from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from itertools import combinations
from typing import Iterable

from ..cards import Card

CATEGORY_NAMES = (
    "high_card",
    "pair",
    "two_pair",
    "three_kind",
    "straight",
    "flush",
    "full_house",
    "four_kind",
    "straight_flush",
)


@dataclass(frozen=True, slots=True, order=True)
class HandRank:
    category: int
    tiebreakers: tuple[int, ...]

    @property
    def category_name(self) -> str:
        return CATEGORY_NAMES[self.category]


def _straight_high(ranks: Iterable[int]) -> int | None:
    unique = set(ranks)
    if {14, 2, 3, 4, 5}.issubset(unique):
        return 5
    for high in range(14, 4, -1):
        if all(rank in unique for rank in range(high - 4, high + 1)):
            return high
    return None


def _evaluate_five(cards: tuple[Card, ...]) -> HandRank:
    ranks = sorted((card.rank for card in cards), reverse=True)
    counts = Counter(ranks)
    groups = sorted(((count, rank) for rank, count in counts.items()), reverse=True)
    flush = len({card.suit for card in cards}) == 1
    straight_high = _straight_high(ranks)
    if flush and straight_high:
        return HandRank(8, (straight_high,))
    if groups[0][0] == 4:
        four = groups[0][1]
        return HandRank(7, (four, groups[1][1]))
    if groups[0][0] == 3 and groups[1][0] == 2:
        return HandRank(6, (groups[0][1], groups[1][1]))
    if flush:
        return HandRank(5, tuple(ranks))
    if straight_high:
        return HandRank(4, (straight_high,))
    if groups[0][0] == 3:
        kickers = sorted((rank for rank in ranks if counts[rank] == 1), reverse=True)
        return HandRank(3, (groups[0][1], *kickers))
    if groups[0][0] == 2 and groups[1][0] == 2:
        pairs = sorted((groups[0][1], groups[1][1]), reverse=True)
        kicker = next(rank for rank in ranks if counts[rank] == 1)
        return HandRank(2, (*pairs, kicker))
    if groups[0][0] == 2:
        pair = groups[0][1]
        kickers = sorted((rank for rank in ranks if counts[rank] == 1), reverse=True)
        return HandRank(1, (pair, *kickers))
    return HandRank(0, tuple(ranks))


def evaluate_hand(cards: Iterable[Card]) -> HandRank:
    cards = tuple(cards)
    if len(cards) < 5 or len(cards) > 7:
        raise ValueError("a Hold'em hand must contain five to seven cards")
    return max(_evaluate_five(combo) for combo in combinations(cards, 5))


def compare_hands(first: Iterable[Card], second: Iterable[Card]) -> int:
    first_rank = evaluate_hand(first)
    second_rank = evaluate_hand(second)
    return (first_rank > second_rank) - (first_rank < second_rank)
