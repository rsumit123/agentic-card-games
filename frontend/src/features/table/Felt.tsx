import { useEffect, useRef, useState } from 'react';
import type { SeatProjection } from '../../domain/game';
import { PlayingCard } from '../../components/PlayingCard';
import { SeatBadge } from './SeatBadge';
import { seatPositions, HERO_SLOT } from './seatLayout';
import { ChipFlight, type Flight } from './ChipFlight';
import { Pots } from './Pots';
import { useRunout } from './useRunout';
import { StreetLabel } from './StreetLabel';
import './table.css';

export function Felt({ projection, deadline = null, seatCount, thinkingSeats = [] }: {
  projection: SeatProjection;
  deadline?: string | null;
  seatCount?: number;
  thinkingSeats?: number[];
}) {
  const { public: pub, seat_id: me, hole_cards } = projection;
  const positions = seatPositions(pub.players.map((player) => player.seat_id), me, seatCount);
  const flights = useChipFlights(pub.players.map((player) => ({ seat: player.seat_id, bet: player.street_contribution })), positions);
  // The server resolves an all-in in a single step. Dealing the board out over
  // a couple of seconds is the whole drama of the hand.
  const board = useRunout(pub.community_cards, pub.street);
  const complete = pub.street === 'complete';
  const winners = new Set(pub.winners);
  const revealedBySeat = new Map(pub.showdown.map((entry) => [entry.seat_id, entry.hole_cards]));
  const winningCards = new Set(
    pub.showdown.filter((entry) => winners.has(entry.seat_id))
      .flatMap((entry) => entry.best_five ?? [])
      .map((card) => `${card.rank}${card.suit}`),
  );

  // Heads-up puts the dealer and small blind on one seat. Collect the badges per
  // seat and hand them to the seat itself, so they can never land on the cards.
  const markersBySeat = new Map<number, string[]>();
  const addMarker = (seat: number, text: string) => {
    if (positions[seat] === undefined) return;
    markersBySeat.set(seat, [...(markersBySeat.get(seat) ?? []), text]);
  };
  addMarker(pub.dealer_seat, 'D');
  addMarker(pub.small_blind_seat, 'SB');
  addMarker(pub.big_blind_seat, 'BB');

  const heroWon = complete && winners.has(me);
  const potHome = complete && pub.winners.length > 0
    ? (positions[pub.winners[0]] ?? HERO_SLOT)
    : null;

  return <section className="felt-wrap" aria-label="Table">
    <div className="felt" data-street={pub.street}>
      <StreetLabel street={pub.street} handNumber={pub.hand_number ?? 0} />
      <Pots pub={pub} />
      <div className="community" role="group" aria-label="Community cards">
        {board.cards.map((card, index) => <PlayingCard key={`${card.rank}${card.suit}${index}`} card={card} size="md"
          enter={index >= board.cards.length - board.fresh}
          highlight={winningCards.has(`${card.rank}${card.suit}`)} />)}
      </div>
      {pub.players.map((player) => <SeatBadge key={player.seat_id} player={player} name={pub.names[player.seat_id] ?? null} isMe={player.seat_id === me} active={pub.current_seat === player.seat_id}
        thinking={thinkingSeats.includes(player.seat_id)}
        holeCards={player.seat_id === me ? hole_cards : null}
        revealed={revealedBySeat.get(player.seat_id) ?? null}
        won={winners.has(player.seat_id)}
        markers={markersBySeat.get(player.seat_id) ?? []} deadline={deadline}
        side={positions[player.seat_id].y < 50 ? 'top' : 'bottom'} style={{ left: `${positions[player.seat_id].x}%`, top: `${positions[player.seat_id].y}%` }} />)}
      {flights.map((flight) => <ChipFlight key={flight.id} flight={flight} />)}
      {potHome && <ChipFlight key={`pot-${pub.hand_number ?? 0}`} flight={{ id: -1, from: POT_ANCHOR, amount: pub.payouts.reduce((total, [, amount]) => total + amount, 0) }} to={potHome} kind="award" />}
    </div>
    {heroWon && <p className="felt-shout" role="presentation">You win</p>}
  </section>;
}

const POT_ANCHOR = { x: 50, y: 36 };

/** Spawn a chip whenever a seat's bet for this street grows. */
function useChipFlights(bets: { seat: number; bet: number }[], positions: Record<number, { x: number; y: number }>) {
  const previous = useRef<Record<number, number>>({});
  const seeded = useRef(false);
  const [flights, setFlights] = useState<Flight[]>([]);
  const signature = bets.map((entry) => `${entry.seat}:${entry.bet}`).join(',');

  useEffect(() => {
    const next: Record<number, number> = {};
    const born: Flight[] = [];
    for (const entry of bets) {
      next[entry.seat] = entry.bet;
      const before = previous.current[entry.seat] ?? 0;
      const position = positions[entry.seat];
      // Seed silently on the first render so joining mid-hand does not replay
      // every bet already on the table.
      if (seeded.current && entry.bet > before && position) {
        born.push({ id: Date.now() + entry.seat, from: position, amount: entry.bet - before });
      }
    }
    previous.current = next;
    seeded.current = true;
    if (born.length === 0) return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) return;
    setFlights((current) => [...current, ...born]);
    const ids = new Set(born.map((flight) => flight.id));
    const timer = setTimeout(() => setFlights((current) => current.filter((flight) => !ids.has(flight.id))), 700);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  return flights;
}
