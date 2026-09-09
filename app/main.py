from __future__ import annotations

from fastapi import FastAPI

from .db import build_engine, get_session, initialize_database, session_factory
from .health import router as health_router
from .settings import Settings


def create_app() -> FastAPI:
    settings = Settings.from_env()
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    engine = build_engine(settings)
    initialize_database(engine)
    sessions = session_factory(engine)

    app = FastAPI(title=settings.app_name)
    app.state.settings = settings
    app.state.engine = engine
    app.state.session_factory = sessions
    app.include_router(health_router)

    def configured_session():
        with sessions() as session:
            yield session

    app.dependency_overrides[get_session] = configured_session
    return app
