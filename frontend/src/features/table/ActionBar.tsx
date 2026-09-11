import { useEffect, useState, type ReactNode } from 'react';
import type { Action, LegalAction } from '../../domain/game';
import { Button } from '../../components/Button';
import { BetSizer, type Sizing } from './BetSizer';

export type BarStatus = 'your-turn' | 'waiting' | 'submitting' | 'resyncing' | 'hand-complete' | 'spectating' | 'out';
const STATUS_TEXT: Record<BarStatus, string> = {
  'your-turn': 'Your turn',
  waiting: 'Waiting for the table',
  submitting: 'Sending…',
  resyncing: 'Resyncing with the table…',
  'hand-complete': 'Hand complete',
  spectating: 'Spectating',
  out: "You're out of chips",
};

export function ActionBar({ legal, canAct, onAct, status, error, deadline, pot, bigBlind, waitingFor, lastAction }: {
  legal: LegalAction[];
  canAct: boolean;
  onAct: (action: Action) => void;
  status: BarStatus;
  error?: string | null;
  deadline?: ReactNode;
  pot?: number;
  bigBlind?: number;
  waitingFor?: string | null;
  lastAction?: string | null;
}) {
  const [amount, setAmount] = useState(0);
  const [confirming, setConfirming] = useState<Action | null>(null);
  const signature = legal.map((action) => action.type).join(',');

  // Your turn can end while the sizer is still showing the last street's
  // bounds. Clearing a pending confirm stops a stale all-in firing.
  useEffect(() => { setConfirming(null); }, [signature, canAct]);

  const fire = (action: Action) => { setConfirming(null); onAct(action); };

  // Folding costs nothing when checking is free, so the only thing the button
  // can do there is lose you the hand by accident.
  const canCheck = legal.some((action) => action.type === 'check');
  // Calling your last chip and going all in are the same act. Offering both
  // reads as a choice the player has to think about.
  const callAmount = legal.find((action) => action.type === 'call')?.amount ?? null;
  const visible = legal.filter((action) => {
    if (action.type === 'fold' && canCheck) return false;
    if (action.type === 'all_in' && callAmount !== null && action.amount === callAmount) return false;
    return true;
  });

  const raise = visible.find((action): action is Extract<LegalAction, { type: 'bet' | 'raise' }> =>
    action.type === 'bet' || action.type === 'raise');
  const sizing: Sizing | null = raise
    ? { kind: raise.type, min: raise.min_amount, max: raise.max_amount }
    : null;

  const commit = () => {
    if (!sizing) return;
    const chips = Math.min(sizing.max, Math.max(sizing.min, amount || sizing.min));
    // Sliding to the top of the range is an all-in like any other.
    if (chips >= sizing.max) setConfirming({ type: sizing.kind, amount: chips });
    else fire({ type: sizing.kind, amount: chips });
  };

  const heading = status === 'waiting' && waitingFor ? `Waiting for ${waitingFor}` : STATUS_TEXT[status];

  return <section className="action-bar" aria-label="Actions">
    <div className="action-status" role="status">
      <span>{heading}</span>{deadline}
    </div>
    {lastAction && status !== 'your-turn' && <p className="action-last">{lastAction}</p>}
    {error && <p role="alert" className="action-error">{error}</p>}

    {confirming ? (
      <div className="action-confirm" role="group" aria-label="Confirm">
        <p>That is your whole stack. Sure?</p>
        <div className="action-confirm-buttons">
          <Button type="button" onClick={() => setConfirming(null)}>Back</Button>
          <Button type="button" variant="danger" onClick={() => fire(confirming)}>Yes, all in</Button>
        </div>
      </div>
    ) : (
      <>
        {sizing && canAct && <BetSizer sizing={sizing} pot={pot ?? sizing.min} bigBlind={bigBlind ?? 1}
          value={amount} onChange={setAmount} />}
        <div className="action-buttons">
          {visible.some((action) => action.type === 'fold') &&
            <Button className="btn-fold" variant="danger" disabled={!canAct} onClick={() => fire({ type: 'fold' })}>Fold</Button>}
          {canCheck &&
            <Button className="btn-call" variant="primary" disabled={!canAct} onClick={() => fire({ type: 'check' })}>Check</Button>}
          {callAmount !== null &&
            <Button className="btn-call" variant="primary" disabled={!canAct} onClick={() => fire({ type: 'call' })}>Call {callAmount.toLocaleString()}</Button>}
          {sizing &&
            <Button className="btn-raise" disabled={!canAct} onClick={commit}>{sizing.kind === 'bet' ? 'Bet' : 'Raise'}</Button>}
          {visible.some((action) => action.type === 'all_in') && !sizing &&
            <Button className="btn-allin" disabled={!canAct} onClick={() => setConfirming({ type: 'all_in' })}>
              All-in {(visible.find((action) => action.type === 'all_in') as Extract<LegalAction, { type: 'all_in' }>).amount.toLocaleString()}
            </Button>}
        </div>
      </>
    )}
  </section>;
}
