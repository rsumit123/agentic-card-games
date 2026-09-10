import { useEffect, useState } from 'react';

export interface Flight { id: number; from: { x: number; y: number }; amount: number }

/** Matches `.pot` in table.css: 36% down the felt on a phone. */
const POT = { x: 50, y: 36 };

/** A chip sliding between a seat and the middle of the table.
 *
 *  Bets travel inward. At the end of a hand the pot travels the other way, to
 *  whoever won it, which is how the outcome reads without anyone having to
 *  compare two numbers. */
export function ChipFlight({ flight, to = POT, kind = 'bet' }: { flight: Flight; to?: { x: number; y: number }; kind?: 'bet' | 'award' }) {
  const [arrived, setArrived] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setArrived(true));
    return () => cancelAnimationFrame(frame);
  }, []);
  const at = arrived ? to : flight.from;
  return (
    <span
      className={`chip-flight chip-flight-${kind} tabular`}
      aria-hidden="true"
      data-arrived={arrived}
      style={{ left: `${at.x}%`, top: `${at.y}%` }}
    >
      {flight.amount.toLocaleString()}
    </span>
  );
}
