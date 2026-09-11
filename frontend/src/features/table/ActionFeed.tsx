import type { PublicState } from '../../domain/game';
import { phraseFor } from './actionPhrase';

const STREET_LABEL: Record<string, string> = { preflop: 'Preflop', flop: 'Flop', turn: 'Turn', river: 'River', complete: 'Showdown' };

/** What has actually happened this hand.
 *
 *  The server sends the whole action log and nothing rendered it, so a raise
 *  was only ever visible as a stack that had changed size. */
export function ActionFeed({ pub, mySeat, limit = 3 }: { pub: PublicState; mySeat: number; limit?: number }) {
  const actions = pub.actions ?? [];
  if (actions.length === 0) return null;
  const recent = actions.slice(-limit);
  const name = (seat: number) => (seat === mySeat ? 'You' : pub.names[seat] ?? `Seat ${seat}`);

  return <ol className="action-feed" aria-label="What has happened this hand">
    {recent.map((action, index) => (
      <li key={`${actions.length - recent.length + index}`}>
        <span className="action-feed-street">{STREET_LABEL[action.street] ?? action.street}</span>
        <span>{phraseFor(action, name(action.seat_id))}</span>
      </li>
    ))}
  </ol>;
}
