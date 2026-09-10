import type { CSSProperties } from 'react';
import type { Card } from '../../domain/cards';
import type { PublicPlayer } from '../../domain/game';
import { PlayingCard } from '../../components/PlayingCard';
import { useCountdown } from './useCountdown';

/** One seat: cards beside the name and stack, so the badge stays short enough
 *  to sit near the rail without reaching the community cards. */
export function SeatBadge({ player, name, isMe, active, holeCards, markers, deadline, side, style }: {
  player: PublicPlayer;
  name: string | null;
  isMe: boolean;
  active: boolean;
  holeCards: Card[] | null;
  markers: string[];
  deadline: string | null;
  side: 'top' | 'bottom';
  style: CSSProperties;
}) {
  const { seconds, fraction } = useCountdown(active ? deadline : null);
  const className = [
    'seat-badge',
    active ? 'seat-active' : '',
    player.folded ? 'seat-folded' : '',
    isMe ? 'seat-me' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={className} style={style} data-seat={player.seat_id} data-side={side} aria-current={active ? 'true' : undefined}>
      <div className="seat-main">
        <div className="seat-cards">
          {holeCards
            ? holeCards.map((card, index) => <PlayingCard key={index} card={card} size={isMe ? 'md' : 'sm'} />)
            : !player.folded && <><PlayingCard back size="sm" /><PlayingCard back size="sm" /></>}
        </div>
        <div className="seat-info">
          <span className="seat-name">{isMe ? 'You' : name ?? `Seat ${player.seat_id}`}</span>
          <span className="seat-stack tabular">{player.stack.toLocaleString()}</span>
          {(player.folded || player.all_in) && (
            <span className="seat-state">{player.folded ? 'folded' : 'all in'}</span>
          )}
          {markers.length > 0 && (
            <span className="seat-markers">{markers.map((label) => <span key={label} className="marker">{label}</span>)}</span>
          )}
        </div>
      </div>

      {player.street_contribution > 0 && (
        <span className="seat-bet tabular" aria-label={`bet ${player.street_contribution}`}>{player.street_contribution}</span>
      )}

      {active && seconds !== null && (
        <span className={`seat-timer ${seconds <= 5 ? 'seat-timer-late' : ''}`} role="timer" aria-label={`${seconds} seconds left for this seat`}>
          <span className="seat-timer-track"><span className="seat-timer-bar" style={{ transform: `scaleX(${fraction})` }} /></span>
          <span className="seat-timer-count tabular">{seconds}s</span>
        </span>
      )}
    </div>
  );
}
