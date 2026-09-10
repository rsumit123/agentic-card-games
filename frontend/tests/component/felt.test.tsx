import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import snapshot from '../fixtures/snapshot.json';
import { Felt } from '../../src/features/table/Felt';
import type { ServerEvent } from '../../src/domain/protocol';

const snap = snapshot as Extract<ServerEvent, { type: 'snapshot' }>;

describe('Felt', () => {
  it('shows pot, my hole cards face up, opponents face down, and blind markers', () => {
    render(<Felt projection={snap.payload} />);
    expect(screen.getByText(/pot/i).parentElement).toHaveTextContent(String(snap.payload.public.pot));
    expect(screen.getAllByRole('img', { name: /of (spades|hearts|clubs|diamonds)/ })).toHaveLength(2);
    expect(screen.getAllByRole('img', { name: 'Face-down card' })).toHaveLength(2);
    expect(screen.getByText('SB')).toBeInTheDocument(); expect(screen.getByText('BB')).toBeInTheDocument(); expect(screen.getByText('D')).toBeInTheDocument();
  });
  it('marks the active seat', () => {
    render(<Felt projection={snap.payload} />);
    const active = document.querySelector('.seat-active');
    expect(active).not.toBeNull();
    // aria-current on a bare div is not exposed, so the badge is a labelled
    // group and the label says whose turn it is.
    expect(active).toHaveAttribute('role', 'group');
    expect(active?.getAttribute('aria-label')).toContain('to act');
    expect(active).toHaveAttribute('data-seat', String(snap.payload.public.current_seat));
  });
});
