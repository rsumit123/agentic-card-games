import type { TableAction } from '../../domain/game';

/** What somebody did, without saying who. The result screen lists the hand in
 *  two columns — who, then what — so the name cannot be baked into the verb. */
export function describeAction(action: TableAction): string {
  const chips = action.amount?.toLocaleString();
  switch (action.type) {
    case 'fold': return action.timeout ? 'ran out of time and folded' : 'folded';
    case 'check': return 'checked';
    case 'call': return `called ${chips}`;
    case 'bet': return `bet ${chips}`;
    case 'raise': return `raised to ${chips}`;
    case 'all_in': return `went all in for ${chips}`;
    default: return action.type;
  }
}

/** One action, said the way a person would say it. Shared by the feed and the
 *  action bar, so the same move never reads two different ways. */
export function phraseFor(action: TableAction, name: string): string {
  return `${name} ${describeAction(action)}`;
}
