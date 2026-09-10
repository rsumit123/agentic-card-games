import { useCountdown } from './useCountdown';

/** The pause between hands.
 *
 *  The server holds the finished hand for a few seconds and then deals the
 *  next one. Without a countdown that pause is indistinguishable from the
 *  table having stopped. */
export function NextHand({ deadline }: { deadline: string | null }) {
  const { seconds } = useCountdown(deadline, 6);
  if (seconds === null) return null;
  return <p className="next-hand" role="status">Next hand in {seconds}s</p>;
}
