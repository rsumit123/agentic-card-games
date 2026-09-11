import { useEffect, useState } from 'react';
import type { PublicState } from '../../domain/game';
import { HAND_CATEGORY_LABELS } from '../../domain/game';

/** How the pot was won, said on the table beside the seat that won it.
 *
 *  A hand used to end by covering the game with a panel. A pot is not an event
 *  worth leaving the table for: the chips crossing the felt, the seat lighting
 *  up and a line of why are enough, and the next hand follows straight on. */
export function WinNote({ pub, mySeat, style }: { pub: PublicState; mySeat?: number; style?: React.CSSProperties }) {
  const settled = pub.street === 'complete' && pub.payouts.length > 0;
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (!settled) { setShown(false); return; }
    const timer = setTimeout(() => setShown(true), 520);
    return () => clearTimeout(timer);
  }, [settled, pub.hand_number]);

  if (!settled || !shown) return null;

  const [seat, amount] = pub.payouts[0];
  const showdown = pub.showdown ?? [];
  const winner = showdown.find((entry) => entry.seat_id === seat);
  // Nobody showed a card, so nobody's hand decided anything: saying what you
  // were holding would claim it did.
  const why = showdown.length === 0
    ? 'Everyone folded'
    : winner?.category
      ? (HAND_CATEGORY_LABELS[winner.category] ?? winner.category.replace(/_/g, ' '))
      : null;
  const split = pub.payouts.length > 1;

  return (
    <span className={`win-note ${seat === mySeat ? 'win-note-mine' : ''}`} style={style} role="status">
      <b>+{amount.toLocaleString()}</b>
      {why && <span>{split ? `Split pot · ${why}` : why}</span>}
      {!why && split && <span>Split pot</span>}
    </span>
  );
}
