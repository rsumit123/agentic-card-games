import type { SessionSeat } from '../../domain/protocol';

export function SessionLine({ hostUserId, hostSeatNumber, seats, myUserId }: { hostUserId: number | null; hostSeatNumber: number | null; seats: SessionSeat[]; myUserId: number | null }) {
  if (hostUserId === null) return null;
  if (hostUserId === myUserId) return <p className="session-line" aria-live="polite">You are the host</p>;
  const host = seats.find((seat) => seat.seat_number === hostSeatNumber);
  return <p className="session-line" aria-live="polite">{host?.display_name ?? 'Another player'} is the host</p>;
}
