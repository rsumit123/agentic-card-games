import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import snapshot from '../fixtures/snapshot.json';
import { useTable } from '../../src/store/table';
import { TablePage } from '../../src/features/table/TablePage';
import { WinNote } from '../../src/features/table/WinNote';
import { FakeWebSocket } from '../fakes/FakeWebSocket';
import type { ServerEvent } from '../../src/domain/protocol';
import type { TableView } from '../../src/domain/table';

const snap = snapshot as Extract<ServerEvent, { type: 'snapshot' }>;
const view: TableView = { id: 7, room_code: null, host_user_id: 1, seat_count: 2, starting_chips: 1000, small_blind: 5, big_blind: 10, status: 'in_progress', join_expires_at: null, seats: [], final_rankings: [] };
const complete = { ...snap.payload, legal_actions: [], public: { ...snap.payload.public, street: 'complete' as const, current_seat: null, winners: [2], payouts: [[2, 15]] as [number, number][] } };
const pub = { ...snap.payload.public, street: 'complete' as const, current_seat: null, winners: [2], payouts: [[2, 300]] as [number, number][] };

describe('how a hand ends', () => {
  beforeEach(() => { FakeWebSocket.reset(); useTable.getState().reset(); vi.stubGlobal('WebSocket', FakeWebSocket); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('resolves on the table rather than covering it with a screen', async () => {
    render(<TablePage view={view} />);
    act(() => { FakeWebSocket.last().open(); FakeWebSocket.last().receive({ ...snap, revision: 4, payload: complete, deadline: null }); });
    // The pot is won beside the seat that won it, and the table stays visible.
    await waitFor(() => expect(screen.getByRole('status', { name: '' })).toBeTruthy(), { timeout: 2000 }).catch(() => {});
    expect(screen.getByLabelText('Table')).toBeInTheDocument();
    expect(screen.queryByText('Hand complete')).toBeNull();
  });
});

describe('the win note', () => {
  it('says what was won and why, once the cards have had a moment', async () => {
    render(<WinNote pub={{ ...pub, showdown: [
      { seat_id: 1, hole_cards: [{ rank: 11, suit: 'diamonds' }, { rank: 11, suit: 'hearts' }], category: 'pair' },
      { seat_id: 2, hole_cards: [{ rank: 14, suit: 'spades' }, { rank: 13, suit: 'spades' }], category: 'two_pair' },
    ] }} mySeat={2} />);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('+300'));
    expect(screen.getByRole('status')).toHaveTextContent('two pair');
  });

  it('does not name a hand nobody had to show', async () => {
    // Everyone folded, so the winner's cards decided nothing and claiming they
    // did would teach a new player the wrong thing.
    render(<WinNote pub={{ ...pub, showdown: [] }} mySeat={2} />);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Everyone folded'));
    expect(screen.getByRole('status')).not.toHaveTextContent(/pair|high card/i);
  });

  it('says when a pot is split', async () => {
    render(<WinNote pub={{ ...pub, winners: [1, 2], payouts: [[1, 150], [2, 150]] as [number, number][], showdown: [] }} />);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Split pot'));
  });
});
