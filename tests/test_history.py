from __future__ import annotations

import base64
import json

import pytest
from fastapi.testclient import TestClient
from itsdangerous import TimestampSigner

from app.main import create_app
from app.models import User
from app.rooms.service import TableConfig


def _cookie(user_id: int) -> str:
    value = base64.b64encode(json.dumps({"user_id": user_id, "csrf_token": "csrf"}).encode()).decode()
    return TimestampSigner("development-only-change-me").sign(value).decode()


@pytest.fixture()
def app(monkeypatch, tmp_path):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path}/history.db")
    application = create_app()
    with application.state.session_factory() as session:
        session.add(User(google_subject="one", display_name="Ana"))
        session.commit()
    return application


def test_history_counts_hands_and_names_the_opponent_tier(app):
    store = app.state.room_store
    created = store.create_table(1, TableConfig(seat_count=2))
    store.fill_ai_seat(1, created.id, 2, "Hard")
    store.start_table(1, created.id)

    manager = app.state.room_manager
    actor = manager.ensure_actor_for_table(created.id, app.state.session_factory, app.state.settings)
    seat = actor.state.current_seat
    manager.submit(created.id, seat, {"expected_revision": 0, "idempotency_key": "k1", "action": {"type": "fold"}})
    assert actor.state.street == "complete"

    with TestClient(app) as client:
        client.cookies.set("session", _cookie(1))
        body = client.get("/me/history").json()

    assert body["hands"]["played"] == 1
    assert body["hands"]["won"] in (0, 1)
    assert body["hands"]["net_chips"] != 0
    assert [row["opponent"] for row in body["opponents"]] == ["Hard"]
    assert body["opponents"][0]["hands"] == 1
    assert body["recent"][0]["opponents"] == ["Hard"]


def test_history_is_empty_for_a_player_who_has_not_finished_a_hand(app):
    with TestClient(app) as client:
        client.cookies.set("session", _cookie(1))
        body = client.get("/me/history").json()

    assert body["hands"] == {"played": 0, "won": 0, "win_rate": 0.0, "net_chips": 0, "showdowns": 0}
    assert body["opponents"] == []
    assert body["sessions"]["played"] == 0


def test_history_requires_a_session(app):
    with TestClient(app) as client:
        assert client.get("/me/history").status_code == 401
