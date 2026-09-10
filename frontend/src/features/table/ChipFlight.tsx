import { useEffect, useState } from 'react';

export interface Flight { id: number; from: { x: number; y: number }; amount: number }

const POT = { x: 50, y: 31 };

/** A chip sliding from the seat that bet it into the middle of the table. */
export function ChipFlight({ flight }: { flight: Flight }) {
  const [arrived, setArrived] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setArrived(true));
    return () => cancelAnimationFrame(frame);
  }, []);
  const at = arrived ? POT : flight.from;
  return (
    <span
      className="chip-flight tabular"
      aria-hidden="true"
      data-arrived={arrived}
      style={{ left: `${at.x}%`, top: `${at.y}%` }}
    >
      {flight.amount.toLocaleString()}
    </span>
  );
}
