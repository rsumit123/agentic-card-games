import type { CSSProperties } from 'react';
import type { Card } from '../../domain/cards';
import type { PublicPlayer } from '../../domain/game';
import { PlayingCard } from '../../components/PlayingCard';
import { useCountdown } from './useCountdown';

export function SeatBadge({ player, name, isMe, active, holeCards, markers, deadline, style }: { player: PublicPlayer; name: string | null; isMe: boolean; active: boolean; holeCards: Card[] | null; markers: string[]; deadline: string | null; style: CSSProperties }) {
  const { seconds, fraction } = useCountdown(active ? deadline : null);
  const className = ['seat-badge', active ? 'seat-active' : '', player.folded ? 'seat-folded' : '', isMe ? 'seat-me' : ''].join(' ');
  return <div className={className} style={style} data-seat={player.seat_id} aria-current={active ? 'true' : undefined}>
    <div className="seat-cards">{holeCards ? holeCards.map((card, index) => <PlayingCard key={index} card={card} size={isMe ? 'lg' : 'sm'} />) : !player.folded && <><PlayingCard back size="sm" /><PlayingCard back size="sm" /></>}</div>
    <div className="seat-name">{isMe ? 'You' : name ?? `Seat ${player.seat_id}`}{player.all_in && ' · all-in'}{player.folded && ' · folded'}</div>
    <div className="seat-stack tabular">{player.stack.toLocaleString()}</div>
    {player.street_contribution > 0 && <div className="seat-bet tabular">{player.street_contribution}</div>}
    {markers.length > 0 && <div className="seat-markers">{markers.map((label) => <span key={label} className="marker">{label}</span>)}</div>}
    {active && seconds !== null && (
      <div className={`seat-timer ${seconds <= 5 ? 'seat-timer-late' : ''}`} role="timer" aria-label={`${seconds} seconds left for this seat`}>
        <span className="seat-timer-bar" style={{ transform: `scaleX(${fraction})` }} />
        <span className="seat-timer-count tabular">{seconds}s</span>
      </div>
    )}
  </div>;
}
