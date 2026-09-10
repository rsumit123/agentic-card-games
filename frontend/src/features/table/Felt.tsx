import type { SeatProjection } from '../../domain/game';
import { PlayingCard } from '../../components/PlayingCard';
import { Chip } from '../../components/Chip';
import { SeatBadge } from './SeatBadge';
import { seatPositions } from './seatLayout';
import './table.css';

export function Felt({ projection }: { projection: SeatProjection }) {
  const { public: pub, seat_id: me, hole_cards } = projection;
  const positions = seatPositions(pub.players.map((player) => player.seat_id), me);
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
        holeCards={player.seat_id === me ? hole_cards : null} markers={markersBySeat.get(player.seat_id) ?? []} style={{ left: `${positions[player.seat_id].x}%`, top: `${positions[player.seat_id].y}%` }} />)}
    </div>
  </section>;
}
