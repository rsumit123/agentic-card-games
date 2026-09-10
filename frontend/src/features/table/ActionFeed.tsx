import type { PublicState, TableAction } from '../../domain/game';

const STREET_LABEL: Record<string, string> = { preflop: 'Preflop', flop: 'Flop', turn: 'Turn', river: 'River', complete: 'Showdown' };

function phrase(action: TableAction, name: string): string {
  const chips = action.amount?.toLocaleString();
  switch (action.type) {
    case 'fold': return action.timeout ? `${name} ran out of time and folded` : `${name} folded`;
    case 'check': return `${name} checked`;
    case 'call': return `${name} called ${chips}`;
    case 'bet': return `${name} bet ${chips}`;
    case 'raise': return `${name} raised to ${chips}`;
    case 'all_in': return `${name} went all in for ${chips}`;
    default: return `${name} ${action.type}`;
  }
}

/** What has actually happened this hand.
 *
 *  The server sends the whole action log and nothing rendered it, so a raise
 *  was only ever visible as a stack that had changed size. */
export function ActionFeed({ pub, mySeat }: { pub: PublicState; mySeat: number }) {
  const actions = pub.actions ?? [];
  if (actions.length === 0) return null;
  const recent = actions.slice(-3);
  const name = (seat: number) => (seat === mySeat ? 'You' : pub.names[seat] ?? `Seat ${seat}`);

  return <ol className="action-feed" aria-label="What has happened this hand">
    {recent.map((action, index) => (
      <li key={`${actions.length - recent.length + index}`}>
        <span className="action-feed-street">{STREET_LABEL[action.street] ?? action.street}</span>
        <span>{phrase(action, name(action.seat_id))}</span>
      </li>
    ))}
  </ol>;
}
