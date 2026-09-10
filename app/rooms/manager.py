from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import Callable

from .actor import RoomActor
from .protocol import Ack
from ..ai.adapter import AIAdapter
from ..ai.openrouter import OpenRouterProvider
from ..ai.policy import policy_for_tier
from ..games.holdem.engine import start_hand
from ..models import Seat, Table
from sqlalchemy import select


class RoomManager:
    def __init__(self, *, clock=None, poll_interval: float = 0.25):
        self._actors: dict[int, RoomActor] = {}
        self._connections: dict[int, dict[int, asyncio.Queue]] = {}
        self._ai_adapters: dict[int, dict[int, object]] = {}
        self._ai_inflight: set[tuple[int, int, int]] = set()
        self._clock = clock or (lambda: datetime.now(timezone.utc))
        self.poll_interval = poll_interval

    def register(self, table_id: int, actor: RoomActor) -> None:
        self._actors[table_id] = actor

    def get(self, table_id: int) -> RoomActor | None:
        return self._actors.get(table_id)

    def connect(self, table_id: int, seat_id: int) -> asyncio.Queue:
        queue: asyncio.Queue = asyncio.Queue()
        self._connections.setdefault(table_id, {})[seat_id] = queue
        return queue

    def disconnect(self, table_id: int, seat_id: int) -> None:
        connections = self._connections.get(table_id)
        if connections is not None:
            connections.pop(seat_id, None)
            if not connections:
                self._connections.pop(table_id, None)

    def publish(
        self,
        table_id: int,
        event_factory: Callable[[int], dict[str, object]],
        *,
        exclude_seat_id: int | None = None,
    ) -> None:
        for seat_id, queue in self._connections.get(table_id, {}).items():
            if seat_id == exclude_seat_id:
                continue
            queue.put_nowait(event_factory(seat_id))

    def register_ai(self, table_id: int, seat_id: int, adapter: object) -> None:
        self._ai_adapters.setdefault(table_id, {})[seat_id] = adapter

    def ensure_actor_for_table(self, table_id: int, session_factory, settings=None) -> RoomActor:
        existing = self.get(table_id)
        if existing is not None:
            return existing
        with session_factory() as session:
            table = session.get(Table, table_id)
            if table is None:
                raise ValueError("table does not exist")
            seats = session.scalars(select(Seat).where(Seat.table_id == table_id)).all()
            stacks = {
                seat.seat_number: seat.chip_count
                for seat in seats
                if seat.seat_number <= table.seat_count and (seat.user_id is not None or seat.actor_type == "ai")
            }
            state = start_hand(
                stacks,
                small_blind=table.small_blind,
                big_blind=table.big_blind,
            )
        actor = RoomActor(table_id, state, session_factory_=session_factory)
        self.register(table_id, actor)
        if settings and settings.openrouter_api_key:
            provider = OpenRouterProvider(settings.openrouter_api_key)
            for seat in seats:
                if seat.actor_type == "ai" and seat.ai_tier:
                    self.register_ai(table_id, seat.seat_number, AIAdapter(provider, policy_for_tier(seat.ai_tier)))
        return actor

    def restore_in_progress(self, session_factory, settings=None) -> None:
        with session_factory() as session:
            table_ids = session.scalars(select(Table.id).where(Table.status == "in_progress")).all()
        for table_id in table_ids:
            self.ensure_actor_for_table(table_id, session_factory, settings)

    async def run_once(self, table_id: int) -> None:
        actor = self._actors.get(table_id)
        if actor is None:
            return
        timeout_result = actor.tick(self._clock())
        if isinstance(timeout_result, Ack):
            self._publish_state(table_id, actor)
            return

        seat_id = actor.state.current_seat
        adapter = self._ai_adapters.get(table_id, {}).get(seat_id)
        if seat_id is None or adapter is None or actor.deadline is None:
            return
        key = (table_id, seat_id, actor.revision)
        if key in self._ai_inflight:
            return
        self._ai_inflight.add(key)
        try:
            proposed = await adapter.decide(
                actor.snapshot_for(seat_id),
                actor.module.ai_schema(actor.state, seat_id),
                actor.revision,
                actor.deadline,
            )
            if proposed is None or proposed.revision != actor.revision:
                return
            result = actor.submit(
                {
                    "expected_revision": proposed.revision,
                    "idempotency_key": f"ai:{seat_id}:{proposed.revision}",
                    "action": proposed.action,
                },
                seat_id=seat_id,
            )
            if isinstance(result, Ack):
                self._publish_state(table_id, actor)
        finally:
            self._ai_inflight.discard(key)

    def _publish_state(self, table_id: int, actor: RoomActor) -> None:
        self.publish(
            table_id,
            lambda seat_id: {
                "type": "state",
                "revision": actor.revision,
                "payload": actor.snapshot_for(seat_id),
                "deadline": actor.deadline,
            },
        )

    async def run_forever(self, stop_event: asyncio.Event) -> None:
        while not stop_event.is_set():
            for table_id in tuple(self._actors):
                await self.run_once(table_id)
            try:
                await asyncio.wait_for(stop_event.wait(), timeout=self.poll_interval)
            except asyncio.TimeoutError:
                pass
