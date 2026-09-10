from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping


@dataclass(frozen=True, slots=True)
class CommandEnvelope:
    expected_revision: int
    idempotency_key: str
    action: Mapping[str, Any]

    @classmethod
    def from_value(cls, value: "CommandEnvelope | Mapping[str, Any]") -> "CommandEnvelope":
        if isinstance(value, cls):
            return value
        return cls(
            expected_revision=int(value["expected_revision"]),
            idempotency_key=str(value["idempotency_key"]),
            action=value["action"],
        )


WSCommand = CommandEnvelope


@dataclass(frozen=True, slots=True)
class Ack:
    revision: int
    idempotency_key: str
    snapshot: Mapping[str, Any]
    deadline: Any = None


@dataclass(frozen=True, slots=True)
class CommandError:
    code: str
    message: str
    current_revision: int


@dataclass(frozen=True, slots=True)
class SnapshotEnvelope:
    revision: int
    snapshot: Mapping[str, Any]
    deadline: Any = None
