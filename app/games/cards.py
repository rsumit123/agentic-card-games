from __future__ import annotations

import secrets
from dataclasses import dataclass
from typing import Callable, Iterable

SUITS = ("clubs", "diamonds", "hearts", "spades")
RANKS = tuple(range(2, 15))


@dataclass(frozen=True, slots=True)
class Card:
    rank: int
    suit: str

    def __post_init__(self) -> None:
        if self.rank not in RANKS:
            raise ValueError("card rank must be between 2 and 14")
        if self.suit not in SUITS:
            raise ValueError(f"card suit must be one of {SUITS}")


def standard_deck() -> tuple[Card, ...]:
    return tuple(Card(rank=rank, suit=suit) for suit in SUITS for rank in RANKS)


def shuffle_deck(
    cards: Iterable[Card],
    *,
    random_bytes: bytes | None = None,
    random_source: Callable[[int], bytes] = secrets.token_bytes,
) -> tuple[Card, ...]:
    shuffled = list(cards)
    cursor = 0

    def next_word() -> int:
        nonlocal cursor
        if random_bytes is not None:
            if cursor + 8 > len(random_bytes):
                raise ValueError("injected random bytes are exhausted")
            value = int.from_bytes(random_bytes[cursor : cursor + 8], "big")
            cursor += 8
            return value
        return int.from_bytes(random_source(8), "big")

    for index in range(len(shuffled) - 1, 0, -1):
        swap_index = next_word() % (index + 1)
        shuffled[index], shuffled[swap_index] = shuffled[swap_index], shuffled[index]
    return tuple(shuffled)
