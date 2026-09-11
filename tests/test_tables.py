from __future__ import annotations

import base64
import json
from dataclasses import replace
from datetime import datetime, timedelta, timezone

from itsdangerous import TimestampSigner
import pytest
from pydantic import ValidationError
from sqlalchemy import select

from app.main import create_app
from app.models import Hand, Seat, Table, User
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
    assert view.seats[1].display_name == "Gemini 3.7 Flash"  # players see the model, not the tier
    assert view.seats[1].model == "google/gemini-3.7-flash"
    assert view.seats[1].spectating is False
    assert started.status == "in_progress"


def test_table_view_exposes_names_spectators_and_final_rankings(app_and_store):
    app, store = app_and_store
    created = store.create_table(1, TableConfig(seat_count=2))

    assert created.seats[0].display_name == "Host"
    assert created.seats[0].spectating is False
    assert created.seats[1].display_name is None
    assert created.seats[1].spectating is True

    store.join_table(2, created.room_code)
    store.start_table(1, created.id)
    with app.state.session_factory() as session:
        table = session.get(Table, created.id)
        table.status = "ended"
        table.seats[0].chip_count = 25
        table.seats[1].chip_count = 75
        session.commit()
        view = store._view(table)

    assert [(item.seat_number, item.display_name, item.chip_count) for item in view.final_rankings] == [
        (2, "Player", 75),
        (1, "Host", 25),
    ]


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


def test_lifecycle_routes_transfer_host_and_end_with_rankings(app_and_store):
    app, store = app_and_store
    created = store.create_table(1, TableConfig(seat_count=2))
    store.join_table(2, created.room_code)
    store.start_table(1, created.id)
    actor = app.state.room_manager.ensure_actor_for_table(created.id, app.state.session_factory, app.state.settings)

    from fastapi.testclient import TestClient

    with TestClient(app) as client:
        client.cookies.set("session", TimestampSigner("development-only-change-me").sign(
            base64.b64encode(json.dumps({"user_id": 1, "csrf_token": "csrf"}).encode()).decode()
        ).decode())
        blocked = client.post(f"/tables/{created.id}/end", headers={"X-CSRF-Token": "csrf"})
        assert blocked.status_code == 409
        assert blocked.json()["detail"] == "session can only end between hands"

        actor.begin_hand(replace(actor.state, street="complete", current_seat=None))
        ended = client.post(f"/tables/{created.id}/end", headers={"X-CSRF-Token": "csrf"})

    assert ended.status_code == 200
    assert ended.json()["status"] == "ended"
    assert ended.json()["final_rankings"]


def test_leave_route_transfers_host_and_emits_session_event(app_and_store):
    app, store = app_and_store
    created = store.create_table(1, TableConfig(seat_count=2))
    store.join_table(2, created.room_code)
    store.start_table(1, created.id)
    actor = app.state.room_manager.ensure_actor_for_table(created.id, app.state.session_factory, app.state.settings)
    actor.begin_hand(replace(actor.state, street="complete", current_seat=None))
    other_queue = app.state.room_manager.connect(created.id, 2)

    from fastapi.testclient import TestClient

    with TestClient(app) as client:
        client.cookies.set("session", TimestampSigner("development-only-change-me").sign(
            base64.b64encode(json.dumps({"user_id": 1, "csrf_token": "csrf"}).encode()).decode()
        ).decode())
        response = client.post(f"/tables/{created.id}/leave", headers={"X-CSRF-Token": "csrf"})

    assert response.status_code == 200
    assert response.json()["host_user_id"] == 2
    assert response.json()["seats"][0]["spectating"] is True
    event = other_queue.get_nowait()
    assert event["type"] == "session"
    assert event["host_user_id"] == 2


def test_start_creates_active_hand_and_actor_projection_has_names(app_and_store):
    app, store = app_and_store
    created = store.create_table(1, TableConfig(seat_count=2))
    store.join_table(2, created.room_code)
    store.start_table(1, created.id)

    actor = app.state.room_manager.ensure_actor_for_table(created.id, app.state.session_factory, app.state.settings)

    with app.state.session_factory() as session:
        hands = session.query(Hand).filter(Hand.table_id == created.id).all()

    assert len(hands) == 1
    assert hands[0].status == "active"
    assert hands[0].pre_hand_balances == {"1": 1000, "2": 1000}
    assert actor.snapshot_for(1)["public"]["names"] == {1: "Host", 2: "Player"}


def test_join_prefers_an_open_seat_then_takes_over_an_ai_seat(app_and_store):
    """A friend arriving with the code should sit down, even at a full-of-AI table."""
    _app, store = app_and_store
    view = store.create_table(1, TableConfig(seat_count=3))

    store.fill_ai_seat(1, view.id, 2, "Medium")
    joined = store.join_table(2, view.room_code)
    human = next(seat for seat in joined.seats if seat.user_id == 2)
    assert human.seat_number == 3, "an open seat is taken before an AI seat is evicted"

    taken_over = store.join_table(3, view.room_code)
    replaced = next(seat for seat in taken_over.seats if seat.user_id == 3)
    assert replaced.seat_number == 2
    assert replaced.actor_type == "human"
    assert replaced.ai_tier is None


def test_ai_seats_are_named_after_the_model_that_plays_them(app_and_store):
    _app, store = app_and_store
    view = store.create_table(1, TableConfig(seat_count=2))
    filled = store.fill_ai_seat(1, view.id, 2, "Medium")

    seat = next(item for item in filled.seats if item.seat_number == 2)
    assert seat.ai_tier == "Medium"
    assert seat.model == "openai/gpt-4o-mini"
    assert seat.display_name == "GPT-4o mini"


def test_ai_tier_catalogue_names_the_model_behind_each_tier(app_and_store):
    from fastapi.testclient import TestClient

    app, _store = app_and_store
    value = base64.b64encode(json.dumps({"user_id": 1, "csrf_token": "csrf"}).encode()).decode()
    cookie = TimestampSigner("development-only-change-me").sign(value).decode()
    with TestClient(app) as client:
        client.cookies.set("session", cookie)
        response = client.get("/ai/tiers")

    assert response.status_code == 200
    tiers = response.json()["tiers"]
    assert [item["tier"] for item in tiers] == ["Easy", "Medium", "Hard"]
    assert {item["label"] for item in tiers} == {"GPT-4o mini", "Gemini 3.7 Flash"}
    assert {item["model"] for item in tiers} == {"openai/gpt-4o-mini", "google/gemini-3.7-flash"}


def test_sit_out_and_sit_in_routes_mark_the_seat(app_and_store):
    app, store = app_and_store
    created = store.create_table(1, TableConfig(seat_count=2))
    store.join_table(2, created.room_code)
    store.start_table(1, created.id)
    app.state.room_manager.ensure_actor_for_table(created.id, app.state.session_factory, app.state.settings)

    from fastapi.testclient import TestClient

    def cookie_for(user_id: int) -> str:
        return TimestampSigner("development-only-change-me").sign(
            base64.b64encode(json.dumps({"user_id": user_id, "csrf_token": "csrf"}).encode()).decode()
        ).decode()

    with TestClient(app) as client:
        client.cookies.set("session", cookie_for(2))
        sat_out = client.post(f"/tables/{created.id}/sit-out", headers={"X-CSRF-Token": "csrf"})
        with app.state.session_factory() as session:
            seat = session.query(Seat).filter(Seat.table_id == created.id, Seat.seat_number == 2).one()
            assert seat.sitting_out is True
        sat_in = client.post(f"/tables/{created.id}/sit-in", headers={"X-CSRF-Token": "csrf"})

    with TestClient(app) as stranger_client:
        stranger_client.cookies.set("session", cookie_for(3))
        stranger = stranger_client.post(f"/tables/{created.id}/sit-out", headers={"X-CSRF-Token": "csrf"})

    assert sat_out.status_code == 200
    assert sat_in.status_code == 200
    with app.state.session_factory() as session:
        seat = session.query(Seat).filter(Seat.table_id == created.id, Seat.seat_number == 2).one()
    assert seat.sitting_out is False
    assert stranger.status_code == 409
    assert stranger.json()["detail"] == "you are not seated at this table"


def _cookie_for(user_id: int) -> str:
    return TimestampSigner("development-only-change-me").sign(
        base64.b64encode(json.dumps({"user_id": user_id, "csrf_token": "csrf"}).encode()).decode()
    ).decode()


def test_host_can_deal_the_next_hand_without_waiting_out_the_reveal(app_and_store):
    app, store = app_and_store
    created = store.create_table(1, TableConfig(seat_count=2))
    store.join_table(2, created.room_code)
    store.start_table(1, created.id)
    manager = app.state.room_manager
    actor = manager.ensure_actor_for_table(created.id, app.state.session_factory, app.state.settings)
    manager.submit(created.id, 1, {"expected_revision": 0, "idempotency_key": "fold", "action": {"type": "fold"}})
    assert manager.reveal_deadline(created.id) is not None
    hand_number = actor.state.hand_number

    from fastapi.testclient import TestClient

    with TestClient(app) as guest:
        guest.cookies.set("session", _cookie_for(2))
        not_the_host = guest.post(f"/tables/{created.id}/next-hand", headers={"X-CSRF-Token": "csrf"})
    with TestClient(app) as client:
        client.cookies.set("session", _cookie_for(1))
        dealt = client.post(f"/tables/{created.id}/next-hand", headers={"X-CSRF-Token": "csrf"})

    assert not_the_host.status_code == 409
    assert dealt.status_code == 200
    assert actor.state.hand_number == hand_number + 1
    assert actor.state.street == "preflop"
    assert manager.reveal_deadline(created.id) is None


def test_dealing_the_next_hand_mid_hand_changes_nothing(app_and_store):
    app, store = app_and_store
    created = store.create_table(1, TableConfig(seat_count=2))
    store.join_table(2, created.room_code)
    store.start_table(1, created.id)
    manager = app.state.room_manager
    actor = manager.ensure_actor_for_table(created.id, app.state.session_factory, app.state.settings)
    revision = actor.revision

    from fastapi.testclient import TestClient

    with TestClient(app) as client:
        client.cookies.set("session", _cookie_for(1))
        response = client.post(f"/tables/{created.id}/next-hand", headers={"X-CSRF-Token": "csrf"})

    assert response.status_code == 409
    assert response.json()["detail"] == "no hand is waiting to be dealt"
    assert actor.revision == revision
    assert actor.state.street == "preflop"
