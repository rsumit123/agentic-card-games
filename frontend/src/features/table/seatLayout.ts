export interface SeatSlot { x: number; y: number }

/** Where the opponents sit, in order clockwise from the seat to your left.
 *
 *  Portrait is the constraining case. The felt is now wider than the phone -
 *  the rail runs off both edges - so opponents can use the flanks instead of
 *  queueing along the top rail. They stay clear of the screen edge, because a
 *  badge is drawn inside the felt but has to be read inside the viewport.
 *
 *  The flanks sit just above the middle rather than level with it: the board
 *  is five cards wide and owns the middle band on a 390px screen, so a seat
 *  level with it would land on the cards. */
const SLOTS: Record<number, SeatSlot[]> = {
  1: [{ x: 50, y: 14 }],
  2: [{ x: 22, y: 20 }, { x: 78, y: 20 }],
  3: [{ x: 22, y: 31 }, { x: 50, y: 12 }, { x: 78, y: 31 }],
};

/** Your own seat is always bottom centre, the way every portrait poker app
 *  does it, so your cards and the action bar sit in the same thumb arc. */
export const HERO_SLOT: SeatSlot = { x: 50, y: 83 };

/**
 * Lay out the table from the viewer's chair.
 *
 * `seatCount` is the size of the table, not the number of players still in the
 * hand. Keying on the latter made every badge jump to a new position the hand
 * after somebody busted.
 */
export function seatPositions(seatIds: number[], mySeat: number, seatCount?: number): Record<number, SeatSlot> {
  const sorted = [...seatIds].sort((a, b) => a - b);
  const start = sorted.indexOf(mySeat);
  const seated = Math.max(seatCount ?? sorted.length, sorted.length);
  const slots = SLOTS[Math.min(Math.max(seated - 1, 1), 3)];
  const positions: Record<number, SeatSlot> = {};

  // Watching rather than playing: nobody gets the hero chair, because handing
  // it to a stranger reads as though you are still in the hand.
  if (start === -1) {
    sorted.forEach((seat, index) => { positions[seat] = slots[Math.min(index, slots.length - 1)]; });
    return positions;
  }

  // Assign by the seat's offset around the full table rather than its index in
  // the players still in the hand, so a bust-out does not shuffle everyone.
  for (const seat of sorted) {
    const offset = ((seat - mySeat) % seated + seated) % seated;
    positions[seat] = offset === 0 ? HERO_SLOT : slots[Math.min(offset - 1, slots.length - 1)];
  }
  return positions;
}
