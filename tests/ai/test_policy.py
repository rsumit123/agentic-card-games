from __future__ import annotations

import pytest

from app.ai.policy import TierPolicy, policy_for_tier


@pytest.mark.parametrize("tier", ["Easy", "Medium", "Hard"])
def test_tier_policy_persists_operational_contract_and_locks_for_hand(tier):
    policy = policy_for_tier(tier)
    locked = policy.lock_for_hand("hand-123")

    assert isinstance(policy, TierPolicy)
    assert policy.model_pool
    assert policy.prompt_version
    assert policy.schema_version
    assert policy.max_tokens > 0
    assert policy.latency_budget_ms > 0
    assert policy.fallback_chain
    assert locked.hand_id == "hand-123"
    assert locked.to_record()["tier"] == tier
    with pytest.raises(AttributeError):
        locked.model_pool += ("unapproved",)


def test_unknown_tier_is_rejected():
    with pytest.raises(ValueError, match="tier"):
        policy_for_tier("Impossible")
