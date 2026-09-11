from __future__ import annotations

import asyncio
import logging
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from typing import Callable

from fastapi.encoders import jsonable_encoder
from sqlalchemy import select

from ..ai.adapter import AIAdapter
from ..ai.openrouter import OpenRouterProvider
from ..ai.policy import model_label_for_tier, policy_for_tier
from ..games.holdem.engine import public_projection, showdown_hands, start_hand
from ..models import Hand, HandOutcome, Seat, Table
from .actor import RoomActor
from .lifecycle import (
    LifecycleError,
    SessionSeat,
    SessionState,
    end_session,
    finish_hand,
    leave_between_hands,
)
from .protocol import Ack
from .reads import summarize, update_from_hand

logger = logging.getLogger(__name__)


class RoomManager:
    def __init__(
        self,
        *,
        clock=None,
        poll_interval: float = 0.25,
        hand_reveal_seconds: float = 6,
        max_ai_attempts: int = 3,
        session_factory=None,
    ):
        self._actors: dict[int, RoomActor] = {}
        self._connections: dict[int, dict[int, asyncio.Queue]] = {}
        self._ai_adapters: dict[int, dict[int, object]] = {}
        self._ai_inflight: set[tuple[int, int, int]] = set()
        self._ai_attempts: dict[tuple[int, int, int], int] = {}
        self._session_states: dict[int, SessionState] = {}
        self._reveal_deadlines: dict[int, datetime] = {}
        # Per table, per seat: what that seat has shown about itself across the
        # hands of this session. In memory only, and never sent to a human.
        self._opponent_reads: dict[int, dict[int, dict[str, int]]] = {}
        self._last_reaction: dict[tuple[int, int], datetime] = {}
        self._active_hand_ids: dict[int, int] = {}
        self._clock = clock or (lambda: datetime.now(timezone.utc))
        self.poll_interval = poll_interval
        self.hand_reveal_seconds = hand_reveal_seconds
        self.max_ai_attempts = max_ai_attempts
        self._session_factory = session_factory

    def register(self, table_id: int, actor: RoomActor) -> None:
        self._actors[table_id] = actor

    def get(self, table_id: int) -> RoomActor | None:
        return self._actors.get(table_id)

    def drop(self, table_id: int) -> None:
        """Forget a table entirely, reads included.

        The reads are a session's worth of memory about the players sitting at
        it; a new table that happens to reuse the id must not inherit them.
        """
        self._actors.pop(table_id, None)
        self._opponent_reads.pop(table_id, None)
        self._ai_adapters.pop(table_id, None)
        self._session_states.pop(table_id, None)
        self._reveal_deadlines.pop(table_id, None)
        self._active_hand_ids.pop(table_id, None)
        self._ai_attempts = {key: count for key, count in self._ai_attempts.items() if key[0] != table_id}
        self._ai_inflight = {key for key in self._ai_inflight if key[0] != table_id}
        self._last_reaction = {key: when for key, when in self._last_reaction.items() if key[0] != table_id}

    def opponent_reads(self, table_id: int, for_seat_id: int | None = None) -> dict[int, dict[str, object]]:
        """How every other seat at this table has played, so far this session.

        For the AI only. A human must never be handed a read on the player
        across the table.
        """
        return summarize(self._opponent_reads.get(table_id, {}), for_seat_id)

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
        self._session_factory = session_factory
        with session_factory() as session:
            table = session.get(Table, table_id)
            if table is None:
                raise ValueError("table does not exist")
            seats = session.scalars(select(Seat).where(Seat.table_id == table_id)).all()
            funded = {
                seat.seat_number: seat.chip_count
                for seat in seats
                if seat.seat_number <= table.seat_count
                and seat.present
                and seat.chip_count > 0
                and (seat.user_id is not None or seat.actor_type == "ai")
            }
            sitting_out = {seat.seat_number for seat in seats if seat.sitting_out}
            stacks = {seat_id: chips for seat_id, chips in funded.items() if seat_id not in sitting_out}
            if len(stacks) < 2 <= len(funded):
                # A restart cannot leave the table stuck with nobody to deal to,
                # so a table that was paused on sit-outs comes back dealing.
                logger.warning("table %s: too few seats are sitting in after a restart, dealing everyone in", table_id)
                stacks = funded
            state = start_hand(stacks, small_blind=table.small_blind, big_blind=table.big_blind)
            names = {seat.seat_number: self._display_name(seat) for seat in seats}
            session_state = self._session_state(table, seats, hand_in_progress=True)

        actor = RoomActor(table_id, state, session_factory_=session_factory, player_names=names)
        self.register(table_id, actor)
        self._session_states[table_id] = session_state
        self._active_hand_ids[table_id] = self._record_hand_start(
            table_id, state, stacks, session_factory, actor
        )
        if settings and settings.openrouter_api_key:
            provider = OpenRouterProvider(settings.openrouter_api_key)
            for seat in seats:
                if seat.actor_type == "ai" and seat.ai_tier:
                    self.register_ai(table_id, seat.seat_number, AIAdapter(provider, policy_for_tier(seat.ai_tier)))
        return actor

    def restore_in_progress(self, session_factory, settings=None) -> None:
        self._session_factory = session_factory
        with session_factory() as session:
            table_ids = session.scalars(select(Table.id).where(Table.status == "in_progress")).all()
        for table_id in table_ids:
            self.ensure_actor_for_table(table_id, session_factory, settings)

    def submit(self, table_id: int, seat_id: int, command) -> Ack | object:
        actor = self._actors.get(table_id)
        if actor is None:
            raise ValueError("table actor is not registered")
        before = actor.state
        result = actor.submit(command, seat_id=seat_id)
        if isinstance(result, Ack):
            self._after_transition(table_id, actor, before)
            self._fold_pending_leavers(table_id, actor)
        return result

    async def run_once(self, table_id: int) -> None:
        actor = self._actors.get(table_id)
        if actor is None:
            return
        now = self._now()
        reveal_deadline = self._reveal_deadlines.get(table_id)
        if reveal_deadline is not None:
            if now < reveal_deadline:
                return
            self._start_next_hand(table_id, actor)
            return

        before = actor.state
        timeout_result = actor.tick(now)
        if isinstance(timeout_result, Ack):
            self._after_transition(table_id, actor, before)
            self._fold_pending_leavers(table_id, actor)
            self._publish_state(table_id, actor)
            return

        seat_id = actor.state.current_seat
        adapter = self._ai_adapters.get(table_id, {}).get(seat_id)
        if seat_id is None or adapter is None or actor.deadline is None:
            return
        key = (table_id, seat_id, actor.revision)
        if key in self._ai_inflight:
            return
        # Ask once per turn, a few times at most. Without this a provider outage
        # is retried every poll interval until the deadline, which bills the
        # account for a hundred failed calls and still ends in an auto-fold.
        self._ai_attempts = {
            existing: count
            for existing, count in self._ai_attempts.items()
            if not (existing[0] == table_id and existing[2] != actor.revision)
        }
        if self._ai_attempts.get(key, 0) >= self.max_ai_attempts:
            return
        self._ai_inflight.add(key)
        self._ai_attempts[key] = self._ai_attempts.get(key, 0) + 1
        try:
            proposed = await adapter.decide(
                actor.snapshot_for(seat_id),
                actor.module.ai_schema(actor.state, seat_id),
                actor.revision,
                actor.deadline,
            )
            if proposed is None:
                logger.warning("table %s seat %s: no usable action from the provider", table_id, seat_id)
                return
            if proposed.revision != actor.revision:
                return
            result = self.submit(
                table_id,
                seat_id,
                {
                    "expected_revision": proposed.revision,
                    "idempotency_key": f"ai:{seat_id}:{proposed.revision}",
                    "action": proposed.action,
                },
            )
            if isinstance(result, Ack):
                logger.info("table %s seat %s played %s because: %s", table_id, seat_id, proposed.action, proposed.reason)
                self._ai_attempts.pop(key, None)
                self._publish_state(table_id, actor)
            else:
                logger.warning("table %s seat %s action rejected: %s", table_id, seat_id, getattr(result, "message", result))
        except Exception:
            # A provider fault must never take the timers down for every table.
            logger.exception("table %s seat %s: AI decision failed", table_id, seat_id)
        finally:
            self._ai_inflight.discard(key)

    def leave(self, table_id: int, user_id: int) -> None:
        actor = self._actors.get(table_id)
        state = self._session_states.get(table_id) or self._load_session_state(
            table_id, actor is not None and actor.state.street != "complete"
        )
        next_state = leave_between_hands(
            replace(state, hand_in_progress=actor is not None and actor.state.street != "complete"),
            user_id,
        )
        self._session_states[table_id] = next_state
        if not next_state.pending_leaves:
            self._persist_session_state(table_id, next_state)
        if next_state.status != "in_progress":
            self._reveal_deadlines.pop(table_id, None)
        if actor is not None and self._fold_pending_leavers(table_id, actor):
            self._publish_state(table_id, actor)
        self.publish_session(table_id)

    def sit_out(self, table_id: int, user_id: int) -> None:
        """Deal this player out from the next hand, keeping their seat and chips."""
        self._set_sitting_out(table_id, user_id, True)

    def sit_in(self, table_id: int, user_id: int) -> None:
        """Deal this player back in, and resume a table that was waiting on them."""
        state = self._set_sitting_out(table_id, user_id, False)
        actor = self._actors.get(table_id)
        paused = (
            actor is not None
            and state.status == "in_progress"
            and not state.hand_in_progress
            and actor.state.street == "complete"
            and self.reveal_deadline(table_id) is None
        )
        if paused:
            self._start_next_hand(table_id, actor)

    def _set_sitting_out(self, table_id: int, user_id: int, sitting_out: bool) -> SessionState:
        actor = self._actors.get(table_id)
        state = self._session_states.get(table_id) or self._load_session_state(
            table_id, actor is not None and actor.state.street != "complete"
        )
        seat = next((item for item in state.seats if item.user_id == user_id), None)
        if seat is None:
            raise LifecycleError("you are not seated at this table")
        next_state = replace(
            state,
            seats=tuple(
                replace(item, sitting_out=sitting_out) if item.seat_id == seat.seat_id else item
                for item in state.seats
            ),
        )
        self._session_states[table_id] = next_state
        # Written on its own rather than through _persist_session_state: mid-hand
        # the chip counts in the session state are the ones from before the hand.
        if self._session_factory is not None:
            with self._session_factory() as session:
                row = session.scalar(
                    select(Seat).where(Seat.table_id == table_id, Seat.seat_number == seat.seat_id)
                )
                if row is not None:
                    row.sitting_out = sitting_out
                    session.commit()
        self.publish_session(table_id)
        return next_state

    def end(self, table_id: int, user_id: int) -> None:
        actor = self._actors.get(table_id)
        state = self._session_states.get(table_id) or self._load_session_state(
            table_id, actor is not None and actor.state.street != "complete"
        )
        next_state = end_session(
            replace(state, hand_in_progress=actor is not None and actor.state.street != "complete"),
            user_id,
        )
        self._session_states[table_id] = next_state
        self._persist_session_state(table_id, next_state)
        if next_state.status != "in_progress":
            self._reveal_deadlines.pop(table_id, None)
        self.publish_session(table_id)

    def _pending_leave_seats(self, table_id: int) -> tuple[int, ...]:
        state = self._session_states.get(table_id)
        if state is None or not state.pending_leaves:
            return ()
        by_user = {seat.user_id: seat.seat_id for seat in state.seats if seat.user_id is not None}
        return tuple(sorted(by_user[user_id] for user_id in state.pending_leaves if user_id in by_user))

    def _fold_pending_leavers(self, table_id: int, actor: RoomActor) -> bool:
        """Fold the seats of players who have already left, the moment it is their turn.

        Queueing the leave alone left the seat owing an action, so everyone else
        sat through a thirty second timeout with no explanation for a player who
        had visibly gone.
        """
        folded = False
        while actor.state.street != "complete":
            seat_id = actor.state.current_seat
            if seat_id is None or seat_id not in self._pending_leave_seats(table_id):
                break
            before = actor.state
            result = actor.submit(
                {
                    "expected_revision": actor.revision,
                    "idempotency_key": f"leave:{seat_id}:{actor.revision}",
                    "action": {"type": "fold"},
                },
                seat_id=seat_id,
            )
            if not isinstance(result, Ack):
                logger.warning("table %s seat %s: could not fold a departed player", table_id, seat_id)
                break
            folded = True
            self._after_transition(table_id, actor, before)
        return folded

    def _after_transition(self, table_id: int, actor: RoomActor, before) -> None:
        if before.street != "complete" and actor.state.street == "complete":
            # Before _complete_hand, which returns early without a database.
            update_from_hand(self._opponent_reads.setdefault(table_id, {}), actor.state)
            self._complete_hand(table_id, actor)

    def _complete_hand(self, table_id: int, actor: RoomActor) -> None:
        if self._session_factory is None:
            return
        state = self._session_states.get(table_id) or self._load_session_state(table_id, hand_in_progress=True)
        chip_counts = {player.seat_id: player.stack for player in actor.state.players}
        next_session_state = finish_hand(replace(state, hand_in_progress=True), chip_counts)
        with self._session_factory() as session:
            table = session.get(Table, table_id)
            if table is None:
                return
            active_hand = session.scalar(
                select(Hand)
                .where(Hand.table_id == table_id, Hand.status == "active")
                .order_by(Hand.id.desc())
            )
            if active_hand is not None:
                active_hand.status = "completed"
                active_hand.finished_at = self._now()
                active_hand.state_snapshot = jsonable_encoder(public_projection(actor.state))
            seats_by_number = {item.seat_number: item for item in table.seats}
            for player in actor.state.players:
                seat = seats_by_number.get(player.seat_id)
                if seat is not None:
                    seat.chip_count = player.stack
                    seat.is_funded = player.stack > 0

            if active_hand is not None:
                self._record_outcomes(session, table, active_hand, actor, seats_by_number)
            table.current_revision = actor.revision
            table.status = next_session_state.status
            if next_session_state.host_user_id is not None:
                table.host_user_id = next_session_state.host_user_id
            if not next_session_state.pending_leaves:
                for seat_state in next_session_state.seats:
                    seat = next((item for item in table.seats if item.seat_number == seat_state.seat_id), None)
                    if seat is not None:
                        seat.present = seat_state.present
            session.commit()

        self._session_states[table_id] = next_session_state
        self._active_hand_ids.pop(table_id, None)
        if next_session_state.status == "in_progress":
            self._reveal_deadlines[table_id] = self._now() + timedelta(seconds=self.hand_reveal_seconds)
        else:
            self._reveal_deadlines.pop(table_id, None)
        self.publish_session(table_id)

    @staticmethod
    def _record_outcomes(session, table, hand, actor: RoomActor, seats_by_number) -> None:
        """Write one row per seat, so a player's record can be read back later."""
        payouts = dict(actor.state.payouts)
        winners = set(actor.state.winners)
        showdown = bool(showdown_hands(actor.state))

        def label(seat) -> str:
            if seat is None:
                return "human"
            return (seat.ai_tier or "AI") if seat.actor_type == "ai" else "human"

        for player in actor.state.players:
            seat = seats_by_number.get(player.seat_id)
            opponents = [
                label(seats_by_number.get(other.seat_id))
                for other in actor.state.players
                if other.seat_id != player.seat_id
            ]
            session.add(
                HandOutcome(
                    hand_id=hand.id,
                    table_id=table.id,
                    seat_number=player.seat_id,
                    user_id=seat.user_id if seat is not None else None,
                    actor_type=seat.actor_type if seat is not None else "human",
                    ai_tier=seat.ai_tier if seat is not None else None,
                    opponent_tiers=opponents,
                    net_chips=payouts.get(player.seat_id, 0) - player.total_contribution,
                    won=player.seat_id in winners,
                    went_to_showdown=showdown,
                )
            )

    def _start_next_hand(self, table_id: int, actor: RoomActor) -> None:
        state = self._session_states.get(table_id)
        if state is None or state.status != "in_progress":
            self._reveal_deadlines.pop(table_id, None)
            return
        funded = {seat.seat_id: seat.chips for seat in state.seats if seat.present and seat.chips > 0}
        stacks = {
            seat.seat_id: seat.chips
            for seat in state.seats
            if seat.present and seat.chips > 0 and not seat.sitting_out
        }
        if len(funded) < 2:
            ended = replace(
                state,
                status="ended",
                hand_in_progress=False,
                final_rankings=tuple(sorted(state.seats, key=lambda seat: (-seat.chips, seat.seat_id))),
            )
            self._session_states[table_id] = ended
            self._persist_session_state(table_id, ended)
            self._reveal_deadlines.pop(table_id, None)
            self.publish_session(table_id)
            return
        if len(stacks) < 2:
            # Enough chips are at the table, but not enough players are sitting
            # in. Wait for one of them rather than dealing a hand to one seat.
            self._session_states[table_id] = replace(state, hand_in_progress=False)
            self._reveal_deadlines.pop(table_id, None)
            self.publish_session(table_id)
            return
        next_hand = start_hand(
            stacks,
            dealer_seat=actor.state.dealer_seat + 1,
            small_blind=actor.state.small_blind,
            big_blind=actor.state.big_blind,
            hand_number=actor.state.hand_number + 1,
        )
        actor.begin_hand(next_hand)
        self._session_states[table_id] = replace(
            state,
            hand_in_progress=True,
            seats=tuple(replace(seat, chips=stacks.get(seat.seat_id, seat.chips)) for seat in state.seats),
            final_rankings=(),
        )
        self._reveal_deadlines.pop(table_id, None)
        self._active_hand_ids[table_id] = self._record_hand_start(
            table_id, next_hand, stacks, self._session_factory, actor
        )
        self._publish_state(table_id, actor)

    def reveal_deadline(self, table_id: int) -> datetime | None:
        """When the next hand begins, or None if none is coming.

        The table holds a finished hand on screen for a few seconds before
        dealing again. Without this the client only sees the hand vanish, so it
        cannot count the wait down or explain it.
        """
        return self._reveal_deadlines.get(table_id)

    def _publish_state(self, table_id: int, actor: RoomActor) -> None:
        reveal_deadline = self.reveal_deadline(table_id)
        self.publish(
            table_id,
            lambda seat_id: {
                "type": "state",
                "revision": actor.revision,
                "payload": actor.snapshot_for(seat_id),
                "deadline": actor.deadline,
                "reveal_deadline": reveal_deadline,
            },
        )

    def session_event(self, table_id: int) -> dict[str, object] | None:
        """The session event a client would receive, or None if there is nothing to describe.

        A connection that arrives mid-session has otherwise never seen one:
        publish_session only fires on a leave, an end, or a finished hand.
        """
        actor = self._actors.get(table_id)
        if actor is None or self._session_factory is None:
            return None
        return self._session_event(table_id, actor.revision)

    def publish_session(self, table_id: int) -> None:
        event = self.session_event(table_id)
        if event is None:
            return
        self.publish(table_id, lambda _seat_id: event)

    async def run_forever(self, stop_event: asyncio.Event) -> None:
        while not stop_event.is_set():
            for table_id in tuple(self._actors):
                try:
                    await self.run_once(table_id)
                except Exception:
                    logger.exception("table %s driver step failed", table_id)
            try:
                await asyncio.wait_for(stop_event.wait(), timeout=self.poll_interval)
            except asyncio.TimeoutError:
                pass

    def _record_hand_start(self, table_id: int, state, balances: dict[int, int], session_factory, actor: RoomActor) -> int:
        with session_factory() as session:
            active = session.scalar(
                select(Hand)
                .where(Hand.table_id == table_id, Hand.status == "active")
                .order_by(Hand.id.desc())
            )
            if active is not None:
                return active.id
            hand = Hand(
                table_id=table_id,
                status="active",
                pre_hand_balances={str(seat_id): chips for seat_id, chips in balances.items()},
                state_snapshot=jsonable_encoder(public_projection(state)),
            )
            session.add(hand)
            table = session.get(Table, table_id)
            if table is not None:
                table.current_revision = actor.revision
            session.commit()
            return hand.id

    def _load_session_state(self, table_id: int, hand_in_progress: bool) -> SessionState:
        if self._session_factory is None:
            raise ValueError("session factory is not configured")
        with self._session_factory() as session:
            table = session.get(Table, table_id)
            if table is None:
                raise ValueError("table does not exist")
            seats = session.scalars(select(Seat).where(Seat.table_id == table_id)).all()
            return self._session_state(table, seats, hand_in_progress=hand_in_progress)

    @staticmethod
    def _session_state(table: Table, seats: list[Seat], *, hand_in_progress: bool) -> SessionState:
        return SessionState(
            table_id=table.id,
            host_user_id=table.host_user_id,
            seats=tuple(
                SessionSeat(
                    seat_id=seat.seat_number,
                    user_id=seat.user_id,
                    actor_type=seat.actor_type,
                    chips=seat.chip_count,
                    joined_order=seat.seat_number,
                    present=seat.present and (seat.user_id is not None or seat.actor_type == "ai"),
                    display_name=RoomManager._display_name(seat),
                    sitting_out=bool(seat.sitting_out),
                )
                for seat in sorted(seats, key=lambda item: item.seat_number)
                if seat.seat_number <= table.seat_count
            ),
            status=table.status,
            hand_in_progress=hand_in_progress,
        )

    @staticmethod
    def _display_name(seat: Seat) -> str | None:
        if seat.user_id is not None:
            return seat.user.display_name if seat.user is not None else None
        if seat.actor_type != "ai":
            return None
        try:
            return model_label_for_tier(seat.ai_tier or "")
        except ValueError:
            return f"{seat.ai_tier or 'AI'} player"

    def _persist_session_state(self, table_id: int, state: SessionState) -> None:
        if self._session_factory is None:
            return
        with self._session_factory() as session:
            table = session.get(Table, table_id)
            if table is None:
                return
            table.status = state.status
            if state.host_user_id is not None:
                table.host_user_id = state.host_user_id
            by_seat = {seat.seat_id: seat for seat in state.seats}
            for seat in table.seats:
                seat_state = by_seat.get(seat.seat_number)
                if seat_state is not None:
                    seat.chip_count = seat_state.chips
                    seat.is_funded = seat_state.chips > 0
                    seat.present = seat_state.present
                    seat.sitting_out = seat_state.sitting_out
            session.commit()

    def _session_event(self, table_id: int, revision: int) -> dict[str, object]:
        with self._session_factory() as session:
            table = session.get(Table, table_id)
            if table is None:
                raise ValueError("table does not exist")
            seats = sorted(table.seats, key=lambda item: item.seat_number)
            seat_events = [
                {
                    "seat_number": seat.seat_number,
                    "display_name": self._display_name(seat),
                    "chip_count": seat.chip_count,
                    "ai_tier": seat.ai_tier if seat.actor_type == "ai" else None,
                    "spectating": (seat.user_id is None and seat.actor_type != "ai") or not seat.present or seat.chip_count <= 0,
                    "sitting_out": bool(seat.sitting_out),
                }
                for seat in seats
                if seat.seat_number <= table.seat_count
            ]
            rankings = []
            if table.status == "ended":
                rankings = sorted(seat_events, key=lambda item: (-item["chip_count"], item["seat_number"]))
                rankings = [
                    {
                        "seat_number": item["seat_number"],
                        "display_name": item["display_name"],
                        "chip_count": item["chip_count"],
                    }
                    for item in rankings
                ]
            return {
                "type": "session",
                "revision": revision,
                "status": table.status,
                "host_user_id": table.host_user_id,
                "seats": seat_events,
                "pending_leaves": list(self._pending_leave_seats(table_id)),
                "final_rankings": rankings,
            }

    @staticmethod
    def _now_from(value: datetime) -> datetime:
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)

    def _now(self) -> datetime:
        return self._now_from(self._clock())
