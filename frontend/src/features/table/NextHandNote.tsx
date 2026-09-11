import { useCountdown } from './useCountdown';

/** The only thing left to decide once a pot is pushed: deal again now, or wait
 *  the few seconds out. It sits where the controls were, and says nothing about
 *  the hand — the table has already shown that. */
export function NextHandNote({ revealDeadline, onNextHand }: {
  revealDeadline: string | null;
  onNextHand?: (() => void) | null;
}) {
  const { seconds } = useCountdown(revealDeadline, 6);
  if (seconds === null) return null;
  return onNextHand
    ? <button type="button" className="btn next-hand" onClick={onNextHand}>Next hand ({seconds}s)</button>
    : <p className="next-hand" role="status">Next hand in {seconds}s</p>;
}
