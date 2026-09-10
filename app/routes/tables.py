from __future__ import annotations

from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel

from ..auth import AuthenticatedUser, require_csrf, require_user
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

