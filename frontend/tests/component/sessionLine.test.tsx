import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SessionLine } from '../../src/features/table/SessionLine';

const seats = [{ seat_number: 1, display_name: 'Ana', chip_count: 500, spectating: false }, { seat_number: 2, display_name: 'Bo', chip_count: 1500, spectating: false }];

describe('SessionLine', () => {
  it('names the host', () => {
    render(<SessionLine hostUserId={2} hostSeatNumber={2} seats={seats} myUserId={1} />);
    expect(screen.getByText('Bo is the host')).toBeInTheDocument();
  });
  it('says "You are the host" for the host', () => {
    render(<SessionLine hostUserId={1} hostSeatNumber={1} seats={seats} myUserId={1} />);
    expect(screen.getByText('You are the host')).toBeInTheDocument();
  });
});
