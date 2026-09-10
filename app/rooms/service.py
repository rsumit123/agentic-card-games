from __future__ import annotations

import hashlib
import secrets
from collections import defaultdict, deque
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from enum import StrEnum

from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import select

from ..models import Seat, Table, User
from ..ai.policy import model_for_tier, model_label_for_tier, policy_for_tier


class TableError(Exception):
    """Base error for lobby operations."""


class InvalidConfiguration(TableError):
    pass


class UnauthorizedJoin(TableError):
    pass


class ExpiredTable(TableError):
    pass


class JoinRateLimited(TableError):
    pass


class FullTable(TableError):
    pass


class TableClosed(TableError):
    pass


class TableStatus(StrEnum):
    LOBBY = "lobby"
    IN_PROGRESS = "in_progress"
    ENDED = "ended"
    COMPLETED = "completed"
    CANCELLED = "cancelled"


class TableConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    seat_count: int = Field(default=4)
    starting_chips: int = Field(default=1000)
    small_blind: int = Field(default=5)
    big_blind: int = Field(default=10)

    @model_validator(mode="after")
    def validate_rules(self):
        if self.seat_count not in {2, 3, 4}:
            raise ValueError("seat_count must be 2, 3, or 4")
        if self.starting_chips not in {1000, 5000, 10000}:
            raise ValueError("starting_chips is not supported")
        if self.small_blind not in {5, 10, 25} or self.big_blind != self.small_blind * 2:
            raise ValueError("blind structure is not supported")
        return self


@dataclass(frozen=True)
class SeatView:
    seat_number: int
    user_id: int | None
    actor_type: str
    ai_tier: str | None
    chip_count: int
    display_name: str | None = None
    spectating: bool = True
    model: str | None = None


@dataclass(frozen=True)
class FinalRankingView:
    seat_number: int
    display_name: str | None
    chip_count: int


@dataclass(frozen=True)
class TableView:
    id: int
    room_code: str | None
    host_user_id: int
    seat_count: int
    starting_chips: int
    small_blind: int
    big_blind: int
    status: str
    join_expires_at: datetime | None
    seats: tuple[SeatView, ...]
    final_rankings: tuple[FinalRankingView, ...] = ()


class RoomStore:
    def __init__(self, session_factory, *, clock=None, max_join_attempts: int = 2):
        self.session_factory = session_factory
        self._clock = clock or (lambda: datetime.now(timezone.utc))
        self._attempts: dict[str, deque[datetime]] = defaultdict(deque)
        self.max_join_attempts = max_join_attempts

    def set_clock(self, clock) -> None:
        self._clock = clock

    @property
    def now(self) -> datetime:
        return self._as_utc(self._clock())

    @staticmethod
    def _as_utc(value: datetime) -> datetime:
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)

    @staticmethod
    def hash_room_code(code: str) -> str:
        return hashlib.sha256(code.encode("utf-8")).hexdigest()

    def _new_room_code(self) -> str:
        return secrets.token_urlsafe(12)

    def _check_rate_limit(self, code: str) -> None:
        key = self.hash_room_code(code)
        attempts = self._attempts[key]
        cutoff = self.now - timedelta(minutes=1)
        while attempts and attempts[0] <= cutoff:
            attempts.popleft()
        if len(attempts) >= self.max_join_attempts:
            raise JoinRateLimited("too many join attempts")
        attempts.append(self.now)

    def _view(self, table: Table, *, room_code: str | None = None) -> TableView:
        seats = tuple(
            SeatView(
                seat.seat_number,
                seat.user_id,
                seat.actor_type,
                seat.ai_tier,
                seat.chip_count,
                self._display_name(seat),
                (seat.user_id is None and seat.actor_type != "ai") or not seat.present or seat.chip_count <= 0,
                self._model(seat),
            )
            for seat in sorted(table.seats, key=lambda value: value.seat_number)
        )
        final_rankings = ()
        if table.status == TableStatus.ENDED.value:
            final_rankings = tuple(
                FinalRankingView(seat.seat_number, self._display_name(seat), seat.chip_count)
                for seat in sorted(table.seats, key=lambda item: (-item.chip_count, item.seat_number))
            )
        return TableView(
            id=table.id,
            room_code=room_code,
            host_user_id=table.host_user_id,
            seat_count=table.seat_count,
            starting_chips=table.starting_chips,
            small_blind=table.small_blind,
            big_blind=table.big_blind,
            status=table.status,
            join_expires_at=table.join_expires_at,
            seats=seats,
            final_rankings=final_rankings,
        )

    @staticmethod
    def _model(seat: Seat) -> str | None:
        if seat.actor_type != "ai" or not seat.ai_tier:
            return None
        try:
            return model_for_tier(seat.ai_tier)
        except ValueError:
            return None

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

    def create_table(
        self,
        host_id: int,
        config: TableConfig,
        *,
        join_ttl: timedelta = timedelta(hours=2),
    ) -> TableView:
        with self.session_factory() as session:
            if session.get(User, host_id) is None:
                raise UnauthorizedJoin("host does not exist")
            room_code = self._new_room_code()
            table = Table(
                host_user_id=host_id,
                room_code_hash=self.hash_room_code(room_code),
                seat_count=config.seat_count,
                starting_chips=config.starting_chips,
                small_blind=config.small_blind,
                big_blind=config.big_blind,
                status=TableStatus.LOBBY.value,
                join_expires_at=self.now + join_ttl,
            )
            table.seats.append(
                Seat(
                    seat_number=1,
                    user_id=host_id,
                    actor_type="human",
                    chip_count=config.starting_chips,
                    is_funded=True,
                    present=True,
                )
            )
            for seat_number in range(2, config.seat_count + 1):
                table.seats.append(
                    Seat(
                        seat_number=seat_number,
                        chip_count=config.starting_chips,
                        is_funded=True,
                        present=False,
                    )
                )
            session.add(table)
            session.commit()
            session.refresh(table)
            return self._view(table, room_code=room_code)

    def _get_table_by_code(self, session, code: str) -> Table:
        table = session.scalar(select(Table).where(Table.room_code_hash == self.hash_room_code(code)))
        if table is None:
            raise UnauthorizedJoin("invalid room code")
        return table

    def join_table(self, user_id: int, code: str) -> TableView:
        self._check_rate_limit(code)
        with self.session_factory() as session:
            if session.get(User, user_id) is None:
                raise UnauthorizedJoin("user does not exist")
            table = self._get_table_by_code(session, code)
            if table.join_expires_at and self.now > self._as_utc(table.join_expires_at):
                raise ExpiredTable("table join window expired")
            if table.status != TableStatus.LOBBY.value:
                raise TableClosed("table is no longer accepting joins")

            existing = next((seat for seat in table.seats if seat.user_id == user_id), None)
            if existing is not None:
                return self._view(table)
            occupied = {seat.user_id for seat in table.seats if seat.user_id is not None}
            if user_id in occupied:
                raise UnauthorizedJoin("user already occupies a seat")
            # Sit at a genuinely open seat first; only evict a house player when
            # the table would otherwise be closed to a friend holding the code.
            empty = next(
                (seat for seat in table.seats if seat.user_id is None and seat.actor_type != "ai"),
                None,
            )
            if empty is None:
                empty = next((seat for seat in table.seats if seat.user_id is None), None)
            if empty is None:
                raise FullTable("table is full")
            empty.user_id = user_id
            empty.actor_type = "human"
            empty.ai_tier = None
            empty.chip_count = table.starting_chips
            empty.is_funded = True
            empty.present = True
            session.commit()
            return self._view(table)

    def _get_table(self, session, table_id: int) -> Table:
        table = session.get(Table, table_id)
        if table is None:
            raise TableClosed("table does not exist")
        return table

    def update_table_config(self, user_id: int, table_id: int, config: TableConfig) -> TableView:
        with self.session_factory() as session:
            table = self._get_table(session, table_id)
            if table.host_user_id != user_id or table.status != TableStatus.LOBBY.value:
                raise UnauthorizedJoin("only the lobby host can configure the table")
            if any(seat.user_id is not None and seat.seat_number > config.seat_count for seat in table.seats):
                raise InvalidConfiguration("selected seat count would remove an occupied seat")
            table.seat_count = config.seat_count
            table.starting_chips = config.starting_chips
            table.small_blind = config.small_blind
            table.big_blind = config.big_blind
            for seat in table.seats:
                seat.chip_count = config.starting_chips
            session.commit()
            return self._view(table)

    def start_table(self, user_id: int, table_id: int) -> TableView:
        with self.session_factory() as session:
            table = self._get_table(session, table_id)
            if table.host_user_id != user_id:
                raise UnauthorizedJoin("only the host can start the table")
            if table.status != TableStatus.LOBBY.value:
                raise TableClosed("table has already started")
            selected_seats = [seat for seat in table.seats if seat.seat_number <= table.seat_count]
            if any(seat.user_id is None and seat.actor_type != "ai" for seat in selected_seats):
                raise FullTable("all selected seats must be occupied")
            table.status = TableStatus.IN_PROGRESS.value
            table.current_revision += 1
            session.commit()
            return self._view(table)

    def fill_ai_seat(self, user_id: int, table_id: int, seat_number: int, tier: str) -> TableView:
        try:
            policy_for_tier(tier)
        except ValueError as exc:
            raise InvalidConfiguration(str(exc)) from exc
        with self.session_factory() as session:
            table = self._get_table(session, table_id)
            if table.host_user_id != user_id or table.status != TableStatus.LOBBY.value:
                raise UnauthorizedJoin("only the lobby host can add an AI seat")
            seat = next((item for item in table.seats if item.seat_number == seat_number), None)
            if seat is None or seat.seat_number > table.seat_count:
                raise InvalidConfiguration("seat is not part of this table")
            if seat.user_id is not None or seat.actor_type == "ai":
                raise TableClosed("seat is already occupied")
            seat.actor_type = "ai"
            seat.ai_tier = tier
            seat.chip_count = table.starting_chips
            seat.is_funded = True
            seat.present = True
            session.commit()
            return self._view(table)
