import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SessionEnded } from '../../src/features/table/SessionEnded';

const rankings = [{ seat_number: 2, display_name: 'Rivers (AI)', chip_count: 2000 }, { seat_number: 1, display_name: 'Ana', chip_count: 0 }];

describe('SessionEnded', () => {
  it('lists every seat in order, including zero-chip seats', () => {
    render(<MemoryRouter><SessionEnded status="ended" rankings={rankings} /></MemoryRouter>);
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('1. Rivers (AI) 2,000');
    expect(items[1]).toHaveTextContent('2. Ana 0');
    expect(screen.getByRole('link', { name: 'Back to lobby' })).toHaveAttribute('href', '/');
  });
  it('explains cancellation', () => {
    render(<MemoryRouter><SessionEnded status="cancelled" rankings={[]} /></MemoryRouter>);
    expect(screen.getByText('Every player left, so this table was closed.')).toBeInTheDocument();
  });
});
