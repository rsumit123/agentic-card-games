from __future__ import annotations

from dataclasses import replace

import pytest

from app.games.cards import Card
from app.games.holdem.engine import (
    InvalidAction,
    apply_action,
    legal_actions,
    resolve_showdown,
    start_hand,
)
from app.games.holdem.state import HoldemState, PlayerState


RANDOM_BYTES = bytes(range(256)) * 4


def test_start_hand_rotates_dealer_and_posts_blinds():
    state = start_hand({0: 100, 1: 100, 2: 100}, dealer_seat=0, random_bytes=RANDOM_BYTES)

    assert state.dealer_seat == 0
    assert state.small_blind_seat == 1
    assert state.big_blind_seat == 2
    assert state.players[1].total_contribution == 5
    assert state.players[2].total_contribution == 10
    assert state.current_seat == 0


def test_dealer_wraps_across_zero_chip_seats():
    state = start_hand({0: 0, 1: 100, 2: 100}, dealer_seat=2, random_bytes=RANDOM_BYTES)

    assert state.dealer_seat == 2
    wrapped = start_hand({0: 0, 1: 100, 2: 100}, dealer_seat=3, random_bytes=RANDOM_BYTES)
    assert wrapped.dealer_seat == 1


def test_preflop_to_river_requires_legal_turns():
    state = start_hand({0: 100, 1: 100}, dealer_seat=0, random_bytes=RANDOM_BYTES)

    state = apply_action(state, 0, {"type": "call"})
    state = apply_action(state, 1, {"type": "check"})
    assert state.street == "flop"
    assert len(state.community_cards) == 3

    for _ in range(2):
        state = apply_action(state, state.current_seat, {"type": "check"})
    assert state.street == "turn"
    assert len(state.community_cards) == 4

    for _ in range(2):
        state = apply_action(state, state.current_seat, {"type": "check"})
    assert state.street == "river"
    assert len(state.community_cards) == 5

    for _ in range(2):
        state = apply_action(state, state.current_seat, {"type": "check"})
    assert state.street == "complete"


def test_out_of_turn_and_raise_below_minimum_are_rejected():
    state = start_hand({0: 100, 1: 100}, dealer_seat=0, random_bytes=RANDOM_BYTES)

    with pytest.raises(InvalidAction, match="out of turn"):
        apply_action(state, 1, {"type": "call"})
    with pytest.raises(InvalidAction, match="minimum raise"):
        apply_action(state, 0, {"type": "raise", "amount": 15})


def test_all_in_never_creates_negative_stack_and_conserves_chips():
    state = start_hand({0: 25, 1: 40}, dealer_seat=0, random_bytes=RANDOM_BYTES)
    initial_total = sum(player.stack + player.total_contribution for player in state.players)

    state = apply_action(state, 0, {"type": "all_in"})
    assert state.players[0].stack == 0
    assert all(player.stack >= 0 for player in state.players)
    assert sum(player.stack + player.total_contribution for player in state.players) == initial_total


def test_fold_awards_pot_and_completes_hand():
    state = start_hand({0: 100, 1: 100}, dealer_seat=0, random_bytes=RANDOM_BYTES)
    state = apply_action(state, 0, {"type": "fold"})

    assert state.street == "complete"
    assert state.players[1].stack == 105
    assert state.winners == (1,)


def test_legal_actions_expose_raise_bounds():
    state = start_hand({0: 100, 1: 100}, dealer_seat=0, random_bytes=RANDOM_BYTES)

    actions = legal_actions(state, 0)

    raise_action = next(action for action in actions if action["type"] == "raise")
    assert raise_action["min_amount"] == 20
    assert raise_action["max_amount"] == 100


def test_showdown_builds_side_pots_and_awards_each_to_best_eligible_hand():
    board = (
        Card(2, "clubs"),
        Card(3, "diamonds"),
        Card(4, "hearts"),
        Card(5, "spades"),
        Card(9, "clubs"),
    )
    state = HoldemState(
        players=(
            PlayerState(0, 0, (Card(14, "clubs"), Card(14, "diamonds")), total_contribution=100),
            PlayerState(1, 0, (Card(13, "clubs"), Card(13, "diamonds")), total_contribution=100),
            PlayerState(2, 0, (Card(6, "clubs"), Card(7, "diamonds")), total_contribution=50),
        ),
        deck=(),
        deck_index=0,
        community_cards=board,
        street="river",
        dealer_seat=0,
        small_blind_seat=1,
        big_blind_seat=2,
        current_seat=None,
        current_bet=0,
        min_raise=10,
        small_blind=5,
        big_blind=10,
    )

    resolved = resolve_showdown(state)

    assert dict(resolved.payouts) == {0: 100, 2: 150}
    assert sum(amount for _, amount in resolved.payouts) == 250
