from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping

from ..cards import Card


@dataclass(frozen=True, slots=True)
class PlayerState:
    seat_id: int
    stack: int
    hole_cards: tuple[Card, ...] = ()
    folded: bool = False
    all_in: bool = False
    total_contribution: int = 0
    street_contribution: int = 0
    has_acted: bool = False


@dataclass(frozen=True, slots=True)
class HoldemState:
    players: tuple[PlayerState, ...]
    deck: tuple[Card, ...]
    deck_index: int
    community_cards: tuple[Card, ...]
    street: str
    dealer_seat: int
    small_blind_seat: int
    big_blind_seat: int
    current_seat: int | None
    current_bet: int
    min_raise: int
    small_blind: int
    big_blind: int
    hand_number: int = 1
    winners: tuple[int, ...] = ()
    payouts: tuple[tuple[int, int], ...] = ()

    @property
    def pot(self) -> int:
        return sum(player.total_contribution for player in self.players)

    @property
    def total_chips(self) -> int:
        return self.pot + sum(player.stack for player in self.players)

    def player(self, seat_id: int) -> PlayerState:
        for player in self.players:
            if player.seat_id == seat_id:
                return player
        raise KeyError(f"unknown seat {seat_id}")

    def stacks(self) -> Mapping[int, int]:
        return {player.seat_id: player.stack for player in self.players}
