from __future__ import annotations

from datetime import datetime, timezone

from app.db import build_engine, initialize_database, session_factory
from app.models import Hand, Seat, Table, User
from app.rooms.recovery import recover_incomplete_hands
from app.settings import Settings


def test_restart_restores_pre_hand_balances_and_cancels_once(tmp_path):
    settings = Settings(database_url=f"sqlite:///{tmp_path}/recovery.db", data_dir=tmp_path)
    engine = build_engine(settings)
    initialize_database(engine)
    sessions = session_factory(engine)
    with sessions() as session:
        user_one = User(google_subject="one")
        user_two = User(google_subject="two")
        session.add_all([user_one, user_two])
        session.flush()
        table = Table(
            host_user_id=user_one.id,
            room_code_hash="hash",
            seat_count=2,
            starting_chips=100,
            small_blind=5,
            big_blind=10,
            status="in_progress",
        )
        table.seats = [
            Seat(seat_number=1, user_id=user_one.id, chip_count=80),
            Seat(seat_number=2, user_id=user_two.id, chip_count=120),
        ]
        session.add(table)
        session.flush()
        session.add(
            Hand(
                table_id=table.id,
                status="active",
                pre_hand_balances={str(user_one.id): 100, str(user_two.id): 100},
                state_snapshot={"street": "flop"},
            )
        )
        session.commit()

    notices = recover_incomplete_hands(sessions)
    assert len(notices) == 1
    assert notices[0].table_id == table.id
    with sessions() as session:
        seats = session.query(Seat).filter(Seat.table_id == table.id).order_by(Seat.seat_number).all()
        hand = session.query(Hand).filter(Hand.table_id == table.id).one()
        assert [seat.chip_count for seat in seats] == [100, 100]
        assert hand.status == "cancelled"
        assert hand.cancellation_reason == "process_restart"

    assert recover_incomplete_hands(sessions) == []
