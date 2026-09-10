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
