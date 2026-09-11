import { useEffect, useRef, useState } from 'react';
import type { PublicState } from '../../domain/game';
import { Chip } from '../../components/Chip';

/** True for a moment after the number changes. The pot growing is the only
 *  feedback that a bet actually landed in the middle. */
function useKick(value: number) {
  const previous = useRef(value);
  const [kicked, setKicked] = useState(false);
  useEffect(() => {
    if (previous.current === value) return;
    previous.current = value;
    setKicked(true);
    const timer = setTimeout(() => setKicked(false), 320);
    return () => clearTimeout(timer);
  }, [value]);
  return kicked;
}

/** The chips in the middle.
 *
 *  With three or four players and a short stack there is more than one pot,
 *  and they have different people eligible to win them. Showing a single
 *  number in that situation is wrong, not merely incomplete. */
export function Pots({ pub }: { pub: PublicState }) {
  const seatName = (seat: number) => pub.names[seat] ?? `Seat ${seat}`;
  const kicked = useKick(pub.pot);

  // Once the pot has been pushed to the winner there is nothing in the middle.
  if (pub.street === 'complete' && pub.pot === 0) return null;

  // The server layers the pot by contribution, so any unmatched bet makes one:
  // preflop the blinds alone come back as two layers. A pot is only really
  // split once somebody is all in for less than the rest.
  const someoneAllIn = pub.players.some((player) => player.all_in && !player.folded);
  const layers = someoneAllIn ? pub.pots ?? [] : [];

  if (layers.length < 2) {
    return <div className={`pot ${kicked ? 'pot-kick' : ''}`}><span>Pot</span><Chip amount={pub.pot} /></div>;
  }

  return <div className="pot pot-split" role="group" aria-label="Pots">
    {layers.map((layer, index) => (
      <span key={index} className="pot-layer">
        <span className="pot-layer-name">{index === 0 ? 'Main' : `Side ${index}`}</span>
        <b className="tabular">{layer.amount.toLocaleString()}</b>
        {index > 0 && <small>{layer.eligible_seats.map(seatName).join(', ')}</small>}
      </span>
    ))}
  </div>;
}
