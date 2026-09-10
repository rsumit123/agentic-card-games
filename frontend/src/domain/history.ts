export interface HandTotals { played: number; won: number; win_rate: number; net_chips: number; showdowns: number }
export interface SessionTotals { played: number; won: number; win_rate: number }
export interface OpponentRecord { opponent: string; hands: number; won: number; win_rate: number; net_chips: number }
export interface RecentHand {
  table_id: number;
  won: boolean;
  net_chips: number;
  opponents: string[];
  showdown: boolean;
  at: string | null;
}
export interface PlayerHistory {
  hands: HandTotals;
  sessions: SessionTotals;
  opponents: OpponentRecord[];
  recent: RecentHand[];
}
