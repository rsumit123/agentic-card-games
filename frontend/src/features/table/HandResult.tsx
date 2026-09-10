import type { PublicState } from '../../domain/game';
import { HAND_CATEGORY_LABELS } from '../../domain/game';
import { PlayingCard } from '../../components/PlayingCard';

export function HandResult({ pub }: { pub: PublicState }) {
  if (pub.street !== 'complete' || pub.payouts.length === 0) return null;

  const seatName = (seat: number) => pub.names[seat] ?? `Seat ${seat}`;
  const winners = new Set(pub.winners);
  const showdown = pub.showdown ?? [];
  const headline = pub.payouts
    .map(([seat, amount]) => `${seatName(seat)} wins ${amount.toLocaleString()}`)
    .join(' and ');

  const reasons = pub.payouts
    .map(([seat]) => showdown.find((entry) => entry.seat_id === seat)?.category)
    .filter((category): category is string => Boolean(category))
    .map((category) => HAND_CATEGORY_LABELS[category] ?? category.replace(/_/g, ' '));
  const why = showdown.length === 0
    ? 'Everyone else folded, so no cards were shown.'
    : reasons.length > 0
      ? `Won with ${reasons.join(' and ')}.`
      : null;

  return (
    <div role="status" aria-label="Hand result" className="hand-result">
      <p className="hand-result-headline">{headline}</p>
      {why && <p className="hand-result-why">{why}</p>}
      {showdown.length > 0 && (
        <ul className="hand-result-showdown">
          {showdown.map((entry) => (
            <li key={entry.seat_id} data-winner={winners.has(entry.seat_id)}>
              <span className="cards">
                {entry.hole_cards.map((card, index) => <PlayingCard key={index} card={card} size="sm" />)}
              </span>
              <span className="who">{seatName(entry.seat_id)}</span>
              {entry.category && <span className="made">{HAND_CATEGORY_LABELS[entry.category] ?? entry.category.replace(/_/g, ' ')}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
