from __future__ import annotations

from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel

from ..auth import AuthenticatedUser, require_csrf, require_user
from ..rooms.lifecycle import LifecycleError
from ..rooms.service import (
    ExpiredTable,
    FullTable,
    InvalidConfiguration,
    JoinRateLimited,
    TableClosed,
    TableConfig,
    TableError,
    UnauthorizedJoin,
)

router = APIRouter(prefix="/tables", tags=["tables"])


class JoinTableRequest(BaseModel):
    code: str


class AISeatRequest(BaseModel):
    tier: str


def _error(error: TableError) -> HTTPException:
    if isinstance(error, (UnauthorizedJoin,)):
        return HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(error))
    if isinstance(error, ExpiredTable):
        return HTTPException(status_code=status.HTTP_410_GONE, detail=str(error))
    if isinstance(error, JoinRateLimited):
        return HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail=str(error))
    if isinstance(error, FullTable):
        return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(error))
    if isinstance(error, InvalidConfiguration):
        return HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(error))
    if isinstance(error, TableClosed):
        return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(error))
    return HTTPException(status_code=400, detail=str(error))


@router.post("")
def create_table(
    config: TableConfig,
    request: Request,
    user: AuthenticatedUser = Depends(require_user),
    _csrf: None = Depends(require_csrf),
):
    try:
        return request.app.state.room_store.create_table(user.id, config)
    except TableError as exc:
        raise _error(exc) from exc


@router.post("/join")
def join_table(
    payload: JoinTableRequest,
    request: Request,
    user: AuthenticatedUser = Depends(require_user),
    _csrf: None = Depends(require_csrf),
):
    try:
        return request.app.state.room_store.join_table(user.id, payload.code)
    except TableError as exc:
        raise _error(exc) from exc


@router.get("/{table_id}")
def get_table(
    table_id: int,
    request: Request,
    _user: AuthenticatedUser = Depends(require_user),
):
    try:
        with request.app.state.session_factory() as session:
            table = request.app.state.room_store._get_table(session, table_id)
            return request.app.state.room_store._view(table)
    except TableError as exc:
        raise _error(exc) from exc


@router.post("/{table_id}/start")
def start_table(
    table_id: int,
    request: Request,
    user: AuthenticatedUser = Depends(require_user),
    _csrf: None = Depends(require_csrf),
):
    try:
        view = request.app.state.room_store.start_table(user.id, table_id)
        actor = request.app.state.room_manager.ensure_actor_for_table(
            table_id, request.app.state.session_factory, request.app.state.settings
        )
        return {"table": view, "revision": actor.revision}
    except (TableError, ValueError) as exc:
        if isinstance(exc, TableError):
            raise _error(exc) from exc
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/{table_id}/seats/{seat_number}/ai")
def fill_ai_seat(
    table_id: int,
    seat_number: int,
    payload: AISeatRequest,
    request: Request,
    user: AuthenticatedUser = Depends(require_user),
    _csrf: None = Depends(require_csrf),
):
    try:
        return request.app.state.room_store.fill_ai_seat(user.id, table_id, seat_number, payload.tier)
    except TableError as exc:
        raise _error(exc) from exc


@router.post("/{table_id}/leave")
def leave_table(
    table_id: int,
    request: Request,
    user: AuthenticatedUser = Depends(require_user),
    _csrf: None = Depends(require_csrf),
):
    try:
        request.app.state.room_manager.leave(table_id, user.id)
        with request.app.state.session_factory() as session:
            table = request.app.state.room_store._get_table(session, table_id)
            return request.app.state.room_store._view(table)
    except LifecycleError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except TableError as exc:
        raise _error(exc) from exc


@router.post("/{table_id}/sit-out")
def sit_out(
    table_id: int,
    request: Request,
    user: AuthenticatedUser = Depends(require_user),
    _csrf: None = Depends(require_csrf),
):
    return _set_sitting_out(request, table_id, user.id, sitting_out=True)


@router.post("/{table_id}/sit-in")
def sit_in(
    table_id: int,
    request: Request,
    user: AuthenticatedUser = Depends(require_user),
    _csrf: None = Depends(require_csrf),
):
    return _set_sitting_out(request, table_id, user.id, sitting_out=False)


def _set_sitting_out(request: Request, table_id: int, user_id: int, *, sitting_out: bool):
    manager = request.app.state.room_manager
    try:
        if sitting_out:
            manager.sit_out(table_id, user_id)
        else:
            manager.sit_in(table_id, user_id)
        with request.app.state.session_factory() as session:
            table = request.app.state.room_store._get_table(session, table_id)
            return request.app.state.room_store._view(table)
    except LifecycleError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except TableError as exc:
        raise _error(exc) from exc


@router.post("/{table_id}/next-hand")
def next_hand(
    table_id: int,
    request: Request,
    user: AuthenticatedUser = Depends(require_user),
    _csrf: None = Depends(require_csrf),
):
    try:
        request.app.state.room_manager.deal_next_hand(table_id, user.id)
        with request.app.state.session_factory() as session:
            table = request.app.state.room_store._get_table(session, table_id)
            return request.app.state.room_store._view(table)
    except LifecycleError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except TableError as exc:
        raise _error(exc) from exc


@router.post("/{table_id}/end")
def end_table(
    table_id: int,
    request: Request,
    user: AuthenticatedUser = Depends(require_user),
    _csrf: None = Depends(require_csrf),
):
    try:
        request.app.state.room_manager.end(table_id, user.id)
        with request.app.state.session_factory() as session:
            table = request.app.state.room_store._get_table(session, table_id)
            return request.app.state.room_store._view(table)
    except LifecycleError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except TableError as exc:
        raise _error(exc) from exc
