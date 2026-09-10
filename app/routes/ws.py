from __future__ import annotations

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from fastapi.encoders import jsonable_encoder
from sqlalchemy import select

from ..auth import validate_websocket_origin
from ..models import Seat, Table
from ..rooms.protocol import Ack, CommandError

router = APIRouter()


@router.websocket("/ws/tables/{table_id}")
async def table_socket(websocket: WebSocket, table_id: int):
    origin = websocket.headers.get("origin")
    if not validate_websocket_origin(origin, websocket.app.state.settings.allowed_origin):
        await websocket.close(code=4403)
        return
    user_id = websocket.session.get("user_id")
    if not user_id:
        await websocket.close(code=4401)
        return
    with websocket.app.state.session_factory() as session:
        table = session.get(Table, table_id)
        seat = session.scalar(select(Seat).where(Seat.table_id == table_id, Seat.user_id == int(user_id)))
    actor = websocket.app.state.room_manager.get(table_id)
    if table is None or seat is None or actor is None:
        await websocket.close(code=4403)
        return

    await websocket.accept()
    await websocket.send_json(
        jsonable_encoder(
            {"type": "snapshot", "revision": actor.revision, "payload": actor.snapshot_for(seat.seat_number), "deadline": actor.deadline}
        )
    )
    try:
        while True:
            command = await websocket.receive_json()
            if actor.state.current_seat != seat.seat_number:
                await websocket.send_json({"type": "error", "code": "invalid_action", "message": "out of turn", "revision": actor.revision})
                continue
            result = actor.submit(command)
            if isinstance(result, Ack):
                await websocket.send_json(
                    jsonable_encoder(
                        {
                            "type": "ack",
                            "revision": result.revision,
                            "idempotency_key": result.idempotency_key,
                            "payload": result.snapshot,
                        }
                    )
                )
            else:
                assert isinstance(result, CommandError)
                await websocket.send_json(jsonable_encoder({"type": "error", "code": result.code, "message": result.message, "revision": result.current_revision}))
    except WebSocketDisconnect:
        return
