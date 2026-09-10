import type { Card } from './cards';

export type Street = 'preflop' | 'flop' | 'turn' | 'river' | 'complete';
export interface PublicPlayer {
  seat_id: number; stack: number; folded: boolean; all_in: boolean;
  contribution: number; street_contribution: number; has_acted: boolean;
}
/** One action somebody took this hand. Public: everyone watched it happen. */
export interface TableAction { seat_id: number; street: Street; type: string; amount: number | null }

/** Cards turned face up at the end of a contested hand. */
export interface ShowdownHand { seat_id: number; hole_cards: Card[]; category?: string }

/** The engine's category names, said the way a dealer would say them. */
export const HAND_CATEGORY_LABELS: Record<string, string> = {
  high_card: 'high card',
  pair: 'a pair',
  two_pair: 'two pair',
  three_kind: 'three of a kind',
  straight: 'a straight',
  flush: 'a flush',
  full_house: 'a full house',
  four_kind: 'four of a kind',
  straight_flush: 'a straight flush',
};

export interface PublicState {
  street: Street; community_cards: Card[]; pot: number; current_seat: number | null;
  dealer_seat: number; small_blind_seat: number; big_blind_seat: number;
  small_blind: number; big_blind: number; current_bet: number; min_raise: number;
  winners: number[]; payouts: [number, number][]; players: PublicPlayer[];
  showdown: ShowdownHand[];
  actions: TableAction[];
  names: Record<number, string | null>;
}
export type LegalAction =
  | { type: 'fold' } | { type: 'check' }
  | { type: 'call'; amount: number }
  | { type: 'bet'; min_amount: number; max_amount: number }
  | { type: 'raise'; min_amount: number; max_amount: number }
  | { type: 'all_in'; amount: number };
export interface SeatProjection {
  public: PublicState; hole_cards: Card[]; seat_id: number;
  legal_actions: LegalAction[];
  hand_rank: { category: string; tiebreakers: number[] } | null;
}
export type Action =
  | { type: 'fold' | 'check' | 'call' | 'all_in' }
  | { type: 'bet' | 'raise'; amount: number };
