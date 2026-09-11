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
    await websocket.accept()
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

    manager = websocket.app.state.room_manager
    queue = manager.connect(table_id, seat.seat_number)
    # The notice describes what happened at startup, so it is worth saying once.
    # Leaving it in place re-sent it on every reconnect and blanked the table
    # again in the middle of a live session.
    notice = websocket.app.state.recovery_notices_by_table.pop(table_id, None)
    await websocket.send_json(
        jsonable_encoder(
            {
                "type": "snapshot",
                "revision": actor.revision,
                "payload": actor.snapshot_for(seat.seat_number),
                "deadline": actor.deadline,
                "reveal_deadline": manager.reveal_deadline(table_id),
                "recovery_notice": notice,
            }
        )
    )
    session_event = manager.session_event(table_id)
    if session_event is not None:
        await websocket.send_json(jsonable_encoder(session_event))
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
                if isinstance(command, dict) and command.get("type") == "reaction":
                    # Not a game command: it must never reach submit, and a
                    # player who is not to act can still send one.
                    manager.react(table_id, seat.seat_number, command.get("emoji"))
                    continue
                try:
                    legal_actions = actor.module.legal_actions(actor.state, seat.seat_number)
                except KeyError:
                    legal_actions = ()
                if not legal_actions:
                    await websocket.send_json(
                        {
                            "type": "error",
                            "code": "invalid_action",
                            "message": "out of turn",
                            "revision": actor.revision,
                            "idempotency_key": command.get("idempotency_key") if isinstance(command, dict) else None,
                        }
                    )
                    continue
                result = websocket.app.state.room_manager.submit(table_id, seat.seat_number, command)
                if isinstance(result, Ack):
                    reveal_deadline = manager.reveal_deadline(table_id)
                    await websocket.send_json(
                        jsonable_encoder(
                            {
                                "type": "ack",
                                "revision": actor.revision,
                                "idempotency_key": result.idempotency_key,
                                "payload": actor.snapshot_for(seat.seat_number),
                                "deadline": actor.deadline,
                                "reveal_deadline": reveal_deadline,
                            }
                        )
                    )
                    manager.publish(
                        table_id,
                        lambda recipient_seat: {
                            "type": "state",
                            "revision": actor.revision,
                            "payload": actor.snapshot_for(recipient_seat),
                            "deadline": actor.deadline,
                            "reveal_deadline": reveal_deadline,
                        },
                        exclude_seat_id=seat.seat_number,
                    )
                else:
                    assert isinstance(result, CommandError)
                    idempotency_key = command.get("idempotency_key") if isinstance(command, dict) else None
                    await websocket.send_json(
                        jsonable_encoder(
                            {
                                "type": "error",
                                "code": result.code,
                                "message": result.message,
                                "revision": result.current_revision,
                                "idempotency_key": idempotency_key,
                            }
                        )
                    )
    except WebSocketDisconnect:
        return
    finally:
        receive_task.cancel()
        queue_task.cancel()
        websocket.app.state.room_manager.disconnect(table_id, seat.seat_number)
