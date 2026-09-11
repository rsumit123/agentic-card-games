import { useState } from 'react';
import type { SeatView, AiTier, AiTierInfo } from '../../domain/table';
import { AiSeatMenu } from './AiSeatMenu';

/** Who is at the table, one row each.
 *
 *  The point of this product is that a person and a language model take the
 *  same seat, so the two read the same way here: a face, a name, what they
 *  are. An empty chair is something to do, not a gap. */
export function SeatGrid({ seats, isHost, hostUserId, busySeat, tiers, onAddAi, onChangeAi, onRemoveAi, onInvite }: {
  seats: SeatView[];
  isHost: boolean;
  hostUserId: number;
  busySeat: number | null;
  tiers: AiTierInfo[];
  onAddAi: (seat: number, tier: AiTier) => void;
  onChangeAi: (seat: number, tier: AiTier) => void;
  onRemoveAi: (seat: number) => void;
  onInvite: () => void;
}) {
  return (
    <ol className="seat-rows" aria-label="Players">
      {seats.map((seat) => {
        const ai = seat.actor_type === 'ai';
        const taken = ai || seat.user_id !== null;
        return (
          <li key={seat.seat_number} className={`seat-row ${taken ? '' : 'seat-row-open'}`}>
            {taken ? (
              <>
                <span className="seat-face" aria-hidden="true">{ai ? '🤖' : (seat.display_name ?? '?').slice(0, 1).toUpperCase()}</span>
                <span className="seat-who">
                  <b>{seat.display_name ?? (ai ? `${seat.ai_tier} player` : `Player ${seat.user_id}`)}</b>
                  <small>{ai ? `${seat.ai_tier} house player` : `Seat ${seat.seat_number}`}</small>
                </span>
                {seat.user_id === hostUserId && <span className="seat-tag">Host</span>}
                {ai && isHost && (
                  <AiSeatMenu tiers={tiers} busy={busySeat === seat.seat_number} label="⋮" compact
                    onPick={(tier) => onChangeAi(seat.seat_number, tier)}
                    onRemove={() => onRemoveAi(seat.seat_number)} />
                )}
              </>
            ) : (
              <>
                <span className="seat-face seat-face-open" aria-hidden="true">＋</span>
                <span className="seat-who"><b>Open seat</b><small>Seat {seat.seat_number}</small></span>
                <span className="seat-open-actions">
                  <button type="button" className="seat-action" onClick={onInvite}>Invite</button>
                  {isHost && <AiSeatMenu tiers={tiers} busy={busySeat === seat.seat_number} label="Add AI"
                    onPick={(tier) => onAddAi(seat.seat_number, tier)} />}
                </span>
              </>
            )}
          </li>
        );
      })}
    </ol>
  );
}

export function useSeatBusy() { return useState<number | null>(null); }
