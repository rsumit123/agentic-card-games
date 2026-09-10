/* Audit-only fixtures. Drives the mock worker from a ?scenario= query param so
 * states we cannot reach by hand (3/4 seats, side pots, all-in runouts,
 * showdowns) can be inspected and screenshotted. Not shipped logic. */
import type { ServerEvent } from '../domain/protocol';
import type { TableView } from '../domain/table';

type Snapshot = Extract<ServerEvent, { type: 'snapshot' }>;
const c = (rank: number, suit: string) => ({ rank, suit }) as never;
const S = 'spades', H = 'hearts', D = 'diamonds', C = 'clubs';

interface P { seat_id: number; stack: number; folded?: boolean; all_in?: boolean; contribution?: number; street_contribution?: number; has_acted?: boolean }
const player = (p: P) => ({
  seat_id: p.seat_id, stack: p.stack, folded: !!p.folded, all_in: !!p.all_in,
  contribution: p.contribution ?? 0, street_contribution: p.street_contribution ?? 0, has_acted: !!p.has_acted,
});

function snap(over: Record<string, unknown>, hole: unknown[], legal: unknown[], seat = 1, deadline: string | null = null): Snapshot {
  return {
    type: 'snapshot', revision: 0,
    payload: {
      public: {
        street: 'preflop', community_cards: [], pot: 0, current_seat: seat, dealer_seat: 1,
        small_blind_seat: 1, big_blind_seat: 2, small_blind: 5, big_blind: 10,
        current_bet: 10, min_raise: 10, winners: [], payouts: [], showdown: [], actions: [],
        players: [], names: {}, ...over,
      },
      hole_cards: hole, seat_id: seat, legal_actions: legal, hand_rank: null,
    },
    deadline, recovery_notice: null,
  } as unknown as Snapshot;
}

const NAMES4 = { 1: 'You', 2: 'Gemini 3.7 Flash', 3: 'Bea', 4: 'GPT-4o mini' };
const NAMES3 = { 1: 'You', 2: 'Gemini 3.7 Flash', 3: 'Bea' };
const DEADLINE = new Date(Date.now() + 22_000).toISOString();
const LATE = new Date(Date.now() + 4_000).toISOString();

const ACT_FULL = [
  { type: 'fold' }, { type: 'call', amount: 60 },
  { type: 'raise', min_amount: 120, max_amount: 940 }, { type: 'all_in', amount: 940 },
];

export const SCENARIOS: Record<string, { table: Partial<TableView>; snapshot: Snapshot }> = {
  /* Four seats, flop, you to act facing a bet. The layout stress test. */
  'seats4': {
    table: { seat_count: 4 as never },
    snapshot: snap({
      street: 'flop', community_cards: [c(11, D), c(2, D), c(10, H)], pot: 340, current_seat: 1,
      dealer_seat: 3, small_blind_seat: 4, big_blind_seat: 1, current_bet: 60, min_raise: 60,
      names: NAMES4,
      players: [
        player({ seat_id: 1, stack: 940, contribution: 60, street_contribution: 0 }),
        player({ seat_id: 2, stack: 820, contribution: 180, street_contribution: 60, has_acted: true }),
        player({ seat_id: 3, stack: 700, contribution: 60, folded: true, has_acted: true }),
        player({ seat_id: 4, stack: 1180, contribution: 40, street_contribution: 0 }),
      ],
    }, [c(14, S), c(13, S)], ACT_FULL, 1, DEADLINE),
  },

  /* Three seats, turn, waiting on an AI seat. Shows the dead "waiting" state. */
  'seats3-waiting': {
    table: { seat_count: 3 as never },
    snapshot: snap({
      street: 'turn', community_cards: [c(11, D), c(2, D), c(10, H), c(5, C)], pot: 620, current_seat: 2,
      dealer_seat: 1, small_blind_seat: 2, big_blind_seat: 3, current_bet: 120, min_raise: 120,
      names: NAMES3,
      players: [
        player({ seat_id: 1, stack: 640, contribution: 360, street_contribution: 120, has_acted: true }),
        player({ seat_id: 2, stack: 880, contribution: 240, street_contribution: 0 }),
        player({ seat_id: 3, stack: 480, contribution: 360, street_contribution: 120, has_acted: true }),
      ],
    }, [c(14, S), c(13, S)], [], 1, DEADLINE),
  },

  /* Timer about to expire on your turn. */
  'urgent': {
    table: { seat_count: 3 as never },
    snapshot: snap({
      street: 'flop', community_cards: [c(11, D), c(2, D), c(10, H)], pot: 340, current_seat: 1,
      names: NAMES3, dealer_seat: 3, small_blind_seat: 1, big_blind_seat: 2,
      players: [
        player({ seat_id: 1, stack: 940, contribution: 60 }),
        player({ seat_id: 2, stack: 820, contribution: 180, street_contribution: 60, has_acted: true }),
        player({ seat_id: 3, stack: 700, contribution: 60, folded: true, has_acted: true }),
      ],
    }, [c(14, S), c(13, S)], ACT_FULL, 1, LATE),
  },

  /* Three-way all-in with side pots. The UI only knows one pot number. */
  'sidepot': {
    table: { seat_count: 3 as never },
    snapshot: snap({
      street: 'turn', community_cards: [c(11, D), c(2, D), c(10, H), c(5, C)], pot: 1480, current_seat: 1,
      names: NAMES3, dealer_seat: 1, small_blind_seat: 2, big_blind_seat: 3,
      current_bet: 700, min_raise: 700,
      pots: [
        { amount: 1140, eligible_seats: [1, 2, 3] },
        { amount: 340, eligible_seats: [1, 3] },
      ],
      players: [
        player({ seat_id: 1, stack: 700, contribution: 400, street_contribution: 0 }),
        player({ seat_id: 2, stack: 0, all_in: true, contribution: 380, street_contribution: 380, has_acted: true }),
        player({ seat_id: 3, stack: 0, all_in: true, contribution: 700, street_contribution: 700, has_acted: true }),
      ],
    }, [c(14, S), c(13, S)], [{ type: 'fold' }, { type: 'call', amount: 700 }, { type: 'all_in', amount: 700 }], 1, DEADLINE),
  },

  /* Showdown, three players, split-free single winner. */
  'showdown': {
    table: { seat_count: 3 as never },
    snapshot: snap({
      street: 'complete', community_cards: [c(11, D), c(2, D), c(10, H), c(5, C), c(14, H)], pot: 0,
      current_seat: null, names: NAMES3, dealer_seat: 1, small_blind_seat: 2, big_blind_seat: 3,
      winners: [1], payouts: [[1, 1480]],
      showdown: [
        { seat_id: 1, hole_cards: [c(14, S), c(13, S)], category: 'pair', best_five: [c(14, S), c(14, H), c(13, S), c(11, D), c(10, H)] },
        { seat_id: 2, hole_cards: [c(9, C), c(9, H)], category: 'pair', best_five: [c(9, C), c(9, H), c(14, H), c(11, D), c(10, H)] },
        { seat_id: 3, hole_cards: [c(11, S), c(4, C)], category: 'pair', best_five: [c(11, S), c(11, D), c(14, H), c(10, H), c(5, C)] },
      ],
      players: [
        player({ seat_id: 1, stack: 1480, contribution: 500 }),
        player({ seat_id: 2, stack: 0, contribution: 500, all_in: true }),
        player({ seat_id: 3, stack: 520, contribution: 480 }),
      ],
    }, [c(14, S), c(13, S)], [], 1, null),
  },

  /* Uncontested win: everyone folded, nothing shown. */
  'uncontested': {
    table: { seat_count: 2 as never },
    snapshot: snap({
      street: 'complete', community_cards: [], pot: 0, current_seat: null,
      names: { 1: 'You', 2: 'Gemini 3.7 Flash' }, dealer_seat: 1, small_blind_seat: 1, big_blind_seat: 2,
      winners: [1], payouts: [[1, 20]], showdown: [],
      players: [
        player({ seat_id: 1, stack: 1010, contribution: 10 }),
        player({ seat_id: 2, stack: 990, folded: true, contribution: 10 }),
      ],
    }, [c(14, S), c(13, S)], [], 1, null),
  },
};

export function currentScenario(): string | null {
  const value = new URLSearchParams(window.location.search).get('scenario');
  return value && value in SCENARIOS ? value : null;
}
