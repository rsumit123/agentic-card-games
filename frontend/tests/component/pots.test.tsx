import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Pots } from '../../src/features/table/Pots';
import type { PublicState } from '../../src/domain/game';

const players = (allIn: number[]) => [1, 2, 3].map((seat) => ({ seat_id: seat, stack: 0, folded: false, all_in: allIn.includes(seat), contribution: 0, street_contribution: 0, has_acted: true }));
const base = { pot: 1480, street: 'turn', names: { 1: 'Ana', 2: 'Bea', 3: 'Cy' }, players: players([2]) } as unknown as PublicState;

describe('Pots', () => {
  it('shows one pot when nobody is short', () => {
    render(<Pots pub={{ ...base, pots: [{ amount: 1480, eligible_seats: [1, 2, 3] }] }} />);
    expect(screen.getByText('Pot')).toBeInTheDocument();
    expect(screen.queryByText(/^Side /i)).toBeNull();
  });

  it('breaks the middle into main and side pots when a short stack is all in', () => {
    render(<Pots pub={{ ...base, pots: [
      { amount: 1140, eligible_seats: [1, 2, 3] },
      { amount: 340, eligible_seats: [1, 3] },
    ] }} />);
    expect(screen.getByText('Main')).toBeInTheDocument();
    expect(screen.getByText('1,140')).toBeInTheDocument();
    expect(screen.getByText('Side 1')).toBeInTheDocument();
    expect(screen.getByText('Ana, Cy')).toBeInTheDocument();
  });

  it('does not call the blinds a side pot before anyone is all in', () => {
    // The server layers by contribution, so preflop an unmatched blind comes
    // back as its own layer.
    render(<Pots pub={{ ...base, street: 'preflop', players: players([]), pots: [
      { amount: 10, eligible_seats: [1, 2] },
      { amount: 5, eligible_seats: [2] },
    ] }} />);
    expect(screen.getByText('Pot')).toBeInTheDocument();
    expect(screen.queryByText('Main')).toBeNull();
  });

  it('shows nothing once the pot has been pushed to the winner', () => {
    const { container } = render(<Pots pub={{ ...base, street: 'complete', pot: 0 }} />);
    expect(container).toBeEmptyDOMElement();
  });
});
