import { useEffect, useState } from 'react';

export function DeadlineRing({ deadline, total = 30 }: { deadline: string | null; total?: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 250); return () => clearInterval(timer); }, []);
  if (!deadline) return null;
  const left = Math.max(0, Math.ceil((new Date(deadline).getTime() - now) / 1000));
  const fraction = Math.min(1, left / total);
  return <span className="deadline" role="timer" aria-live="off" aria-label={`${left} seconds left`}>
    <svg viewBox="0 0 40 40" width="44" height="44" aria-hidden="true">
      <circle cx="20" cy="20" r="17" fill="none" stroke="rgba(255,255,255,.15)" strokeWidth="3" />
      <circle cx="20" cy="20" r="17" fill="none" stroke="var(--moss)" strokeWidth="3" strokeDasharray={`${fraction * 106.8} 106.8`} transform="rotate(-90 20 20)" />
    </svg>
    <span className="tabular">{left}s</span>
  </span>;
}
