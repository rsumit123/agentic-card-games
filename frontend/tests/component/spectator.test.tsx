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
const spectator = { ...snap.payload, seat_id: 3, hole_cards: [], legal_actions: [], hand_rank: null };
const session = { type: 'session' as const, revision: 4, status: 'in_progress' as const, host_user_id: 1,
  seats: [{ seat_number: 1, display_name: 'Ana', chip_count: 990, spectating: false }, { seat_number: 2, display_name: 'Rivers (AI)', chip_count: 1010, spectating: false }, { seat_number: 3, display_name: 'Bo', chip_count: 0, spectating: true }],
  final_rankings: [] };

describe('spectating', () => {
  beforeEach(() => { FakeWebSocket.reset(); useTable.getState().reset(); vi.stubGlobal('WebSocket', FakeWebSocket); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('shows the spectating status, no action buttons, no deadline, and keeps the zero-chip seat in the roster', () => {
    render(<TablePage view={view} />);
    act(() => { FakeWebSocket.last().open(); FakeWebSocket.last().receive({ ...snap, payload: spectator }); FakeWebSocket.last().receive(session); });
    expect(screen.getByText('Spectating')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /fold|check|call|raise|all-in/i })).toBeNull();
    // A spectator has no action clock of their own, but still watches the
    // active seat's clock run down.
    expect(screen.queryByRole('timer', { name: /seconds left$/ })).toBeNull();
    expect(screen.getByRole('timer', { name: /seconds left for this seat$/ })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Spectators' })).toHaveTextContent('Bo');
  });
});
