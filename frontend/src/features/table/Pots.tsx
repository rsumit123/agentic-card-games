import type { PublicState } from '../../domain/game';
import { Chip } from '../../components/Chip';

/** The chips in the middle.
 *
 *  With three or four players and a short stack there is more than one pot,
 *  and they have different people eligible to win them. Showing a single
 *  number in that situation is wrong, not merely incomplete. */
export function Pots({ pub }: { pub: PublicState }) {
  const seatName = (seat: number) => pub.names[seat] ?? `Seat ${seat}`;

  // Once the pot has been pushed to the winner there is nothing in the middle.
  if (pub.street === 'complete' && pub.pot === 0) return null;

  // The server layers the pot by contribution, so any unmatched bet makes one:
  // preflop the blinds alone come back as two layers. A pot is only really
  // split once somebody is all in for less than the rest.
  const someoneAllIn = pub.players.some((player) => player.all_in && !player.folded);
  const layers = someoneAllIn ? pub.pots ?? [] : [];

  if (layers.length < 2) {
    return <div className="pot"><span>Pot</span><Chip amount={pub.pot} /></div>;
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
