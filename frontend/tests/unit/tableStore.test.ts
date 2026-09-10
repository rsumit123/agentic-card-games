import { describe, it, expect, beforeEach } from 'vitest';
import snapshot from '../fixtures/snapshot.json';
import { useTable } from '../../src/store/table';
import type { ServerEvent } from '../../src/domain/protocol';

const snap = snapshot as Extract<ServerEvent, { type: 'snapshot' }>;

describe('table store', () => {
  beforeEach(() => useTable.getState().reset());

  it('snapshot replaces projection, revision, deadline, and notice', () => {
    useTable.getState().applyEvent({ ...snap, recovery_notice: 'The active hand was cancelled after a restart.' });
    const state = useTable.getState();
    expect(state.revision).toBe(0); expect(state.projection?.seat_id).toBe(1); expect(state.recoveryNotice).toContain('cancelled');
  });

  it('ignores state events at or below the held revision', () => {
    useTable.getState().applyEvent({ ...snap, revision: 5 });
    useTable.getState().applyEvent({ type: 'state', revision: 4, payload: { ...snap.payload, public: { ...snap.payload.public, pot: 999 } }, deadline: null });
    expect(useTable.getState().projection?.public.pot).not.toBe(999);
  });

  it('marks stale_revision as needing resync and clears pending', () => {
    useTable.getState().applyEvent(snap);
    useTable.setState({ pending: { key: 'k', action: { type: 'call' } } });
    useTable.getState().applyEvent({ type: 'error', code: 'stale_revision', message: 'expected revision does not match', revision: 2, idempotency_key: null });
    expect(useTable.getState().pending).toBeNull(); expect(useTable.getState().needsResync).toBe(true);
  });

  it('canAct is true only on my turn with nothing pending', () => {
    useTable.getState().applyEvent(snap); useTable.setState({ connection: 'open' });
    expect(useTable.getState().canAct()).toBe(snap.payload.public.current_seat === snap.payload.seat_id);
    useTable.setState({ pending: { key: 'k', action: { type: 'call' } } });
    expect(useTable.getState().canAct()).toBe(false);
  });
});
