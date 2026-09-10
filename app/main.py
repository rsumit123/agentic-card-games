from __future__ import annotations

import logging
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import asyncio
from starlette.middleware.sessions import SessionMiddleware

from .auth import validate_websocket_origin
from .db import build_engine, get_session, initialize_database, session_factory
from .health import router as health_router
from .models import User
from .routes.auth import router as auth_router
from .routes.ai import router as ai_router
from .routes.tables import router as tables_router
from .rooms.service import RoomStore
from .rooms.recovery import recover_incomplete_hands
from .rooms.manager import RoomManager
from .routes.ws import router as websocket_router
from .settings import Settings


def _configure_logging() -> None:
    """Uvicorn only wires up its own loggers, so ours would never be printed."""
    app_logger = logging.getLogger("app")
    app_logger.setLevel(os.getenv("LOG_LEVEL", "INFO").upper())
    if not app_logger.handlers:
        handler = logging.StreamHandler()
        handler.setFormatter(logging.Formatter("%(levelname)s:     %(name)s %(message)s"))
        app_logger.addHandler(handler)
    app_logger.propagate = False


def create_app() -> FastAPI:
    _configure_logging()
    settings = Settings.from_env()
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    engine = build_engine(settings)
    initialize_database(engine)
    sessions = session_factory(engine)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        stop_event = asyncio.Event()
        driver = asyncio.create_task(app.state.room_manager.run_forever(stop_event))
        try:
            yield
        finally:
            stop_event.set()
            await driver

    app = FastAPI(title=settings.app_name, lifespan=lifespan)
    app.add_middleware(
        SessionMiddleware,
        secret_key=settings.session_secret,
        same_site="none" if settings.environment == "production" else "lax",
        https_only=settings.environment == "production",
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.allowed_origins),
        allow_credentials=True,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Content-Type", "X-CSRF-Token"],
    )
    app.state.settings = settings
    app.state.engine = engine
    app.state.session_factory = sessions
    app.state.room_store = RoomStore(sessions)
    app.state.room_manager = RoomManager(
        hand_reveal_seconds=settings.hand_reveal_seconds,
        session_factory=sessions,
    )
    app.state.recovery_notices = recover_incomplete_hands(sessions)
    app.state.recovery_notices_by_table = {
        notice.table_id: notice.message for notice in app.state.recovery_notices
    }
    app.state.room_manager.restore_in_progress(sessions, settings)
    app.state.UserModel = User
    app.state.validate_websocket_origin = validate_websocket_origin
    app.include_router(health_router)
    app.include_router(auth_router)
    app.include_router(tables_router)
    app.include_router(ai_router)
    app.include_router(websocket_router)

    def configured_session():
        with sessions() as session:
            yield session

    app.dependency_overrides[get_session] = configured_session
    return app
