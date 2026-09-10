from __future__ import annotations

import base64
import json
from datetime import datetime, timedelta, timezone

from itsdangerous import TimestampSigner
import pytest
from pydantic import ValidationError
from sqlalchemy import select

from app.main import create_app
from app.models import Seat, Table, User
from app.rooms.service import (
    ExpiredTable,
    FullTable,
    InvalidConfiguration,
    JoinRateLimited,
    TableClosed,
    TableConfig,
    UnauthorizedJoin,
)


@pytest.fixture()
def app_and_store(monkeypatch, tmp_path):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path}/tables.db")
    app = create_app()
    with app.state.session_factory() as session:
        session.add_all(
            [
                User(google_subject="host", email="host@example.com", display_name="Host"),
                User(google_subject="player", email="player@example.com", display_name="Player"),
                User(google_subject="other", email="other@example.com", display_name="Other"),
            ]
        )
        session.commit()
    return app, app.state.room_store


@pytest.mark.parametrize("seat_count", [2, 3, 4])
def test_host_can_create_supported_table(app_and_store, seat_count):
    app, store = app_and_store

    view = store.create_table(1, TableConfig(seat_count=seat_count))

    assert view.seat_count == seat_count
    assert view.room_code
    assert len(view.seats) == seat_count
    assert view.seats[0].user_id == 1
    with app.state.session_factory() as session:
        row = session.get(Table, view.id)
        assert row is not None
        assert view.room_code not in row.room_code_hash


def test_invalid_config_is_rejected(app_and_store):
    _, store = app_and_store

    with pytest.raises(ValidationError, match="starting_chips is not supported"):
        store.create_table(1, TableConfig(seat_count=2, starting_chips=123))


def test_join_occupies_one_seat_and_duplicate_join_is_idempotent(app_and_store):
    _, store = app_and_store
    created = store.create_table(1, TableConfig(seat_count=2))

    joined = store.join_table(2, created.room_code)
    repeated = store.join_table(2, created.room_code)

    assert [seat.user_id for seat in joined.seats].count(2) == 1
    assert repeated.seats == joined.seats


def test_join_rejects_expired_unknown_and_rate_limited_codes(app_and_store):
    _, store = app_and_store
    created = store.create_table(1, TableConfig(seat_count=2), join_ttl=timedelta(seconds=1))
    store.set_clock(lambda: created.join_expires_at + timedelta(seconds=1))

    with pytest.raises(ExpiredTable):
        store.join_table(2, created.room_code)

    store.set_clock(lambda: datetime.now(timezone.utc))
    with pytest.raises(UnauthorizedJoin):
        store.join_table(999, "not-a-room-code")
    with pytest.raises(UnauthorizedJoin):
        store.join_table(999, "not-a-room-code")
    with pytest.raises(JoinRateLimited):
        store.join_table(999, "not-a-room-code")


def test_full_table_and_join_after_start_are_rejected(app_and_store):
    _, store = app_and_store
    created = store.create_table(1, TableConfig(seat_count=2))
    store.join_table(2, created.room_code)
    started = store.start_table(1, created.id)

    assert started.status == "in_progress"
    with pytest.raises(TableClosed):
        store.join_table(3, created.room_code)


def test_non_host_cannot_start_or_reconfigure(app_and_store):
    _, store = app_and_store
    created = store.create_table(1, TableConfig(seat_count=2))

    with pytest.raises(UnauthorizedJoin):
        store.update_table_config(2, created.id, TableConfig(seat_count=3))
    with pytest.raises(UnauthorizedJoin):
        store.start_table(2, created.id)


def test_host_can_fill_empty_seat_with_ai_and_start(app_and_store):
    _, store = app_and_store
    created = store.create_table(1, TableConfig(seat_count=2))

    view = store.fill_ai_seat(1, created.id, 2, "Hard")
    started = store.start_table(1, created.id)

    assert view.seats[1].actor_type == "ai"
    assert view.seats[1].ai_tier == "Hard"
    assert started.status == "in_progress"


def test_http_start_registers_actor_for_real_table(app_and_store):
    app, store = app_and_store
    created = store.create_table(1, TableConfig(seat_count=2))
    store.join_table(2, created.room_code)
    cookie_data = base64.b64encode(json.dumps({"user_id": 1, "csrf_token": "csrf"}).encode()).decode()
    cookie = TimestampSigner("development-only-change-me").sign(cookie_data).decode()

    from fastapi.testclient import TestClient

    with TestClient(app) as client:
        client.cookies.set("session", cookie)
        response = client.post(f"/tables/{created.id}/start", headers={"X-CSRF-Token": "csrf"})

    assert response.status_code == 200
    assert app.state.room_manager.get(created.id) is not None
