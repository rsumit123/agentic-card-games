from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

from app.games.holdem.engine import start_hand
from app.games.holdem.engine import HoldemModule
from app.ai.adapter import ProposedAction
from app.rooms.actor import RoomActor
from app.rooms.manager import RoomManager
from app.rooms.protocol import Ack
from app.models import Hand, Seat, Table, User


RANDOM_BYTES = bytes(range(256)) * 4


def test_ack_snapshot_belongs_to_submitter_and_includes_next_deadline():
    state = start_hand({0: 100, 1: 100}, random_bytes=RANDOM_BYTES)
    actor = RoomActor(1, state, action_timeout=timedelta(seconds=30))

    acknowledgement = actor.submit(
        {"expected_revision": 0, "idempotency_key": "human-0", "action": {"type": "call"}},
        seat_id=0,
    )

    assert isinstance(acknowledgement, Ack)
    assert acknowledgement.snapshot["seat_id"] == 0
    assert acknowledgement.snapshot["hole_cards"] == state.player(0).hole_cards
    assert state.player(1).hole_cards[0] not in acknowledgement.snapshot["hole_cards"]
    assert acknowledgement.deadline is not None


def test_seat_projection_contains_table_markers_betting_state_and_legal_actions():
    state = start_hand({0: 100, 1: 100}, random_bytes=RANDOM_BYTES)

    projection = HoldemModule().seat_projection(state, 0)
    public = projection["public"]

    assert public["dealer_seat"] == state.dealer_seat
    assert public["small_blind_seat"] == state.small_blind_seat
    assert public["big_blind_seat"] == state.big_blind_seat
    assert public["current_bet"] == state.current_bet
    assert public["min_raise"] == state.min_raise
    assert public["players"][1]["street_contribution"] == state.player(1).street_contribution
    assert projection["legal_actions"]
    assert any(action["type"] == "raise" for action in projection["legal_actions"])


def test_room_manager_fans_out_seat_specific_state_events():
    actor = RoomActor(1, start_hand({0: 100, 1: 100}, random_bytes=RANDOM_BYTES))
    manager = RoomManager()
    manager.register(1, actor)
    first = manager.connect(1, 0)
    second = manager.connect(1, 1)

    manager.publish(1, lambda seat_id: {"type": "state", "payload": actor.snapshot_for(seat_id)})

    first_event = first.get_nowait()
    second_event = second.get_nowait()
    assert first_event["payload"]["seat_id"] == 0
    assert second_event["payload"]["seat_id"] == 1
    assert first_event["payload"]["hole_cards"] != second_event["payload"]["hole_cards"]


def test_room_manager_drives_expired_turns_with_async_tick():
    now = datetime(2026, 1, 1, tzinfo=timezone.utc)
    current = [now]
    actor = RoomActor(1, start_hand({0: 100, 1: 100}, random_bytes=RANDOM_BYTES), clock=lambda: current[0], action_timeout=timedelta(seconds=1))
    manager = RoomManager(clock=lambda: current[0], poll_interval=0.001)
    manager.register(1, actor)
    queue = manager.connect(1, 0)

    async def drive():
        task = asyncio.create_task(manager.run_once(1))
        current[0] = now + timedelta(seconds=2)
        await task

    asyncio.run(drive())

    assert actor.state.player(0).folded is True
    assert queue.get_nowait()["type"] == "state"


def test_room_manager_invokes_ai_and_publishes_its_accepted_action():
    state = start_hand({0: 100, 1: 100}, random_bytes=RANDOM_BYTES)
    actor = RoomActor(1, state, action_timeout=timedelta(seconds=30))

    class FakeAdapter:
        def __init__(self):
            self.calls = 0

        async def decide(self, projection, schema, revision, deadline):
            self.calls += 1
            return ProposedAction({"type": "call"}, revision)

    adapter = FakeAdapter()
    manager = RoomManager()
    manager.register(1, actor)
    manager.register_ai(1, 0, adapter)
    queue = manager.connect(1, 1)

    asyncio.run(manager.run_once(1))

    assert adapter.calls == 1
    assert actor.revision == 1
    assert queue.get_nowait()["type"] == "state"


def test_completed_hand_writes_back_chips_and_starts_next_hand_after_reveal(tmp_path):
    from app.db import build_engine, initialize_database, session_factory
    from app.settings import Settings

    settings = Settings(database_url=f"sqlite:///{tmp_path}/progression.db", data_dir=tmp_path)
    engine = build_engine(settings)
    initialize_database(engine)
    sessions = session_factory(engine)
    with sessions() as session:
        host = User(google_subject="host", display_name="Host")
        player = User(google_subject="player", display_name="Player")
        session.add_all([host, player])
        session.flush()
        table = Table(
            host_user_id=host.id,
            room_code_hash="progression",
            seat_count=2,
            starting_chips=1000,
            small_blind=5,
            big_blind=10,
            status="in_progress",
            seats=[
                Seat(seat_number=1, user_id=host.id, chip_count=1000, is_funded=True),
                Seat(seat_number=2, user_id=player.id, chip_count=1000, is_funded=True),
            ],
        )
        session.add(table)
        session.commit()
        table_id = table.id

    now = datetime(2026, 1, 1, tzinfo=timezone.utc)
    current = [now]
    manager = RoomManager(clock=lambda: current[0], hand_reveal_seconds=6, session_factory=sessions)
    actor = manager.ensure_actor_for_table(table_id, sessions, settings)
    manager.submit(table_id, 1, {"expected_revision": 0, "idempotency_key": "fold-1", "action": {"type": "fold"}})

    with sessions() as session:
        hands = session.query(Hand).filter(Hand.table_id == table_id).order_by(Hand.id).all()
        seats = session.query(Seat).filter(Seat.table_id == table_id).order_by(Seat.seat_number).all()
    assert hands[0].status == "completed"
    assert [seat.chip_count for seat in seats] == [995, 1005]
    assert actor.state.street == "complete"

    current[0] = now + timedelta(seconds=5)
    asyncio.run(manager.run_once(table_id))
    assert actor.state.street == "complete"
    current[0] = now + timedelta(seconds=7)
    asyncio.run(manager.run_once(table_id))

    with sessions() as session:
        hands = session.query(Hand).filter(Hand.table_id == table_id).order_by(Hand.id).all()
    assert len(hands) == 2
    assert hands[1].status == "active"
    assert actor.state.street == "preflop"
    assert actor.revision == 2


def test_leave_during_hand_is_applied_at_hand_boundary(tmp_path):
    from app.db import build_engine, initialize_database, session_factory
    from app.settings import Settings

    settings = Settings(database_url=f"sqlite:///{tmp_path}/leave.db", data_dir=tmp_path)
    engine = build_engine(settings)
    initialize_database(engine)
    sessions = session_factory(engine)
    with sessions() as session:
        host = User(google_subject="host", display_name="Host")
        player = User(google_subject="player", display_name="Player")
        session.add_all([host, player])
        session.flush()
        table = Table(
            host_user_id=host.id,
            room_code_hash="leave",
            seat_count=2,
            starting_chips=1000,
            small_blind=5,
            big_blind=10,
            status="in_progress",
            seats=[
                Seat(seat_number=1, user_id=host.id, chip_count=1000),
                Seat(seat_number=2, user_id=player.id, chip_count=1000),
            ],
        )
        session.add(table)
        session.commit()
        table_id = table.id

    manager = RoomManager(session_factory=sessions)
    actor = manager.ensure_actor_for_table(table_id, sessions, settings)
    manager.leave(table_id, 1)
    manager.submit(table_id, 1, {"expected_revision": 0, "idempotency_key": "leave-fold", "action": {"type": "fold"}})

    with sessions() as session:
        table = session.get(Table, table_id)
        seats = session.query(Seat).filter(Seat.table_id == table_id).order_by(Seat.seat_number).all()
    assert table.host_user_id == 2
    assert seats[0].present is False
    assert seats[1].present is True
    assert actor.state.street == "complete"
