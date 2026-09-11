#!/usr/bin/env python3
"""Measure whether an AI seat can tell a maniac from an honest player.

A human beat every LLM seat at this table by betting every street of every
hand with any two cards. The seats folded almost every hand and lost only
their blinds, hand after hand, because each decision was made from one hand's
action log with no memory of the ten before it.

This probe runs the real engine and the real adapter against two scripted
opponents:

  maniac  bets or raises the pot on every turn, whatever it holds
  honest  bets or raises only with a pair or better, and otherwise checks or folds

SUCCESS CRITERION
-----------------
After the fix the AI seat should fold LESS often when facing a bet from the
maniac than it did before, WITHOUT folding less against the honest player. If
its fold rate collapses against both, the read is not conditional: it has
simply started calling everything, which is a new leak rather than a fix.

Usage
-----
  python3 scripts/probe_aggression.py --stub
  python3 scripts/probe_aggression.py --tier Hard --model openai/gpt-4o-mini

The OpenRouter key is read from OPENROUTER_API_KEY; without one, and without
--stub, the script says so and exits rather than crashing. --stub proves the
plumbing only: the fake is not a poker player, so read its chip counts as
"the reads arrived and were acted on", never as a measure of play.
"""
from __future__ import annotations

import argparse
import asyncio
import os
import random
import sys
from dataclasses import replace
from datetime import timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.ai.adapter import AIAdapter  # noqa: E402
from app.ai.policy import policy_for_tier  # noqa: E402
from app.ai.prompt import describe_table, system_prompt  # noqa: E402
from app.games.holdem.engine import start_hand  # noqa: E402
from app.games.holdem.evaluator import best_hand  # noqa: E402
from app.rooms.actor import RoomActor  # noqa: E402
from app.rooms.manager import RoomManager  # noqa: E402
from app.rooms.protocol import Ack  # noqa: E402

TABLE_ID = 1
AI_SEAT = 1
OPPONENT_SEAT = 2
STARTING_CHIPS = 1000
SMALL_BLIND = 5
BIG_BLIND = 10


def _by_type(legal):
    return {action["type"]: action for action in legal}


def maniac(state, legal):
    """Bet the pot every single turn, with any two cards."""
    actions = _by_type(legal)
    for kind in ("raise", "bet"):
        if kind in actions:
            bounds = actions[kind]
            target = state.current_bet + max(state.pot, state.big_blind)
            return {
                "type": kind,
                "amount": int(min(bounds["max_amount"], max(bounds["min_amount"], target))),
            }
    if "all_in" in actions:
        return {"type": "all_in"}
    if "call" in actions:
        return {"type": "call", "amount": actions["call"]["amount"]}
    return {"type": "check"}


def _has_a_pair_or_better(state, seat_id) -> bool:
    player = state.player(seat_id)
    cards = player.hole_cards + state.community_cards
    if len(cards) >= 5:
        rank, _ = best_hand(cards)
        return rank.category >= 1
    return player.hole_cards[0].rank == player.hole_cards[1].rank


def honest(state, legal):
    """Value only: bet or raise with a pair or better, otherwise check or fold."""
    actions = _by_type(legal)
    strong = _has_a_pair_or_better(state, OPPONENT_SEAT)
    if strong:
        for kind in ("raise", "bet"):
            if kind in actions:
                bounds = actions[kind]
                target = state.current_bet + max(state.pot // 2, state.big_blind)
                return {
                    "type": kind,
                    "amount": int(min(bounds["max_amount"], max(bounds["min_amount"], target))),
                }
        if "call" in actions:
            return {"type": "call", "amount": actions["call"]["amount"]}
    if "check" in actions:
        return {"type": "check"}
    return {"type": "fold"}


OPPONENTS = {"maniac": maniac, "honest": honest}


class StubProvider:
    """A deterministic stand-in for OpenRouter, so the plumbing can be tested offline.

    It walks the same path the real provider does — the system prompt and the
    table description, policy and all — and then plays the read: it folds to
    bets from a selective opponent and calls down someone who bets constantly.
    """

    def __init__(self) -> None:
        self.prompts: list[str] = []

    async def complete(self, projection, legal_schema, policy):
        actions = list(legal_schema.get("actions", ()))
        self.prompts.append(
            system_prompt(policy) + "\n\n" + describe_table(projection, actions, policy=policy)
        )
        available = _by_type(actions)
        reads = projection.get("opponent_reads") or {}
        wild = policy.sees_reads and any(
            int(read.get("hands", 0)) >= 5 and int(read.get("aggression_pct", 0)) >= 60
            for read in reads.values()
        )
        if "check" in available:
            return {"reasoning": "nothing to call", "action": {"type": "check"}}
        if wild and "call" in available:
            return {"reasoning": "they bet every hand", "action": {"type": "call", "amount": available["call"]["amount"]}}
        return {"reasoning": "facing a bet with little", "action": {"type": "fold"}}


async def _play_hand(manager: RoomManager, actor: RoomActor, script) -> None:
    stalled = 0
    while actor.state.street != "complete" and stalled < 400:
        seat_id = actor.state.current_seat
        if seat_id is None:
            break
        if seat_id == AI_SEAT:
            revision = actor.revision
            await manager.run_once(TABLE_ID)
            stalled = 0 if actor.revision != revision else stalled + 1
            if stalled:
                await asyncio.sleep(0.05)
            continue
        legal = actor.module.legal_actions(actor.state, seat_id)
        result = manager.submit(
            TABLE_ID,
            seat_id,
            {
                "expected_revision": actor.revision,
                "idempotency_key": f"{actor.state.hand_number}:{actor.revision}",
                "action": script(actor.state, legal),
            },
        )
        if not isinstance(result, Ack):
            raise RuntimeError(f"scripted opponent was rejected: {result}")
        stalled = 0


async def run_matchup(name: str, adapter, hands: int, seed: int) -> dict[str, object]:
    script = OPPONENTS[name]
    rng = random.Random(seed)
    manager = RoomManager()
    state = start_hand(
        {AI_SEAT: STARTING_CHIPS, OPPONENT_SEAT: STARTING_CHIPS},
        small_blind=SMALL_BLIND,
        big_blind=BIG_BLIND,
        random_bytes=bytes(rng.randrange(256) for _ in range(1024)),
    )
    actor = RoomActor(TABLE_ID, state, action_timeout=timedelta(seconds=5))
    manager.register(TABLE_ID, actor)
    manager.register_ai(TABLE_ID, AI_SEAT, adapter)

    net = 0
    for hand_number in range(1, hands + 1):
        await _play_hand(manager, actor, script)
        net += actor.state.player(AI_SEAT).stack - STARTING_CHIPS
        if hand_number == hands:
            break
        # Stacks are reset every hand so a bust cannot cut the sample short and
        # the two matchups stay comparable.
        actor.begin_hand(
            start_hand(
                {AI_SEAT: STARTING_CHIPS, OPPONENT_SEAT: STARTING_CHIPS},
                dealer_seat=actor.state.dealer_seat + 1,
                small_blind=SMALL_BLIND,
                big_blind=BIG_BLIND,
                hand_number=hand_number + 1,
                random_bytes=bytes(rng.randrange(256) for _ in range(1024)),
            )
        )

    read = manager.opponent_reads(TABLE_ID, OPPONENT_SEAT).get(AI_SEAT, {})
    counters = manager._opponent_reads[TABLE_ID].get(AI_SEAT, {})
    return {
        "opponent": name,
        "hands": read.get("hands", 0),
        "decisions": counters.get("decisions", 0),
        "faced_bet": counters.get("faced_bet", 0),
        "folded_to_bet": counters.get("folded_to_bet", 0),
        "fold_rate_facing_a_bet": read.get("fold_to_bet_pct", 0),
        "net_chips": net,
    }


def _report(rows: list[dict[str, object]]) -> None:
    print()
    print(f"{'opponent':10} {'hands':>6} {'decisions':>10} {'faced bet':>10} {'folded':>7} {'fold %':>7} {'net chips':>10}")
    for row in rows:
        print(
            f"{row['opponent']:10} {row['hands']:>6} {row['decisions']:>10} {row['faced_bet']:>10} "
            f"{row['folded_to_bet']:>7} {row['fold_rate_facing_a_bet']:>7} {row['net_chips']:>10}"
        )
    by_name = {row["opponent"]: row for row in rows}
    maniac_fold = by_name["maniac"]["fold_rate_facing_a_bet"]
    honest_fold = by_name["honest"]["fold_rate_facing_a_bet"]
    print()
    print(f"Folds to the maniac {maniac_fold}% of the time, to the honest player {honest_fold}%.")
    if maniac_fold < honest_fold:
        print("The read is conditional: it gives the constant bettor less credit than the selective one.")
    elif maniac_fold == honest_fold:
        print("No difference between the two. The seat is not reading the opponent at all.")
    else:
        print("It folds MORE to the maniac. The leak that motivated this probe is still open.")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--tier", default="Hard", help="Easy, Medium or Hard (default: Hard)")
    parser.add_argument("--model", default=None, help="override the tier's model, e.g. openai/gpt-4o-mini")
    parser.add_argument("--hands", type=int, default=20, help="hands per matchup (default: 20)")
    parser.add_argument("--seed", type=int, default=20260101, help="fixed seed, so a run is repeatable")
    parser.add_argument("--stub", action="store_true", help="use a deterministic fake instead of a provider")
    args = parser.parse_args(argv)

    try:
        policy = policy_for_tier(args.tier)
    except ValueError as exc:
        print(f"{exc}. Pick one of Easy, Medium or Hard.")
        return 2
    if args.model:
        policy = replace(policy, model_pool=(args.model,))

    if args.stub:
        provider = StubProvider()
    else:
        key = os.environ.get("OPENROUTER_API_KEY")
        if not key:
            print(
                "No OPENROUTER_API_KEY in the environment, so there is no model to ask.\n"
                "Set the key, or run with --stub to exercise the probe itself offline."
            )
            return 1
        from app.ai.openrouter import OpenRouterProvider

        provider = OpenRouterProvider(key)

    print(f"tier {policy.tier}, model {policy.model_pool[0]}, {args.hands} hands per opponent, seed {args.seed}")
    rows = []
    for name in ("maniac", "honest"):
        adapter = AIAdapter(provider, policy)
        rows.append(asyncio.run(run_matchup(name, adapter, args.hands, args.seed)))
    _report(rows)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
