from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Mapping

from .policy import TierPolicy


@dataclass(frozen=True, slots=True)
class ProposedAction:
    action: Mapping[str, Any]
    revision: int
    reason: str = "provider"


def _allowed_actions(legal_schema: Mapping[str, Any]) -> list[Mapping[str, Any]]:
    actions = legal_schema.get("actions", ())
    return [action for action in actions if isinstance(action, Mapping)]


def _is_int(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def validate_ai_reply(reply: Any, legal_schema: Mapping[str, Any], revision: int) -> dict[str, Any] | None:
    """Turn a model reply into a legal action, or None if it cannot be trusted.

    A provider answers with an action; the revision is ours, not the model's, so
    it is only checked when the reply volunteers one. A reply that names a legal
    action but omits its amount is completed from that action rather than
    thrown away, because discarding it costs the seat its whole turn.
    """
    if not isinstance(reply, Mapping):
        return None
    if "revision" in reply and reply.get("revision") != revision:
        return None
    action = reply.get("action", reply)
    if not isinstance(action, Mapping) or not isinstance(action.get("type"), str):
        return None
    action_type = action["type"]
    amount = action.get("amount")
    if amount is not None and not _is_int(amount):
        return None

    allowed = _allowed_actions(legal_schema)
    if allowed:
        candidate = next((item for item in allowed if item.get("type") == action_type), None)
        if candidate is None:
            return None
        if "amount" in candidate:
            if amount is None:
                amount = candidate["amount"]
            elif amount != candidate["amount"]:
                return None
        elif "min_amount" in candidate:
            if amount is None:
                amount = candidate["min_amount"]
            if not _is_int(amount) or amount < int(candidate["min_amount"]) or amount > int(candidate["max_amount"]):
                return None
        elif amount is not None:
            return None
    else:
        action_types = legal_schema.get("properties", {}).get("type", {}).get("enum", ())
        if action_types and action_type not in action_types:
            return None

    clean: dict[str, Any] = {"type": action_type}
    if amount is not None:
        clean["amount"] = amount
    return clean


class AIAdapter:
    def __init__(self, provider, policy: TierPolicy, *, clock=None):
        self.provider = provider
        self.policy = policy
        self._clock = clock or (lambda: datetime.now(timezone.utc))

    def _now(self) -> datetime:
        value = self._clock()
        return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)

    async def decide(
        self,
        seat_projection: Mapping[str, Any],
        legal_schema: Mapping[str, Any],
        revision: int,
        deadline: datetime,
    ) -> ProposedAction | None:
        deadline = deadline.replace(tzinfo=timezone.utc) if deadline.tzinfo is None else deadline.astimezone(timezone.utc)
        remaining = (deadline - self._now()).total_seconds()
        if remaining <= 0:
            return ProposedAction({"type": "fold"}, revision, "provider_timeout")
        try:
            reply = await asyncio.wait_for(
                self.provider.complete(seat_projection, legal_schema, self.policy),
                timeout=remaining,
            )
        except (asyncio.TimeoutError, TimeoutError):
            return ProposedAction({"type": "fold"}, revision, "provider_timeout")
        if isinstance(reply, Mapping) and "revision" in reply and reply.get("revision") != revision:
            return None
        action = validate_ai_reply(reply, legal_schema, revision)
        if action is None:
            return ProposedAction({"type": "fold"}, revision, "invalid_reply")
        reasoning = reply.get("reasoning") if isinstance(reply, Mapping) else None
        return ProposedAction(action, revision, str(reasoning) if reasoning else "provider")
