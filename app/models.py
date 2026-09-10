from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, JSON, String, Text, UniqueConstraint
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    google_subject: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    email: Mapped[str] = mapped_column(String(320), default="")
    display_name: Mapped[str] = mapped_column(String(255), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))

    seats: Mapped[list["Seat"]] = relationship(back_populates="user")


class Table(Base):
    __tablename__ = "tables"

    id: Mapped[int] = mapped_column(primary_key=True)
    host_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    room_code_hash: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    seat_count: Mapped[int] = mapped_column(Integer)
    starting_chips: Mapped[int] = mapped_column(Integer)
    small_blind: Mapped[int] = mapped_column(Integer)
    big_blind: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(32), default="lobby")
    join_expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    current_revision: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))

    seats: Mapped[list["Seat"]] = relationship(back_populates="table", cascade="all, delete-orphan")
    hands: Mapped[list["Hand"]] = relationship(back_populates="table", cascade="all, delete-orphan")
    events: Mapped[list["RoomEvent"]] = relationship(back_populates="table", cascade="all, delete-orphan")


class Seat(Base):
    __tablename__ = "seats"
    __table_args__ = (UniqueConstraint("table_id", "seat_number"), UniqueConstraint("table_id", "user_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    table_id: Mapped[int] = mapped_column(ForeignKey("tables.id"), index=True)
    seat_number: Mapped[int] = mapped_column(Integer)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    actor_type: Mapped[str] = mapped_column(String(16), default="human")
    ai_tier: Mapped[str | None] = mapped_column(String(16), nullable=True)
    chip_count: Mapped[int] = mapped_column(Integer, default=0)
    is_funded: Mapped[bool] = mapped_column(Boolean, default=True)
    present: Mapped[bool] = mapped_column(Boolean, default=True)
    # Sitting out keeps the seat and its chips but deals the player out until
    # they sit back in. Distinct from present, which means they have left.
    sitting_out: Mapped[bool] = mapped_column(Boolean, default=False)

    table: Mapped[Table] = relationship(back_populates="seats")
    user: Mapped[User | None] = relationship(back_populates="seats")


class Hand(Base):
    __tablename__ = "hands"

    id: Mapped[int] = mapped_column(primary_key=True)
    table_id: Mapped[int] = mapped_column(ForeignKey("tables.id"), index=True)
    status: Mapped[str] = mapped_column(String(32), default="active")
    pre_hand_balances: Mapped[dict] = mapped_column(JSON, default=dict)
    state_snapshot: Mapped[dict] = mapped_column(JSON, default=dict)
    started_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    cancellation_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

    table: Mapped[Table] = relationship(back_populates="hands")


class HandOutcome(Base):
    """One row per seat per finished hand, so a player's record can be read back.

    Hands were already persisted with a snapshot, but the winners live inside
    that JSON keyed by seat, and seats change hands over a session. Recording
    the outcome per seat at the moment it settles keeps the attribution honest
    and makes "how do I do against Hard" a single query.
    """

    __tablename__ = "hand_outcomes"

    id: Mapped[int] = mapped_column(primary_key=True)
    hand_id: Mapped[int] = mapped_column(ForeignKey("hands.id"), index=True)
    table_id: Mapped[int] = mapped_column(ForeignKey("tables.id"), index=True)
    seat_number: Mapped[int] = mapped_column(Integer)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    actor_type: Mapped[str] = mapped_column(String(16), default="human")
    ai_tier: Mapped[str | None] = mapped_column(String(16), nullable=True)
    opponent_tiers: Mapped[list] = mapped_column(JSON, default=list)
    net_chips: Mapped[int] = mapped_column(Integer, default=0)
    won: Mapped[bool] = mapped_column(Boolean, default=False)
    went_to_showdown: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))


class RoomEvent(Base):
    __tablename__ = "room_events"

    id: Mapped[int] = mapped_column(primary_key=True)
    table_id: Mapped[int] = mapped_column(ForeignKey("tables.id"), index=True)
    revision: Mapped[int] = mapped_column(Integer)
    event_type: Mapped[str] = mapped_column(String(64))
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    idempotency_key: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=lambda: datetime.now(timezone.utc))

    table: Mapped[Table] = relationship(back_populates="events")
