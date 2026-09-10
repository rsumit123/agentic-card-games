from __future__ import annotations

from .actor import RoomActor


class RoomManager:
    def __init__(self):
        self._actors: dict[int, RoomActor] = {}

    def register(self, table_id: int, actor: RoomActor) -> None:
        self._actors[table_id] = actor

    def get(self, table_id: int) -> RoomActor | None:
        return self._actors.get(table_id)
