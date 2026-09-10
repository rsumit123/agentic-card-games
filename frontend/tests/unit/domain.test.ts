import { describe, it, expect } from 'vitest';
import snapshot from '../fixtures/snapshot.json';
import type { ServerEvent } from '../../src/domain/protocol';
import { cardLabel } from '../../src/domain/cards';

describe('domain types', () => {
  it('accepts the backend snapshot fixture as a ServerEvent', () => {
    const event = snapshot as ServerEvent;
    expect(event.type).toBe('snapshot');
    if (event.type === 'snapshot') {
      expect(event.payload.hole_cards).toHaveLength(2);
      expect(event.payload.public.players[0].street_contribution).toBeTypeOf('number');
    }
  });
  it('labels cards for screen readers', () => {
    expect(cardLabel({ rank: 14, suit: 'spades' })).toBe('Ace of spades');
    expect(cardLabel({ rank: 10, suit: 'hearts' })).toBe('10 of hearts');
  });
});
