from __future__ import annotations

import base64
import json

from fastapi.testclient import TestClient
from itsdangerous import TimestampSigner

from app.models import User
from app.rooms.service import TableConfig


def _session_cookie(user_id: int) -> str:
    value = {"user_id": user_id, "csrf_token": "csrf"}
    encoded = base64.b64encode(json.dumps(value).encode()).decode()
    return TimestampSigner("development-only-change-me").sign(encoded).decode()


def _table(monkeypatch, tmp_path, name):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path}/{name}.db")
    app = __import__("app.main", fromlist=["create_app"]).create_app()
    with app.state.session_factory() as session:
        session.add_all([User(google_subject="one", display_name="Ana"), User(google_subject="two", display_name="Bo")])
        session.commit()
    created = app.state.room_store.create_table(1, TableConfig(seat_count=2))
    app.state.room_store.join_table(2, created.room_code)
    app.state.room_store.start_table(1, created.id)
    app.state.room_manager.ensure_actor_for_table(created.id, app.state.session_factory, app.state.settings)
    return app, created.id


def _opening(socket) -> None:
    socket.receive_json()  # snapshot
    socket.receive_json()  # session


def test_a_reaction_reaches_the_whole_table_including_the_sender(monkeypatch, tmp_path):
    app, table_id = _table(monkeypatch, tmp_path, "reaction")
    manager = app.state.room_manager
    revision_before = manager.get(table_id).revision

    with TestClient(app) as first_client, TestClient(app) as second_client:
        first_client.cookies.set("session", _session_cookie(1))
        second_client.cookies.set("session", _session_cookie(2))
        headers = {"origin": "http://localhost:8000"}
        with first_client.websocket_connect(f"/ws/tables/{table_id}", headers=headers) as first:
            with second_client.websocket_connect(f"/ws/tables/{table_id}", headers=headers) as second:
                _opening(first)
                _opening(second)
                first.send_json({"type": "reaction", "emoji": "🎉"})
                mine = first.receive_json()
                theirs = second.receive_json()

    assert theirs == {"type": "reaction", "seat_number": 1, "emoji": "🎉"}
    assert mine == theirs, "the sender sees their own reaction too"
    assert manager.get(table_id).revision == revision_before, "a reaction is not a game action"


def test_an_unlisted_emoji_or_a_wall_of_text_is_dropped(monkeypatch, tmp_path):
    app, table_id = _table(monkeypatch, tmp_path, "reaction-bad")

    with TestClient(app) as client:
        client.cookies.set("session", _session_cookie(1))
        with client.websocket_connect(f"/ws/tables/{table_id}", headers={"origin": "http://localhost:8000"}) as socket:
            _opening(socket)
            socket.send_json({"type": "reaction", "emoji": "💩"})
            socket.send_json({"type": "reaction", "emoji": "check out my site " * 40})
            socket.send_json({"type": "reaction", "emoji": "👍"})
            received = socket.receive_json()

    assert received == {"type": "reaction", "seat_number": 1, "emoji": "👍"}, "only the allowed emoji got through"


def test_a_second_reaction_within_two_seconds_is_dropped(monkeypatch, tmp_path):
    app, table_id = _table(monkeypatch, tmp_path, "reaction-rate")

    with TestClient(app) as client:
        client.cookies.set("session", _session_cookie(1))
        with client.websocket_connect(f"/ws/tables/{table_id}", headers={"origin": "http://localhost:8000"}) as socket:
            _opening(socket)
            socket.send_json({"type": "reaction", "emoji": "😂"})
            socket.send_json({"type": "reaction", "emoji": "😮"})
            first = socket.receive_json()
            # A command from a seat that is not to act draws a known error, which
            # is the fence proving nothing else was queued behind the reaction.
            socket.send_json({"idempotency_key": "x", "expected_revision": 0, "action": {"type": "fold"}})
            fence = socket.receive_json()

    assert first == {"type": "reaction", "seat_number": 1, "emoji": "😂"}
    assert fence["type"] in {"error", "ack"}, fence
    assert fence.get("emoji") is None, "the rapid second reaction must not have been relayed"


def test_the_websocket_state_never_carries_opponent_reads(monkeypatch, tmp_path):
    app, table_id = _table(monkeypatch, tmp_path, "reaction-reads")

    with TestClient(app) as client:
        client.cookies.set("session", _session_cookie(1))
        with client.websocket_connect(f"/ws/tables/{table_id}", headers={"origin": "http://localhost:8000"}) as socket:
            snapshot = socket.receive_json()

    assert "opponent_reads" not in snapshot["payload"]
