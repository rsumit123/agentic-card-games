from __future__ import annotations

from fastapi import FastAPI
from starlette.middleware.sessions import SessionMiddleware

from .auth import validate_websocket_origin
from .db import build_engine, get_session, initialize_database, session_factory
from .health import router as health_router
from .models import User
from .routes.auth import router as auth_router
from .routes.tables import router as tables_router
from .rooms.service import RoomStore
from .rooms.recovery import recover_incomplete_hands
from .settings import Settings


def create_app() -> FastAPI:
    settings = Settings.from_env()
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    engine = build_engine(settings)
    initialize_database(engine)
    sessions = session_factory(engine)

    app = FastAPI(title=settings.app_name)
    app.add_middleware(
        SessionMiddleware,
        secret_key=settings.session_secret,
        same_site="lax",
        https_only=settings.environment == "production",
    )
    app.state.settings = settings
    app.state.engine = engine
    app.state.session_factory = sessions
    app.state.room_store = RoomStore(sessions)
    app.state.recovery_notices = recover_incomplete_hands(sessions)
    app.state.UserModel = User
    app.state.validate_websocket_origin = validate_websocket_origin
    app.include_router(health_router)
    app.include_router(auth_router)
    app.include_router(tables_router)

    def configured_session():
        with sessions() as session:
            yield session

    app.dependency_overrides[get_session] = configured_session
    return app
