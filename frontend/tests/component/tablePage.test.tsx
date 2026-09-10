import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import snapshot from '../fixtures/snapshot.json';
import { FakeWebSocket } from '../fakes/FakeWebSocket';
import { TablePage } from '../../src/features/table/TablePage';
import { useTable } from '../../src/store/table';
import type { ServerEvent } from '../../src/domain/protocol';
import type { TableView } from '../../src/domain/table';

const snap = snapshot as Extract<ServerEvent, { type: 'snapshot' }>;
const view: TableView = { id: 7, room_code: null, host_user_id: 1, seat_count: 2, starting_chips: 1000, small_blind: 5, big_blind: 10, status: 'in_progress', join_expires_at: null, seats: [], final_rankings: [] };

describe('TablePage', () => {
  beforeEach(() => { FakeWebSocket.reset(); sessionStorage.clear(); useTable.getState().reset(); vi.stubGlobal('WebSocket', FakeWebSocket); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('shows connecting, then the felt after the snapshot, and the recovery notice first', async () => {
    render(<TablePage view={view} />);
    expect(screen.getByText('Connecting…')).toBeInTheDocument();
    act(() => { FakeWebSocket.last().open(); FakeWebSocket.last().receive({ ...snap, recovery_notice: 'The active hand was cancelled after a restart; pre-hand balances were restored.' }); });
    expect(screen.getByRole('alert')).toHaveTextContent(/cancelled after a restart/);
    await userEvent.click(screen.getByRole('button', { name: /continue/i }));
    expect(screen.getByLabelText('Table')).toBeInTheDocument();
    expect(screen.getByText('Connected')).toBeInTheDocument();
  });

  it('sends a command on my turn, disables the bar until the ack, then re-enables', async () => {
    render(<TablePage view={view} />);
    act(() => { FakeWebSocket.last().open(); FakeWebSocket.last().receive({ ...snap, payload: { ...snap.payload, public: { ...snap.payload.public, current_seat: snap.payload.seat_id } } }); });
    await userEvent.click(screen.getByRole('button', { name: 'Fold' }));
    expect(screen.getByText(/sending/i)).toBeInTheDocument();
    const key = JSON.parse(FakeWebSocket.last().sent[0]).idempotency_key;
    act(() => { FakeWebSocket.last().receive({ type: 'ack', revision: 1, idempotency_key: key, payload: snap.payload, deadline: null }); });
    expect(screen.queryByText(/sending/i)).toBeNull();
  });

  it('reconnects on stale_revision and shows resyncing', () => {
    render(<TablePage view={view} />);
    act(() => { FakeWebSocket.last().open(); FakeWebSocket.last().receive(snap); });
    act(() => { FakeWebSocket.last().receive({ type: 'error', code: 'stale_revision', message: 'expected revision does not match', revision: 3, idempotency_key: null }); });
    expect(screen.getByText(/resyncing/i)).toBeInTheDocument();
    expect(FakeWebSocket.last().readyState).toBe(3);
  });
});
