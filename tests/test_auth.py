from __future__ import annotations

import base64
import json
from urllib.parse import parse_qs, urlparse

import pytest
from fastapi.testclient import TestClient
from itsdangerous import TimestampSigner

from app.auth import GoogleClaims, verify_google_id_token
from app.main import create_app


def claims(**overrides) -> dict:
    value = {
        "sub": "google-sub-1",
        "email": "player@example.com",
        "name": "Player One",
        "iss": "https://accounts.google.com",
        "aud": "client-123",
        "nonce": "nonce-123",
    }
    value.update(overrides)
    return value


@pytest.mark.parametrize(
    ("overrides", "expected"),
    [
        ({"iss": "https://evil.example"}, "issuer"),
        ({"aud": "wrong-client"}, "audience"),
        ({"nonce": "wrong-nonce"}, "nonce"),
    ],
)
def test_google_claims_reject_invalid_security_fields(overrides, expected):
    with pytest.raises(ValueError, match=expected):
        verify_google_id_token(
            "opaque-token",
            verifier=lambda _token: claims(**overrides),
            expected_audience="client-123",
            expected_nonce="nonce-123",
        )


def test_valid_google_claims_are_normalized():
    result = verify_google_id_token(
        "opaque-token",
        verifier=lambda _token: claims(),
        expected_audience="client-123",
        expected_nonce="nonce-123",
    )

    assert result == GoogleClaims(
        subject="google-sub-1",
        email="player@example.com",
        display_name="Player One",
        issuer="https://accounts.google.com",
        audience="client-123",
        nonce="nonce-123",
    )


def test_callback_creates_then_loads_same_user(monkeypatch, tmp_path):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path}/auth.db")
    app = create_app()
    app.state.exchange_code = lambda _code: "opaque-token"
    app.state.google_token_verifier = lambda _token, **kwargs: claims(nonce=kwargs["expected_nonce"])

    with TestClient(app) as client:
        login = client.get("/auth/login", follow_redirects=False)
        query = parse_qs(urlparse(login.headers["location"]).query)
        callback = client.get(
            f"/auth/callback?code=code-1&state={query['state'][0]}",
            follow_redirects=False,
        )
        assert callback.status_code == 303
        assert callback.headers["location"] == "http://localhost:5173/"

        second_client = TestClient(app)
        second_client.cookies.update(client.cookies)
        login_again = second_client.get("/auth/login", follow_redirects=False)
        query_again = parse_qs(urlparse(login_again.headers["location"]).query)
        second_callback = second_client.get(
            f"/auth/callback?code=code-2&state={query_again['state'][0]}",
            follow_redirects=False,
        )
        assert second_callback.status_code == 303

        with app.state.session_factory() as session:
            assert session.query(app.state.UserModel).count() == 1


def test_login_return_to_allows_configured_preview_origin(monkeypatch, tmp_path):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path}/auth-return-to.db")
    monkeypatch.setenv("ALLOWED_ORIGINS", "http://localhost:5173,https://preview.example.com")
    app = create_app()
    app.state.exchange_code = lambda _code: "opaque-token"
    app.state.google_token_verifier = lambda _token, **kwargs: claims(nonce=kwargs["expected_nonce"])

    with TestClient(app) as client:
        login = client.get("/auth/login?return_to=https://preview.example.com", follow_redirects=False)
        query = parse_qs(urlparse(login.headers["location"]).query)
        callback = client.get(
            f"/auth/callback?code=code-1&state={query['state'][0]}",
            follow_redirects=False,
        )

    assert callback.status_code == 303
    assert callback.headers["location"] == "https://preview.example.com/"


def test_callback_rejects_invalid_state(monkeypatch, tmp_path):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path}/auth.db")
    app = create_app()

    with TestClient(app) as client:
        client.get("/auth/login", follow_redirects=False)
        response = client.get("/auth/callback?code=code-1&state=wrong", follow_redirects=False)

    assert response.status_code == 400
    assert response.json()["detail"] == "Invalid OAuth state"


def test_logout_requires_csrf_and_clears_secure_session(monkeypatch, tmp_path):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path}/auth.db")
    app = create_app()
    app.state.exchange_code = lambda _code: "opaque-token"
    app.state.google_token_verifier = lambda _token, **kwargs: claims(nonce=kwargs["expected_nonce"])

    with TestClient(app) as client:
        login = client.get("/auth/login", follow_redirects=False)
        state = parse_qs(urlparse(login.headers["location"]).query)["state"][0]
        client.get(f"/auth/callback?code=code-1&state={state}", follow_redirects=False)
        raw_cookie = client.cookies.get("session")
        signed = TimestampSigner("development-only-change-me").unsign(raw_cookie)
        session = json.loads(base64.b64decode(signed))

        rejected = client.post("/auth/logout")
        assert rejected.status_code == 403

        logged_out = client.post("/auth/logout", headers={"X-CSRF-Token": session["csrf_token"]})
        assert logged_out.status_code == 200

        with app.state.session_factory() as db_session:
            assert db_session.query(app.state.UserModel).count() == 1


def test_auth_me_returns_user_and_browser_csrf_token(monkeypatch, tmp_path):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path}/auth-me.db")
    app = create_app()
    app.state.exchange_code = lambda _code: "opaque-token"
    app.state.google_token_verifier = lambda _token, **kwargs: claims(nonce=kwargs["expected_nonce"])

    with TestClient(app) as client:
        login = client.get("/auth/login", follow_redirects=False)
        state = parse_qs(urlparse(login.headers["location"]).query)["state"][0]
        client.get(f"/auth/callback?code=code-1&state={state}", follow_redirects=False)

        response = client.get("/auth/me")

    assert response.status_code == 200
    assert response.json()["user"]["google_subject"] == "google-sub-1"
    assert response.json()["csrf_token"]


def test_cors_allows_configured_frontend_with_credentials(monkeypatch, tmp_path):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path}/cors.db")
    monkeypatch.setenv("ALLOWED_ORIGINS", "https://frontend.example")
    app = create_app()

    response = TestClient(app).options(
        "/tables",
        headers={
            "Origin": "https://frontend.example",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type,x-csrf-token",
        },
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "https://frontend.example"
    assert response.headers["access-control-allow-credentials"] == "true"


def test_production_session_cookie_is_cross_origin_secure(monkeypatch, tmp_path):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path}/secure.db")
    monkeypatch.setenv("ENVIRONMENT", "production")
    app = create_app()

    response = TestClient(app).get("/auth/login", follow_redirects=False)

    cookie = response.headers["set-cookie"].lower()
    assert "samesite=none" in cookie
    assert "secure" in cookie


def test_google_token_verifier_delegates_to_google_library(monkeypatch):
    """Exercise the real verifier path, which every other auth test replaces.

    Fails in any environment where google.auth.transport.requests cannot be
    imported, which is exactly how production broke.
    """
    from google.oauth2 import id_token

    from app.auth import _google_token_verifier

    seen = {}

    def fake_verify(token, request, **kwargs):
        seen["token"] = token
        seen["request"] = request
        return {"sub": "subject-123", "iss": "https://accounts.google.com"}

    monkeypatch.setattr(id_token, "verify_oauth2_token", fake_verify)

    assert _google_token_verifier("raw-token") == {
        "sub": "subject-123",
        "iss": "https://accounts.google.com",
    }
    assert seen["token"] == "raw-token"
    assert seen["request"] is not None
