import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useRunout } from '../../src/features/table/useRunout';
import type { Card } from '../../src/domain/cards';

const deck: Card[] = [
  { rank: 11, suit: 'diamonds' }, { rank: 2, suit: 'diamonds' }, { rank: 10, suit: 'hearts' },
  { rank: 5, suit: 'clubs' }, { rank: 14, suit: 'hearts' },
];

beforeEach(() => {
  vi.useFakeTimers();
  window.matchMedia = ((query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} })) as never;
});

describe('useRunout', () => {
  it('shows a flop as a single beat', () => {
    const { result, rerender } = renderHook(({ cards }) => useRunout(cards, 'flop'), { initialProps: { cards: [] as Card[] } });
    rerender({ cards: deck.slice(0, 3) });
    expect(result.current.cards).toHaveLength(3);
    expect(result.current.fresh).toBe(3);
  });

  it('deals an all-in runout out one card at a time', () => {
    const { result, rerender } = renderHook(({ cards }) => useRunout(cards, 'complete'), { initialProps: { cards: [] as Card[] } });
    rerender({ cards: deck });
    expect(result.current.cards).toHaveLength(3);
    act(() => { vi.advanceTimersByTime(620); });
    expect(result.current.cards).toHaveLength(4);
    expect(result.current.fresh).toBe(1);
    act(() => { vi.advanceTimersByTime(620); });
    expect(result.current.cards).toHaveLength(5);
  });

  it('snaps the whole board when motion is reduced', () => {
    window.matchMedia = ((query: string) => ({ matches: true, media: query, addEventListener() {}, removeEventListener() {} })) as never;
    const { result, rerender } = renderHook(({ cards }) => useRunout(cards, 'complete'), { initialProps: { cards: [] as Card[] } });
    rerender({ cards: deck });
    expect(result.current.cards).toHaveLength(5);
  });

  it('clears instantly when the next hand starts', () => {
    const { result, rerender } = renderHook(({ cards }) => useRunout(cards, 'flop'), { initialProps: { cards: deck } });
    rerender({ cards: [] as Card[] });
    expect(result.current.cards).toHaveLength(0);
  });
});
