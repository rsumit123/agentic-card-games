import { describe, it, expect, beforeEach } from 'vitest';
import { useTable } from '../../src/store/table';
import snapshot from '../fixtures/snapshot.json';
import type { ServerEvent } from '../../src/domain/protocol';

const snap = snapshot as Extract<ServerEvent, { type: 'snapshot' }>;

describe('acknowledging a move', () => {
  beforeEach(() => useTable.getState().reset());

  it('releases the move even when a state event already used that revision', () => {
    const store = useTable.getState();
    store.applyEvent({ ...snap, revision: 4 });
    store.setPending({ key: 'pending:4', action: { type: 'fold' } });
    // A hand that settles while the command is in flight can broadcast first.
    store.applyEvent({ type: 'state', revision: 5, payload: snap.payload, deadline: null });
    store.applyEvent({ type: 'ack', revision: 5, idempotency_key: 'k', payload: snap.payload, deadline: null });
    expect(useTable.getState().pending).toBeNull();
  });

  it('still ignores a stale projection', () => {
    const store = useTable.getState();
    store.applyEvent({ ...snap, revision: 9 });
    store.applyEvent({ type: 'state', revision: 3, payload: snap.payload, deadline: null });
    expect(useTable.getState().revision).toBe(9);
  });
});
