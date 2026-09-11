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
  revealDeadline: string | null;
  droppedAction: boolean;
  /** Reactions still on screen, newest last. Cosmetic and short-lived. */
  reactions: { id: number; seat: number; emoji: string }[];
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
  setDroppedAction: (dropped: boolean) => void;
  expireReaction: (id: number) => void;
  canAct: () => boolean;
  reset: () => void;
}

const initial = {
  view: null,
  projection: null,
  revision: -1,
  deadline: null,
  recoveryNotice: null,
  revealDeadline: null,
  droppedAction: false,
  reactions: [] as { id: number; seat: number; emoji: string }[],
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
    // Cosmetic, and deliberately outside the revision guard: a reaction has no
    // revision and must never disturb the hand.
    if (event.type === 'reaction') {
      const entry = { id: Date.now() + Math.random(), seat: event.seat_number, emoji: event.emoji };
      set((state) => ({ reactions: [...state.reactions.slice(-5), entry] }));
      return;
    }
    if (event.type === 'snapshot') {
      set({ projection: event.payload, revision: event.revision, deadline: event.deadline,
        revealDeadline: event.reveal_deadline ?? null,
        recoveryNotice: event.recovery_notice ?? get().recoveryNotice, needsResync: false, lastError: null });
      return;
    }
    if (event.type === 'error') {
      set({ pending: null, lastError: { code: event.code, message: event.message }, needsResync: event.code === 'stale_revision' });
      return;
    }
    // An ack always releases the move, whatever revision it carries. A hand
    // that settles while the command is in flight can broadcast the same
    // revision first, and dropping the ack for being stale would leave the
    // player stuck on "Sending…" with every button refusing to work.
    if (event.type === 'ack') set({ pending: null, droppedAction: false });
    if (event.revision <= get().revision) return;
    set({ projection: event.payload, revision: event.revision, deadline: event.deadline,
      revealDeadline: event.reveal_deadline ?? null, lastError: null,
      ...(event.type === 'ack' ? { pending: null } : {}) });
  },
  setConnection: (connection) => set({ connection }),
  setView: (view) => set({ view }),
  setPending: (pending) => set({ pending }),
  dismissNotice: () => set({ recoveryNotice: null }),
  setDroppedAction: (droppedAction) => set({ droppedAction }),
  expireReaction: (id) => set((state) => ({ reactions: state.reactions.filter((entry) => entry.id !== id) })),
  canAct: () => {
    const { projection, pending, connection } = get();
    return !!projection && pending === null && connection === 'open' && projection.public.current_seat === projection.seat_id;
  },
  reset: () => set(initial),
}));
