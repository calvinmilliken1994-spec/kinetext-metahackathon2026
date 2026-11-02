"""Judge relay core (docs/specs/STAGE-11-judge-relay.md).

Pure logic, no Modal imports: `create_app(store, transport, settings)` builds the FastAPI app. `app.py` wires Modal.

A judge's local server holds only an access code. This relay checks the code, the model allowlist, the budget cap and the
kill switch, then forwards the request with Calvin's real upstream credentials, which exist only in `Settings`.

Nothing in this module logs a body, a code, a key or a header, and error text from upstreams or exceptions is never
echoed to the caller.
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
UPSTREAM_TIMEOUT_S = 600.0

# USD per token (Muse Spark 1.3 and Spark Open share these rates; no cached discount, deliberately conservative)
INPUT_USD_PER_TOKEN = 1.25e-6
OUTPUT_USD_PER_TOKEN = 4.25e-6
SAM_COST_USD = 0.0025

RATE_LIMIT_FAILURES = 10
RATE_LIMIT_WINDOW_S = 60.0
_MAX_TRACKED_IPS = 5000


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
    rate_limit_failures: int = RATE_LIMIT_FAILURES
    rate_limit_window_s: float = RATE_LIMIT_WINDOW_S
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
        )
        settings.validate()
        return settings


# --------------------------------------------------------------------------------------------- cost rules


def _positive_int(value: Any) -> int | None:
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        return None
    return value


def estimate_chat_cost_usd(body_bytes: bytes, body: Mapping[str, Any]) -> float:
    """(len(body)/3 * 1.25 + max_out * 4.25) / 1e6 with max_out = max_completion_tokens or max_tokens or 32000.

    Unusable values (zero, negative, non-integers) fall back to the default so a request can never shrink its
    own reservation.
    """
    max_out = _positive_int(body.get("max_completion_tokens")) or _positive_int(body.get("max_tokens")) or DEFAULT_MAX_OUT_TOKENS
    return (len(body_bytes) / 3 * 1.25 + max_out * 4.25) / 1e6


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
        self.spent = 0.0
        self.reserved = 0.0
        self._loaded = False
        self._persist_lock = asyncio.Lock()

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

    def _read_state(self) -> tuple[bool, float | None]:
        enabled = self.store.get("enabled", True) is True
        spent = None
        if not self._loaded:
            raw = self.store.get("spentUSD", 0.0)
            spent = float(raw)
            if isinstance(raw, bool) or not math.isfinite(spent) or spent < 0:
                raise ValueError("bad spentUSD")
        return enabled, spent

    async def _state(self) -> bool | None:
        """Return `enabled`; None when the state cannot be read (callers fail closed)."""
        try:
            enabled, spent = await asyncio.to_thread(self._read_state)
        except Exception:
            log.warning("state read failed")
            return None
        if not self._loaded and spent is not None:  # no await between check and set
            self.spent = spent
            self._loaded = True
        return enabled

    async def _persist(self) -> None:
        async with self._persist_lock:
            value = self.spent
            try:
                await asyncio.to_thread(self.store.put, "spentUSD", value)
            except Exception:
                log.warning("state write failed")

    def _client_for_call(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(
                transport=self.transport,
                timeout=httpx.Timeout(self.s.upstream_timeout_s, connect=15.0),
                follow_redirects=False,
            )
        return self._client

    async def aclose(self) -> None:
        client, self._client = self._client, None
        if client is not None:
            await client.aclose()

    # ---- routes

    async def status(self, request: Request) -> Response:
        ctx = _Ctx("status")
        t0 = time.perf_counter()
        try:
            denied = self._authenticate(request, ctx, _bearer_code(request))
            if denied is not None:
                return denied
            enabled = await self._state()
            spent = self.spent if self._loaded else self.s.cap_usd  # unreadable state reads as fully spent
            ctx.status = 200
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

        raw = await self._read_body(request)
        body = _parse_object(raw) if raw is not None else None
        if raw is None or body is None or body.get("model") != route.model:
            return _error(ctx, 400, "RELAY_REQUEST_INVALID", "The request body is not allowed on this route.")

        estimate = estimate_chat_cost_usd(raw, body) if route.kind == "chat" else SAM_COST_USD
        # No await between this check and the reservation: concurrent requests cannot both pass on the same headroom.
        if self.spent + self.reserved + estimate > self.s.cap_usd:
            return _error(ctx, 402, "RELAY_BUDGET_SPENT", "The relay budget is spent.")
        self.reserved += estimate

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
                content=upstream.content,
                status_code=upstream.status_code,
                headers={"content-type": upstream.headers.get("content-type", "application/json")},
            )
            ctx.status = upstream.status_code
        except httpx.TimeoutException:
            response = _error(ctx, 504, "RELAY_UPSTREAM_TIMEOUT", "The upstream model did not answer in time.")
        except Exception:
            response = _error(ctx, 502, "RELAY_UPSTREAM_UNREACHABLE", "The upstream model could not be reached.")
        finally:
            self.reserved -= estimate
            if self.reserved < 1e-12:
                self.reserved = 0.0
            self.spent += charge
            ctx.charged = charge
            await asyncio.shield(self._persist())
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
