"""Discord pings from the judge relay: access granted, a live build starting, budget alerts.

Every upstream (including Discord) is an httpx.MockTransport; nothing touches the network.
Run: uv run --with fastapi --with httpx --with pytest pytest relay -q
"""
from __future__ import annotations

import asyncio
import json
import logging
import time

import httpx
import pytest
from fastapi.testclient import TestClient

from relay_core import CHAT_MODEL, OPEN_MODEL, SAM_MODEL, Settings, create_app
from tests.test_relay import (
    CODE,
    META_CHAT,
    META_RESP,
    MODAL_CHAT,
    Clock,
    FakeStore,
    Upstream,
    bearer,
    body_for,
    make_settings,
    modal_headers,
    ok_chat,
    _env,
)

HOOK = "https://discord.com/api/webhooks/123456789012345678/HOOKTOKEN-abcdefghijklmnopqrstuvwxyz_0123456789"


def discord_calls(upstream: Upstream, expect: int, timeout: float = 2.0) -> list[dict]:
    """Wait (the posts run in the background) until `expect` Discord posts arrived, then a little longer for extras."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if len([r for r in upstream.requests if r.url.host == "discord.com"]) >= expect:
            break
        time.sleep(0.02)
    time.sleep(0.1)
    return [json.loads(r.content) for r in upstream.requests if r.url.host == "discord.com"]


def build(responder=None, store=None, clock=None, **kw):
    upstream = Upstream(responder)
    store = store if store is not None else FakeStore()
    kw.setdefault("discord_webhook_url", HOOK)
    if clock is not None:
        kw["clock"] = clock
    app = create_app(store, httpx.MockTransport(upstream), make_settings(**kw))
    return app, store, upstream


def router(discord=None):
    """Upstream answers: Discord gets `discord` (default 204), everything else a normal chat answer."""

    def respond(req: httpx.Request):
        if req.url.host == "discord.com":
            return discord(req) if discord else httpx.Response(204)
        if req.url.path.endswith("/responses"):
            return httpx.Response(200, json={"output": []})
        return ok_chat()

    return respond


# ----------------------------------------------------------------------------- access granted


def test_access_ping_once_per_visitor_per_hour():
    clock = Clock()
    app, _, upstream = build(router(), clock=clock)
    with TestClient(app) as client:
        assert client.get("/v1/status", headers=bearer()).status_code == 200
        assert client.get("/v1/status", headers=bearer()).status_code == 200  # page reload, the app's refresh
        calls = discord_calls(upstream, 1)
        assert len(calls) == 1
        assert "access code" in calls[0]["content"].lower()
        assert "$50.00" in calls[0]["content"]
        clock.now += 3601
        client.get("/v1/status", headers=bearer())
        assert len(discord_calls(upstream, 2)) == 2


def test_no_access_ping_for_a_wrong_code():
    app, _, upstream = build(router())
    with TestClient(app) as client:
        assert client.get("/v1/status", headers=bearer("totally-wrong-code-0000000000")).status_code == 401
        assert discord_calls(upstream, 1, timeout=0.3) == []


# ----------------------------------------------------------------------------- live build started


@pytest.mark.parametrize(
    "path,model,hdr,label",
    [(META_CHAT, CHAT_MODEL, bearer, "Muse Spark 1.3"), (MODAL_CHAT, OPEN_MODEL, modal_headers, "Muse Spark Open")],
)
def test_build_ping_once_per_burst_of_calls(path, model, hdr, label):
    clock = Clock()
    app, _, upstream = build(router(), clock=clock)
    with TestClient(app) as client:
        for _ in range(4):  # one build makes several calls a few seconds apart
            assert client.post(path, content=body_for(model), headers=hdr()).status_code == 200
            clock.now += 20
        calls = discord_calls(upstream, 1)
        assert len(calls) == 1
        assert "live build started" in calls[0]["content"].lower()
        assert label in calls[0]["content"]
        clock.now += 301  # quiet for more than five minutes: the next call is a new build
        client.post(path, content=body_for(model), headers=hdr())
        assert len(discord_calls(upstream, 2)) == 2


def test_sam_calls_alone_do_not_ping_a_build():
    app, _, upstream = build(router())
    with TestClient(app) as client:
        assert client.post(META_RESP, content=body_for(SAM_MODEL), headers=bearer()).status_code == 200
        assert discord_calls(upstream, 1, timeout=0.3) == []


# ----------------------------------------------------------------------------- budget


def test_budget_alerts_fire_once_per_threshold_crossed():
    clock = Clock()
    store = FakeStore(spentUSD=9.99)
    app, _, upstream = build(router(), store=store, clock=clock)
    with TestClient(app) as client:
        client.post(META_CHAT, content=body_for(CHAT_MODEL), headers=bearer())  # crosses $10, also starts a build
        clock.now += 10
        client.post(META_CHAT, content=body_for(CHAT_MODEL), headers=bearer())  # stays above $10: nothing new
        calls = [c["content"] for c in discord_calls(upstream, 2)]
        budget = [c for c in calls if "spent" in c.lower()]
        assert len(budget) == 1 and "$10" in budget[0]


def test_thresholds_already_passed_before_start_do_not_ping():
    store = FakeStore(spentUSD=30.0)
    app, _, upstream = build(router(), store=store)
    with TestClient(app) as client:
        client.post(META_CHAT, content=body_for(CHAT_MODEL), headers=bearer())
        calls = [c["content"] for c in discord_calls(upstream, 1)]
        assert not [c for c in calls if "spent" in c.lower() and "$10" in c]
        assert not [c for c in calls if "spent" in c.lower() and "$25" in c]


def test_budget_used_up_pings_once():
    store = FakeStore(spentUSD=50.0)
    app, _, upstream = build(router(), store=store)
    with TestClient(app) as client:
        for _ in range(3):
            assert client.post(META_CHAT, content=body_for(CHAT_MODEL), headers=bearer()).status_code == 402
        calls = [c["content"] for c in discord_calls(upstream, 1)]
        assert len([c for c in calls if "used up" in c.lower()]) == 1


# ----------------------------------------------------------------------------- safety


def test_discord_down_never_affects_judges(caplog):
    def broken(_req):
        raise httpx.ConnectError("discord down")

    app, _, upstream = build(router(broken))
    with caplog.at_level(logging.INFO), TestClient(app) as client:
        assert client.get("/v1/status", headers=bearer()).status_code == 200
        r = client.post(META_CHAT, content=body_for(CHAT_MODEL), headers=bearer())
        assert r.status_code == 200
        discord_calls(upstream, 2)
    assert "HOOKTOKEN" not in caplog.text


def test_slow_discord_does_not_delay_the_answer():
    async def slow(req: httpx.Request):  # async like a real network wait (a sync sleep would block the whole loop)
        if req.url.host == "discord.com":
            await asyncio.sleep(1.5)
            return httpx.Response(204)
        return ok_chat()

    upstream = Upstream(slow)
    app = create_app(FakeStore(), httpx.MockTransport(upstream), make_settings(discord_webhook_url=HOOK))
    with TestClient(app) as client:
        t0 = time.monotonic()
        assert client.get("/v1/status", headers=bearer()).status_code == 200
        assert time.monotonic() - t0 < 1.0


def test_messages_never_carry_the_code_ip_or_mentions():
    app, _, upstream = build(router())
    with TestClient(app) as client:
        client.get("/v1/status", headers=bearer())
        client.post(META_CHAT, content=body_for(CHAT_MODEL), headers=bearer())
        for post in discord_calls(upstream, 2):
            text = json.dumps(post)
            assert CODE not in text and "testclient" not in text and "127.0.0.1" not in text
            assert post["allowed_mentions"] == {"parse": []}


def test_no_webhook_means_no_posts():
    app, _, upstream = build(router(), discord_webhook_url="")
    with TestClient(app) as client:
        client.get("/v1/status", headers=bearer())
        client.post(META_CHAT, content=body_for(CHAT_MODEL), headers=bearer())
        assert discord_calls(upstream, 1, timeout=0.3) == []


# ----------------------------------------------------------------------------- settings


def test_webhook_is_optional_and_read_from_env():
    assert Settings.from_env(_env()).discord_webhook_url == ""
    s = Settings.from_env(_env(DISCORD_WEBHOOK_URL=HOOK))
    assert s.discord_webhook_url == HOOK
    assert "HOOKTOKEN" not in repr(s)


@pytest.mark.parametrize(
    "bad",
    ["http://discord.com/api/webhooks/1/x", "https://example.com/api/webhooks/1/x", "https://discord.com/other/1/x"],
)
def test_bad_webhook_url_is_rejected_by_name_only(bad):
    with pytest.raises(ValueError) as err:
        Settings.from_env(_env(DISCORD_WEBHOOK_URL=bad))
    assert "DISCORD_WEBHOOK_URL" in str(err.value)
    assert bad not in str(err.value)
