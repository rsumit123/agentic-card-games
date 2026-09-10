import { useCountdown } from './useCountdown';

export function DeadlineRing({ deadline, total = 30 }: { deadline: string | null; total?: number }) {
  const { seconds, fraction } = useCountdown(deadline, total);
  if (seconds === null) return null;
  const circumference = 106.8;
  return (
    <span className="deadline" data-late={seconds <= 5 ? 'true' : undefined} role="timer" aria-live="off" aria-label={`${seconds} seconds left`}>
      <svg viewBox="0 0 40 40" width="44" height="44" aria-hidden="true">
        <circle cx="20" cy="20" r="17" fill="none" stroke="rgba(255,255,255,.15)" strokeWidth="3" />
        <circle
          cx="20" cy="20" r="17" fill="none"
          stroke={seconds <= 5 ? 'var(--ember)' : 'var(--moss)'}
          strokeWidth="3"
          strokeDasharray={`${fraction * circumference} ${circumference}`}
          transform="rotate(-90 20 20)"
        />
      </svg>
      <span className="tabular">{seconds}s</span>
    </span>
  );
}
