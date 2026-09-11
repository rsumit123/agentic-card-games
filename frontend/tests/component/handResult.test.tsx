import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import snapshot from '../fixtures/snapshot.json';
import { useTable } from '../../src/store/table';
import { TablePage } from '../../src/features/table/TablePage';
import { HandResult } from '../../src/features/table/HandResult';
import { FakeWebSocket } from '../fakes/FakeWebSocket';
import type { ServerEvent } from '../../src/domain/protocol';
import type { TableView } from '../../src/domain/table';

const snap = snapshot as Extract<ServerEvent, { type: 'snapshot' }>;
const view: TableView = { id: 7, room_code: null, host_user_id: 1, seat_count: 2, starting_chips: 1000, small_blind: 5, big_blind: 10, status: 'in_progress', join_expires_at: null, seats: [], final_rankings: [] };
const complete = { ...snap.payload, legal_actions: [], public: { ...snap.payload.public, street: 'complete' as const, current_seat: null, winners: [2], payouts: [[2, 15]] as [number, number][] } };

describe('hand result', () => {
  beforeEach(() => { FakeWebSocket.reset(); useTable.getState().reset(); vi.stubGlobal('WebSocket', FakeWebSocket); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('shows the winner and payout when the street is complete', async () => {
    render(<TablePage view={view} />);
    act(() => { FakeWebSocket.last().open(); FakeWebSocket.last().receive({ ...snap, revision: 4, payload: complete, deadline: null }); });
    // The panel holds back ~900ms so the cards turning over are seen first.
    await waitFor(() => expect(screen.getByRole('status', { name: 'Hand result' })).toHaveTextContent('Rivers (AI) wins 15'));
    expect(screen.getByText('Hand complete')).toBeInTheDocument();
  });

  it('replaces the result with the next deal on the following state event', async () => {
    render(<TablePage view={view} />);
    act(() => { FakeWebSocket.last().open(); FakeWebSocket.last().receive({ ...snap, revision: 4, payload: complete, deadline: null }); });
    act(() => { FakeWebSocket.last().receive({ type: 'state', revision: 5, payload: snap.payload, deadline: '2026-09-10T12:00:30+00:00' }); });
    await waitFor(() => expect(screen.queryByRole('status', { name: 'Hand result' })).toBeNull());
    expect(screen.getAllByRole('img', { name: /of (spades|hearts|clubs|diamonds)/ })).toHaveLength(2);
  });
});

describe('why the hand was won', () => {
  const complete = {
    ...snap.payload.public,
    street: 'complete' as const,
    current_seat: null,
    winners: [2],
    payouts: [[2, 300]] as [number, number][],
  };

  it('names the winning hand and turns both hands face up at a showdown', async () => {
    const pub = {
      ...complete,
      showdown: [
        { seat_id: 1, hole_cards: [{ rank: 11, suit: 'diamonds' as const }, { rank: 11, suit: 'hearts' as const }], category: 'pair' },
        { seat_id: 2, hole_cards: [{ rank: 14, suit: 'spades' as const }, { rank: 13, suit: 'spades' as const }], category: 'two_pair' },
      ],
    };
    render(<HandResult pub={pub} />);

    await waitFor(() => expect(screen.getByRole('status', { name: 'Hand result' })).toHaveTextContent('wins 300 with two pair'));
    expect(screen.getAllByRole('img', { name: /of (spades|hearts|clubs|diamonds)/ })).toHaveLength(4);
  });

  it('gives every winner of a split pot their own line', async () => {
    const pub = {
      ...complete,
      winners: [1, 2],
      payouts: [[1, 150], [2, 150]] as [number, number][],
      showdown: [
        { seat_id: 1, hole_cards: [{ rank: 11, suit: 'diamonds' as const }, { rank: 11, suit: 'hearts' as const }], category: 'pair' },
        { seat_id: 2, hole_cards: [{ rank: 11, suit: 'spades' as const }, { rank: 11, suit: 'clubs' as const }], category: 'pair' },
      ],
    };
    render(<HandResult pub={pub} />);
    await waitFor(() => expect(screen.getByText('Split pot')).toBeInTheDocument());
    expect(screen.getByRole('status', { name: 'Hand result' })).toHaveTextContent('Ana wins 150 with a pair');
    expect(screen.getByRole('status', { name: 'Hand result' })).toHaveTextContent('Rivers (AI) wins 150 with a pair');
  });

  it('says "You win", not "You wins"', async () => {
    render(<HandResult pub={{ ...complete, winners: [2], payouts: [[2, 300]] as [number, number][] }} mySeat={2} />);
    await waitFor(() => expect(screen.getByRole('status', { name: 'Hand result' })).toHaveTextContent('You win 300'));
  });

  it('shows what you were holding when nobody had to show', async () => {
    render(<HandResult pub={{ ...complete, showdown: [] }} mySeat={2}
      holeCards={[{ rank: 5, suit: 'hearts' }, { rank: 5, suit: 'spades' }]} handRank={{ category: 'pair' }} />);
    await waitFor(() => expect(screen.getByText('Your hand')).toBeInTheDocument());
    expect(screen.getByText('a pair')).toBeInTheDocument();
  });

  it('says nothing was shown when everyone folded', async () => {
    render(<HandResult pub={{ ...complete, showdown: [] }} />);

    await waitFor(() => expect(screen.getByText('Everyone else folded.')).toBeInTheDocument());
    expect(screen.queryByRole('img', { name: /of spades/ })).toBeNull();
  });
});
