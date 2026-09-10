from __future__ import annotations

import sqlite3
from datetime import datetime, timedelta, timezone

from app.games.holdem.engine import start_hand
from app.rooms.actor import RoomActor
from app.rooms.protocol import Ack, CommandError


RANDOM_BYTES = bytes(range(256)) * 4


def test_actor_orders_revisions_and_replays_idempotent_command(tmp_path):
    state = start_hand({0: 100, 1: 100}, random_bytes=RANDOM_BYTES)
    actor = RoomActor(42, state, data_path=tmp_path / "events.db")

    command = {"expected_revision": 0, "idempotency_key": "action-1", "action": {"type": "call"}}
    first = actor.submit(command)
    replay = actor.submit(command)
    stale = actor.submit({**command, "idempotency_key": "action-2"})

    assert isinstance(first, Ack)
    assert replay == first
    assert isinstance(stale, CommandError)
    assert stale.code == "stale_revision"
    assert actor.revision == 1

    with sqlite3.connect(tmp_path / "events.db") as connection:
        event = connection.execute(
            "SELECT revision, idempotency_key FROM room_events WHERE table_id = 42"
        ).fetchone()
    assert event == (1, "action-1")


def test_snapshot_and_reconnect_only_include_recipient_hole_cards():
    state = start_hand({0: 100, 1: 100}, random_bytes=RANDOM_BYTES)
    actor = RoomActor(42, state)

    seat_zero = actor.snapshot_for(0)
    seat_one = actor.snapshot_for(1)
    resync = actor.resync(0, since_revision=-1)

    assert seat_zero["hole_cards"] == state.player(0).hole_cards
    assert seat_one["hole_cards"] == state.player(1).hole_cards
    assert state.player(1).hole_cards[0] not in seat_zero["hole_cards"]
    assert resync["revision"] == 0
    assert resync["snapshot"] == seat_zero


def test_snapshot_for_spectator_has_public_state_without_private_cards():
    state = start_hand({0: 100, 1: 100}, random_bytes=RANDOM_BYTES)
    actor = RoomActor(42, state)

    spectator = actor.snapshot_for(2)

    assert spectator["seat_id"] == 2
    assert spectator["hole_cards"] == ()
    assert spectator["legal_actions"] == ()
    assert spectator["hand_rank"] is None


def test_tick_auto_folds_expired_turn():
    now = datetime(2026, 1, 1, tzinfo=timezone.utc)
    state = start_hand({0: 100, 1: 100}, random_bytes=RANDOM_BYTES)
    actor = RoomActor(42, state, clock=lambda: now, action_timeout=timedelta(seconds=5))

    assert actor.tick(now + timedelta(seconds=4)) is None
    timeout_ack = actor.tick(now + timedelta(seconds=6))

    assert isinstance(timeout_ack, Ack)
    assert actor.state.player(0).folded is True
    assert actor.state.street == "complete"


def test_timeout_fold_is_marked_in_the_action_log():
    now = datetime(2026, 1, 1, tzinfo=timezone.utc)
    state = start_hand({0: 100, 1: 100}, random_bytes=RANDOM_BYTES)
    actor = RoomActor(42, state, clock=lambda: now, action_timeout=timedelta(seconds=5))

    actor.tick(now + timedelta(seconds=6))

    entry = actor.state.action_log[-1]
    assert entry["type"] == "fold"
    assert entry["timeout"] is True


def test_voluntary_fold_is_not_marked_as_a_timeout():
    state = start_hand({0: 100, 1: 100}, random_bytes=RANDOM_BYTES)
    actor = RoomActor(42, state)

    actor.submit({"expected_revision": 0, "idempotency_key": "fold-1", "action": {"type": "fold"}})

    entry = actor.state.action_log[-1]
    assert entry["type"] == "fold"
    assert entry.get("timeout") in (None, False)
