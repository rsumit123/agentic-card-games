from __future__ import annotations

from collections.abc import Generator

from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import Session, sessionmaker

from .models import Base
from .settings import Settings


def build_engine(settings: Settings):
    connect_args = {"check_same_thread": False}
    engine = create_engine(settings.database_url, connect_args=connect_args, future=True)

    @event.listens_for(engine, "connect")
    def configure_sqlite(dbapi_connection, _connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA busy_timeout=5000")
        cursor.close()

    return engine


def initialize_database(engine) -> None:
    Base.metadata.create_all(engine)
    with engine.begin() as connection:
        connection.execute(text("PRAGMA journal_mode=WAL"))
        connection.execute(text("PRAGMA busy_timeout=5000"))


def session_factory(engine) -> sessionmaker[Session]:
    return sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)


def get_session() -> Generator[Session, None, None]:
    raise RuntimeError("get_session must be configured with the application database")
