import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import snapshot from '../fixtures/snapshot.json';
import { useTable } from '../../src/store/table';
import { TablePage } from '../../src/features/table/TablePage';
import { FakeWebSocket } from '../fakes/FakeWebSocket';
import type { ServerEvent } from '../../src/domain/protocol';
import type { TableView } from '../../src/domain/table';

const snap = snapshot as Extract<ServerEvent, { type: 'snapshot' }>;
const view: TableView = { id: 7, room_code: null, host_user_id: 1, seat_count: 2, starting_chips: 1000, small_blind: 5, big_blind: 10, status: 'in_progress', join_expires_at: null, seats: [], final_rankings: [] };
const complete = { ...snap.payload, legal_actions: [], public: { ...snap.payload.public, street: 'complete' as const, current_seat: null, winners: [2], payouts: [[2, 15]] as [number, number][] } };

describe('hand result', () => {
  beforeEach(() => { FakeWebSocket.reset(); useTable.getState().reset(); vi.stubGlobal('WebSocket', FakeWebSocket); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('shows the winner and payout when the street is complete', () => {
    render(<TablePage view={view} />);
    act(() => { FakeWebSocket.last().open(); FakeWebSocket.last().receive({ ...snap, revision: 4, payload: complete, deadline: null }); });
    expect(screen.getByRole('status', { name: 'Hand result' })).toHaveTextContent('Rivers (AI) wins 15');
    expect(screen.getByText('Hand complete')).toBeInTheDocument();
  });

  it('replaces the result with the next deal on the following state event', () => {
    render(<TablePage view={view} />);
    act(() => { FakeWebSocket.last().open(); FakeWebSocket.last().receive({ ...snap, revision: 4, payload: complete, deadline: null }); });
    act(() => { FakeWebSocket.last().receive({ type: 'state', revision: 5, payload: snap.payload, deadline: '2026-09-10T12:00:30+00:00' }); });
    expect(screen.queryByRole('status', { name: 'Hand result' })).toBeNull();
    expect(screen.getAllByRole('img', { name: /of (spades|hearts|clubs|diamonds)/ })).toHaveLength(2);
  });
});
