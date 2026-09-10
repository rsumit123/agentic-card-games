import { useMemo, useState } from 'react';
import { Button } from '../../components/Button';

/** Sizing a bet.
 *
 *  Presets carry almost all the traffic and the slider is the escape hatch,
 *  which is the order every mobile poker client puts them in. The slider steps
 *  in big blinds so it can be driven from a keyboard at all. */
export function RaiseControl({ kind, min, max, pot, bigBlind, onConfirm, onCancel }: {
  kind: 'bet' | 'raise';
  min: number;
  max: number;
  pot: number;
  bigBlind: number;
  onConfirm: (amount: number) => void;
  onCancel: () => void;
}) {
  const clamp = (amount: number) => Math.min(max, Math.max(min, Number.isFinite(amount) ? Math.round(amount) : min));
  const [value, setValue] = useState(min);
  const label = kind === 'bet' ? 'Bet' : 'Raise to';

  const presets = useMemo(() => {
    const candidates: { label: string; amount: number }[] = [
      { label: '½ pot', amount: clamp(pot / 2) },
      { label: '¾ pot', amount: clamp(pot * 0.75) },
      { label: 'Pot', amount: clamp(pot) },
      { label: 'All-in', amount: max },
    ];
    // Two presets that resolve to the same chips are one preset.
    const seen = new Set<number>();
    return candidates.filter((preset) => {
      if (seen.has(preset.amount)) return false;
      seen.add(preset.amount);
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pot, min, max]);

  const step = Math.max(1, Math.min(bigBlind, Math.floor((max - min) / 20) || 1));

  return <form className="raise" onSubmit={(event) => { event.preventDefault(); onConfirm(clamp(value)); }}>
    <div className="raise-presets" role="group" aria-label="Bet size shortcuts">
      {presets.map((preset) => (
        <button key={preset.label} type="button" className="raise-preset" aria-pressed={value === preset.amount}
          onClick={() => setValue(preset.amount)}>
          <span>{preset.label}</span><b className="tabular">{preset.amount.toLocaleString()}</b>
        </button>
      ))}
    </div>

    <div className="raise-amount">
      <label htmlFor="raise-amount">{label}</label>
      <input id="raise-amount" type="number" inputMode="numeric" min={min} max={max} step={1}
        aria-describedby="raise-bounds" value={value}
        onChange={(event) => setValue(Number(event.target.value))} onBlur={() => setValue(clamp(value))} />
    </div>
    <input type="range" className="raise-slider" aria-label={`${label} slider`} aria-describedby="raise-bounds"
      min={min} max={max} step={step} value={clamp(value)} onChange={(event) => setValue(Number(event.target.value))} />
    <small id="raise-bounds" className="tabular">Min {min.toLocaleString()} · Max {max.toLocaleString()}</small>

    <div className="raise-confirm">
      <Button type="button" onClick={onCancel}>Back</Button>
      <Button type="submit" variant="primary">{kind === 'bet' ? 'Bet' : 'Raise to'} {clamp(value).toLocaleString()}</Button>
    </div>
  </form>;
}
