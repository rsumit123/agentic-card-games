import type { TableAction } from '../../domain/game';

/** One action, said the way a person would say it. Shared by the feed and the
 *  action bar, so the same move never reads two different ways. */
export function phraseFor(action: TableAction, name: string): string {
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
