import type { Action } from '../domain/game';
import type { Command } from '../domain/protocol';

const keyFor = (tableId: number) => `pending:${tableId}`;
export const newKey = (seatId: number, revision: number) => `${seatId}:${revision}:${crypto.randomUUID()}`;
export const buildCommand = (action: Action, revision: number, seatId: number): Command =>
  ({ expected_revision: revision, idempotency_key: newKey(seatId, revision), action });
export const savePending = (tableId: number, command: Command) => {
  try { sessionStorage.setItem(keyFor(tableId), JSON.stringify(command)); } catch { /* storage unavailable */ }
};
export const loadPending = (tableId: number): Command | null => {
  try {
    const value = sessionStorage.getItem(keyFor(tableId));
    return value ? JSON.parse(value) as Command : null;
  } catch { return null; }
};
export const clearPending = (tableId: number) => {
  try { sessionStorage.removeItem(keyFor(tableId)); } catch { /* storage unavailable */ }
};
