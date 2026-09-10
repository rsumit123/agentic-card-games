from __future__ import annotations

from dataclasses import dataclass, replace


class LifecycleError(ValueError):
    pass


@dataclass(frozen=True, slots=True)
class SessionSeat:
    seat_id: int
    user_id: int | None
    actor_type: str
    chips: int
    joined_order: int
    present: bool = True

    @property
    def spectating(self) -> bool:
        return self.chips <= 0 or not self.present


@dataclass(frozen=True, slots=True)
class SessionState:
    table_id: int
    host_user_id: int | None
    seats: tuple[SessionSeat, ...]
    status: str = "lobby"
    hand_in_progress: bool = False
    pending_leaves: tuple[int, ...] = ()
    final_rankings: tuple[SessionSeat, ...] = ()


def _human_seats(state: SessionState) -> list[SessionSeat]:
    return [seat for seat in state.seats if seat.present and seat.actor_type == "human" and seat.user_id is not None]


def _apply_leave(state: SessionState, user_id: int) -> SessionState:
    seats = tuple(replace(seat, present=False) if seat.user_id == user_id else seat for seat in state.seats)
    humans = sorted(_human_seats(replace(state, seats=seats)), key=lambda seat: seat.joined_order)
    host = humans[0].user_id if humans else None
    status = "cancelled" if not humans else state.status
    return replace(state, seats=seats, host_user_id=host, status=status)


def start_table(state: SessionState) -> SessionState:
    if state.status != "lobby":
        raise LifecycleError("table has already started")
    if any(seat.user_id is None for seat in state.seats):
        raise LifecycleError("all selected seats must be filled before starting")
    return replace(state, status="in_progress")


def leave_between_hands(state: SessionState, user_id: int) -> SessionState:
    if state.hand_in_progress:
        if user_id not in state.pending_leaves:
            return replace(state, pending_leaves=state.pending_leaves + (user_id,))
        return state
    return _apply_leave(state, user_id)


def finish_hand(state: SessionState, chip_counts: dict[int, int]) -> SessionState:
    seats = tuple(replace(seat, chips=chip_counts.get(seat.seat_id, seat.chips)) for seat in state.seats)
    finished = replace(state, seats=seats, hand_in_progress=False)
    for user_id in finished.pending_leaves:
        finished = _apply_leave(finished, user_id)
    finished = replace(finished, pending_leaves=())
    funded = [seat for seat in finished.seats if seat.present and seat.chips > 0]
    if len(funded) < 2:
        return replace(finished, status="ended", final_rankings=tuple(sorted(finished.seats, key=lambda seat: (-seat.chips, seat.seat_id))))
    return finished


def end_session(state: SessionState, user_id: int) -> SessionState:
    if state.host_user_id != user_id:
        raise LifecycleError("only the host can end the session")
    if state.hand_in_progress:
        raise LifecycleError("session can only end between hands")
    return replace(state, status="ended", final_rankings=tuple(sorted(state.seats, key=lambda seat: (-seat.chips, seat.seat_id))))
