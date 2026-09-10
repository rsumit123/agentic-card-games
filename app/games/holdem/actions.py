from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping


VALID_ACTIONS = frozenset({"fold", "check", "call", "bet", "raise", "all_in"})


@dataclass(frozen=True, slots=True)
class HoldemAction:
    type: str
    amount: int | None = None


def normalize_action(action: HoldemAction | Mapping[str, object]) -> HoldemAction:
    if isinstance(action, HoldemAction):
        result = action
    else:
        result = HoldemAction(type=str(action.get("type", "")), amount=action.get("amount"))
    if result.type not in VALID_ACTIONS:
        raise ValueError("unknown action")
    if result.amount is not None and (not isinstance(result.amount, int) or isinstance(result.amount, bool)):
        raise ValueError("action amount must be an integer")
    return result
