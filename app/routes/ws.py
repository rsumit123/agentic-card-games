from __future__ import annotations

import asyncio

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
    if not validate_websocket_origin(origin, websocket.app.state.settings.allowed_origins):
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
    queue = websocket.app.state.room_manager.connect(table_id, seat.seat_number)
    notice = websocket.app.state.recovery_notices_by_table.get(table_id)
    await websocket.send_json(
        jsonable_encoder(
            {
                "type": "snapshot",
                "revision": actor.revision,
                "payload": actor.snapshot_for(seat.seat_number),
                "deadline": actor.deadline,
                "recovery_notice": notice,
            }
        )
    )
    receive_task = asyncio.create_task(websocket.receive_json())
    queue_task = asyncio.create_task(queue.get())
    try:
        while True:
            done, _pending = await asyncio.wait((receive_task, queue_task), return_when=asyncio.FIRST_COMPLETED)
            if queue_task in done:
                await websocket.send_json(jsonable_encoder(queue_task.result()))
                queue_task = asyncio.create_task(queue.get())
            if receive_task in done:
                command = receive_task.result()
                receive_task = asyncio.create_task(websocket.receive_json())
                if actor.state.current_seat != seat.seat_number:
                    await websocket.send_json({"type": "error", "code": "invalid_action", "message": "out of turn", "revision": actor.revision})
                    continue
                result = actor.submit(command, seat_id=seat.seat_number)
                if isinstance(result, Ack):
                    await websocket.send_json(
                        jsonable_encoder(
                            {
                                "type": "ack",
                                "revision": result.revision,
                                "idempotency_key": result.idempotency_key,
                                "payload": result.snapshot,
                                "deadline": result.deadline,
                            }
                        )
                    )
                    websocket.app.state.room_manager.publish(
                        table_id,
                        lambda recipient_seat: {
                            "type": "state",
                            "revision": result.revision,
                            "payload": actor.snapshot_for(recipient_seat),
                            "deadline": result.deadline,
                        },
                        exclude_seat_id=seat.seat_number,
                    )
                else:
                    assert isinstance(result, CommandError)
                    await websocket.send_json(jsonable_encoder({"type": "error", "code": result.code, "message": result.message, "revision": result.current_revision}))
    except WebSocketDisconnect:
        return
    finally:
        receive_task.cancel()
        queue_task.cancel()
        websocket.app.state.room_manager.disconnect(table_id, seat.seat_number)
