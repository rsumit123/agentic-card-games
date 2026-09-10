import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Pots } from '../../src/features/table/Pots';
import type { PublicState } from '../../src/domain/game';

const base = { pot: 1480, street: 'turn', names: { 1: 'Ana', 2: 'Bea', 3: 'Cy' } } as unknown as PublicState;

describe('Pots', () => {
  it('shows one pot when nobody is short', () => {
    render(<Pots pub={{ ...base, pots: [{ amount: 1480, eligible_seats: [1, 2, 3] }] }} />);
    expect(screen.getByText('Pot')).toBeInTheDocument();
    expect(screen.queryByText(/side pot/i)).toBeNull();
  });

  it('breaks the middle into main and side pots when a short stack is all in', () => {
    render(<Pots pub={{ ...base, pots: [
      { amount: 1140, eligible_seats: [1, 2, 3] },
      { amount: 340, eligible_seats: [1, 3] },
    ] }} />);
    expect(screen.getByText('Main pot')).toBeInTheDocument();
    expect(screen.getByText('1,140')).toBeInTheDocument();
    expect(screen.getByText('Side pot 1')).toBeInTheDocument();
    expect(screen.getByText('Ana, Cy')).toBeInTheDocument();
  });

  it('shows nothing once the pot has been pushed to the winner', () => {
    const { container } = render(<Pots pub={{ ...base, street: 'complete', pot: 0 }} />);
    expect(container).toBeEmptyDOMElement();
  });
});
