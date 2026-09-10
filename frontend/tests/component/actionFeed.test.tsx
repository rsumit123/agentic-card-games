import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ActionFeed } from '../../src/features/table/ActionFeed';
import type { PublicState, TableAction } from '../../src/domain/game';

const base = { names: { 1: 'Ana', 2: 'Gemini 3.7 Flash' } } as unknown as PublicState;
const feed = (actions: TableAction[]) => ({ ...base, actions });

describe('ActionFeed', () => {
  it('says what each player did, in words', () => {
    render(<ActionFeed pub={feed([
      { seat_id: 1, street: 'preflop', type: 'call', amount: 50 },
      { seat_id: 2, street: 'preflop', type: 'raise', amount: 200 },
      { seat_id: 1, street: 'flop', type: 'check', amount: null },
    ])} mySeat={1} />);
    expect(screen.getByText('You called 50')).toBeInTheDocument();
    expect(screen.getByText('Gemini 3.7 Flash raised to 200')).toBeInTheDocument();
    expect(screen.getByText('You checked')).toBeInTheDocument();
  });

  it('distinguishes a fold from running out of time', () => {
    render(<ActionFeed pub={feed([
      { seat_id: 2, street: 'flop', type: 'fold', amount: null, timeout: true },
    ])} mySeat={1} />);
    expect(screen.getByText('Gemini 3.7 Flash ran out of time and folded')).toBeInTheDocument();
  });

  it('renders nothing before anyone has acted', () => {
    const { container } = render(<ActionFeed pub={feed([])} mySeat={1} />);
    expect(container).toBeEmptyDOMElement();
  });
});
