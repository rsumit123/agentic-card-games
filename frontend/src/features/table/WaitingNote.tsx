import type { ReactNode } from 'react';

/** Who the table is waiting on, in the space the controls leave behind.
 *
 *  The seat that owes the action is already lit and counting down, but with
 *  the controls gone the bottom third of the screen said nothing at all. A
 *  line here explains the quiet without rebuilding the panel we removed. */
export function WaitingNote({ name, isAi, deadline, lastAction }: {
  name: string;
  isAi: boolean;
  deadline?: ReactNode;
  lastAction?: string | null;
}) {
  return (
    <div className="waiting-note" role="status">
      <p className="waiting-line">
        {isAi && <span className="waiting-avatar" aria-hidden="true">🤖</span>}
        <span className="waiting-who">{name}</span>
        <span className="waiting-verb">{isAi ? 'is thinking' : 'is to act'}</span>
        {isAi && <span className="waiting-dots" aria-hidden="true"><i /><i /><i /></span>}
        {deadline}
      </p>
      {lastAction && <p className="waiting-last">{lastAction}</p>}
    </div>
  );
}
