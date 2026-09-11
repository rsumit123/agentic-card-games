import { useEffect, useMemo, useRef } from 'react';

export interface Sizing { kind: 'bet' | 'raise'; min: number; max: number }

/** Bet sizing, always on screen rather than behind a button.
 *
 *  Presets carry almost all the traffic and the slider is the escape hatch,
 *  which is the order every mobile poker client puts them in. Keeping both
 *  visible means raising is one tap on a size, then one tap on Raise. */
export function BetSizer({ sizing, pot, bigBlind, value, onChange }: {
  sizing: Sizing;
  pot: number;
  bigBlind: number;
  value: number;
  onChange: (amount: number) => void;
}) {
  const { min, max } = sizing;
  const clamp = (amount: number) => Math.min(max, Math.max(min, Number.isFinite(amount) ? Math.round(amount) : min));

  const presets = useMemo(() => {
    const candidates = [
      { label: '¼ Pot', amount: clamp(pot / 4) },
      { label: '½ Pot', amount: clamp(pot / 2) },
      { label: 'Pot', amount: clamp(pot) },
      { label: 'All-in', amount: max },
    ];
    // Two sizes that land on the same chips are one preset.
    const seen = new Set<number>();
    return candidates.filter((preset) => {
      if (seen.has(preset.amount)) return false;
      seen.add(preset.amount);
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pot, min, max]);

  // A new street resets the bounds; a value left over from the last one would
  // silently become a different bet.
  const reset = useRef(onChange);
  reset.current = onChange;
  useEffect(() => { reset.current(min); }, [min, max]);

  const step = Math.max(1, Math.min(bigBlind, Math.floor((max - min) / 20) || 1));
  const current = clamp(value);

  return <div className="sizer">
    <div className="sizer-presets" role="group" aria-label="Bet size shortcuts">
      {presets.map((preset) => (
        <button key={preset.label} type="button" className="sizer-preset" aria-pressed={current === preset.amount}
          onClick={() => onChange(preset.amount)}>
          <span>{preset.label}</span><b className="tabular">{preset.amount.toLocaleString()}</b>
        </button>
      ))}
    </div>
    <div className="sizer-slide">
      <output className="sizer-value tabular" aria-live="off">{current.toLocaleString()}</output>
      <input type="range" className="sizer-range"
        aria-label={`${sizing.kind === 'bet' ? 'Bet' : 'Raise to'} amount`}
        min={min} max={max} step={step} value={current}
        onChange={(event) => onChange(Number(event.target.value))} />
    </div>
  </div>;
}
