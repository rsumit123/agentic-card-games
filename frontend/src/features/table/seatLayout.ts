const SLOTS: Record<number, { x: number; y: number }[]> = {
  2: [{ x: 50, y: 8 }],
  3: [{ x: 12, y: 30 }, { x: 88, y: 30 }],
  4: [{ x: 10, y: 45 }, { x: 50, y: 8 }, { x: 90, y: 45 }],
};

export function seatPositions(seatIds: number[], mySeat: number): Record<number, { x: number; y: number }> {
  const sorted = [...seatIds].sort((a, b) => a - b);
  const start = sorted.indexOf(mySeat);
  const order = start === -1 ? sorted : [...sorted.slice(start), ...sorted.slice(0, start)];
  const positions: Record<number, { x: number; y: number }> = {};
  const slots = SLOTS[sorted.length] ?? SLOTS[4];
  order.forEach((seat, index) => { positions[seat] = index === 0 ? { x: 50, y: 92 } : slots[Math.min(index - 1, slots.length - 1)]; });
  return positions;
}
