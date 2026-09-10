from __future__ import annotations

from dataclasses import dataclass
from types import MappingProxyType
from typing import Any, Mapping, NewType, Protocol

SeatId = NewType("SeatId", int)


@dataclass(frozen=True, slots=True)
class GameState:
    game_id: str
    ruleset_version: str
    seat_count: int
    revision: int
    payload: Mapping[str, Any]

    def __post_init__(self) -> None:
        object.__setattr__(self, "payload", MappingProxyType(dict(self.payload)))


@dataclass(frozen=True, slots=True)
class Transition:
    state: GameState
    action: Mapping[str, Any]
    revision: int

    def __post_init__(self) -> None:
        object.__setattr__(self, "action", MappingProxyType(dict(self.action)))


class GameModule(Protocol):
    game_id: str
    ruleset_version: str

    def setup(self, seat_count: int, **kwargs: Any) -> GameState: ...

    def legal_actions(self, state: GameState, seat_id: SeatId) -> tuple[Mapping[str, Any], ...]: ...

    def transition(self, state: GameState, seat_id: SeatId, action: Mapping[str, Any]) -> Transition: ...

    def seat_projection(self, state: GameState, seat_id: SeatId) -> Mapping[str, Any]: ...

    def public_projection(self, state: GameState) -> Mapping[str, Any]: ...

    def timeout_action(self, state: GameState, seat_id: SeatId) -> Mapping[str, Any]: ...

    def ai_schema(self, state: GameState, seat_id: SeatId) -> Mapping[str, Any]: ...
