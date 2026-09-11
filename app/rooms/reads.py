"""What each seat has shown about itself, hand after hand.

A single decision is made from one hand's action log, so an opponent who has
bet eleven hands in a row looks exactly like one who has a monster this time.
These counters are the memory that difference needs: they accumulate for the
life of the table's actor and are summarised into plain numbers for the AI.

Everything here is public information — what everyone at the table watched
happen — and it is kept in memory only. It is never shown to a human player.
"""
from __future__ import annotations

from typing import Any, Mapping

from ..games.holdem.engine import showdown_hands

VOLUNTARY = {"call", "bet", "raise", "all_in"}
AGGRESSIVE = {"bet", "raise", "all_in"}
WEAK_CATEGORIES = {"high_card", "pair"}

COUNTERS = (
    "hands",
    "vpip",
    "decisions",
    "aggressive",
    "faced_bet",
    "folded_to_bet",
    "won_without_showdown",
    "showdowns",
    "showed_weak",
)


def _blank() -> dict[str, int]:
    return {name: 0 for name in COUNTERS}


def _percent(numerator: int, denominator: int) -> int:
    if not denominator:
        return 0
    return max(0, min(100, round(100 * numerator / denominator)))


def update_from_hand(reads: dict[int, dict[str, int]], state) -> dict[int, dict[str, int]]:
    """Fold one completed hand into the running per-seat counters."""
    dealt = [player.seat_id for player in state.players if player.hole_cards]
    for seat_id in dealt:
        reads.setdefault(seat_id, _blank())["hands"] += 1

    voluntary_preflop: set[int] = set()
    aggressed: set[int] = set()

    street = "preflop"
    current_bet = state.big_blind
    contributed: dict[int, int] = {}
    contributed[state.small_blind_seat] = state.small_blind
    contributed[state.big_blind_seat] = state.big_blind

    for entry in state.action_log or ():
        entry_street = str(entry.get("street"))
        if entry_street != street:
            street = entry_street
            current_bet = 0
            contributed = {}
        seat_id = entry.get("seat_id")
        if seat_id is None:
            continue
        counters = reads.setdefault(seat_id, _blank())
        kind = str(entry.get("type"))
        to_call = current_bet - contributed.get(seat_id, 0)

        counters["decisions"] += 1
        # Completing an unraised blind is not facing a bet. Counting it made
        # every small blind look like a player who folds to pressure.
        real_bet = to_call > 0 and not (street == "preflop" and current_bet <= state.big_blind)
        if real_bet:
            counters["faced_bet"] += 1
            if kind == "fold":
                counters["folded_to_bet"] += 1
        if kind in AGGRESSIVE:
            counters["aggressive"] += 1
            aggressed.add(seat_id)
        # Posting a blind is not a choice, and the big blind checking its option
        # has put nothing in voluntarily.
        if street == "preflop" and kind in VOLUNTARY:
            voluntary_preflop.add(seat_id)

        amount = entry.get("amount")
        if amount is not None:
            contributed[seat_id] = int(amount)
            current_bet = max(current_bet, int(amount))

    for seat_id in voluntary_preflop:
        reads.setdefault(seat_id, _blank())["vpip"] += 1

    showdown = showdown_hands(state)
    for entry in showdown:
        seat_id = entry.get("seat_id")
        counters = reads.setdefault(seat_id, _blank())
        counters["showdowns"] += 1
        if seat_id in aggressed and entry.get("category") in WEAK_CATEGORIES:
            counters["showed_weak"] += 1
    if not showdown:
        for seat_id, amount in state.payouts:
            if amount > 0:
                reads.setdefault(seat_id, _blank())["won_without_showdown"] += 1
    return reads


def summarize(reads: Mapping[int, Mapping[str, int]], for_seat_id: int | None) -> dict[int, dict[str, Any]]:
    """The other seats' reads, as the plain numbers the prompt speaks in."""
    summary: dict[int, dict[str, Any]] = {}
    for seat_id, counters in reads.items():
        if seat_id == for_seat_id or counters.get("hands", 0) < 1:
            continue
        summary[seat_id] = {
            "hands": counters["hands"],
            "vpip_pct": _percent(counters["vpip"], counters["hands"]),
            "aggression_pct": _percent(counters["aggressive"], counters["decisions"]),
            "fold_to_bet_pct": _percent(counters["folded_to_bet"], counters["faced_bet"]),
            "won_without_showdown": counters["won_without_showdown"],
            "showdowns": counters["showdowns"],
            "showed_weak": counters["showed_weak"],
        }
    return summary
