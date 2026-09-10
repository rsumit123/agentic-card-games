import type { PublicState } from '../../domain/game';
import { HAND_CATEGORY_LABELS } from '../../domain/game';
import { PlayingCard } from '../../components/PlayingCard';

export function HandResult({ pub, mySeat }: { pub: PublicState; mySeat?: number }) {
  if (pub.street !== 'complete' || pub.payouts.length === 0) return null;

  const seatName = (seat: number) => (seat === mySeat ? 'You' : pub.names[seat] ?? `Seat ${seat}`);
  const winners = new Set(pub.winners);
  const showdown = pub.showdown ?? [];
  const madeLabel = (category?: string) => (category ? HAND_CATEGORY_LABELS[category] ?? category.replace(/_/g, ' ') : null);

  // "You wins" is what you get from a single template. Each winner gets their
  // own sentence, which also makes a split pot say so.
  const lines = pub.payouts.map(([seat, amount]) => {
    const verb = seat === mySeat ? 'win' : 'wins';
    const made = madeLabel(showdown.find((entry) => entry.seat_id === seat)?.category);
    return `${seatName(seat)} ${verb} ${amount.toLocaleString()}${made ? ` with ${made}` : ''}`;
  });
  const split = pub.payouts.length > 1;

  return (
    <div role="status" aria-label="Hand result" className="hand-result">
      {split && <p className="hand-result-split">Split pot</p>}
      {lines.map((line) => <p key={line} className="hand-result-headline">{line}</p>)}
      {showdown.length === 0 && <p className="hand-result-why">Everyone else folded, so no cards were shown.</p>}
      {showdown.length > 0 && (
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
      )}
    </div>
  );
}
