import { useEffect, useState } from 'react';

export interface Flight { id: number; from: { x: number; y: number }; amount: number }

const POT = { x: 50, y: 40 };

/** A chip sliding from the seat that bet it into the middle of the table. */
export function ChipFlight({ flight }: { flight: Flight }) {
  const [at, setAt] = useState(flight.from);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setAt(POT));
    return () => cancelAnimationFrame(frame);
  }, []);
  return (
    <span className="chip-flight tabular" aria-hidden="true" style={{ left: `${at.x}%`, top: `${at.y}%` }}>
      {flight.amount.toLocaleString()}
    </span>
  );
}
