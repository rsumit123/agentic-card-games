export type Suit = 'clubs' | 'diamonds' | 'hearts' | 'spades';
export interface Card { rank: number; suit: Suit }

const NAMES: Record<number, string> = { 11: 'Jack', 12: 'Queen', 13: 'King', 14: 'Ace' };
export const rankLabel = (rank: number) => NAMES[rank] ?? String(rank);
export const rankIndex = (rank: number) => ({ 11: 'J', 12: 'Q', 13: 'K', 14: 'A' } as Record<number, string>)[rank] ?? String(rank);
export const cardLabel = (card: Card) => `${rankLabel(card.rank)} of ${card.suit}`;
export const isRed = (suit: Suit) => suit === 'hearts' || suit === 'diamonds';
