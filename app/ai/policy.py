from __future__ import annotations

from dataclasses import dataclass, replace


@dataclass(frozen=True, slots=True)
class TierPolicy:
    tier: str
    model_pool: tuple[str, ...]
    prompt_version: str
    schema_version: str
    temperature: float
    max_tokens: int
    latency_budget_ms: int
    fallback_chain: tuple[str, ...]
    hand_id: str | None = None

    def lock_for_hand(self, hand_id: str) -> "TierPolicy":
        return replace(self, hand_id=hand_id)

    def to_record(self) -> dict[str, object]:
        return {
            "tier": self.tier,
            "model_pool": list(self.model_pool),
            "prompt_version": self.prompt_version,
            "schema_version": self.schema_version,
            "temperature": self.temperature,
            "max_tokens": self.max_tokens,
            "latency_budget_ms": self.latency_budget_ms,
            "fallback_chain": list(self.fallback_chain),
            "hand_id": self.hand_id,
        }


_POLICIES = {
    "Easy": TierPolicy(
        "Easy", ("openai/gpt-4o-mini",), "holdem-easy-v1", "action-v1", 0.8, 96, 1800, ("openai/gpt-4o-mini",)
    ),
    "Medium": TierPolicy(
        "Medium", ("openai/gpt-4o-mini", "openai/gpt-4o"), "holdem-medium-v1", "action-v1", 0.4, 128, 2200, ("openai/gpt-4o-mini",)
    ),
    "Hard": TierPolicy(
        "Hard", ("openai/gpt-4o",), "holdem-hard-v1", "action-v1", 0.15, 192, 2600, ("openai/gpt-4o-mini",)
    ),
}


def policy_for_tier(tier: str) -> TierPolicy:
    try:
        return _POLICIES[tier]
    except KeyError as exc:
        raise ValueError(f"unknown AI tier: {tier}") from exc


TIERS = ("Easy", "Medium", "Hard")

# Shown to players, so they know which model is sitting across the table.
MODEL_LABELS = {
    "openai/gpt-4o-mini": "GPT-4o mini",
    "openai/gpt-4o": "GPT-4o",
}


def model_for_tier(tier: str) -> str:
    return policy_for_tier(tier).model_pool[0]


def model_label_for_tier(tier: str) -> str:
    model = model_for_tier(tier)
    return MODEL_LABELS.get(model, model)
