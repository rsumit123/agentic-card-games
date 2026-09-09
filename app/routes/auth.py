from __future__ import annotations

import secrets

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import RedirectResponse
from sqlalchemy import select

from ..auth import (
    AuthenticatedUser,
    call_maybe_async,
    exchange_code_for_token,
    google_authorization_url,
    require_csrf,
    require_user,
    verify_google_id_token,
)
from ..models import User

router = APIRouter(prefix="/auth", tags=["auth"])


@router.get("/login")
async def login(request: Request):
    state = secrets.token_urlsafe(32)
    nonce = secrets.token_urlsafe(32)
    request.session["oauth_state"] = state
    request.session["oauth_nonce"] = nonce
    return RedirectResponse(
        google_authorization_url(request.app.state.settings, state, nonce),
        status_code=status.HTTP_307_TEMPORARY_REDIRECT,
    )


@router.get("/callback")
async def callback(request: Request, code: str | None = None, state: str | None = None):
    expected_state = request.session.pop("oauth_state", None)
    expected_nonce = request.session.pop("oauth_nonce", None)
    if not expected_state or not state or not secrets.compare_digest(str(expected_state), state):
        raise HTTPException(status_code=400, detail="Invalid OAuth state")
    if not code or not expected_nonce:
        raise HTTPException(status_code=400, detail="Invalid OAuth callback")

    settings = request.app.state.settings
    exchanger = getattr(request.app.state, "exchange_code", None)
    id_token = await call_maybe_async(exchanger or (lambda value: exchange_code_for_token(value, settings)), code)
    provider_verifier = getattr(request.app.state, "google_token_verifier", None)
    raw_claims = None
    if provider_verifier:
        raw_claims = await call_maybe_async(provider_verifier, id_token, expected_nonce=expected_nonce)
    claims = verify_google_id_token(
        id_token,
        verifier=(lambda _token: raw_claims) if raw_claims is not None else None,
        expected_audience=settings.google_client_id,
        expected_nonce=expected_nonce,
    )

    with request.app.state.session_factory() as session:
        user = session.scalar(select(User).where(User.google_subject == claims.subject))
        if user is None:
            user = User(
                google_subject=claims.subject,
                email=claims.email,
                display_name=claims.display_name,
            )
            session.add(user)
        else:
            user.email = claims.email
            user.display_name = claims.display_name
        session.commit()
        session.refresh(user)

    request.session["user_id"] = user.id
    request.session["csrf_token"] = secrets.token_urlsafe(32)
    return RedirectResponse("/", status_code=status.HTTP_303_SEE_OTHER)


@router.post("/logout")
def logout(
    request: Request,
    _user: AuthenticatedUser = Depends(require_user),
    _csrf: None = Depends(require_csrf),
):
    request.session.clear()
    return {"status": "ok"}
