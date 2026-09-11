import type { TableStatus, FinalRanking } from './table';
import type { Action, SeatProjection } from './game';

export interface Command { expected_revision: number; idempotency_key: string; action: Action }
export interface SessionSeat { seat_number: number; display_name: string | null; chip_count: number; spectating: boolean; sitting_out?: boolean }
export interface SessionEvent { type: 'session'; revision: number; status: TableStatus; host_user_id: number | null; seats: SessionSeat[]; final_rankings: FinalRanking[]; pending_leaves?: number[] }
export type ErrorCode = 'stale_revision' | 'invalid_action' | 'invalid_command' | 'persistence_failed';
export type ServerEvent =
  | { type: 'snapshot'; revision: number; payload: SeatProjection; deadline: string | null; recovery_notice: string | null; reveal_deadline?: string | null }
  | { type: 'ack'; revision: number; idempotency_key: string; payload: SeatProjection; deadline: string | null; reveal_deadline?: string | null }
  | { type: 'state'; revision: number; payload: SeatProjection; deadline: string | null; reveal_deadline?: string | null }
  | SessionEvent
  | { type: 'reaction'; seat_number: number; emoji: string }
  | { type: 'error'; code: ErrorCode; message: string; revision: number; idempotency_key: string | null };
