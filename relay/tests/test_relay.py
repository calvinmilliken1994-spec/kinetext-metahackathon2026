"""Tests for the judge relay (docs/specs/STAGE-11-judge-relay.md).

All upstreams are mocked with httpx.MockTransport; nothing here touches the network, Modal or a real key.
Run: uv run --with fastapi --with httpx --with pytest pytest relay -q
"""
from __future__ import annotations

import asyncio
import dataclasses
import json
import logging
import re

import httpx
import pytest
from fastapi.testclient import TestClient

import relay_core
from relay_core import (
    CHAT_MODEL,
    MAX_BODY_BYTES,
    OPEN_MODEL,
    SAM_COST_USD,
    SAM_MODEL,
    Settings,
    chat_cost_usd,
    create_app,
    estimate_chat_cost_usd,
    split_proxy_token,
)

CODE = "judge-code-0123456789-abcdef"
CODE2 = "second-code-9876543210-zyxwvu"
WRONG = "totally-wrong-code-0000000000"
META_KEY = "LLM_REALMETAKEY_aaaaaaaaaaaaaaaaaaaa"
MODAL_KEY = "wk-REALMODALKEYaaaaaaaa"
MODAL_SECRET = "ws-REALMODALSECRETbbbbbbbb"
MODAL_BASE = "https://acct--ep-demo-server.us-west.modal.direct/v1"
PROMPT_MARKER = "PRIVATE-PROMPT-TEXT-qwertyuiop"

META_CHAT = "/meta/v1/chat/completions"
META_RESP = "/meta/v1/responses"
MODAL_CHAT = "/modal/v1/chat/completions"


def cost(prompt: int, completion: int) -> float:
    return prompt * 1.25e-6 + completion * 4.25e-6


def make_settings(**kw) -> Settings:
    base = dict(
        access_codes=(CODE, CODE2),
        cap_usd=50.0,
        meta_api_key=META_KEY,
        modal_key=MODAL_KEY,
        modal_secret=MODAL_SECRET,
        modal_base_url=MODAL_BASE,
    )
    base.update(kw)
    return Settings(**base)


class FakeStore:
    """Same get/put surface as modal.Dict."""

    def __init__(self, **initial):
        self.data = dict(initial)
        self.fail_get = False
        self.fail_put = False
        self.puts = 0

    def get(self, key, default=None):
        if self.fail_get:
            raise RuntimeError("store down")
        return self.data.get(key, default)

    def put(self, key, value):
        if self.fail_put:
            raise RuntimeError("store down")
        self.puts += 1
        self.data[key] = value


class Upstream:
    def __init__(self, responder=None):
        self.requests: list[httpx.Request] = []
        self.responder = responder or (lambda req: ok_chat())

    def __call__(self, request: httpx.Request):
        self.requests.append(request)
        out = self.responder(request)
        if isinstance(out, Exception):
            raise out
        return out


def ok_chat(prompt=1000, completion=2000, **extra):
    usage = {
        "prompt_tokens": prompt,
        "completion_tokens": completion,
        "completion_tokens_details": {"reasoning_tokens": 500},
    }
    usage.update(extra)
    return httpx.Response(200, json={"id": "chatcmpl-1", "choices": [], "usage": usage})


class Clock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now


def build(upstream=None, store=None, **settings_kw):
    upstream = upstream or Upstream()
    store = store if store is not None else FakeStore()
    settings = make_settings(**settings_kw)
    app = create_app(store, httpx.MockTransport(upstream), settings)
    return app, store, upstream


@pytest.fixture
def env():
    app, store, upstream = build()
    with TestClient(app) as client:
        yield client, store, upstream


def body_for(model: str, **extra) -> bytes:
    return json.dumps({"model": model, "messages": [{"role": "user", "content": PROMPT_MARKER}], **extra}).encode()


def bearer(code=CODE):
    return {"Authorization": f"Bearer {code}", "Content-Type": "application/json"}


def modal_headers(code=CODE):
    return {"Modal-Key": "wk-relay", "Modal-Secret": f"ws-{code}", "Content-Type": "application/json"}


ROUTES = [
    # (path, model, header factory)
    (META_CHAT, CHAT_MODEL, bearer),
    (META_RESP, SAM_MODEL, bearer),
    (MODAL_CHAT, OPEN_MODEL, modal_headers),
]
ROUTE_IDS = ["meta-chat", "meta-responses", "modal-chat"]


def all_header_values(req: httpx.Request) -> str:
    return " ".join(f"{k}={v}" for k, v in req.headers.items())


# ----------------------------------------------------------------------------- healthz


def test_healthz_needs_no_code_and_leaks_nothing(env):
    client, store, _ = env
    r = client.get("/healthz")
    assert r.status_code == 200
    assert r.json() == {"ok": True}
    store.data["enabled"] = False
    store.data["spentUSD"] = 12.0
    r = client.get("/healthz")
    assert r.json() == {"ok": True}


def test_healthz_survives_store_failure():
    app, store, _ = build()
    store.fail_get = True
    with TestClient(app) as client:
        assert client.get("/healthz").json() == {"ok": True}


def test_unknown_routes_and_docs_are_not_exposed(env):
    client, _, _ = env
    for path in ["/", "/docs", "/redoc", "/openapi.json", "/meta/v1/models", "/v1/anything"]:
        r = client.get(path)
        assert r.status_code == 404, path
        assert CODE not in r.text
    assert client.get(META_CHAT, headers=bearer()).status_code == 405


# ----------------------------------------------------------------------------- happy paths


def test_meta_chat_forwards_with_real_key_and_strips_code(env):
    client, _, up = env
    raw = body_for(CHAT_MODEL, max_tokens=200)
    headers = {**bearer(), "X-Judge-Extra": "leak-me", "Cookie": "sid=abc"}
    r = client.post(META_CHAT, content=raw, headers=headers)
    assert r.status_code == 200
    assert len(up.requests) == 1
    req = up.requests[0]
    assert str(req.url) == "https://api.meta.ai/v1/chat/completions"
    assert req.method == "POST"
    assert req.headers["authorization"] == f"Bearer {META_KEY}"
    assert req.headers["content-type"] == "application/json"
    assert req.content == raw  # forwarded unchanged
    seen = all_header_values(req) + req.content.decode()
    assert CODE not in seen and CODE2 not in seen
    assert "x-judge-extra" not in req.headers and "cookie" not in req.headers
    assert r.json()["id"] == "chatcmpl-1"


def test_meta_responses_sam_forwards(env):
    client, _, up = env
    raw = body_for(SAM_MODEL)
    r = client.post(META_RESP, content=raw, headers=bearer())
    assert r.status_code == 200
    req = up.requests[0]
    assert str(req.url) == "https://api.meta.ai/v1/responses"
    assert req.headers["authorization"] == f"Bearer {META_KEY}"
    assert req.content == raw
    assert CODE not in all_header_values(req)


def test_modal_chat_forwards_with_proxy_token_and_strips_code(env):
    client, _, up = env
    raw = body_for(OPEN_MODEL)
    headers = {**modal_headers(), "Authorization": f"Bearer {CODE}"}
    r = client.post(MODAL_CHAT, content=raw, headers=headers)
    assert r.status_code == 200
    req = up.requests[0]
    assert str(req.url) == MODAL_BASE + "/chat/completions"
    assert req.headers["modal-key"] == MODAL_KEY  # the judge's 'wk-relay' is ignored
    assert req.headers["modal-secret"] == MODAL_SECRET
    assert "authorization" not in req.headers
    assert req.content == raw
    assert CODE not in all_header_values(req)


def test_modal_chat_takes_the_code_in_the_path(env):
    # Live 2026-11-02: Modal's edge strips Modal-Key/Modal-Secret before the app sees them, so the local API sends the
    # code in the path (/modal/c/<code>/v1/...). Upstream gets Calvin's proxy token; the code goes nowhere upstream.
    client, _, up = env
    raw = body_for(OPEN_MODEL)
    r = client.post(f"/modal/c/{CODE}/v1/chat/completions", content=raw, headers={"Content-Type": "application/json"})
    assert r.status_code == 200
    req = up.requests[0]
    assert str(req.url) == MODAL_BASE + "/chat/completions"
    assert req.headers["modal-secret"] == MODAL_SECRET
    assert CODE not in all_header_values(req) and CODE not in str(req.url)
    bad = client.post("/modal/c/not-the-code-not-the-code/v1/chat/completions", content=raw, headers={"Content-Type": "application/json"})
    assert bad.status_code == 401


def test_response_status_body_and_only_content_type_pass_through():
    payload = b'{"a": "\xc3\xa9 raw  spacing",  "n": 1}'

    def responder(req):
        return httpx.Response(
            200,
            content=payload,
            headers={
                "content-type": "application/json; charset=utf-8",
                "x-upstream-secret": "nope",
                "set-cookie": "a=b",
                "x-request-id": "r1",
            },
        )

    app, _, _ = build(Upstream(responder))
    with TestClient(app) as client:
        r = client.post(META_CHAT, content=body_for(CHAT_MODEL), headers=bearer())
    assert r.content == payload
    assert r.headers["content-type"] == "application/json; charset=utf-8"
    for h in ["x-upstream-secret", "set-cookie", "x-request-id"]:
        assert h not in r.headers


def test_second_configured_code_works(env):
    client, _, up = env
    assert client.post(META_CHAT, content=body_for(CHAT_MODEL), headers=bearer(CODE2)).status_code == 200
    assert client.post(MODAL_CHAT, content=body_for(OPEN_MODEL), headers=modal_headers(CODE2)).status_code == 200
    assert len(up.requests) == 2


# ----------------------------------------------------------------------------- auth


@pytest.mark.parametrize("path,model,hdr", ROUTES, ids=ROUTE_IDS)
def test_missing_and_wrong_code_are_401(env, path, model, hdr):
    client, store, up = env
    raw = body_for(model)
    for headers in [{"Content-Type": "application/json"}, hdr(WRONG), hdr(CODE[:-1]), hdr(CODE + "x"), hdr("")]:
        r = client.post(path, content=raw, headers=headers)
        assert r.status_code == 401, headers
        assert r.json() == {"error": {"code": "RELAY_CODE_INVALID", "message": r.json()["error"]["message"]}}
        assert CODE not in r.text
    assert up.requests == []
    assert store.data.get("spentUSD", 0) == 0


def test_status_requires_valid_code(env):
    client, _, _ = env
    assert client.get("/v1/status").status_code == 401
    assert client.get("/v1/status", headers=bearer(WRONG)).json()["error"]["code"] == "RELAY_CODE_INVALID"
    assert client.get("/v1/status", headers=bearer()).status_code == 200


def test_auth_header_shapes_are_not_interchangeable(env):
    client, _, up = env
    # Modal route needs the ws- prefix in Modal-Secret, and ignores Authorization
    r = client.post(MODAL_CHAT, content=body_for(OPEN_MODEL), headers={"Modal-Secret": CODE})
    assert r.status_code == 401
    r = client.post(MODAL_CHAT, content=body_for(OPEN_MODEL), headers=bearer())
    assert r.status_code == 401
    # any three characters in front of the code must not pass for the ws- prefix
    r = client.post(MODAL_CHAT, content=body_for(OPEN_MODEL), headers={"Modal-Secret": f"xyz{CODE}"})
    assert r.status_code == 401
    r = client.post(MODAL_CHAT, content=body_for(OPEN_MODEL), headers={"Modal-Secret": f"WS-{CODE}"})
    assert r.status_code == 401
    # Meta routes need the Bearer scheme and ignore Modal-Secret
    r = client.post(META_CHAT, content=body_for(CHAT_MODEL), headers={"Modal-Secret": f"ws-{CODE}"})
    assert r.status_code == 401
    r = client.post(META_CHAT, content=body_for(CHAT_MODEL), headers={"Authorization": f"Basic {CODE}"})
    assert r.status_code == 401
    r = client.post(META_CHAT, content=body_for(CHAT_MODEL), headers={"Authorization": CODE})
    assert r.status_code == 401
    assert up.requests == []


def test_code_compare_uses_constant_time_digest_compare(monkeypatch):
    calls = []
    real = relay_core.hmac.compare_digest

    def spy(a, b):
        calls.append((len(a), len(b)))
        return real(a, b)

    monkeypatch.setattr(relay_core.hmac, "compare_digest", spy)
    app, _, _ = build()
    with TestClient(app) as client:
        client.get("/v1/status", headers=bearer(WRONG))
    assert len(calls) == 2  # every configured code is compared, no early exit
    assert all(a == b == 32 for a, b in calls)  # SHA-256 digests, equal length whatever the input


# ----------------------------------------------------------------------------- rate limit


def test_rate_limit_429_after_10_failures_per_ip_per_minute():
    clock = Clock()
    app, _, up = build(clock=clock)
    with TestClient(app, client=("203.0.113.7", 5000)) as c1, TestClient(app, client=("198.51.100.9", 5000)) as c2:
        for _ in range(10):
            assert c1.get("/v1/status", headers=bearer(WRONG)).status_code == 401
        r = c1.get("/v1/status", headers=bearer(WRONG))
        assert r.status_code == 429
        assert r.json()["error"]["code"] == "RELAY_RATE_LIMITED"
        # even a valid code is refused from a blocked IP, and refusals do not extend the window
        assert c1.get("/v1/status", headers=bearer()).status_code == 429
        # other IPs are unaffected
        assert c2.get("/v1/status", headers=bearer()).status_code == 200
        assert c2.get("/v1/status", headers=bearer(WRONG)).status_code == 401
        # healthz is never limited
        assert c1.get("/healthz").status_code == 200
        # the window slides
        clock.now += 61
        assert c1.get("/v1/status", headers=bearer()).status_code == 200
    assert up.requests == []


def test_successes_do_not_count_as_failures():
    app, _, _ = build()
    with TestClient(app) as c:
        for _ in range(30):
            assert c.get("/v1/status", headers=bearer()).status_code == 200
        for _ in range(10):
            assert c.get("/v1/status", headers=bearer(WRONG)).status_code == 401


def test_rate_limit_applies_to_forwarding_routes_too():
    app, _, up = build()
    with TestClient(app) as c:
        for _ in range(10):
            assert c.post(META_CHAT, content=body_for(CHAT_MODEL), headers=bearer(WRONG)).status_code == 401
        assert c.post(META_CHAT, content=body_for(CHAT_MODEL), headers=bearer()).status_code == 429
    assert up.requests == []


# ----------------------------------------------------------------------------- request validation


@pytest.mark.parametrize("path,model,hdr", ROUTES, ids=ROUTE_IDS)
def test_model_not_allowlisted_is_400(env, path, model, hdr):
    client, store, up = env
    others = {CHAT_MODEL, SAM_MODEL, OPEN_MODEL, "gpt-4o", "", "MUSE-SPARK-1.3", "muse-spark-1.3 "} - {model}
    for other in others:
        r = client.post(path, content=body_for(other), headers=hdr())
        assert r.status_code == 400, other
        assert r.json()["error"]["code"] == "RELAY_REQUEST_INVALID"
    for bad in [None, 5, ["muse-spark-1.3"], {"x": 1}]:
        raw = json.dumps({"model": bad}).encode()
        assert client.post(path, content=raw, headers=hdr()).status_code == 400
    assert client.post(path, content=b'{"messages": []}', headers=hdr()).status_code == 400
    assert up.requests == []
    assert store.data.get("spentUSD", 0) == 0


@pytest.mark.parametrize("path,model,hdr", ROUTES, ids=ROUTE_IDS)
def test_invalid_json_and_non_object_bodies_are_400(env, path, model, hdr):
    client, _, up = env
    for raw in [b"", b"not json", b"[1,2]", b'"muse"', b"null", b"123", b'{"model": ', b"\xff\xfe\x00", b"[" * 100000]:
        r = client.post(path, content=raw, headers=hdr())
        assert r.status_code == 400, raw[:20]
        assert r.json()["error"]["code"] == "RELAY_REQUEST_INVALID"
    assert up.requests == []


def test_duplicate_model_keys_are_rejected(env):
    # a parser differential (we read the last key, upstream the first) would bypass the allowlist
    client, _, up = env
    raw = ('{"model": "%s", "model": "gpt-4o"}' % CHAT_MODEL).encode()
    assert client.post(META_CHAT, content=raw, headers=bearer()).status_code == 400
    raw = ('{"model": "gpt-4o", "model": "%s"}' % CHAT_MODEL).encode()
    assert client.post(META_CHAT, content=raw, headers=bearer()).status_code == 400
    assert up.requests == []


def test_body_size_limit_is_12_mib():
    assert MAX_BODY_BYTES == 12 * 1024 * 1024
    app, _, up = build(cap_usd=1000.0)
    prefix = ('{"model": "%s", "pad": "' % CHAT_MODEL).encode()
    suffix = b'"}'

    def padded(total: int) -> bytes:
        return prefix + b"x" * (total - len(prefix) - len(suffix)) + suffix

    with TestClient(app) as c:
        ok = padded(MAX_BODY_BYTES)
        assert len(ok) == MAX_BODY_BYTES
        assert c.post(META_CHAT, content=ok, headers=bearer()).status_code == 200
        too_big = padded(MAX_BODY_BYTES + 1)
        r = c.post(META_CHAT, content=too_big, headers=bearer())
        assert r.status_code == 400
        assert r.json()["error"]["code"] == "RELAY_REQUEST_INVALID"
    assert len(up.requests) == 1


def test_oversized_body_with_wrong_code_is_401_not_read(env):
    client, _, _ = env
    r = client.post(META_CHAT, content=b"x" * (MAX_BODY_BYTES + 10), headers=bearer(WRONG))
    assert r.status_code == 401


# ----------------------------------------------------------------------------- estimate


def test_estimate_formula_chat():
    body = {"model": CHAT_MODEL, "max_tokens": 100}
    raw = json.dumps(body).encode()
    assert estimate_chat_cost_usd(raw, body) == pytest.approx((len(raw) / 3 * 1.25 + 100 * 4.25) / 1e6)
    body = {"model": CHAT_MODEL, "max_completion_tokens": 700, "max_tokens": 100}
    raw = json.dumps(body).encode()
    assert estimate_chat_cost_usd(raw, body) == pytest.approx((len(raw) / 3 * 1.25 + 700 * 4.25) / 1e6)
    body = {"model": CHAT_MODEL}
    raw = json.dumps(body).encode()
    assert estimate_chat_cost_usd(raw, body) == pytest.approx((len(raw) / 3 * 1.25 + 32000 * 4.25) / 1e6)


@pytest.mark.parametrize("bad", [0, -5, "100", None, True, 1.5, [1], {"a": 1}])
def test_estimate_ignores_unusable_max_out(bad):
    # a negative / bogus max_tokens must never shrink the reservation below the 32000 default
    body = {"model": CHAT_MODEL, "max_tokens": bad}
    raw = json.dumps(body).encode()
    assert estimate_chat_cost_usd(raw, body) == pytest.approx((len(raw) / 3 * 1.25 + 32000 * 4.25) / 1e6)


def test_chat_cost_from_usage():
    assert chat_cost_usd({"prompt_tokens": 1000, "completion_tokens": 2000}) == pytest.approx(cost(1000, 2000))
    # completion_tokens already includes reasoning; the reasoning breakdown is never added on top
    u = {"prompt_tokens": 10, "completion_tokens": 20, "completion_tokens_details": {"reasoning_tokens": 15}}
    assert chat_cost_usd(u) == pytest.approx(cost(10, 20))
    # Modal shape: top-level reasoning_tokens, prompt_tokens_details null
    u = {"prompt_tokens": 10, "completion_tokens": 20, "reasoning_tokens": 15, "prompt_tokens_details": None}
    assert chat_cost_usd(u) == pytest.approx(cost(10, 20))
    assert chat_cost_usd({"prompt_tokens": 0, "completion_tokens": 0}) == 0
    for bad in [None, {}, [], "x", {"prompt_tokens": 5}, {"prompt_tokens": "5", "completion_tokens": 1},
                {"prompt_tokens": -1, "completion_tokens": 1}, {"prompt_tokens": True, "completion_tokens": 1},
                {"prompt_tokens": 1.5, "completion_tokens": 1}]:
        assert chat_cost_usd(bad) is None


# ----------------------------------------------------------------------------- cap


def test_cap_refusal_402_without_calling_upstream():
    app, store, up = build(cap_usd=0.01)
    with TestClient(app) as c:
        r = c.post(META_CHAT, content=body_for(CHAT_MODEL), headers=bearer())  # estimate ~0.136
        assert r.status_code == 402
        assert r.json()["error"]["code"] == "RELAY_BUDGET_SPENT"
        # modal chat the same
        assert c.post(MODAL_CHAT, content=body_for(OPEN_MODEL), headers=modal_headers()).status_code == 402
        # a small request still fits
        small = body_for(CHAT_MODEL, max_tokens=10)
        assert c.post(META_CHAT, content=small, headers=bearer()).status_code == 200
    assert len(up.requests) == 1


def test_cap_boundary_is_inclusive_and_uses_spent_plus_estimate():
    raw = body_for(CHAT_MODEL, max_tokens=50)
    est = estimate_chat_cost_usd(raw, json.loads(raw))
    # exactly at the cap: allowed
    app, _, up = build(store=FakeStore(spentUSD=1.0), cap_usd=1.0 + est)
    with TestClient(app) as c:
        assert c.post(META_CHAT, content=raw, headers=bearer()).status_code == 200
    # one micro-dollar over: refused
    app, _, up2 = build(store=FakeStore(spentUSD=1.0), cap_usd=1.0 + est - 1e-6)
    with TestClient(app) as c:
        assert c.post(META_CHAT, content=raw, headers=bearer()).status_code == 402
    assert up2.requests == []


def test_spent_is_loaded_from_store_on_start():
    app, _, up = build(store=FakeStore(spentUSD=49.99), cap_usd=50.0)
    with TestClient(app) as c:
        assert c.post(META_CHAT, content=body_for(CHAT_MODEL), headers=bearer()).status_code == 402
        assert c.get("/v1/status", headers=bearer()).json()["spentUSD"] == 49.99
    assert up.requests == []


def test_sam_estimate_is_flat_per_call():
    assert SAM_COST_USD == 0.0025
    app, _, up = build(store=FakeStore(spentUSD=0.99), cap_usd=0.9925)
    with TestClient(app) as c:
        assert c.post(META_RESP, content=body_for(SAM_MODEL), headers=bearer()).status_code == 200
        assert c.post(META_RESP, content=body_for(SAM_MODEL), headers=bearer()).status_code == 402
    assert len(up.requests) == 1


def test_concurrent_reservations_cannot_overshoot_the_cap():
    raw = body_for(CHAT_MODEL, max_tokens=1000)
    est = estimate_chat_cost_usd(raw, json.loads(raw))

    async def scenario():
        gate = asyncio.Event()
        entered = asyncio.Event()
        seen = []

        async def handler(request):
            seen.append(request)
            entered.set()
            await gate.wait()
            return ok_chat(10, 10)

        store = FakeStore()
        app = create_app(store, httpx.MockTransport(handler), make_settings(cap_usd=est * 1.5))
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://relay") as c:
            first = asyncio.create_task(c.post(META_CHAT, content=raw, headers=bearer()))
            await asyncio.wait_for(entered.wait(), 5)
            # first holds a reservation of `est`; est + est > 1.5 * est -> refused at once
            second = await asyncio.wait_for(c.post(META_CHAT, content=raw, headers=bearer()), 5)
            third = await asyncio.wait_for(c.post(MODAL_CHAT, content=body_for(OPEN_MODEL, max_tokens=1000),
                                                  headers=modal_headers()), 5)
            gate.set()
            r1 = await asyncio.wait_for(first, 5)
            # reservation released with the actual (tiny) charge: now a new call fits
            r4 = await asyncio.wait_for(c.post(META_CHAT, content=raw, headers=bearer()), 5)
            return r1, second, third, r4, seen, store

    r1, second, third, r4, seen, store = asyncio.run(scenario())
    assert r1.status_code == 200
    assert second.status_code == 402 and third.status_code == 402
    assert r4.status_code == 200
    assert len(seen) == 2
    assert store.data["spentUSD"] == pytest.approx(2 * cost(10, 10))


def test_many_concurrent_calls_never_exceed_cap_in_total():
    raw = body_for(CHAT_MODEL, max_tokens=1000)
    est = estimate_chat_cost_usd(raw, json.loads(raw))

    async def scenario():
        gate = asyncio.Event()

        async def handler(request):
            await gate.wait()
            return httpx.Response(200, json={"usage": {"prompt_tokens": 100, "completion_tokens": 1000}})

        app = create_app(FakeStore(), httpx.MockTransport(handler), make_settings(cap_usd=est * 3.5))
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://relay") as c:
            tasks = [asyncio.create_task(c.post(META_CHAT, content=raw, headers=bearer())) for _ in range(8)]
            await asyncio.sleep(0.2)
            gate.set()
            return [r.status_code for r in await asyncio.gather(*tasks)]

    codes = asyncio.run(scenario())
    assert sorted(codes) == [200] * 3 + [402] * 5


# ----------------------------------------------------------------------------- charging


def test_charge_comes_from_usage_and_is_persisted(env):
    client, store, _ = env
    client.post(META_CHAT, content=body_for(CHAT_MODEL), headers=bearer())
    assert store.data["spentUSD"] == pytest.approx(cost(1000, 2000))
    client.post(META_CHAT, content=body_for(CHAT_MODEL), headers=bearer())
    assert store.data["spentUSD"] == pytest.approx(2 * cost(1000, 2000))


def test_modal_usage_shape_is_charged_the_same_way():
    def responder(req):
        return httpx.Response(200, json={"usage": {"prompt_tokens": 400, "completion_tokens": 900,
                                                   "reasoning_tokens": 300, "prompt_tokens_details": None}})

    app, store, _ = build(Upstream(responder))
    with TestClient(app) as c:
        c.post(MODAL_CHAT, content=body_for(OPEN_MODEL), headers=modal_headers())
    assert store.data["spentUSD"] == pytest.approx(cost(400, 900))


@pytest.mark.parametrize(
    "response",
    [
        httpx.Response(200, json={"id": "no usage"}),
        httpx.Response(200, json={"usage": None}),
        httpx.Response(200, json={"usage": {"prompt_tokens": "x", "completion_tokens": 2}}),
        httpx.Response(200, content=b"not json", headers={"content-type": "text/plain"}),
        httpx.Response(200, json=[1, 2]),
    ],
    ids=["no-usage", "null-usage", "bad-usage", "non-json", "json-array"],
)
def test_missing_usage_on_200_charges_the_estimate(response):
    raw = body_for(CHAT_MODEL, max_tokens=500)
    est = estimate_chat_cost_usd(raw, json.loads(raw))
    app, store, _ = build(Upstream(lambda req: response))
    with TestClient(app) as c:
        r = c.post(META_CHAT, content=raw, headers=bearer())
    assert r.status_code == 200
    assert store.data["spentUSD"] == pytest.approx(est)


@pytest.mark.parametrize("status", [400, 401, 403, 404, 422, 429, 500, 502, 503])
def test_upstream_error_statuses_pass_through_and_charge_nothing_without_usage(status):
    err = {"error": {"message": "upstream said no", "type": "x"}}
    app, store, _ = build(Upstream(lambda req: httpx.Response(status, json=err)))
    with TestClient(app) as c:
        r = c.post(META_CHAT, content=body_for(CHAT_MODEL), headers=bearer())
        assert r.status_code == status
        assert r.json() == err
        assert c.get("/v1/status", headers=bearer()).json()["spentUSD"] == 0.0
    assert store.data.get("spentUSD", 0) == 0


def test_upstream_error_that_reports_usage_is_charged_by_usage():
    resp = httpx.Response(400, json={"error": {}, "usage": {"prompt_tokens": 1000, "completion_tokens": 0}})
    app, store, _ = build(Upstream(lambda req: resp))
    with TestClient(app) as c:
        assert c.post(META_CHAT, content=body_for(CHAT_MODEL), headers=bearer()).status_code == 400
    assert store.data["spentUSD"] == pytest.approx(cost(1000, 0))


def test_sam_charged_only_on_200():
    for status, expected in [(200, SAM_COST_USD), (400, 0), (401, 0), (429, 0), (500, 0)]:
        app, store, _ = build(Upstream(lambda req, s=status: httpx.Response(s, json={"output": []})))
        with TestClient(app) as c:
            r = c.post(META_RESP, content=body_for(SAM_MODEL), headers=bearer())
        assert r.status_code == status
        assert store.data.get("spentUSD", 0) == pytest.approx(expected), status


@pytest.mark.parametrize(
    "exc,status",
    [
        (httpx.ConnectError("boom"), 502),
        (httpx.ReadTimeout("slow"), 504),
        (httpx.ConnectTimeout("slow"), 504),
        (httpx.RemoteProtocolError("bad"), 502),
        (RuntimeError("anything else"), 502),
    ],
)
def test_network_errors_charge_the_estimate_and_release_the_reservation(exc, status):
    raw = body_for(CHAT_MODEL, max_tokens=500)
    est = estimate_chat_cost_usd(raw, json.loads(raw))
    app, store, up = build(Upstream(lambda req: exc))
    with TestClient(app) as c:
        r = c.post(META_CHAT, content=raw, headers=bearer())
        assert r.status_code == status
        assert r.json()["error"]["code"] in {"RELAY_UPSTREAM_UNREACHABLE", "RELAY_UPSTREAM_TIMEOUT"}
        assert str(exc) not in r.text
        assert store.data["spentUSD"] == pytest.approx(est)
        # the reservation is gone: only spent remains, so a repeat is charged exactly once more
        c.post(META_CHAT, content=raw, headers=bearer())
    assert store.data["spentUSD"] == pytest.approx(2 * est)


def test_sam_network_error_charges_the_flat_estimate():
    app, store, _ = build(Upstream(lambda req: httpx.ReadTimeout("slow")))
    with TestClient(app) as c:
        assert c.post(META_RESP, content=body_for(SAM_MODEL), headers=bearer()).status_code == 504
    assert store.data["spentUSD"] == pytest.approx(SAM_COST_USD)


def test_store_write_failure_does_not_break_the_response_or_in_memory_accounting():
    app, store, _ = build()
    store.fail_put = True
    with TestClient(app) as c:
        assert c.post(META_CHAT, content=body_for(CHAT_MODEL), headers=bearer()).status_code == 200
        assert c.get("/v1/status", headers=bearer()).json()["spentUSD"] == pytest.approx(round(cost(1000, 2000), 2))
        store.fail_put = False
        c.post(META_CHAT, content=body_for(CHAT_MODEL), headers=bearer())
    assert store.data["spentUSD"] == pytest.approx(2 * cost(1000, 2000))  # next write carries the full total


def test_client_disconnect_style_cancellation_charges_the_estimate():
    raw = body_for(CHAT_MODEL, max_tokens=500)
    est = estimate_chat_cost_usd(raw, json.loads(raw))

    async def scenario():
        entered = asyncio.Event()

        async def handler(request):
            entered.set()
            await asyncio.sleep(30)

        store = FakeStore()
        app = create_app(store, httpx.MockTransport(handler), make_settings())
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://relay") as c:
            task = asyncio.create_task(c.post(META_CHAT, content=raw, headers=bearer()))
            await asyncio.wait_for(entered.wait(), 5)
            task.cancel()
            await asyncio.sleep(0.2)
            st = await c.get("/v1/status", headers=bearer())
            return st.json(), store

    status, store = asyncio.run(scenario())
    assert status["spentUSD"] == pytest.approx(round(est, 2))
    assert store.data["spentUSD"] == pytest.approx(est)


# ----------------------------------------------------------------------------- pause


@pytest.mark.parametrize("path,model,hdr", ROUTES, ids=ROUTE_IDS)
def test_paused_returns_503_on_every_forwarding_route(path, model, hdr):
    app, store, up = build(store=FakeStore(enabled=False))
    with TestClient(app) as c:
        r = c.post(path, content=body_for(model), headers=hdr())
        assert r.status_code == 503
        assert r.json()["error"]["code"] == "RELAY_PAUSED"
        # pause is checked before the body; a bad body also reads as paused
        assert c.post(path, content=b"garbage", headers=hdr()).status_code == 503
        # but identity comes first: a wrong code is still 401
        assert c.post(path, content=body_for(model), headers=hdr(WRONG)).status_code == 401
    assert up.requests == []


def test_pause_and_resume_take_effect_between_requests(env):
    client, store, up = env
    assert client.post(META_CHAT, content=body_for(CHAT_MODEL), headers=bearer()).status_code == 200
    store.data["enabled"] = False  # what `modal run relay/app.py::pause` writes
    assert client.post(META_CHAT, content=body_for(CHAT_MODEL), headers=bearer()).status_code == 503
    status = client.get("/v1/status", headers=bearer())
    assert status.status_code == 200 and status.json()["enabled"] is False
    store.data["enabled"] = True
    assert client.post(META_CHAT, content=body_for(CHAT_MODEL), headers=bearer()).status_code == 200
    assert len(up.requests) == 2


def test_unreadable_state_fails_closed():
    app, store, up = build()
    store.fail_get = True
    with TestClient(app) as c:
        r = c.post(META_CHAT, content=body_for(CHAT_MODEL), headers=bearer())
        assert r.status_code == 503
        assert r.json()["error"]["code"] == "RELAY_PAUSED"
        assert c.get("/v1/status", headers=bearer()).json()["enabled"] is False
    assert up.requests == []


def test_anything_but_true_in_enabled_means_paused():
    for value in [False, 0, None, "no"]:
        app, _, up = build(store=FakeStore(enabled=value))
        with TestClient(app) as c:
            assert c.post(META_CHAT, content=body_for(CHAT_MODEL), headers=bearer()).status_code == 503


# ----------------------------------------------------------------------------- status


def test_status_shape_and_two_decimal_numbers():
    app, _, up = build(store=FakeStore(spentUSD=12.3456, enabled=True), cap_usd=50.0)
    with TestClient(app) as c:
        r = c.get("/v1/status", headers=bearer())
    assert r.status_code == 200
    assert r.json() == {"ok": True, "enabled": True, "capUSD": 50.0, "spentUSD": 12.35, "remainingUSD": 37.65}
    # on the wire too: no float noise such as 37.654400000000004
    for field in ["capUSD", "spentUSD", "remainingUSD"]:
        m = re.search(r'"%s":\s*(-?[0-9.eE+-]+)' % field, r.text)
        assert m and re.fullmatch(r"\d+(\.\d{1,2})?", m.group(1)), (field, m and m.group(1))
    assert up.requests == []  # status never calls upstream


def test_status_default_cap_and_remaining_never_negative():
    app, _, _ = build(store=FakeStore(spentUSD=61.234), cap_usd=50.0)
    with TestClient(app) as c:
        body = c.get("/v1/status", headers=bearer()).json()
    assert body["remainingUSD"] == 0.0
    assert body["spentUSD"] == 61.23
    app, _, _ = build()
    with TestClient(app) as c:
        body = c.get("/v1/status", headers=bearer()).json()
    assert body == {"ok": True, "enabled": True, "capUSD": 50.0, "spentUSD": 0.0, "remainingUSD": 50.0}
    assert set(body) == {"ok", "enabled", "capUSD", "spentUSD", "remainingUSD"}


def test_status_reflects_spend_after_a_call(env):
    client, _, _ = env
    client.post(META_CHAT, content=body_for(CHAT_MODEL), headers=bearer())
    for _ in range(20):
        client.post(META_RESP, content=body_for(SAM_MODEL), headers=bearer())
    body = client.get("/v1/status", headers=bearer()).json()
    expected = cost(1000, 2000) + 20 * SAM_COST_USD
    assert body["spentUSD"] == round(expected, 2)
    assert body["remainingUSD"] == round(50 - expected, 2)


# ----------------------------------------------------------------------------- logging


def test_logs_one_line_per_request_and_never_contain_secrets(caplog):
    caplog.set_level(logging.DEBUG)
    upstreams = Upstream()
    app, store, _ = build(upstreams)
    secrets = [CODE, CODE2, WRONG, META_KEY, MODAL_KEY, MODAL_SECRET, PROMPT_MARKER, f"ws-{CODE}", f"Bearer {CODE}"]
    with TestClient(app) as c:
        n = 0
        c.get("/healthz")
        c.get("/v1/status", headers=bearer()); n += 1
        c.get("/v1/status", headers=bearer(WRONG)); n += 1
        c.post(META_CHAT, content=body_for(CHAT_MODEL), headers=bearer()); n += 1
        c.post(META_RESP, content=body_for(SAM_MODEL), headers=bearer()); n += 1
        c.post(MODAL_CHAT, content=body_for(OPEN_MODEL), headers=modal_headers()); n += 1
        c.post(MODAL_CHAT, content=body_for(OPEN_MODEL), headers=modal_headers(WRONG)); n += 1
        c.post(META_CHAT, content=body_for("gpt-4o"), headers=bearer()); n += 1
        c.post(META_CHAT, content=b"{" + PROMPT_MARKER.encode(), headers=bearer()); n += 1
        upstreams.responder = lambda req: httpx.ReadTimeout("slow " + PROMPT_MARKER)
        c.post(META_CHAT, content=body_for(CHAT_MODEL), headers=bearer()); n += 1
        upstreams.responder = lambda req: RuntimeError("kaboom " + CODE)
        c.post(META_CHAT, content=body_for(CHAT_MODEL), headers=bearer()); n += 1
        store.data["enabled"] = False
        c.post(META_CHAT, content=body_for(CHAT_MODEL), headers=bearer()); n += 1
        store.data["enabled"] = True
        store.fail_put = True
        upstreams.responder = lambda req: ok_chat()
        c.post(META_CHAT, content=body_for(CHAT_MODEL), headers=bearer()); n += 1
        store.fail_put = False
        store.fail_get = True
        c.post(META_CHAT, content=body_for(CHAT_MODEL), headers=bearer()); n += 1
    relay_lines = [r for r in caplog.records if r.name == "mki.relay"]
    assert len(relay_lines) >= n
    first_ok = next(r.getMessage() for r in relay_lines if "route=meta.chat" in r.getMessage() and "status=200" in r.getMessage())
    for token in ["route=", "status=", "latency_ms=", "charged_usd="]:
        assert token in first_ok
    assert f"charged_usd={cost(1000, 2000):.6f}" in first_ok
    assert any("status=401" in r.getMessage() for r in relay_lines)
    assert any("status=402" in r.getMessage() or "status=503" in r.getMessage() for r in relay_lines)
    haystack = caplog.text + "\n".join(
        f"{r.getMessage()} {r.exc_text or ''} {r.args!r} {getattr(r, '__dict__', {})!r}" for r in caplog.records
    )
    for secret in secrets:
        assert secret not in haystack, f"leaked into logs: {secret[:8]}..."
    assert not any(r.exc_info for r in relay_lines)


# ----------------------------------------------------------------------------- settings


def test_settings_from_env_parses_and_defaults():
    s = Settings.from_env(
        {
            "ACCESS_CODES": f" {CODE} , {CODE2},, ",
            "META_API_KEY": META_KEY,
            "MODAL_PROXY_KEY": MODAL_KEY,
            "MODAL_PROXY_SECRET": MODAL_SECRET,
            "MODAL_BASE_URL": MODAL_BASE + "/",
        }
    )
    assert s.access_codes == (CODE, CODE2)
    assert s.cap_usd == 50.0
    assert s.modal_base_url == MODAL_BASE  # trailing slash dropped
    assert s.meta_base_url == "https://api.meta.ai/v1"
    assert s.upstream_timeout_s == 600
    s2 = Settings.from_env({**_env(), "CAP_USD": "12.5"})
    assert s2.cap_usd == 12.5


def _env(**over):
    base = {
        "ACCESS_CODES": CODE,
        "META_API_KEY": META_KEY,
        "MODAL_PROXY_KEY": MODAL_KEY,
        "MODAL_PROXY_SECRET": MODAL_SECRET,
        "MODAL_BASE_URL": MODAL_BASE,
    }
    base.update(over)
    return {k: v for k, v in base.items() if v is not None}


def test_settings_accepts_the_combined_proxy_token():
    s = Settings.from_env(_env(MODAL_PROXY_KEY=None, MODAL_PROXY_SECRET=None, MODAL_PROXY_TOKEN="wk-ABC123_x.ws-SECRET456"))
    assert (s.modal_key, s.modal_secret) == ("wk-ABC123_x", "ws-SECRET456")
    assert split_proxy_token("wk-AAA:;|ws-BBB") == ("wk-AAA", "ws-BBB")
    assert split_proxy_token("  wk-AAA ws-BBB\n") == ("wk-AAA", "ws-BBB")
    with pytest.raises(ValueError):
        split_proxy_token("no-secret-here")
    with pytest.raises(ValueError):
        split_proxy_token("ws-only")


@pytest.mark.parametrize(
    "over,needle",
    [
        ({"ACCESS_CODES": None}, "ACCESS_CODES"),
        ({"ACCESS_CODES": " , "}, "ACCESS_CODES"),
        ({"ACCESS_CODES": "short-code"}, "ACCESS_CODES"),
        ({"ACCESS_CODES": CODE + ",nineteen-chars-xx-1"}, "ACCESS_CODES"),
        ({"META_API_KEY": None}, "META_API_KEY"),
        ({"MODAL_PROXY_KEY": None, "MODAL_PROXY_SECRET": None}, "MODAL_PROXY"),
        ({"MODAL_BASE_URL": None}, "MODAL_BASE_URL"),
        ({"MODAL_BASE_URL": "http://insecure.example/v1"}, "MODAL_BASE_URL"),
        ({"MODAL_BASE_URL": "https://user:pw@host.example/v1"}, "MODAL_BASE_URL"),
        ({"MODAL_BASE_URL": "https://host.example/v1?x=1"}, "MODAL_BASE_URL"),
        ({"CAP_USD": "abc"}, "CAP_USD"),
        ({"CAP_USD": "0"}, "CAP_USD"),
        ({"CAP_USD": "-3"}, "CAP_USD"),
        ({"CAP_USD": "nan"}, "CAP_USD"),
        ({"CAP_USD": "inf"}, "CAP_USD"),
    ],
)
def test_settings_validation_names_the_variable_never_the_value(over, needle):
    with pytest.raises(ValueError) as ei:
        Settings.from_env(_env(**over))
    msg = str(ei.value)
    assert needle in msg
    for secret in [CODE, META_KEY, MODAL_KEY, MODAL_SECRET, "short-code", "nineteen-chars-xx-1", "user:pw"]:
        assert secret not in msg


def test_create_app_refuses_to_run_without_valid_codes():
    with pytest.raises(ValueError):
        create_app(FakeStore(), httpx.MockTransport(Upstream()), make_settings(access_codes=()))
    with pytest.raises(ValueError):
        create_app(FakeStore(), httpx.MockTransport(Upstream()), make_settings(access_codes=("too-short",)))


def test_settings_is_immutable():
    s = make_settings()
    with pytest.raises(dataclasses.FrozenInstanceError):
        s.cap_usd = 1e9  # type: ignore[misc]
