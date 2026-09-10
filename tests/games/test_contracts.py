from __future__ import annotations

import pytest

from app.games.contracts import GameState, Transition


def test_game_state_is_opaque_immutable_and_versioned():
    state = GameState(
        game_id="holdem",
        ruleset_version="1",
        seat_count=2,
        revision=4,
        payload={"private": "server-only"},
    )

    assert state.game_id == "holdem"
    assert state.ruleset_version == "1"
    assert state.seat_count == 2
    assert state.revision == 4
    with pytest.raises(TypeError):
        state.payload["new"] = "value"
    with pytest.raises((AttributeError, TypeError)):
        state.revision = 5


def test_transition_records_next_state_and_action():
    state = GameState("holdem", "1", 2, 0, {})
    transition = Transition(state=state, action={"type": "check"}, revision=1)

    assert transition.state is state
    assert transition.action == {"type": "check"}
    assert transition.revision == 1
