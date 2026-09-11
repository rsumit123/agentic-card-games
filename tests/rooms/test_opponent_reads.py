from __future__ import annotations

from datetime import timedelta

from app.games.holdem.engine import start_hand
from app.rooms.actor import RoomActor
from app.rooms.manager import RoomManager


RANDOM_BYTES = bytes(range(256)) * 4


def _seed(hand_number: int) -> bytes:
    return bytes((value + hand_number * 7) % 256 for value in range(256)) * 4


def _play(manager: RoomManager, table_id: int, actor: RoomActor, choose) -> None:
    """Run one hand to completion, asking `choose(seat_id, legal)` for each turn."""
    guard = 0
    while actor.state.street != "complete":
        guard += 1
        assert guard < 200, "hand did not finish"
        seat_id = actor.state.current_seat
        legal = actor.module.legal_actions(actor.state, seat_id)
        action = choose(seat_id, legal)
        result = manager.submit(
            table_id,
            seat_id,
            {
                "expected_revision": actor.revision,
                "idempotency_key": f"{actor.state.hand_number}:{actor.revision}",
                "action": action,
            },
        )
        assert getattr(result, "revision", None) is not None, result


def _always_bet(_seat_id, legal):
    by_type = {action["type"]: action for action in legal}
    for kind in ("bet", "raise"):
        if kind in by_type:
            return {"type": kind, "amount": by_type[kind]["min_amount"]}
    if "check" in by_type:
        return {"type": "check"}
    return {"type": "call", "amount": by_type["call"]["amount"]}


def _always_fold(_seat_id, legal):
    by_type = {action["type"]: action for action in legal}
    if "check" in by_type:
        return {"type": "check"}
    return {"type": "fold"}


def _hands(manager, table_id, actor, choose, count=6):
    for number in range(count):
        _play(manager, table_id, actor, choose)
        actor.begin_hand(
            start_hand(
                {0: 1000, 1: 1000},
                dealer_seat=number + 1,
                random_bytes=_seed(number + 1),
                hand_number=number + 2,
            )
        )


def test_a_seat_that_bets_every_turn_reads_as_highly_aggressive():
    actor = RoomActor(1, start_hand({0: 1000, 1: 1000}, random_bytes=RANDOM_BYTES), action_timeout=timedelta(seconds=30))
    manager = RoomManager()
    manager.register(1, actor)

    _hands(manager, 1, actor, _always_bet)

    reads = manager.opponent_reads(1, 0)
    assert reads[1]["hands"] >= 6
    assert reads[1]["aggression_pct"] >= 60
    assert reads[1]["vpip_pct"] >= 80


def test_a_seat_that_never_puts_money_in_preflop_reads_as_tight():
    actor = RoomActor(1, start_hand({0: 1000, 1: 1000}, random_bytes=RANDOM_BYTES), action_timeout=timedelta(seconds=30))
    manager = RoomManager()
    manager.register(1, actor)

    def choose(seat_id, legal):
        return _always_bet(seat_id, legal) if seat_id == 0 else _always_fold(seat_id, legal)

    _hands(manager, 1, actor, choose)

    reads = manager.opponent_reads(1, 0)
    assert reads[1]["vpip_pct"] <= 25
    assert reads[1]["aggression_pct"] == 0
    assert reads[1]["fold_to_bet_pct"] >= 75


def test_reads_never_include_the_asking_seat_and_reset_when_the_actor_is_dropped():
    actor = RoomActor(1, start_hand({0: 1000, 1: 1000}, random_bytes=RANDOM_BYTES), action_timeout=timedelta(seconds=30))
    manager = RoomManager()
    manager.register(1, actor)

    _hands(manager, 1, actor, _always_bet)

    assert 0 not in manager.opponent_reads(1, 0)
    assert 1 not in manager.opponent_reads(1, 1)

    manager.drop(1)

    assert manager.opponent_reads(1, 0) == {}
    assert manager.get(1) is None


def test_a_seat_with_no_finished_hands_is_left_out():
    actor = RoomActor(1, start_hand({0: 1000, 1: 1000}, random_bytes=RANDOM_BYTES))
    manager = RoomManager()
    manager.register(1, actor)

    assert manager.opponent_reads(1, 0) == {}


def test_the_ai_is_handed_the_reads_and_the_websocket_never_is():
    import asyncio

    actor = RoomActor(1, start_hand({0: 1000, 1: 1000}, random_bytes=RANDOM_BYTES), action_timeout=timedelta(seconds=30))
    manager = RoomManager()
    manager.register(1, actor)
    _hands(manager, 1, actor, _always_bet, count=6)

    seen = {}

    class RecordingAdapter:
        async def decide(self, projection, schema, revision, deadline):
            seen.update(projection)
            return None

    manager.register_ai(1, actor.state.current_seat, RecordingAdapter())
    queue = manager.connect(1, actor.state.current_seat)
    asyncio.run(manager.run_once(1))

    assert seen["opponent_reads"], "the AI must be able to remember earlier hands"
    assert "opponent_reads" not in actor.snapshot_for(0)
    manager._publish_state(1, actor)
    event = queue.get_nowait()
    assert "opponent_reads" not in event["payload"], "a human must never be shown a read"


def test_completing_an_unraised_blind_is_not_facing_a_bet():
    """A small blind folding to nothing but the big blind is not folding to pressure."""
    from app.games.holdem.engine import apply_action
    from app.rooms.reads import update_from_hand, summarize

    state = start_hand({1: 1000, 2: 1000}, random_bytes=RANDOM_BYTES)
    # Heads-up the small blind acts first preflop, and folds to nothing but the
    # big blind.
    folder = state.current_seat
    state = apply_action(state, folder, {"type": "fold"})

    reads: dict[int, dict[str, int]] = {}
    update_from_hand(reads, state)
    other = next(seat for seat in (1, 2) if seat != folder)
    summary = summarize(reads, for_seat_id=other)
    assert folder in summary, "the folding seat should have a read"
    assert summary[folder]["fold_to_bet_pct"] == 0
