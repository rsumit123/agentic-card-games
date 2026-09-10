import { useEffect, useRef } from 'react';
import { TableSocket } from '../../ws/TableSocket';
import { useTable } from '../../store/table';
import type { Action } from '../../domain/game';

export function useTableSocket(tableId: number) {
  const ref = useRef<TableSocket | null>(null);
  const { applyEvent, setConnection, needsResync } = useTable();
  useEffect(() => {
    const socket = new TableSocket(tableId, { onEvent: applyEvent, onStatus: setConnection, onPendingDropped: () => useTable.getState().setPending(null) });
    ref.current = socket;
    socket.connect();
    return () => { socket.close(); ref.current = null; useTable.getState().reset(); };
  }, [tableId, applyEvent, setConnection]);
  useEffect(() => { if (needsResync) ref.current?.resync(); }, [needsResync]);
  const send = (action: Action) => {
    const { projection, revision } = useTable.getState();
    if (!projection || !ref.current) return;
    const key = `pending:${revision}`;
    useTable.getState().setPending({ key, action });
    ref.current.send(action, revision, projection.seat_id);
  };
  return { send, reconnect: () => ref.current?.connect() };
}
