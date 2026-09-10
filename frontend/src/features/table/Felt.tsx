import type { SeatProjection } from '../../domain/game';
import { PlayingCard } from '../../components/PlayingCard';
import { Chip } from '../../components/Chip';
import { SeatBadge } from './SeatBadge';
import { seatPositions } from './seatLayout';
import './table.css';

export function Felt({ projection }: { projection: SeatProjection }) {
  const { public: pub, seat_id: me, hole_cards } = projection;
  const positions = seatPositions(pub.players.map((player) => player.seat_id), me);
  const marker = (seat: number, text: string) => {
    const position = positions[seat];
    return <span key={text} className="marker" style={{ left: `${position.x}%`, top: `${position.y > 50 ? position.y - 18 : position.y + 18}%` }}>{text}</span>;
  };
  return <section className="felt-wrap" aria-label="Table">
    <div className="felt">
      <div className="pot"><span>Pot</span><Chip amount={pub.pot} /></div>
      <div className="community" aria-label="Community cards">{pub.community_cards.map((card, index) => <PlayingCard key={`${card.rank}${card.suit}${index}`} card={card} size="md" />)}</div>
      {pub.players.map((player) => <SeatBadge key={player.seat_id} player={player} name={pub.names[player.seat_id] ?? null} isMe={player.seat_id === me} active={pub.current_seat === player.seat_id}
        holeCards={player.seat_id === me ? hole_cards : null} style={{ left: `${positions[player.seat_id].x}%`, top: `${positions[player.seat_id].y}%` }} />)}
      {marker(pub.dealer_seat, 'D')}{marker(pub.small_blind_seat, 'SB')}{marker(pub.big_blind_seat, 'BB')}
    </div>
  </section>;
}
