from __future__ import annotations

from app.ai.policy import policy_for_tier
from app.ai.prompt import describe_table, system_prompt
from app.games.holdem.engine import HoldemModule, start_hand
from app.rooms.actor import RoomActor


def test_the_spot_is_described_in_poker_terms_not_raw_json():
    state = start_hand({1: 1000, 2: 1000}, small_blind=25, big_blind=50)
    seat = state.current_seat
    projection = RoomActor(1, state).snapshot_for(seat)
    legal = list(HoldemModule().ai_schema(state, seat)["actions"])

    described = describe_table(projection, legal)

    assert f"You are seat {seat}." in described
    assert "Your cards:" in described
    assert "Pot: 75" in described
    assert "To call:" in described
    assert "Legal actions:" in described
    assert "'rank'" not in described and '"rank"' not in described


def test_system_prompt_tells_the_model_how_to_play_and_how_to_answer():
    prompt = system_prompt(policy_for_tier("Medium"))

    assert "Fold weak hands" in prompt
    assert "raising TO" in prompt
    assert '"reasoning"' in prompt
    assert "Your style:" in prompt


def test_the_model_is_told_how_the_betting_has_gone():
    from app.games.holdem.engine import apply_action

    state = start_hand({1: 1000, 2: 1000}, small_blind=25, big_blind=50, random_bytes=bytes(range(256)) * 4)
    state = apply_action(state, state.current_seat, {"type": "call"})
    state = apply_action(state, state.current_seat, {"type": "check"})
    state = apply_action(state, state.current_seat, {"type": "bet", "amount": 100})
    seat = state.current_seat

    described = describe_table(RoomActor(1, state).snapshot_for(seat), list(HoldemModule().ai_schema(state, seat)["actions"]))

    assert "How the betting has gone this hand:" in described
    assert "preflop:" in described and "flop:" in described
    assert "you called 50" in described
    assert "seat 2 bet 100" in described


AGGRESSIVE_READ = {
    2: {
        "hands": 12,
        "vpip_pct": 92,
        "aggression_pct": 78,
        "fold_to_bet_pct": 10,
        "won_without_showdown": 9,
        "showdowns": 3,
        "showed_weak": 2,
    }
}
PASSIVE_READ = {
    2: {
        "hands": 9,
        "vpip_pct": 20,
        "aggression_pct": 8,
        "fold_to_bet_pct": 80,
        "won_without_showdown": 1,
        "showdowns": 2,
        "showed_weak": 0,
    }
}


def _spot_with_reads(reads, tier):
    from app.rooms.actor import RoomActor

    state = start_hand({1: 1000, 2: 1000}, small_blind=25, big_blind=50)
    seat = state.current_seat
    projection = dict(RoomActor(1, state).snapshot_for(seat))
    projection["opponent_reads"] = reads
    legal = list(HoldemModule().ai_schema(state, seat)["actions"])
    return describe_table(projection, legal, policy=policy_for_tier(tier))


def test_an_aggressive_opponent_is_described_and_interpreted_for_the_hard_tier():
    described = _spot_with_reads(AGGRESSIVE_READ, "Hard")

    assert "Seat 2, read from 12 hands" in described
    assert "78%" in described
    assert "9 pots" in described
    assert "Nobody is dealt good cards that often" in described
    assert "do not fold just because they bet again" in described


def test_a_passive_opponent_gets_the_opposite_interpretation():
    described = _spot_with_reads(PASSIVE_READ, "Hard")

    assert "almost never bets" in described
    assert "Nobody is dealt good cards that often" not in described


def test_the_tier_ladder_decides_who_sees_the_reads():
    easy = _spot_with_reads(AGGRESSIVE_READ, "Easy")
    medium = _spot_with_reads(AGGRESSIVE_READ, "Medium")
    hard = _spot_with_reads(AGGRESSIVE_READ, "Hard")

    assert "read from 12 hands" not in easy, "Easy has no memory at all, so it stays beatable"
    assert "read from 12 hands" in medium
    assert "Nobody is dealt good cards that often" not in medium, "Medium gets the numbers, not the reading"
    assert "read from 12 hands" in hard and "Nobody is dealt good cards that often" in hard


def test_a_seat_with_too_little_evidence_is_not_described_at_all():
    thin = {2: dict(AGGRESSIVE_READ[2], hands=4)}

    described = _spot_with_reads(thin, "Hard")

    assert "read from" not in described
    assert "Nobody is dealt good cards that often" not in described


def test_the_rules_say_what_to_do_against_a_player_who_bets_every_hand():
    prompt = system_prompt(policy_for_tier("Hard"))

    assert "Fold weak hands" in prompt
    assert "bets in most hands" in prompt
    assert "Folding every hand to a player who keeps betting" in prompt
