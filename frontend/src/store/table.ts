import { create } from 'zustand';
import type { Action, SeatProjection } from '../domain/game';
import type { ErrorCode, ServerEvent, SessionEvent } from '../domain/protocol';
import type { TableView } from '../domain/table';
import type { SocketStatus } from '../ws/TableSocket';

interface TableState {
  view: TableView | null;
  projection: SeatProjection | null;
  revision: number;
  deadline: string | null;
  recoveryNotice: string | null;
  connection: SocketStatus;
  pending: { key: string; action: Action } | null;
  lastError: { code: ErrorCode; message: string } | null;
  needsResync: boolean;
  session: SessionEvent | null;
  applyEvent: (event: ServerEvent) => void;
  setConnection: (status: SocketStatus) => void;
  setView: (view: TableView) => void;
  setPending: (pending: { key: string; action: Action } | null) => void;
  dismissNotice: () => void;
  canAct: () => boolean;
  reset: () => void;
}

const initial = {
  view: null,
  projection: null,
  revision: -1,
  deadline: null,
  recoveryNotice: null,
  connection: 'closed' as SocketStatus,
  pending: null,
  lastError: null,
  needsResync: false,
  session: null as SessionEvent | null,
};

export const useTable = create<TableState>((set, get) => ({
  ...initial,
  applyEvent: (event) => {
    if (event.type === 'session') { set({ session: event }); return; }
    if (event.type === 'snapshot') {
      set({ projection: event.payload, revision: event.revision, deadline: event.deadline,
        recoveryNotice: event.recovery_notice ?? get().recoveryNotice, needsResync: false, lastError: null });
      return;
    }
    if (event.type === 'error') {
      set({ pending: null, lastError: { code: event.code, message: event.message }, needsResync: event.code === 'stale_revision' });
      return;
    }
    if (event.revision <= get().revision) return;
    set({ projection: event.payload, revision: event.revision, deadline: event.deadline, lastError: null,
      ...(event.type === 'ack' ? { pending: null } : {}) });
  },
  setConnection: (connection) => set({ connection }),
  setView: (view) => set({ view }),
  setPending: (pending) => set({ pending }),
  dismissNotice: () => set({ recoveryNotice: null }),
  canAct: () => {
    const { projection, pending, connection } = get();
    return !!projection && pending === null && connection === 'open' && projection.public.current_seat === projection.seat_id;
  },
  reset: () => set(initial),
}));
