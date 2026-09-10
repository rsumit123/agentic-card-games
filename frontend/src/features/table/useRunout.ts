import { useEffect, useRef, useState } from 'react';
import type { Card } from '../../domain/cards';
import type { Street } from '../../domain/game';

export interface Runout { cards: Card[]; fresh: number }

const STEP_MS = 620;

/**
 * Deal the board out one card at a time.
 *
 * When everyone is all in, the server runs the flop, turn and river and
 * resolves the hand in a single transition, so the client receives five cards
 * at once. Showing them together throws away the most dramatic moment in
 * poker. This releases them in order and reports how many just landed, so the
 * new ones can be animated and the settled ones left alone.
 */
export function useRunout(cards: Card[], street: Street): Runout {
  const [shown, setShown] = useState(cards.length);
  const [fresh, setFresh] = useState(0);
  const previous = useRef(cards.length);

  useEffect(() => {
    const before = previous.current;
    previous.current = cards.length;

    // A new hand clears the board; snap rather than deal backwards.
    if (cards.length < before) { setShown(cards.length); setFresh(0); return; }
    const gained = cards.length - before;
    if (gained <= 0) return;

    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
    // Three cards arriving together are a flop, and a flop lands as one beat.
    if (reduced || gained <= 3) { setShown(cards.length); setFresh(gained); return; }

    // An all-in runout: flop as one beat, then a card at a time.
    const first = before + 3;
    setShown(first);
    setFresh(3);
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (let at = first + 1; at <= cards.length; at += 1) {
      const target = at;
      timers.push(setTimeout(() => { setShown(target); setFresh(1); }, STEP_MS * (target - first)));
    }
    return () => timers.forEach(clearTimeout);
  }, [cards.length, street]);

  const visible = Math.min(shown, cards.length);
  return { cards: cards.slice(0, visible), fresh: Math.min(fresh, visible) };
}
