from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

from app.ai.adapter import AIAdapter, ProposedAction, validate_ai_reply
from app.ai.policy import policy_for_tier


class FakeProvider:
    def __init__(self, reply=None, error=None):
        self.reply = reply
        self.error = error
        self.received = None

    async def complete(self, projection, legal_schema, policy):
        self.received = (projection, legal_schema, policy)
        if self.error:
            raise self.error
        return self.reply


def run(coro):
    return asyncio.run(coro)


def test_adapter_sends_only_projection_and_accepts_structured_action():
    projection = {"seat_id": 1, "hole_cards": ("AS", "KH"), "public": {"pot": 20}}
    schema = {"actions": [{"type": "call", "amount": 10}]}
    provider = FakeProvider({"type": "call", "amount": 10, "revision": 7})
    adapter = AIAdapter(provider, policy_for_tier("Medium"))

    result = run(adapter.decide(projection, schema, revision=7, deadline=datetime.now(timezone.utc) + timedelta(seconds=1)))

    assert isinstance(result, ProposedAction)
    assert result.action == {"type": "call", "amount": 10}
    assert provider.received[0] is projection
    assert provider.received[1] is schema


def test_invalid_reply_is_validated_and_folds():
    schema = {"actions": [{"type": "check"}]}

    assert validate_ai_reply({"type": "raise", "amount": 100}, schema, revision=1) is None
    provider = FakeProvider({"type": "raise", "amount": 100, "revision": 1})
    adapter = AIAdapter(provider, policy_for_tier("Easy"))
    result = run(adapter.decide({}, schema, revision=1, deadline=datetime.now(timezone.utc) + timedelta(seconds=1)))

    assert result.action == {"type": "fold"}
    assert result.reason == "invalid_reply"


def test_stale_reply_is_discarded_and_timeout_folds():
    deadline = datetime.now(timezone.utc) + timedelta(seconds=1)
    stale_provider = FakeProvider({"type": "check", "revision": 2})
    stale = AIAdapter(stale_provider, policy_for_tier("Hard"))
    assert run(stale.decide({}, {"actions": [{"type": "check"}]}, revision=3, deadline=deadline)) is None

    timeout_provider = FakeProvider(error=TimeoutError())
    timeout = AIAdapter(timeout_provider, policy_for_tier("Hard"))
    folded = run(timeout.decide({}, {"actions": [{"type": "check"}]}, revision=3, deadline=deadline))
    assert folded.action == {"type": "fold"}
    assert folded.reason == "provider_timeout"
