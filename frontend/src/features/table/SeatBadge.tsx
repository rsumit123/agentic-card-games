import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { Card } from '../../domain/cards';
import type { PublicPlayer } from '../../domain/game';
import { PlayingCard } from '../../components/PlayingCard';
import { useCountdown } from './useCountdown';

/** One seat at the table.
 *
 *  Your own chair is wide, with cards big enough to read at arm's length.
 *  Opponents are a narrow vertical token, because two of them have to sit
 *  side by side on a felt that is only about 320px wide in portrait. */
export function SeatBadge({ player, name, isMe, active, thinking, isAi, reaction, said, holeCards, revealed, markers, winningCards = null, deadline, side, lane = 'up', won, style }: {
  player: PublicPlayer;
  name: string | null;
  isMe: boolean;
  active: boolean;
  thinking?: boolean;
  isAi?: boolean;
  reaction?: string | null;
  said?: string | null;
  holeCards: Card[] | null;
  revealed?: Card[] | null;
  markers: string[];
  winningCards?: Set<string> | null;
  deadline: string | null;
  side: 'top' | 'bottom';
  lane?: 'up' | 'down' | 'left' | 'right';
  won?: boolean;
  style: CSSProperties;
}) {
  const { seconds, fraction } = useCountdown(active ? deadline : null);
  const cards = holeCards ?? revealed ?? null;
  // A fold used to make two cards vanish between frames. They now go where
  // folded cards go: face down, towards the middle.
  const mucking = useMuck(player.folded);
  // Chips land on a stack; they do not teleport onto it.
  const stack = useCountTo(player.stack);
  const className = [
    'seat-badge',
    isMe ? 'seat-hero' : 'seat-opponent',
    active ? 'seat-active' : '',
    player.folded ? 'seat-folded' : '',
    won ? 'seat-won' : '',
  ].filter(Boolean).join(' ');

  const label = isMe ? 'You' : name ?? `Seat ${player.seat_id}`;
  const state = player.folded ? 'folded' : player.all_in ? 'all in' : null;

  return (
    <div
      className={className}
      style={style}
      data-seat={player.seat_id}
      data-side={side}
      data-lane={lane}
      role="group"
      aria-label={`${label}, ${player.stack.toLocaleString()} chips${state ? `, ${state}` : ''}${active ? ', to act' : ''}`}
    >
      <div className="seat-main">
        <div className="seat-cards">
          {mucking && <span className="seat-muck" aria-hidden="true"><PlayingCard back size={isMe ? 'lg' : 'sm'} /><PlayingCard back size={isMe ? 'lg' : 'sm'} /></span>}
          {cards
            ? cards.map((card, index) => <PlayingCard key={index} card={card} size={isMe ? 'lg' : 'sm'}
              highlight={!!winningCards?.has(`${card.rank}${card.suit}`)}
              dim={!!winningCards && !winningCards.has(`${card.rank}${card.suit}`)} />)
            : !player.folded && <><PlayingCard back size={isMe ? 'lg' : 'sm'} /><PlayingCard back size={isMe ? 'lg' : 'sm'} /></>}
        </div>
        <div className="seat-info">
          <span className="seat-name">
            {!isMe && <span className="seat-avatar" aria-hidden="true">{isAi ? '🤖' : label.slice(0, 1).toUpperCase()}</span>}
            <span className="seat-name-text">{label}</span>
          </span>
          <span className="seat-stack tabular">{stack.toLocaleString()}</span>
          {state && <span className="seat-state">{state}</span>}
        </div>
      </div>

      {said && <span className="seat-said" aria-hidden="true">{said}</span>}

      {reaction && <span className="seat-reaction" aria-hidden="true">{reaction}</span>}

      {markers.length > 0 && (
        <span className="seat-markers">{markers.map((marker) => <span key={marker} className="marker">{marker}</span>)}</span>
      )}

      {player.street_contribution > 0 && (
        <span className="seat-bet tabular" aria-label={`bet ${player.street_contribution}`}>{player.street_contribution}</span>
      )}

      {/* Somebody is always to act. Saying who, and showing that an AI seat is
          working rather than stuck, is the difference between a pause and a
          hang. */}
      {thinking && !active && <span className="seat-thinking" aria-hidden="true"><i /><i /><i /></span>}

      {active && seconds !== null && !isMe && (
        <span className={`seat-timer ${seconds <= 5 ? 'seat-timer-late' : ''}`} role="timer" aria-label={`${seconds} seconds left for this seat`}>
          <span className="seat-timer-track"><span className="seat-timer-bar" style={{ transform: `scaleX(${fraction})` }} /></span>
          <span className="seat-timer-count tabular">{seconds}s</span>
        </span>
      )}
      {active && thinking && <span className="seat-thinking seat-thinking-inline" aria-hidden="true"><i /><i /><i /></span>}
    </div>
  );
}


/** Count a stack up to a pot it has just won, over about a third of a second.
 *
 *  Only upwards, and only for a jump worth watching: chips leaving for the pot
 *  are already drawn as chips crossing the felt. */
function useCountTo(target: number) {
  const [shown, setShown] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    const start = from.current;
    from.current = target;
    const gain = target - start;
    if (gain <= 0 || gain < 25 || window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) {
      setShown(target);
      return;
    }
    const began = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const through = Math.min(1, (now - began) / 380);
      // Fast at first, settling onto the number.
      setShown(Math.round(start + gain * (1 - (1 - through) ** 3)));
      if (through < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [target]);
  return shown;
}

/** True for the third of a second after a seat folds. */
function useMuck(folded: boolean) {
  const previous = useRef(folded);
  const [mucking, setMucking] = useState(false);
  useEffect(() => {
    if (previous.current === folded) return;
    previous.current = folded;
    if (!folded) return;
    setMucking(true);
    const timer = setTimeout(() => setMucking(false), 380);
    return () => clearTimeout(timer);
  }, [folded]);
  return mucking;
}
