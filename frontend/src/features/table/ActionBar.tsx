import { useState, type ReactNode } from 'react';
import type { Action, LegalAction } from '../../domain/game';
import { Button } from '../../components/Button';
import { RaiseControl } from './RaiseControl';

export type BarStatus = 'your-turn' | 'waiting' | 'submitting' | 'resyncing' | 'hand-complete' | 'spectating';
const STATUS_TEXT: Record<BarStatus, string> = { 'your-turn': 'Your turn', waiting: 'Waiting for the table', submitting: 'Sending…', resyncing: 'Resyncing with the table…', 'hand-complete': 'Hand complete', spectating: 'Spectating' };

export function ActionBar({ legal, canAct, onAct, status, error, deadline }: { legal: LegalAction[]; canAct: boolean; onAct: (action: Action) => void; status: BarStatus; error?: string | null; deadline?: ReactNode }) {
  const [sizing, setSizing] = useState<Extract<LegalAction, { type: 'bet' | 'raise' }> | null>(null);
  const fire = (action: Action) => { setSizing(null); onAct(action); };
  return <section className="action-bar" aria-label="Actions">
    <div className="action-status"><span>{STATUS_TEXT[status]}</span>{deadline}</div>
    {error && <p role="alert" className="action-error">{error}</p>}
    {sizing ? <RaiseControl kind={sizing.type} min={sizing.min_amount} max={sizing.max_amount} onConfirm={(amount) => fire({ type: sizing.type, amount })} onCancel={() => setSizing(null)} /> :
      <div className="action-buttons">{legal.map((action) => {
        switch (action.type) {
          case 'fold': return <Button key="fold" variant="danger" disabled={!canAct} onClick={() => fire({ type: 'fold' })}>Fold</Button>;
          case 'check': return <Button key="check" variant="primary" disabled={!canAct} onClick={() => fire({ type: 'check' })}>Check</Button>;
          case 'call': return <Button key="call" variant="primary" disabled={!canAct} onClick={() => fire({ type: 'call' })}>Call {action.amount.toLocaleString()}</Button>;
          case 'bet': return <Button key="bet" disabled={!canAct} onClick={() => setSizing(action)}>Bet</Button>;
          case 'raise': return <Button key="raise" disabled={!canAct} onClick={() => setSizing(action)}>Raise</Button>;
          case 'all_in': return <Button key="all_in" disabled={!canAct} onClick={() => fire({ type: 'all_in' })}>All-in {action.amount.toLocaleString()}</Button>;
        }
      })}</div>}
  </section>;
}
