import { useEffect, useState, type ReactNode } from 'react';
import type { Action, LegalAction } from '../../domain/game';
import { Button } from '../../components/Button';
import { RaiseControl } from './RaiseControl';

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

export function ActionBar({ legal, canAct, onAct, status, error, deadline, pot, bigBlind, waitingFor }: {
  legal: LegalAction[];
  canAct: boolean;
  onAct: (action: Action) => void;
  status: BarStatus;
  error?: string | null;
  deadline?: ReactNode;
  pot?: number;
  bigBlind?: number;
  waitingFor?: string | null;
}) {
  const [sizing, setSizing] = useState<Extract<LegalAction, { type: 'bet' | 'raise' }> | null>(null);
  const [confirming, setConfirming] = useState<Action | null>(null);
  const signature = legal.map((action) => action.type).join(',');

  // Your turn can end while you are still sizing a raise. Leaving the form up
  // lets you fire an action the server will reject.
  useEffect(() => { setSizing(null); setConfirming(null); }, [signature, canAct]);

  const fire = (action: Action) => { setSizing(null); setConfirming(null); onAct(action); };

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

  const heading = status === 'waiting' && waitingFor ? `Waiting for ${waitingFor}` : STATUS_TEXT[status];

  return <section className="action-bar" aria-label="Actions">
    <div className="action-status" role="status"><span>{heading}</span>{deadline}</div>
    {error && <p role="alert" className="action-error">{error}</p>}

    {confirming ? (
      <div className="action-confirm" role="group" aria-label="Confirm">
        <p>Put your whole stack in?</p>
        <div className="action-confirm-buttons">
          <Button type="button" onClick={() => setConfirming(null)}>Back</Button>
          <Button type="button" variant="danger" onClick={() => fire(confirming)}>Yes, all in</Button>
        </div>
      </div>
    ) : sizing ? (
      <RaiseControl kind={sizing.type} min={sizing.min_amount} max={sizing.max_amount}
        pot={pot ?? sizing.min_amount} bigBlind={bigBlind ?? 1}
        onConfirm={(amount) => fire({ type: sizing.type, amount })} onCancel={() => setSizing(null)} />
    ) : (
      <div className="action-buttons">{visible.map((action) => {
        switch (action.type) {
          case 'fold': return <Button key="fold" variant="danger" disabled={!canAct} onClick={() => fire({ type: 'fold' })}>Fold</Button>;
          case 'check': return <Button key="check" variant="primary" disabled={!canAct} onClick={() => fire({ type: 'check' })}>Check</Button>;
          case 'call': return <Button key="call" variant="primary" disabled={!canAct} onClick={() => fire({ type: 'call' })}>Call {action.amount.toLocaleString()}</Button>;
          case 'bet': return <Button key="bet" disabled={!canAct} onClick={() => setSizing(action)}>Bet</Button>;
          case 'raise': return <Button key="raise" disabled={!canAct} onClick={() => setSizing(action)}>Raise</Button>;
          case 'all_in': return <Button key="all_in" className="btn-allin" disabled={!canAct} onClick={() => setConfirming({ type: 'all_in' })}>All-in {action.amount.toLocaleString()}</Button>;
        }
      })}</div>
    )}
  </section>;
}
