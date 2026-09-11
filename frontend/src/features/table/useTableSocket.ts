import { useEffect, useRef } from 'react';
import { TableSocket } from '../../ws/TableSocket';
import { useTable } from '../../store/table';
import type { Action } from '../../domain/game';

export function useTableSocket(tableId: number) {
  const ref = useRef<TableSocket | null>(null);
  const { applyEvent, setConnection, needsResync } = useTable();
  useEffect(() => {
    const socket = new TableSocket(tableId, { onEvent: applyEvent, onStatus: setConnection, onPendingDropped: () => { useTable.getState().setPending(null); useTable.getState().setDroppedAction(true); } });
    ref.current = socket;
    socket.connect();
    return () => { socket.close(); ref.current = null; useTable.getState().reset(); };
  }, [tableId, applyEvent, setConnection]);
  useEffect(() => { if (needsResync) ref.current?.resync(); }, [needsResync]);

  // A browser socket cannot tell a quiet server from a dead one. The server
  // always sends something at the deadline, because it folds the seat itself,
  // so silence well past it means the connection has gone without saying so.
  const deadline = useTable((state) => state.deadline);
  const connection = useTable((state) => state.connection);
  useEffect(() => {
    if (!deadline || connection !== 'open') return;
    const late = new Date(deadline).getTime() + 6000 - Date.now();
    const timer = setTimeout(() => {
      if (useTable.getState().deadline === deadline) ref.current?.resync();
    }, Math.max(1000, late));
    return () => clearTimeout(timer);
  }, [deadline, connection]);
  const send = (action: Action) => {
    const { projection, revision } = useTable.getState();
    if (!projection || !ref.current) return;
    const key = `pending:${revision}`;
    useTable.getState().setDroppedAction(false);
    useTable.getState().setPending({ key, action });
    ref.current.send(action, revision, projection.seat_id);
  };
  return { send, react: (emoji: string) => ref.current?.react(emoji), reconnect: () => ref.current?.retry() };
}
