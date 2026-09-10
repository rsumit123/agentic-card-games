import type { SeatView, AiTier, AiTierInfo } from '../../domain/table';
import { AiSeatMenu } from './AiSeatMenu';

export function SeatGrid({ seats, isHost, busySeat, tiers, onAddAi }: {
  seats: SeatView[]; isHost: boolean; busySeat: number | null; tiers: AiTierInfo[]; onAddAi: (seat: number, tier: AiTier) => void;
}) {
  return (
    <ol className="seat-grid" aria-label="Seats">
      {seats.map((seat) => {
        const empty = seat.user_id === null && seat.actor_type !== 'ai';
        return (
          <li key={seat.seat_number} className={`seat ${empty ? 'seat-empty' : ''}`}>
            <span className="seat-number">Seat {seat.seat_number}</span>
            {seat.actor_type === 'ai' ? (
              <>
                <span>{seat.display_name ?? `${seat.ai_tier} player`}</span>
                <span className="seat-sub" title={seat.model ?? undefined}>{seat.ai_tier} house player</span>
              </>
            ) : seat.user_id !== null ? (
              <span>{seat.display_name ?? `Player ${seat.user_id}`}</span>
            ) : (
              <span className="muted">Open seat</span>
            )}
            {empty && isHost && <AiSeatMenu tiers={tiers} busy={busySeat === seat.seat_number} onPick={(tier) => onAddAi(seat.seat_number, tier)} />}
          </li>
        );
      })}
    </ol>
  );
}
