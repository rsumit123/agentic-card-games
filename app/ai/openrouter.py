from __future__ import annotations

import json

import httpx


class OpenRouterProvider:
    def __init__(self, api_key: str, *, endpoint: str = "https://openrouter.ai/api/v1/chat/completions"):
        self.api_key = api_key
        self.endpoint = endpoint

    async def complete(self, projection, legal_schema, policy):
        payload = {
            "model": policy.model_pool[0],
            "messages": [
                {
                    "role": "system",
                    "content": (
                        "You are playing no-limit Texas Hold'em. Pick exactly one action from "
                        "legal_actions. Reply with JSON only, shaped "
                        '{"type": "<action type>", "amount": <chips>}. '
                        "Include amount only where the chosen legal action carries one: for bet "
                        "and raise it is the total you are raising to and must sit between "
                        "min_amount and max_amount. Add no other fields and no prose."
                    ),
                },
                {
                    "role": "user",
                    "content": json.dumps(
                        {"table": projection, "legal_actions": legal_schema.get("actions", legal_schema)},
                        default=str,
                    ),
                },
            ],
            "temperature": policy.temperature,
            "max_tokens": policy.max_tokens,
            "response_format": {"type": "json_object"},
        }
        async with httpx.AsyncClient(timeout=policy.latency_budget_ms / 1000) as client:
            response = await client.post(
                self.endpoint,
                headers={"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"},
                json=payload,
            )
            response.raise_for_status()
            content = response.json()["choices"][0]["message"]["content"]
            return json.loads(content)
