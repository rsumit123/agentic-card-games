import { useEffect, useRef, useState } from 'react';
import type { SeatProjection } from '../../domain/game';
import { PlayingCard } from '../../components/PlayingCard';
import { Chip } from '../../components/Chip';
import { SeatBadge } from './SeatBadge';
import { seatPositions } from './seatLayout';
import { ChipFlight, type Flight } from './ChipFlight';
import './table.css';

export function Felt({ projection, deadline = null }: { projection: SeatProjection; deadline?: string | null }) {
  const { public: pub, seat_id: me, hole_cards } = projection;
  const positions = seatPositions(pub.players.map((player) => player.seat_id), me);
  const flights = useChipFlights(pub.players.map((player) => ({ seat: player.seat_id, bet: player.street_contribution })), positions);
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
  return <section className="felt-wrap" aria-label="Table">
    <div className="felt">
      <div className="pot"><span>Pot</span><Chip amount={pub.pot} /></div>
      <div className="community" aria-label="Community cards">{pub.community_cards.map((card, index) => <PlayingCard key={`${card.rank}${card.suit}${index}`} card={card} size="md" />)}</div>
      {pub.players.map((player) => <SeatBadge key={player.seat_id} player={player} name={pub.names[player.seat_id] ?? null} isMe={player.seat_id === me} active={pub.current_seat === player.seat_id}
        holeCards={player.seat_id === me ? hole_cards : null} markers={markersBySeat.get(player.seat_id) ?? []} deadline={deadline}
        side={positions[player.seat_id].y < 50 ? 'top' : 'bottom'} style={{ left: `${positions[player.seat_id].x}%`, top: `${positions[player.seat_id].y}%` }} />)}
      {flights.map((flight) => <ChipFlight key={flight.id} flight={flight} />)}
    </div>
  </section>;
}

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
