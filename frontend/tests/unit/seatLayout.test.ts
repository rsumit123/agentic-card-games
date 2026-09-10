import { describe, it, expect } from 'vitest';
import { seatPositions, HERO_SLOT } from '../../src/features/table/seatLayout';

describe('seatPositions', () => {
  it('puts my seat at the bottom and rotates the rest clockwise', () => {
    const positions = seatPositions([1, 2, 3, 4], 3);
    expect(positions[3]).toEqual(HERO_SLOT);
    expect(positions[4].x).toBeLessThan(50);
    expect(positions[1].y).toBeLessThan(25);
  });

  it('puts a single opponent at the top', () => {
    const positions = seatPositions([1, 2], 1);
    expect(positions[2]).toEqual({ x: 50, y: 13 });
  });

  it('keeps every opponent clear of the community cards', () => {
    for (const count of [2, 3, 4]) {
      const seats = Array.from({ length: count }, (_, index) => index + 1);
      const positions = seatPositions(seats, 1, count);
      for (const seat of seats.slice(1)) expect(positions[seat].y).toBeLessThan(30);
    }
  });

  it('keeps the layout stable when a player busts out of a four-handed table', () => {
    const full = seatPositions([1, 2, 3, 4], 1, 4);
    const busted = seatPositions([1, 2, 4], 1, 4);
    expect(busted[2]).toEqual(full[2]);
    expect(busted[4]).toEqual(full[4]);
  });

  it('leaves the hero chair empty when I am not in the hand', () => {
    const positions = seatPositions([2, 3], 1, 3);
    expect(Object.values(positions)).not.toContainEqual(HERO_SLOT);
  });
});
