import { useEffect, useRef, useState } from 'react';
import type { Street } from '../../domain/game';

const NAMES: Partial<Record<Street, string>> = { flop: 'Flop', turn: 'Turn', river: 'River' };

/** Names the street as it lands, then gets out of the way.
 *
 *  New cards used to simply appear, with nothing marking the boundary between
 *  one round of betting and the next. */
export function StreetLabel({ street, handNumber }: { street: Street; handNumber: number }) {
  const [shown, setShown] = useState<string | null>(null);
  const previous = useRef<string | null>(null);
  const key = `${handNumber}:${street}`;

  useEffect(() => {
    const name = NAMES[street];
    if (!name || previous.current === key) return;
    previous.current = key;
    setShown(name);
    const timer = setTimeout(() => setShown(null), 1400);
    return () => clearTimeout(timer);
  }, [key, street]);

  if (!shown) return null;
  return <span className="street-label" role="status">{shown}</span>;
}
