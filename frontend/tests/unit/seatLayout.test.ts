import { describe, it, expect } from 'vitest';
import { seatPositions } from '../../src/features/table/seatLayout';

describe('seatPositions', () => {
  it('puts my seat at the bottom and rotates the rest clockwise', () => {
    const positions = seatPositions([1, 2, 3, 4], 3);
    expect(positions[3]).toEqual({ x: 50, y: 92 });
    expect(positions[4].x).toBeLessThan(50);
    expect(positions[1].y).toBeLessThan(20);
  });
  it('puts a single opponent at the top', () => {
    const positions = seatPositions([1, 2], 1);
    expect(positions[2]).toEqual({ x: 50, y: 8 });
  });
});
