from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone

from sqlalchemy import select

from ..models import Hand, Seat, Table


@dataclass(frozen=True, slots=True)
class RecoveryNotice:
    table_id: int
    message: str = "The active hand was cancelled after a restart; pre-hand balances were restored."


def recover_incomplete_hands(session_factory, *, clock=None) -> list[RecoveryNotice]:
    now = (clock or (lambda: datetime.now(timezone.utc)))()
    notices: list[RecoveryNotice] = []
    with session_factory() as session:
        hands = session.scalars(select(Hand).where(Hand.status == "active")).all()
        for hand in hands:
            balances = {int(seat_id): int(chips) for seat_id, chips in (hand.pre_hand_balances or {}).items()}
            seats = session.scalars(select(Seat).where(Seat.table_id == hand.table_id)).all()
            for seat in seats:
                if seat.seat_number in balances:
                    seat.chip_count = balances[seat.seat_number]
                    seat.is_funded = seat.chip_count > 0
                elif seat.user_id in balances:
                    seat.chip_count = balances[seat.user_id]
                    seat.is_funded = seat.chip_count > 0
            hand.status = "cancelled"
            hand.cancellation_reason = "process_restart"
            hand.finished_at = now
            notices.append(RecoveryNotice(hand.table_id))
        session.commit()
    return notices
