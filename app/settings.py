from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Settings:
    app_name: str = "The Common Table"
    environment: str = "development"
    database_url: str = "sqlite:///./data/card_games.db"
    data_dir: Path = Path("./data")
    session_secret: str = "development-only-change-me"
    google_client_id: str = ""
    google_client_secret: str = ""
    google_redirect_uri: str = ""
    openrouter_api_key: str = ""
    allowed_origin: str = "http://localhost:8000"
    allowed_origins: tuple[str, ...] = ("http://localhost:5173", "http://localhost:8000")
    frontend_url: str = "http://localhost:5173"

    @classmethod
    def from_env(cls) -> "Settings":
        raw_origins = os.getenv("ALLOWED_ORIGINS", os.getenv("ALLOWED_ORIGIN", ",".join(cls.allowed_origins)))
        allowed_origins = tuple(origin.strip().rstrip("/") for origin in raw_origins.split(",") if origin.strip())
        return cls(
            app_name=os.getenv("APP_NAME", cls.app_name),
            environment=os.getenv("ENVIRONMENT", cls.environment),
            database_url=os.getenv("DATABASE_URL", cls.database_url),
            data_dir=Path(os.getenv("DATA_DIR", str(cls.data_dir))),
            session_secret=os.getenv("SESSION_SECRET", cls.session_secret),
            google_client_id=os.getenv("GOOGLE_CLIENT_ID", cls.google_client_id),
            google_client_secret=os.getenv("GOOGLE_CLIENT_SECRET", cls.google_client_secret),
            google_redirect_uri=os.getenv("GOOGLE_REDIRECT_URI", cls.google_redirect_uri),
            openrouter_api_key=os.getenv("OPENROUTER_API_KEY", cls.openrouter_api_key),
            allowed_origin=allowed_origins[0] if allowed_origins else cls.allowed_origin,
            allowed_origins=allowed_origins,
            frontend_url=os.getenv("FRONTEND_URL", cls.frontend_url),
        )
