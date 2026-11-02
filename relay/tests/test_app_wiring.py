"""Wiring check for relay/app.py. Needs the Modal SDK, so it is skipped in the default run:

    uv run --with fastapi --with httpx --with pytest --with modal pytest relay -q

No network, no Modal login and no real secrets are used: the web function body is called directly with fake env values
and an in-memory store.
"""
import importlib
import os
import sys

import pytest

pytest.importorskip("modal")

from fastapi.testclient import TestClient  # noqa: E402

CODE = "wiring-code-0123456789-abcdef"


class Store:
    def __init__(self):
        self.d = {}

    def get(self, k, default=None):
        return self.d.get(k, default)

    def put(self, k, v):
        self.d[k] = v


@pytest.fixture
def relay_app(monkeypatch):
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    module = importlib.import_module("app")
    store = Store()
    monkeypatch.setattr(module, "state", store)
    monkeypatch.setenv("ACCESS_CODES", CODE)
    monkeypatch.setenv("CAP_USD", "7")
    monkeypatch.setenv("META_API_KEY", "LLM_fake_fake_fake_fake_fake")
    monkeypatch.setenv("MODAL_PROXY_TOKEN", "wk-FAKEKEY.ws-FAKESECRET")
    monkeypatch.setenv("MODAL_BASE_URL", "https://example--ep-x-server.us-west.modal.direct/v1")
    return module, store


def test_declared_entrypoints_and_functions(relay_app):
    module, _ = relay_app
    assert module.APP_NAME == "mki-relay" and module.STATE_NAME == "mki-relay-state"
    assert module.SECRET_NAME == "mki-relay"
    for name in ["pause", "resume", "report"]:
        assert callable(getattr(module, name))


def test_web_function_builds_the_app_from_the_secret_env(relay_app):
    module, store = relay_app
    raw = module.web._raw_f_  # the undecorated function body (private Modal attribute; this test is optional)
    with TestClient(raw()) as client:
        assert client.get("/healthz").json() == {"ok": True}
        r = client.get("/v1/status", headers={"Authorization": f"Bearer {CODE}"})
        assert r.json() == {"ok": True, "enabled": True, "capUSD": 7.0, "spentUSD": 0.0, "remainingUSD": 7.0}
        assert client.get("/v1/status").status_code == 401


def test_pause_and_resume_write_the_shared_state(relay_app, capsys):
    module, store = relay_app
    module.pause()
    assert store.d["enabled"] is False
    module.resume()
    assert store.d["enabled"] is True
    out = capsys.readouterr().out
    assert CODE not in out and "wk-" not in out and "ws-" not in out


def test_web_function_refuses_an_incomplete_secret(relay_app, monkeypatch):
    module, _ = relay_app
    monkeypatch.delenv("ACCESS_CODES")
    with pytest.raises(ValueError):
        module.web._raw_f_()
