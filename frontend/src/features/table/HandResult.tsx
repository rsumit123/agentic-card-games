import { useEffect, useState } from 'react';
import type { Card } from '../../domain/cards';
import type { PublicState } from '../../domain/game';
import { HAND_CATEGORY_LABELS } from '../../domain/game';
import { PlayingCard } from '../../components/PlayingCard';
import { describeAction } from './actionPhrase';
import { useCountdown } from './useCountdown';

/* A hand that went to the river with raises has a dozen entries and nobody
   reads a dozen. The last few are the ones that decided it. */
const LOG_LINES = 6;

/** How the hand ended, over the felt.
 *
 *  It waits a beat before appearing so the cards turning over, the winner's
 *  halo and the pot travelling home are all seen first. */
export function HandResult({ pub, mySeat, holeCards = null, handRank = null, revealDeadline = null, onNextHand }: {
  pub: PublicState;
  mySeat?: number;
  holeCards?: Card[] | null;
  handRank?: { category: string } | null;
  revealDeadline?: string | null;
  onNextHand?: (() => void) | null;
}) {
  const settled = pub.street === 'complete' && pub.payouts.length > 0;
  const [shown, setShown] = useState(false);
  const { seconds } = useCountdown(revealDeadline, 6);

  useEffect(() => {
    if (!settled) { setShown(false); return; }
    const timer = setTimeout(() => setShown(true), 900);
    return () => clearTimeout(timer);
  }, [settled, pub.hand_number]);

  if (!settled || !shown) return null;

  const seatName = (seat: number) => (seat === mySeat ? 'You' : pub.names[seat] ?? `Seat ${seat}`);
  const winners = new Set(pub.winners);
  const showdown = pub.showdown ?? [];
  const madeLabel = (category?: string) => (category ? HAND_CATEGORY_LABELS[category] ?? category.replace(/_/g, ' ') : null);
  const iWon = mySeat !== undefined && winners.has(mySeat);
  const split = pub.payouts.length > 1;

  // "You wins" is what a single template gives you. Each winner gets a line,
  // which also makes a split pot say so.
  const lines = pub.payouts.map(([seat, amount]) => {
    const made = madeLabel(showdown.find((entry) => entry.seat_id === seat)?.category);
    return `${seatName(seat)} ${seat === mySeat ? 'win' : 'wins'} ${amount.toLocaleString()}${made ? ` with ${made}` : ''}`;
  });


  // The log belongs to the win screen, which has the room for it. A loss keeps
  // the board and the two hands in view instead.
  const log = iWon ? (pub.actions ?? []).slice(-LOG_LINES) : [];

  return (
    /* Winning is a moment and takes the screen; losing is information, and
       leaves the board you lost on in view above it. */
    <div className={`result-scrim ${iWon ? 'result-scrim-won' : 'result-scrim-lost'}`}>
      {iWon && <Confetti />}
      <div role="status" aria-label="Hand result" className={`hand-result ${iWon ? 'hand-result-won' : 'hand-result-lost'}`}>
        {iWon && <span className="hand-result-crown" aria-hidden="true">♛</span>}
        {iWon && <p className="hand-result-title">You win</p>}
        {split && <p className="hand-result-split">Split pot</p>}
        {lines.map((line) => <p key={line} className="hand-result-headline">{line}</p>)}
        {showdown.length === 0 && <p className="hand-result-why">Everyone else folded.</p>}

        {showdown.length > 0 ? (
          <ul className="hand-result-showdown">
            {showdown.map((entry) => (
              <li key={entry.seat_id} data-winner={winners.has(entry.seat_id)}>
                <span className="cards">
                  {entry.hole_cards.map((card, index) => <PlayingCard key={index} card={card} size="sm" />)}
                </span>
                <span className="who">{seatName(entry.seat_id)}</span>
                {entry.category && <span className="made">{madeLabel(entry.category)}</span>}
              </li>
            ))}
          </ul>
        ) : holeCards && holeCards.length > 0 ? (
          /* Nobody showed, so say what you were holding. The hand is over, so
             this is a result rather than help while deciding. */
          <ul className="hand-result-showdown">
            <li data-winner={iWon}>
              <span className="cards">{holeCards.map((card, index) => <PlayingCard key={index} card={card} size="sm" />)}</span>
              <span className="who">Your hand</span>
              {handRank && <span className="made">{madeLabel(handRank.category)}</span>}
            </li>
          </ul>
        ) : null}

      </div>

      {/* How the hand actually went, which is the part you want after a pot is
          pushed away from you. */}
      {log.length > 0 && (
        <ol className="hand-result-log" aria-label="How the hand went">
          {log.map((action, index) => (
            <li key={index}>
              <span className="who">{seatName(action.seat_id)}</span>
              <span className="did">{describeAction(action)}</span>
            </li>
          ))}
        </ol>
      )}

      {seconds !== null && (
        onNextHand
          ? <button type="button" className="btn hand-result-next" onClick={onNextHand}>Next hand ({seconds}s)</button>
          : <p className="hand-result-next" role="presentation">Next hand in {seconds}s</p>
      )}
    </div>
  );
}

/** Paper over the winner, for the two seconds a win lasts. */
function Confetti() {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) return null;
  return <div className="confetti" aria-hidden="true">
    {Array.from({ length: 14 }, (_, index) => <i key={index} style={{ left: `${(index * 7 + 4) % 100}%`, animationDelay: `${(index % 5) * 0.18}s` }} />)}
  </div>;
}
