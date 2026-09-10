from __future__ import annotations

import base64
import json
from dataclasses import replace

import pytest
from fastapi.testclient import TestClient
from itsdangerous import TimestampSigner

from app.games.holdem.engine import start_hand
from app.models import User
from app.rooms.actor import RoomActor
from app.rooms.lifecycle import (
    LifecycleError,
    SessionSeat,
    SessionState,
    end_session,
    finish_hand,
    leave_between_hands,
    start_table,
)
from app.rooms.service import FullTable, TableConfig


RANDOM_BYTES = bytes(range(256)) * 4


def _session_cookie(user_id: int) -> str:
    value = {"user_id": user_id, "csrf_token": "csrf"}
    encoded = base64.b64encode(json.dumps(value).encode()).decode()
    return TimestampSigner("development-only-change-me").sign(encoded).decode()


def test_lifecycle_requires_filled_seats_and_preserves_zero_chip_spectators():
    state = SessionState(
        table_id=1,
        host_user_id=10,
        seats=(
            SessionSeat(1, 10, "human", 100, joined_order=0),
            SessionSeat(2, None, "human", 100, joined_order=1),
            SessionSeat(3, 30, "human", 0, joined_order=2),
        ),
    )
    with pytest.raises(LifecycleError, match="filled"):
        start_table(state)
    filled = replace(state, seats=(state.seats[0], replace(state.seats[1], user_id=20), state.seats[2]))

    started = start_table(filled)
    assert started.status == "in_progress"
    assert started.seats[2].spectating is True

    ended = finish_hand(started, {1: 0, 2: 50, 3: 0})
    assert ended.status == "ended"
    assert [seat.seat_id for seat in ended.final_rankings] == [2, 1, 3]


def test_host_transfer_and_all_human_departure_cancel():
    state = SessionState(
        table_id=1,
        host_user_id=10,
        seats=(
            SessionSeat(1, 10, "human", 100, joined_order=0),
            SessionSeat(2, 20, "human", 100, joined_order=1),
            SessionSeat(3, 30, "ai", 100, joined_order=2),
        ),
        status="in_progress",
        hand_in_progress=False,
    )

    transferred = leave_between_hands(state, 10)
    assert transferred.host_user_id == 20
    assert transferred.seats[0].present is False
    assert transferred.status == "in_progress"

    cancelled = leave_between_hands(leave_between_hands(transferred, 20), 30)
    assert cancelled.status == "cancelled"


def test_end_session_requires_host_and_waits_for_hand_boundary():
    state = SessionState(
        table_id=1,
        host_user_id=10,
        seats=(SessionSeat(1, 10, "human", 100, joined_order=0), SessionSeat(2, 20, "human", 100, joined_order=1)),
        status="in_progress",
        hand_in_progress=True,
    )
    with pytest.raises(LifecycleError, match="between hands"):
        end_session(state, 10)
    with pytest.raises(LifecycleError, match="host"):
        end_session(replace(state, hand_in_progress=False), 20)


def test_websocket_sends_member_snapshot_and_ack(monkeypatch, tmp_path):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path}/ws.db")
    app = __import__("app.main", fromlist=["create_app"]).create_app()
    with app.state.session_factory() as session:
        session.add_all([User(google_subject="one"), User(google_subject="two")])
        session.commit()
    created = app.state.room_store.create_table(1, TableConfig(seat_count=2))
    app.state.room_store.join_table(2, created.room_code)
    app.state.room_store.start_table(1, created.id)
    app.state.room_manager.register(created.id, RoomActor(created.id, start_hand({1: 1000, 2: 1000}, random_bytes=RANDOM_BYTES)))

    with TestClient(app) as client:
        client.cookies.set("session", _session_cookie(1))
        with client.websocket_connect(f"/ws/tables/{created.id}", headers={"origin": "http://localhost:8000"}) as websocket:
            snapshot = websocket.receive_json()
            assert snapshot["type"] == "snapshot"
            assert snapshot["payload"]["hole_cards"]
            websocket.send_json(
                {"expected_revision": 0, "idempotency_key": "human-1", "action": {"type": "call"}}
            )
            acknowledgement = websocket.receive_json()
            assert acknowledgement["type"] == "ack"
            assert acknowledgement["revision"] == 1


def test_websocket_fans_out_state_without_leaking_hole_cards(monkeypatch, tmp_path):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path}/ws-fanout.db")
    app = __import__("app.main", fromlist=["create_app"]).create_app()
    with app.state.session_factory() as session:
        session.add_all([User(google_subject="one"), User(google_subject="two")])
        session.commit()
    created = app.state.room_store.create_table(1, TableConfig(seat_count=2))
    app.state.room_store.join_table(2, created.room_code)
    app.state.room_store.start_table(1, created.id)
    app.state.room_manager.register(created.id, RoomActor(created.id, start_hand({1: 1000, 2: 1000}, random_bytes=RANDOM_BYTES)))

    with TestClient(app) as first_client, TestClient(app) as second_client:
        first_client.cookies.set("session", _session_cookie(1))
        second_client.cookies.set("session", _session_cookie(2))
        with first_client.websocket_connect(f"/ws/tables/{created.id}", headers={"origin": "http://localhost:8000"}) as first_socket:
            first_snapshot = first_socket.receive_json()
            with second_client.websocket_connect(f"/ws/tables/{created.id}", headers={"origin": "http://localhost:8000"}) as second_socket:
                second_snapshot = second_socket.receive_json()
                first_cards = first_snapshot["payload"]["hole_cards"]
                second_cards = second_snapshot["payload"]["hole_cards"]
                first_socket.send_json(
                    {"expected_revision": 0, "idempotency_key": "fanout-1", "action": {"type": "call"}}
                )
                assert first_socket.receive_json()["type"] == "ack"
                state_event = second_socket.receive_json()

    assert state_event["type"] == "state"
    assert state_event["payload"]["seat_id"] == 2
    assert state_event["payload"]["hole_cards"] == second_cards
    assert state_event["payload"]["hole_cards"] != first_cards


def test_websocket_rejects_bad_origin(monkeypatch, tmp_path):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path}/ws.db")
    app = __import__("app.main", fromlist=["create_app"]).create_app()
    with TestClient(app) as client:
        client.cookies.set("session", _session_cookie(1))
        with pytest.raises(Exception):
            with client.websocket_connect("/ws/tables/999", headers={"origin": "https://evil.example"}):
                pass
