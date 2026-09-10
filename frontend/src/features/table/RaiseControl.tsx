import { useState } from 'react';
import { Button } from '../../components/Button';

export function RaiseControl({ kind, min, max, onConfirm, onCancel }: { kind: 'bet' | 'raise'; min: number; max: number; onConfirm: (amount: number) => void; onCancel: () => void }) {
  const [value, setValue] = useState(min);
  const clamp = (amount: number) => Math.min(max, Math.max(min, Number.isFinite(amount) ? amount : min));
  const label = kind === 'bet' ? 'Bet' : 'Raise to';
  return <form className="raise" onSubmit={(event) => { event.preventDefault(); onConfirm(clamp(value)); }}>
    <label htmlFor="raise-amount">{label}</label>
    <input id="raise-amount" type="number" inputMode="numeric" min={min} max={max} step={1} value={value} onChange={(event) => setValue(Number(event.target.value))} onBlur={() => setValue(clamp(value))} autoFocus />
    <input type="range" aria-label={`${label} slider`} min={min} max={max} value={clamp(value)} onChange={(event) => setValue(Number(event.target.value))} />
    <small className="tabular">Min {min.toLocaleString()} · Max {max.toLocaleString()}</small>
    <Button type="submit" variant="primary">Confirm {kind}</Button>
    <Button type="button" onClick={onCancel}>Back</Button>
  </form>;
}
