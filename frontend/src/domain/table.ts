export type TableStatus = 'lobby' | 'in_progress' | 'ended' | 'cancelled';
export type AiTier = 'Easy' | 'Medium' | 'Hard';
export interface SeatView {
  seat_number: number; user_id: number | null; actor_type: 'human' | 'ai'; ai_tier: AiTier | null;
  chip_count: number; display_name: string | null; spectating: boolean;
}
export interface TableView {
  id: number; room_code: string | null; host_user_id: number; seat_count: 2 | 3 | 4;
  starting_chips: 1000 | 5000 | 10000; small_blind: 5 | 10 | 25; big_blind: number;
  status: TableStatus; join_expires_at: string | null; seats: SeatView[];
  final_rankings: FinalRanking[];
}
export interface FinalRanking { seat_number: number; display_name: string | null; chip_count: number }
