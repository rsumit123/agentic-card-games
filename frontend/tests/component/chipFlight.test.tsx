import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import snapshot from '../fixtures/snapshot.json';
import { Felt } from '../../src/features/table/Felt';
import type { ServerEvent } from '../../src/domain/protocol';

const snap = snapshot as Extract<ServerEvent, { type: 'snapshot' }>;

const withBet = (seat: number, bet: number) => ({
  ...snap.payload,
  public: {
    ...snap.payload.public,
    players: snap.payload.public.players.map((player) =>
      player.seat_id === seat ? { ...player, street_contribution: bet } : player),
  },
});

describe('chip flights', () => {
  it('sends a chip to the middle when a seat puts more in', () => {
    const seat = snap.payload.public.players[0].seat_id;
    const { container, rerender } = render(<Felt projection={withBet(seat, 5)} />);
    expect(container.querySelectorAll('.chip-flight')).toHaveLength(0);

    rerender(<Felt projection={withBet(seat, 25)} />);
    const chips = container.querySelectorAll('.chip-flight');
    expect(chips).toHaveLength(1);
    expect(chips[0]).toHaveTextContent('20');
  });

  it('stays quiet when nobody has added chips', () => {
    const seat = snap.payload.public.players[0].seat_id;
    const { container, rerender } = render(<Felt projection={withBet(seat, 5)} />);
    rerender(<Felt projection={withBet(seat, 5)} />);
    expect(container.querySelectorAll('.chip-flight')).toHaveLength(0);
  });
});
