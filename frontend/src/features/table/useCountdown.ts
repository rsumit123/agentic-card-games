import { useEffect, useState } from 'react';

/** Seconds left on a server deadline, and how much of the turn remains. */
export function useCountdown(deadline: string | null, total = 30) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!deadline) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [deadline]);
  if (!deadline) return { seconds: null as number | null, fraction: 0 };
  const seconds = Math.max(0, Math.ceil((new Date(deadline).getTime() - now) / 1000));
  return { seconds, fraction: Math.max(0, Math.min(1, seconds / total)) };
}
