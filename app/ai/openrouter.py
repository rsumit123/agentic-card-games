from __future__ import annotations

import json

import httpx

from .prompt import describe_table, system_prompt


class OpenRouterProvider:
    def __init__(self, api_key: str, *, endpoint: str = "https://openrouter.ai/api/v1/chat/completions"):
        self.api_key = api_key
        self.endpoint = endpoint

    async def complete(self, projection, legal_schema, policy):
        payload = {
            "model": policy.model_pool[0],
            "messages": [
                {"role": "system", "content": system_prompt(policy)},
                {"role": "user", "content": describe_table(projection, list(legal_schema.get("actions", ())))},
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
            try:
                content = response.json()["choices"][0]["message"]["content"]
            except (KeyError, IndexError, ValueError):
                return None
            try:
                return json.loads(content)
            except (TypeError, ValueError):
                # A model that thinks in tokens can spend its whole budget before
                # writing anything, leaving a half-finished object. Returning None
                # lets the caller ask again instead of the seat losing its turn.
                return None
