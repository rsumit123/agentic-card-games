from __future__ import annotations

from collections import defaultdict

from fastapi import APIRouter, Depends, Request
from sqlalchemy import select

from ..ai.policy import TIERS
from ..auth import AuthenticatedUser, require_user
from ..models import HandOutcome, Seat, Table

router = APIRouter(prefix="/me", tags=["history"])


def _rate(won: int, played: int) -> float:
    return round(100 * won / played, 1) if played else 0.0


@router.get("/history")
def history(request: Request, user: AuthenticatedUser = Depends(require_user)):
    """How this player has done, overall and against each kind of opponent."""
    with request.app.state.session_factory() as session:
        rows = session.scalars(
            select(HandOutcome).where(HandOutcome.user_id == user.id).order_by(HandOutcome.id.desc())
        ).all()

        played = len(rows)
        won = sum(1 for row in rows if row.won)
        net = sum(row.net_chips for row in rows)
        showdowns = sum(1 for row in rows if row.went_to_showdown)

        buckets: dict[str, dict[str, int]] = defaultdict(lambda: {"hands": 0, "won": 0, "net_chips": 0})
        for row in rows:
            for opponent in set(row.opponent_tiers or []):
                bucket = buckets[opponent]
                bucket["hands"] += 1
                bucket["won"] += 1 if row.won else 0
                bucket["net_chips"] += row.net_chips

        opponents = [
            {
                "opponent": name,
                "hands": bucket["hands"],
                "won": bucket["won"],
                "win_rate": _rate(bucket["won"], bucket["hands"]),
                "net_chips": bucket["net_chips"],
            }
            for name, bucket in sorted(
                buckets.items(),
                key=lambda item: (list(TIERS).index(item[0]) if item[0] in TIERS else len(TIERS), item[0]),
            )
        ]

        # A session is a whole table. You win it by finishing with the most chips.
        finished = session.scalars(
            select(Table)
            .join(Seat, Seat.table_id == Table.id)
            .where(Seat.user_id == user.id, Table.status.in_(("ended", "cancelled")))
        ).unique().all()
        sessions_played = 0
        sessions_won = 0
        for table in finished:
            seats = [seat for seat in table.seats if seat.seat_number <= table.seat_count]
            mine = next((seat for seat in seats if seat.user_id == user.id), None)
            if mine is None or not seats:
                continue
            sessions_played += 1
            if mine.chip_count == max(seat.chip_count for seat in seats):
                sessions_won += 1

        recent = [
            {
                "table_id": row.table_id,
                "won": row.won,
                "net_chips": row.net_chips,
                "opponents": row.opponent_tiers or [],
                "showdown": row.went_to_showdown,
                "at": row.created_at,
            }
            for row in rows[:20]
        ]

    return {
        "hands": {
            "played": played,
            "won": won,
            "win_rate": _rate(won, played),
            "net_chips": net,
            "showdowns": showdowns,
        },
        "sessions": {
            "played": sessions_played,
            "won": sessions_won,
            "win_rate": _rate(sessions_won, sessions_played),
        },
        "opponents": opponents,
        "recent": recent,
    }
