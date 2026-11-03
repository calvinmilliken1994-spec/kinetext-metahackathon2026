"""Judge relay core (docs/specs/STAGE-11-judge-relay.md).

Pure logic, no Modal imports: `create_app(store, transport, settings)` builds the FastAPI app. `app.py` wires Modal.

A judge's local server holds only an access code. This relay checks the code, the model allowlist, the budget cap and the
kill switch, then forwards the request with Calvin's real upstream credentials, which exist only in `Settings`.

Nothing in this module logs a body, a code, a key or a header, and error text from exceptions is never echoed to the
caller. Upstream answers are relayed with every configured credential replaced by "[redacted]".

Spend is durable (security review 2026-11-02): the estimate is written to the store BEFORE the request is forwarded and only
the difference to the actual cost is written afterwards, so a crash or restart mid-call leaves the estimate charged. This
assumes ONE container (`max_containers=1`, see app.py): the lock that serialises the read-modify-write of `spentUSD` is
process-local, and there is no fencing against a second container.
"""
from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import logging
import math
import re
import time
from collections import deque
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import Any, Callable, Mapping, Protocol
from urllib.parse import urlsplit

import httpx
from fastapi import FastAPI, Request
from fastapi.exception_handlers import http_exception_handler
from fastapi.responses import JSONResponse, Response
from starlette.exceptions import HTTPException as StarletteHTTPException

RELAY_LOGGER_NAME = "mki.relay"
log = logging.getLogger(RELAY_LOGGER_NAME)

CHAT_MODEL = "muse-spark-1.3"
SAM_MODEL = "sam-3.1"
OPEN_MODEL = "meta-models/Muse-Spark-Open-816B-A42B"

META_BASE_URL = "https://api.meta.ai/v1"
MAX_BODY_BYTES = 12 * 1024 * 1024
MIN_CODE_LENGTH = 20
DEFAULT_CAP_USD = 50.0
DEFAULT_MAX_OUT_TOKENS = 32000
MAX_OUT_TOKENS_LIMIT = 32000  # the largest max_tokens / max_completion_tokens a chat request may ask for
INPUT_BYTES_PER_TOKEN = 2  # conservative: at most one input token per two request bytes (was three)
UPSTREAM_TIMEOUT_S = 600.0
BODY_READ_TIMEOUT_S = 60.0
REDACTED = "[redacted]"

# USD per token (Muse Spark 1.3 and Spark Open share these rates; no cached discount, deliberately conservative)
INPUT_USD_PER_TOKEN = 1.25e-6
OUTPUT_USD_PER_TOKEN = 4.25e-6
SAM_COST_USD = 0.0025

RATE_LIMIT_FAILURES = 10
RATE_LIMIT_WINDOW_S = 60.0
_MAX_TRACKED_IPS = 5000

# Discord pings (optional, DISCORD_WEBHOOK_URL): posted in the background so a slow or broken Discord never touches a
# judge's request. Messages carry the event, the model and the budget; never a code, an address or a mention.
NOTIFY_TIMEOUT_S = 5.0
NOTIFY_MAX_PENDING = 20
ACCESS_PING_EVERY_S = 3600.0  # one "access granted" per visitor per hour (the app re-checks the code every few minutes)
BUILD_QUIET_S = 300.0  # a chat call after five quiet minutes counts as a new live build
BUDGET_ALERTS_USD = (10.0, 25.0, 40.0)
MODEL_LABELS = {CHAT_MODEL: "Muse Spark 1.3", OPEN_MODEL: "Muse Spark Open"}
_WEBHOOK_RE = re.compile(r"^https://(?:discord\.com|discordapp\.com)/api/webhooks/\d+/[A-Za-z0-9_-]+$")


class Store(Protocol):
    """The slice of `modal.Dict` the relay uses (a plain object with get/put works in tests)."""

    def get(self, key: str, default: Any = None) -> Any: ...

    def put(self, key: str, value: Any) -> Any: ...


# --------------------------------------------------------------------------------------------- settings


def split_proxy_token(token: str) -> tuple[str, str]:
    """Split a stored `MODAL_PROXY_TOKEN` (`wk-...<sep>ws-...`) into (Modal-Key, Modal-Secret).

    The separator Calvin stored sits at the end of the key half and may be any non-token character.
    """
    text = token.strip()
    m = re.fullmatch(r"(wk-[A-Za-z0-9_-]+?)[^A-Za-z0-9_-]+(ws-[A-Za-z0-9_-]+)", text)
    if m:
        return m.group(1), m.group(2)
    idx = text.rfind("ws-")
    if text.startswith("wk-") and idx > 3:
        key = re.sub(r"[^A-Za-z0-9_-]", "", text[:idx])
        secret = re.sub(r"[^A-Za-z0-9_-]", "", text[idx:])
        if len(key) > 3 and len(secret) > 3:
            return key, secret
    raise ValueError("MODAL_PROXY_TOKEN is not in the wk-...ws-... shape")


def _clean_base_url(name: str, value: str) -> str:
    parts = urlsplit(value.strip())
    if (
        parts.scheme != "https"
        or not parts.hostname
        or parts.username is not None
        or parts.password is not None
        or parts.query
        or parts.fragment
    ):
        raise ValueError(f"{name} must be a plain https URL without credentials, query or fragment")
    return value.strip().rstrip("/")


@dataclass(frozen=True)
class Settings:
    access_codes: tuple[str, ...]
    meta_api_key: str
    modal_key: str
    modal_secret: str
    modal_base_url: str  # includes the /v1 segment, e.g. https://<ws>--ep-<name>-server.us-west.modal.direct/v1
    cap_usd: float = DEFAULT_CAP_USD
    meta_base_url: str = META_BASE_URL
    upstream_timeout_s: float = UPSTREAM_TIMEOUT_S
    max_body_bytes: int = MAX_BODY_BYTES
    body_read_timeout_s: float = BODY_READ_TIMEOUT_S
    rate_limit_failures: int = RATE_LIMIT_FAILURES
    rate_limit_window_s: float = RATE_LIMIT_WINDOW_S
    discord_webhook_url: str = field(default="", repr=False)
    clock: Callable[[], float] = field(default=time.monotonic, repr=False, compare=False)

    def __repr__(self) -> str:  # never print secrets, even by accident
        return f"Settings(cap_usd={self.cap_usd}, codes={len(self.access_codes)})"

    def validate(self) -> None:
        if not self.access_codes:
            raise ValueError("ACCESS_CODES must contain at least one code")
        if any(len(c) < MIN_CODE_LENGTH for c in self.access_codes):
            raise ValueError(f"ACCESS_CODES: every code must be at least {MIN_CODE_LENGTH} characters")
        if not (isinstance(self.cap_usd, (int, float)) and math.isfinite(self.cap_usd) and self.cap_usd > 0):
            raise ValueError("CAP_USD must be a positive number")
        for name, value in [("META_API_KEY", self.meta_api_key), ("MODAL_PROXY_KEY", self.modal_key),
                            ("MODAL_PROXY_SECRET", self.modal_secret)]:
            if not value:
                raise ValueError(f"{name} is missing")
        if self.discord_webhook_url and not _WEBHOOK_RE.match(self.discord_webhook_url):
            raise ValueError("DISCORD_WEBHOOK_URL must be a https://discord.com/api/webhooks/... URL")

    @classmethod
    def from_env(cls, env: Mapping[str, str]) -> "Settings":
        """Build settings from the Modal Secret's environment. Errors name the variable, never its value."""
        raw_codes = env.get("ACCESS_CODES", "")
        codes = tuple(c.strip() for c in raw_codes.split(",") if c.strip())
        if not codes:
            raise ValueError("ACCESS_CODES is missing or empty")
        if any(len(c) < MIN_CODE_LENGTH for c in codes):
            raise ValueError(f"ACCESS_CODES: every code must be at least {MIN_CODE_LENGTH} characters")

        raw_cap = env.get("CAP_USD", "").strip()
        try:
            cap = float(raw_cap) if raw_cap else DEFAULT_CAP_USD
        except ValueError:
            raise ValueError("CAP_USD must be a positive number") from None
        if not (math.isfinite(cap) and cap > 0):
            raise ValueError("CAP_USD must be a positive number")

        meta_key = env.get("META_API_KEY", "").strip()
        if not meta_key:
            raise ValueError("META_API_KEY is missing")

        key, secret = env.get("MODAL_PROXY_KEY", "").strip(), env.get("MODAL_PROXY_SECRET", "").strip()
        if not (key and secret):
            token = env.get("MODAL_PROXY_TOKEN", "").strip()
            if not token:
                raise ValueError("MODAL_PROXY_KEY and MODAL_PROXY_SECRET (or MODAL_PROXY_TOKEN) are missing")
            try:
                key, secret = split_proxy_token(token)
            except ValueError:
                raise ValueError("MODAL_PROXY_TOKEN is not in the wk-...ws-... shape") from None

        base = env.get("MODAL_BASE_URL", "").strip()
        if not base:
            raise ValueError("MODAL_BASE_URL is missing")
        settings = cls(
            access_codes=codes,
            meta_api_key=meta_key,
            modal_key=key,
            modal_secret=secret,
            modal_base_url=_clean_base_url("MODAL_BASE_URL", base),
            cap_usd=cap,
            discord_webhook_url=env.get("DISCORD_WEBHOOK_URL", "").strip(),
        )
        settings.validate()
        return settings


# --------------------------------------------------------------------------------------------- cost rules


def _positive_int(value: Any) -> int | None:
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        return None
    return value


def estimate_chat_cost_usd(body_bytes: bytes, body: Mapping[str, Any]) -> float:
    """(len(body)/2 * 1.25 + max_out * 4.25) / 1e6 with max_out = max_completion_tokens or max_tokens or 32000.

    Routes validate the bound before this runs (see `_validate_chat`); unusable values (zero, negative, non-integers)
    still fall back to the default so a request can never shrink its own reservation.
    """
    max_out = _positive_int(body.get("max_completion_tokens")) or _positive_int(body.get("max_tokens")) or DEFAULT_MAX_OUT_TOKENS
    return (len(body_bytes) / INPUT_BYTES_PER_TOKEN * 1.25 + max_out * 4.25) / 1e6


def chat_cost_usd(usage: Any) -> float | None:
    """prompt_tokens * 1.25e-6 + completion_tokens * 4.25e-6, or None when usage is missing or malformed.

    completion_tokens already includes reasoning tokens; reasoning breakdowns are never added on top.
    """
    if not isinstance(usage, Mapping):
        return None
    prompt, completion = _nonneg_int(usage.get("prompt_tokens")), _nonneg_int(usage.get("completion_tokens"))
    if prompt is None or completion is None:
        return None
    return prompt * INPUT_USD_PER_TOKEN + completion * OUTPUT_USD_PER_TOKEN


def _nonneg_int(value: Any) -> int | None:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        return None
    return value


# --------------------------------------------------------------------------------------------- request parsing


def _no_duplicate_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for key, value in pairs:
        if key in out:
            # A parser differential (we read the last duplicate, upstream the first) would bypass the model allowlist.
            raise ValueError("duplicate key")
        out[key] = value
    return out


def _reject_constant(_name: str) -> Any:
    raise ValueError("non-finite number")


def _parse_object(raw: bytes) -> dict[str, Any] | None:
    try:
        parsed = json.loads(
            raw.decode("utf-8"), object_pairs_hook=_no_duplicate_keys, parse_constant=_reject_constant
        )
    except (ValueError, RecursionError):
        return None
    return parsed if isinstance(parsed, dict) else None


def _is_int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _valid_chat_body(body: Mapping[str, Any]) -> bool:
    """Bounded chat request: no streaming, one choice, exactly one max-token bound that is an integer in [1, 32000]."""
    if body.get("stream"):
        return False
    if "n" in body and not (_is_int(body["n"]) and body["n"] == 1):
        return False
    has_max, has_completion = "max_tokens" in body, "max_completion_tokens" in body
    if has_max == has_completion:  # both present, or neither
        return False
    bound = body["max_tokens"] if has_max else body["max_completion_tokens"]
    return _is_int(bound) and 1 <= bound <= MAX_OUT_TOKENS_LIMIT and _images_inline(body)


def _images_inline(node: Any) -> bool:
    """Every image URL in the body is an inline `data:` URL: a remote image would be fetched and billed by the provider
    outside the byte-based estimate (security review residual, 2026-11-02). Our client only sends data URLs."""
    if isinstance(node, dict):
        for key, value in node.items():
            if key in ("image_url", "url") and isinstance(value, str) and not value.startswith("data:"):
                if key == "image_url" or node.get("type") in (None, "image_url") or "image" in str(node.get("type", "")):
                    return False
            if not _images_inline(value):
                return False
    elif isinstance(node, list):
        return all(_images_inline(v) for v in node)
    return True


def _count_media(node: Any) -> tuple[int, bool]:
    """(image inputs, any video input) anywhere in a request body, however they are nested.

    A dict whose `type` mentions "image" (input_image, image_url, ...) is one image; one that mentions "video" is refused
    outright. This is the encoding packages/meta/sam.ts uses: input[].content[] parts of type input_image.
    """
    images, video = 0, False
    if isinstance(node, dict):
        kind = node.get("type")
        if isinstance(kind, str):
            low = kind.lower()
            if "video" in low:
                video = True
            elif "image" in low:
                images += 1
        for value in node.values():
            n, v = _count_media(value)
            images, video = images + n, video or v
    elif isinstance(node, list):
        for value in node:
            n, v = _count_media(value)
            images, video = images + n, video or v
    return images, video


def _valid_sam_body(body: Mapping[str, Any]) -> bool:
    """One image at most and no video. `stream` may only be a boolean: our SAM client sends stream:true and parses the
    SSE reply, the relay buffers it, and SAM costs a flat amount per call, so streaming cannot multiply the cost."""
    if "stream" in body and not isinstance(body["stream"], bool):
        return False
    images, video = _count_media(body)
    return images <= 1 and not video


def _bearer_code(request: Request) -> str | None:
    value = request.headers.get("authorization")
    if not value:
        return None
    parts = value.split(None, 1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        return None
    return parts[1].strip()


def _path_code(request: Request) -> str | None:
    """The code in /modal/c/<code>/v1/...: Modal's edge strips Modal-Key/Modal-Secret before the app sees them (live, 2 Nov)."""
    value = request.path_params.get("code")
    return value.strip() if isinstance(value, str) and value.strip() else None


def _modal_secret_code(request: Request) -> str | None:
    value = request.headers.get("modal-secret")
    if not value or not value.startswith("ws-"):
        return None
    return value[3:].strip()


@dataclass(frozen=True)
class _Route:
    name: str  # log label
    model: str
    kind: str  # "chat" | "sam"
    upstream: str  # "meta" | "modal"
    path: str  # upstream path appended to the base URL
    code_from: Callable[[Request], str | None]


ROUTES = {
    "/meta/v1/chat/completions": _Route("meta.chat", CHAT_MODEL, "chat", "meta", "/chat/completions", _bearer_code),
    "/meta/v1/responses": _Route("meta.responses", SAM_MODEL, "sam", "meta", "/responses", _bearer_code),
    "/modal/v1/chat/completions": _Route(
        "modal.chat", OPEN_MODEL, "chat", "modal", "/chat/completions", _modal_secret_code
    ),
    # The route the local API uses (the log label never includes the path, so the code is never logged).
    "/modal/c/{code}/v1/chat/completions": _Route(
        "modal.chat", OPEN_MODEL, "chat", "modal", "/chat/completions", _path_code
    ),
}


class _Ctx:
    """What the one-line request log needs."""

    def __init__(self, route: str):
        self.route = route
        self.status = 0
        self.charged = 0.0


def _error(ctx: _Ctx, status: int, code: str, message: str, headers: dict[str, str] | None = None) -> Response:
    ctx.status = status
    return JSONResponse({"error": {"code": code, "message": message}}, status_code=status, headers=headers)


# --------------------------------------------------------------------------------------------- the app


class _Relay:
    def __init__(self, store: Store, transport: httpx.AsyncBaseTransport | None, settings: Settings):
        settings.validate()
        self.store = store
        self.transport = transport
        self.s = settings
        self._digests = [hashlib.sha256(c.encode("utf-8")).digest() for c in settings.access_codes]
        self._failures: dict[str, deque[float]] = {}
        self._client: httpx.AsyncClient | None = None
        self.spent = 0.0  # mirror of the last persisted total (+ unsettled); the store is the authority
        self._unsettled = 0.0  # charges the store has not (yet) accepted: carried into the next successful write
        self._ledger_lock = asyncio.Lock()  # serialises the read-modify-write of spentUSD within this process
        self._secrets = sorted(
            {
                x.encode("utf-8")
                for x in (settings.meta_api_key, settings.modal_key, settings.modal_secret, settings.discord_webhook_url)
                if x
            },
            key=len,
            reverse=True,
        )
        self._notify_client: httpx.AsyncClient | None = None
        self._notify_tasks: set[asyncio.Task] = set()
        self._access_pinged: dict[bytes, float] = {}  # sha256(client address) -> last ping; the address is never sent
        self._last_chat_at: float | None = None
        self._spent_seen: float | None = None  # spend at the last budget check; thresholds below it never ping
        self._used_up_pinged = False

    # ---- Discord pings (fire and forget)

    def _notify(self, text: str) -> None:
        if not self.s.discord_webhook_url or len(self._notify_tasks) >= NOTIFY_MAX_PENDING:
            return
        try:
            task = asyncio.get_running_loop().create_task(self._post_notify(text))
        except RuntimeError:
            return
        self._notify_tasks.add(task)
        task.add_done_callback(self._notify_tasks.discard)

    async def _post_notify(self, text: str) -> None:
        if self._notify_client is None:
            self._notify_client = httpx.AsyncClient(
                transport=self.transport, timeout=httpx.Timeout(NOTIFY_TIMEOUT_S), follow_redirects=False
            )
        payload = {"username": "Kinetext relay", "content": text, "allowed_mentions": {"parse": []}}
        try:
            res = await self._notify_client.post(self.s.discord_webhook_url, json=payload)
            if res.status_code >= 300:
                log.warning("notify failed status=%s", res.status_code)
        except Exception:
            log.warning("notify failed")  # never the URL: it is a credential

    def _left(self) -> str:
        return f"${max(0.0, self.s.cap_usd - self.spent):.2f} of ${self.s.cap_usd:.2f} left"

    def _ping_access(self, request: Request) -> None:
        ip = request.client.host if request.client else "unknown"
        key = hashlib.sha256(ip.encode("utf-8", "replace")).digest()
        now = self.s.clock()
        last = self._access_pinged.get(key)
        if last is not None and now - last < ACCESS_PING_EVERY_S:
            return
        if len(self._access_pinged) >= _MAX_TRACKED_IPS:
            self._access_pinged.clear()
        self._access_pinged[key] = now
        self._notify(f"Kinetext: someone unlocked live builds with the judge access code. Budget: {self._left()}.")

    def _ping_chat(self, route: _Route) -> None:
        now = self.s.clock()
        quiet = self._last_chat_at is None or now - self._last_chat_at >= BUILD_QUIET_S
        self._last_chat_at = now
        if quiet:
            label = MODEL_LABELS.get(route.model, route.model)
            self._notify(f"Kinetext: a live build started on {label}. Budget: {self._left()}.")

    def _ping_budget(self) -> None:
        before, now_spent = self._spent_seen, self.spent
        self._spent_seen = now_spent if before is None else max(before, now_spent)
        if before is None:
            return
        for mark in BUDGET_ALERTS_USD:
            if before < mark <= now_spent:
                self._notify(f"Kinetext relay: ${mark:.0f} of the ${self.s.cap_usd:.2f} judge budget is spent ({self._left()}).")

    # ---- auth and rate limit

    def _code_ok(self, presented: str | None) -> bool:
        if not presented:
            return False
        digest = hashlib.sha256(presented.encode("utf-8", "replace")).digest()
        ok = False
        for known in self._digests:  # no early exit: every configured code is compared
            ok |= hmac.compare_digest(digest, known)
        return ok

    def _recent_failures(self, ip: str) -> deque[float]:
        now = self.s.clock()
        window = self._failures.get(ip)
        if window is None:
            if len(self._failures) >= _MAX_TRACKED_IPS:
                self._sweep(now)
            window = self._failures.setdefault(ip, deque())
        while window and window[0] <= now - self.s.rate_limit_window_s:
            window.popleft()
        return window

    def _sweep(self, now: float) -> None:
        for key in [k for k, w in self._failures.items() if not w or w[-1] <= now - self.s.rate_limit_window_s]:
            del self._failures[key]
        if len(self._failures) >= _MAX_TRACKED_IPS:
            self._failures.clear()

    def _authenticate(self, request: Request, ctx: _Ctx, code: str | None) -> Response | None:
        ip = request.client.host if request.client else "unknown"
        window = self._recent_failures(ip)
        if len(window) >= self.s.rate_limit_failures:
            return _error(ctx, 429, "RELAY_RATE_LIMITED", "Too many failed attempts. Try again in a minute.",
                          {"Retry-After": str(int(self.s.rate_limit_window_s))})
        if not self._code_ok(code):
            window.append(self.s.clock())
            return _error(ctx, 401, "RELAY_CODE_INVALID", "The access code is missing or not valid.")
        return None

    # ---- state

    def _read_spent(self) -> float:
        raw = self.store.get("spentUSD", 0.0)
        if isinstance(raw, bool) or not isinstance(raw, (int, float, str)):
            raise ValueError("bad spentUSD")
        spent = float(raw)
        if not math.isfinite(spent) or spent < 0:
            raise ValueError("bad spentUSD")
        return spent

    def _read_state(self) -> tuple[bool, float]:
        enabled = self.store.get("enabled", True) is True
        return enabled, self._read_spent() + self._unsettled

    async def _state(self) -> bool | None:
        """Return `enabled` and refresh the spent mirror; None when the state cannot be read (callers fail closed)."""
        try:
            enabled, spent = await asyncio.to_thread(self._read_state)
        except Exception:
            log.warning("state read failed")
            return None
        self.spent = spent
        if self._spent_seen is None:
            self._spent_seen = spent
        return enabled

    async def _enabled_now(self) -> bool:
        """Re-read the kill switch alone; anything but a clean True (including a read error) counts as paused."""
        try:
            return await asyncio.to_thread(lambda: self.store.get("enabled", True) is True)
        except Exception:
            log.warning("state read failed")
            return False

    def _admit_sync(self, estimate: float) -> str:
        """Runs in a worker thread under the ledger lock: cap check against the persisted total, then persist."""
        total = self._read_spent() + self._unsettled
        if total + estimate > self.s.cap_usd:
            return "spent"
        new_total = total + estimate
        self.store.put("spentUSD", new_total)
        self._unsettled = 0.0
        self.spent = new_total
        return "ok"

    async def _admit(self, estimate: float) -> str:
        """Charge `estimate` durably before forwarding: 'ok', 'spent' (cap) or 'unavailable' (store read/write failed)."""
        try:
            async with self._ledger_lock:
                return await asyncio.to_thread(self._admit_sync, estimate)
        except Exception:
            log.warning("state write failed")
            return "unavailable"

    def _adjust_sync(self, delta: float) -> None:
        total = self._read_spent() + self._unsettled + delta
        if total < 1e-12:
            total = 0.0
        self.store.put("spentUSD", total)
        self._unsettled = 0.0
        self.spent = total

    async def _adjust(self, delta: float) -> None:
        """Persist `delta` (actual minus estimate; negative refunds). On failure the delta is kept and carried into the
        next write, while the estimate admission persisted stays charged (the conservative side)."""
        if delta == 0.0:
            return
        async with self._ledger_lock:
            try:
                await asyncio.to_thread(self._adjust_sync, delta)
            except Exception:
                self._unsettled += delta
                self.spent += delta
                log.warning("state write failed")

    def _redact(self, data: bytes) -> bytes:
        for secret in self._secrets:
            data = data.replace(secret, REDACTED.encode())
        return data

    def _redact_text(self, text: str) -> str:
        for secret in self._secrets:
            text = text.replace(secret.decode("utf-8"), REDACTED)
        return text

    def _client_for_call(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(
                transport=self.transport,
                timeout=httpx.Timeout(self.s.upstream_timeout_s, connect=15.0),
                follow_redirects=False,
            )
        return self._client

    async def aclose(self) -> None:
        for task in list(self._notify_tasks):
            task.cancel()
        client, self._client = self._client, None
        if client is not None:
            await client.aclose()
        notify, self._notify_client = self._notify_client, None
        if notify is not None:
            await notify.aclose()

    # ---- routes

    async def status(self, request: Request) -> Response:
        ctx = _Ctx("status")
        t0 = time.perf_counter()
        try:
            denied = self._authenticate(request, ctx, _bearer_code(request))
            if denied is not None:
                return denied
            enabled = await self._state()
            spent = self.spent if enabled is not None else self.s.cap_usd  # unreadable state reads as fully spent
            ctx.status = 200
            self._ping_access(request)
            return JSONResponse(
                {
                    "ok": True,
                    "enabled": bool(enabled),
                    "capUSD": round(self.s.cap_usd, 2),
                    "spentUSD": round(spent, 2),
                    "remainingUSD": round(max(0.0, self.s.cap_usd - spent), 2),
                }
            )
        finally:
            self._log(ctx, t0)

    async def forward(self, request: Request, route: _Route) -> Response:
        ctx = _Ctx(route.name)
        t0 = time.perf_counter()
        try:
            return await self._forward(request, route, ctx)
        finally:
            self._log(ctx, t0)

    def _log(self, ctx: _Ctx, t0: float) -> None:
        log.info(
            "route=%s status=%s latency_ms=%d charged_usd=%.6f",
            ctx.route, ctx.status or 499, int((time.perf_counter() - t0) * 1000), ctx.charged,
        )

    async def _read_body(self, request: Request) -> bytes | None:
        limit = self.s.max_body_bytes
        declared = request.headers.get("content-length")
        if declared and declared.isdigit() and int(declared) > limit:
            return None
        chunks: list[bytes] = []
        size = 0
        async for chunk in request.stream():
            size += len(chunk)
            if size > limit:
                return None
            chunks.append(chunk)
        return b"".join(chunks)

    async def _forward(self, request: Request, route: _Route, ctx: _Ctx) -> Response:
        denied = self._authenticate(request, ctx, route.code_from(request))
        if denied is not None:
            return denied

        enabled = await self._state()
        if not enabled:  # paused, or state unreadable: fail closed
            return _error(ctx, 503, "RELAY_PAUSED", "The relay is paused.")

        try:
            raw = await asyncio.wait_for(self._read_body(request), self.s.body_read_timeout_s)
        except asyncio.TimeoutError:
            return _error(ctx, 408, "RELAY_REQUEST_INVALID", "The request body was not received in time.")
        body = _parse_object(raw) if raw is not None else None
        valid = raw is not None and body is not None and body.get("model") == route.model
        if valid:
            valid = _valid_chat_body(body) if route.kind == "chat" else _valid_sam_body(body)
        if not valid:
            return _error(ctx, 400, "RELAY_REQUEST_INVALID", "The request body is not allowed on this route.")

        estimate = estimate_chat_cost_usd(raw, body) if route.kind == "chat" else SAM_COST_USD
        # Charge the estimate durably BEFORE forwarding: a crash or restart from here on leaves it charged.
        admitted = await self._admit(estimate)
        if admitted == "spent":
            if not self._used_up_pinged:
                self._used_up_pinged = True
                self._notify("Kinetext relay: the judge budget is used up. Live builds now answer 'budget spent'.")
            return _error(ctx, 402, "RELAY_BUDGET_SPENT", "The relay budget is spent.")
        if admitted != "ok":  # the ledger could not be read or written: nothing is forwarded, nothing is charged
            return _error(ctx, 503, "RELAY_PAUSED", "The relay is paused.")

        # Dispatch fence: the switch may have been thrown while the body was being read or the spend written.
        if not await asyncio.shield(self._enabled_now()):
            await asyncio.shield(self._adjust(-estimate))
            return _error(ctx, 503, "RELAY_PAUSED", "The relay is paused.")

        if route.kind == "chat":
            self._ping_chat(route)

        if route.upstream == "meta":
            url = self.s.meta_base_url.rstrip("/") + route.path
            headers = {"Authorization": f"Bearer {self.s.meta_api_key}", "Content-Type": "application/json"}
        else:
            url = self.s.modal_base_url.rstrip("/") + route.path
            headers = {"Modal-Key": self.s.modal_key, "Modal-Secret": self.s.modal_secret,
                       "Content-Type": "application/json"}

        charge = estimate  # until the upstream answers: the call may have run (timeouts, cancellation, crashes)
        response: Response
        try:
            upstream = await self._client_for_call().post(url, content=raw, headers=headers)
            charge = self._actual_charge(route, upstream, estimate)
            response = Response(
                content=self._redact(upstream.content),
                status_code=upstream.status_code,
                headers={"content-type": self._redact_text(upstream.headers.get("content-type", "application/json"))},
            )
            ctx.status = upstream.status_code
        except httpx.TimeoutException:
            response = _error(ctx, 504, "RELAY_UPSTREAM_TIMEOUT", "The upstream model did not answer in time.")
        except Exception:
            response = _error(ctx, 502, "RELAY_UPSTREAM_UNREACHABLE", "The upstream model could not be reached.")
        finally:
            # The estimate is already in the ledger; settle only the difference (0 when the rules charge the estimate).
            ctx.charged = charge
            await asyncio.shield(self._adjust(charge - estimate))
            if route.kind == "chat":
                self._last_chat_at = self.s.clock()  # a long call keeps the build "active" until it ends
            self._ping_budget()
        return response

    @staticmethod
    def _actual_charge(route: _Route, upstream: httpx.Response, estimate: float) -> float:
        ok = upstream.status_code == 200
        if route.kind == "sam":
            return SAM_COST_USD if ok else 0.0
        try:
            payload = upstream.json()
        except ValueError:
            payload = None
        usage = payload.get("usage") if isinstance(payload, dict) else None
        by_usage = chat_cost_usd(usage)
        if by_usage is not None:
            return by_usage
        return estimate if ok else 0.0


def create_app(store: Store, transport: httpx.AsyncBaseTransport | None, settings: Settings) -> FastAPI:
    relay = _Relay(store, transport, settings)

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        yield
        await relay.aclose()

    app = FastAPI(title="mki-relay", docs_url=None, redoc_url=None, openapi_url=None, lifespan=lifespan)

    @app.exception_handler(StarletteHTTPException)
    async def _http_errors(request: Request, exc: StarletteHTTPException):
        log.info("route=other status=%s latency_ms=0 charged_usd=0.000000", exc.status_code)
        return await http_exception_handler(request, exc)

    @app.get("/healthz")
    async def healthz() -> dict[str, bool]:
        return {"ok": True}

    @app.get("/v1/status")
    async def status(request: Request) -> Response:
        return await relay.status(request)

    def add(path: str, route: _Route) -> None:
        async def handler(request: Request) -> Response:
            return await relay.forward(request, route)

        app.add_api_route(path, handler, methods=["POST"], name=route.name)

    for path, route in ROUTES.items():
        add(path, route)

    app.state.relay = relay
    return app
