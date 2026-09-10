from __future__ import annotations

import logging
import threading
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Mapping

from sqlalchemy import select

from ..db import build_engine, initialize_database, session_factory
from ..games.holdem.engine import HoldemModule, InvalidAction
from ..games.holdem.state import HoldemState
from ..models import RoomEvent
from ..settings import Settings
from .protocol import Ack, CommandEnvelope, CommandError, SnapshotEnvelope

logger = logging.getLogger(__name__)


class RoomActor:
    def __init__(
        self,
        table_id: int,
        state: HoldemState,
        *,
        module=None,
        revision: int = 0,
        clock=None,
        action_timeout: timedelta = timedelta(seconds=30),
        session_factory_=None,
        data_path: Path | None = None,
        player_names: Mapping[int, str | None] | None = None,
    ):
        self.table_id = table_id
        self.state = state
        self.module = module or HoldemModule()
        self.revision = revision
        self._clock = clock or (lambda: datetime.now(timezone.utc))
        self.action_timeout = action_timeout
        self._deadline = self.now + action_timeout if state.current_seat is not None else None
        self._seen: dict[str, Ack] = {}
        self._lock = threading.RLock()
        self._session_factory = session_factory_
        self.player_names = dict(player_names or {})
        if data_path is not None:
            settings = Settings(database_url=f"sqlite:///{Path(data_path)}", data_dir=Path(data_path).parent)
            engine = build_engine(settings)
            initialize_database(engine)
            self._session_factory = session_factory(engine)

    @property
    def now(self) -> datetime:
        value = self._clock()
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)

    @property
    def deadline(self) -> datetime | None:
        return self._deadline

    def snapshot_for(self, seat_id: int | None) -> Mapping[str, Any]:
        if seat_id is None:
            return self.module.public_projection(self.state)
        try:
            projection = dict(self.module.seat_projection(self.state, seat_id))
        except KeyError:
            projection = {
                "public": self.module.public_projection(self.state),
                "hole_cards": (),
                "seat_id": seat_id,
                "legal_actions": (),
                "hand_rank": None,
            }
        public = dict(projection["public"])
        public["names"] = {player.seat_id: self.player_names.get(player.seat_id) for player in self.state.players}
        projection["public"] = public
        return projection

    def begin_hand(self, state: HoldemState) -> None:
        with self._lock:
            self.state = state
            self.revision += 1
            self._deadline = self.now + self.action_timeout if state.current_seat is not None else None

    def resync(self, seat_id: int | None, *, since_revision: int | None = None) -> dict[str, Any]:
        return {
            "revision": self.revision,
            "snapshot": self.snapshot_for(seat_id),
            "deadline": self._deadline,
            "full": True,
        }

    def _persist_transition(self, revision: int, command: CommandEnvelope, *, timeout: bool = False) -> None:
        if self._session_factory is None:
            return
        with self._session_factory() as session:
            session.add(
                RoomEvent(
                    table_id=self.table_id,
                    revision=revision,
                    event_type="action_accepted",
                    payload={"action": dict(command.action), "timeout": timeout},
                    idempotency_key=command.idempotency_key,
                )
            )
            session.commit()

    @staticmethod
    def _mark_timeout(state: HoldemState) -> HoldemState:
        """Flag the entry the clock just wrote, so the client can say the time ran out.

        The flag is stamped here rather than carried on the action itself: it is
        a fact about who submitted the action, and a client must not be able to
        claim it.
        """
        if not state.action_log:
            return state
        marked = {**state.action_log[-1], "timeout": True}
        return replace(state, action_log=state.action_log[:-1] + (marked,))

    def submit(
        self,
        command: CommandEnvelope | Mapping[str, Any],
        *,
        seat_id: int | None = None,
        timeout: bool = False,
    ) -> Ack | CommandError:
        try:
            envelope = CommandEnvelope.from_value(command)
        except (KeyError, TypeError, ValueError) as exc:
            return CommandError("invalid_command", str(exc), self.revision)
        with self._lock:
            if envelope.idempotency_key in self._seen:
                return self._seen[envelope.idempotency_key]
            if envelope.expected_revision != self.revision:
                return CommandError("stale_revision", "expected revision does not match", self.revision)
            try:
                transition = self.module.transition(self.state, self.state.current_seat, envelope.action)
            except (InvalidAction, ValueError, KeyError) as exc:
                return CommandError("invalid_action", str(exc), self.revision)
            next_revision = self.revision + 1
            try:
                self._persist_transition(next_revision, envelope, timeout=timeout)
            except Exception as exc:
                return CommandError("persistence_failed", str(exc), self.revision)
            self.state = self._mark_timeout(transition.state) if timeout else transition.state
            self.revision = next_revision
            self._deadline = self.now + self.action_timeout if self.state.current_seat is not None else None
            submitter_seat = seat_id if seat_id is not None else transition.state.current_seat
            ack = Ack(
                self.revision,
                envelope.idempotency_key,
                self.snapshot_for(submitter_seat),
                self._deadline,
            )
            self._seen[envelope.idempotency_key] = ack
            return ack

    def tick(self, now: datetime | None = None) -> Ack | CommandError | None:
        with self._lock:
            if self._deadline is None:
                return None
            current = now or self.now
            if current.tzinfo is None:
                current = current.replace(tzinfo=timezone.utc)
            if current < self._deadline:
                return None
            return self.submit(
                {
                    "expected_revision": self.revision,
                    "idempotency_key": f"timeout:{self.revision}",
                    "action": self.module.timeout_action(self.state, self.state.current_seat),
                },
                seat_id=self.state.current_seat,
                timeout=True,
            )
