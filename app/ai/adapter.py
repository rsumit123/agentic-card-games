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


def validate_ai_reply(reply: Any, legal_schema: Mapping[str, Any], revision: int) -> dict[str, Any] | None:
    if not isinstance(reply, Mapping):
        return None
    if reply.get("revision") != revision:
        return None
    action = reply.get("action", reply)
    if not isinstance(action, Mapping) or not isinstance(action.get("type"), str):
        return None
    action_type = action["type"]
    allowed = _allowed_actions(legal_schema)
    if allowed:
        matching = [candidate for candidate in allowed if candidate.get("type") == action_type]
        if not matching:
            return None
        candidate = matching[0]
        if "amount" in candidate and action.get("amount") != candidate["amount"]:
            return None
        if "min_amount" in candidate and int(action.get("amount", -1)) < int(candidate["min_amount"]):
            return None
        if "max_amount" in candidate and int(action.get("amount", -1)) > int(candidate["max_amount"]):
            return None
    else:
        action_types = legal_schema.get("properties", {}).get("type", {}).get("enum", ())
        if action_types and action_type not in action_types:
            return None
    clean = {"type": action_type}
    if "amount" in action:
        if not isinstance(action["amount"], int) or isinstance(action["amount"], bool):
            return None
        clean["amount"] = action["amount"]
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
        if isinstance(reply, Mapping) and reply.get("revision") != revision:
            return None
        action = validate_ai_reply(reply, legal_schema, revision)
        if action is None:
            return ProposedAction({"type": "fold"}, revision, "invalid_reply")
        return ProposedAction(action, revision)
