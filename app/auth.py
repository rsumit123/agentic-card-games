from __future__ import annotations

import inspect
import secrets
from dataclasses import dataclass
from typing import Any, Callable
from urllib.parse import urlencode

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import select

from .db import get_session
from .models import User

GOOGLE_ISSUERS = {"accounts.google.com", "https://accounts.google.com"}


@dataclass(frozen=True)
class GoogleClaims:
    subject: str
    email: str
    display_name: str
    issuer: str
    audience: str
    nonce: str


@dataclass(frozen=True)
class AuthenticatedUser:
    id: int
    google_subject: str
    email: str
    display_name: str


def _google_token_verifier(token: str) -> dict[str, Any]:
    try:
        from google.auth.transport import requests
        from google.oauth2 import id_token
    except ImportError as exc:  # pragma: no cover - exercised in deployment environments
        raise RuntimeError("google-auth is required to verify Google ID tokens") from exc
    return id_token.verify_oauth2_token(token, requests.Request())


def verify_google_id_token(
    token: str,
    *,
    expected_audience: str,
    expected_nonce: str,
    verifier: Callable[[str], dict[str, Any]] | None = None,
) -> GoogleClaims:
    payload = (verifier or _google_token_verifier)(token)
    issuer = str(payload.get("iss", ""))
    if issuer not in GOOGLE_ISSUERS:
        raise ValueError("Invalid issuer")

    audience = payload.get("aud")
    if expected_audience and (
        audience != expected_audience
        and not (isinstance(audience, list) and expected_audience in audience)
    ):
        raise ValueError("Invalid audience")

    nonce = str(payload.get("nonce", ""))
    if not expected_nonce or not secrets.compare_digest(nonce, expected_nonce):
        raise ValueError("Invalid nonce")

    subject = str(payload.get("sub", ""))
    if not subject:
        raise ValueError("Missing subject")
    return GoogleClaims(
        subject=subject,
        email=str(payload.get("email", "")),
        display_name=str(payload.get("name", payload.get("email", ""))),
        issuer=issuer,
        audience=(audience[0] if isinstance(audience, list) else str(audience or "")),
        nonce=nonce,
    )


def require_user(request: Request) -> AuthenticatedUser:
    user_id = request.session.get("user_id")
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")

    with request.app.state.session_factory() as session:
        user = session.get(User, int(user_id))
        if user is None:
            request.session.clear()
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")
        return AuthenticatedUser(user.id, user.google_subject, user.email, user.display_name)


def require_csrf(request: Request) -> None:
    expected = request.session.get("csrf_token")
    supplied = request.headers.get("X-CSRF-Token", "")
    if not expected or not supplied or not secrets.compare_digest(str(expected), supplied):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="CSRF validation failed")


def validate_websocket_origin(origin: str | None, allowed_origin: str | tuple[str, ...]) -> bool:
    if not origin:
        return False
    allowed = (allowed_origin,) if isinstance(allowed_origin, str) else allowed_origin
    return any(secrets.compare_digest(origin.rstrip("/"), item.rstrip("/")) for item in allowed)


def google_authorization_url(settings, state: str, nonce: str) -> str:
    query = urlencode(
        {
            "client_id": settings.google_client_id,
            "redirect_uri": settings.google_redirect_uri,
            "response_type": "code",
            "scope": "openid email profile",
            "state": state,
            "nonce": nonce,
            "access_type": "online",
        }
    )
    return f"https://accounts.google.com/o/oauth2/v2/auth?{query}"


async def call_maybe_async(function, *args, **kwargs):
    result = function(*args, **kwargs)
    return await result if inspect.isawaitable(result) else result


async def exchange_code_for_token(code: str, settings) -> str:
    import httpx

    async with httpx.AsyncClient(timeout=5.0) as client:
        response = await client.post(
            "https://oauth2.googleapis.com/token",
            data={
                "code": code,
                "client_id": settings.google_client_id,
                "client_secret": settings.google_client_secret,
                "redirect_uri": settings.google_redirect_uri,
                "grant_type": "authorization_code",
            },
        )
        response.raise_for_status()
        return response.json()["id_token"]
