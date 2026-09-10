"""Turn a seat projection into something a language model can actually read.

The first version handed the model raw JSON with cards as {"rank": 14,
"suit": "spades"} and a one-line instruction to answer with an action. It
played every hand the same way: raise, raise, raise, all-in, regardless of
its cards. Describing the spot in poker's own words, and saying what good
play looks like, is what makes the reply worth trusting.
"""
from __future__ import annotations

from typing import Any, Mapping

RANK_NAMES = {11: "J", 12: "Q", 13: "K", 14: "A"}
SUIT_GLYPHS = {"spades": "s", "hearts": "h", "diamonds": "d", "clubs": "c"}
STREET_NAMES = {"preflop": "preflop", "flop": "the flop", "turn": "the turn", "river": "the river"}


def _field(card: Any, name: str) -> Any:
    if isinstance(card, Mapping):
        return card.get(name)
    return getattr(card, name, None)


def describe_card(card: Any) -> str:
    rank = _field(card, "rank")
    suit = _field(card, "suit")
    return f"{RANK_NAMES.get(rank, rank)}{SUIT_GLYPHS.get(suit, suit)}"


def describe_cards(cards: Any) -> str:
    rendered = " ".join(describe_card(card) for card in cards or ())
    return rendered or "none yet"


def describe_action(action: Mapping[str, Any]) -> str:
    kind = action.get("type")
    if "amount" in action and kind in {"call", "all_in"}:
        return f"{kind} {action['amount']}"
    if "min_amount" in action:
        return f"{kind} to any total between {action['min_amount']} and {action['max_amount']}"
    return str(kind)


def describe_table(projection: Mapping[str, Any], legal_actions: list[Mapping[str, Any]]) -> str:
    public = projection.get("public", {})
    seat_id = projection.get("seat_id")
    me = next((player for player in public.get("players", ()) if player.get("seat_id") == seat_id), {})
    to_call = max(0, int(public.get("current_bet", 0)) - int(me.get("street_contribution", 0)))

    opponents = [
        f"seat {player['seat_id']} has {player['stack']} chips"
        + (f", {player['street_contribution']} in front" if player.get("street_contribution") else "")
        + (" (folded)" if player.get("folded") else " (all in)" if player.get("all_in") else "")
        for player in public.get("players", ())
        if player.get("seat_id") != seat_id
    ]

    lines = [
        f"You are seat {seat_id}. Your cards: {describe_cards(projection.get('hole_cards'))}.",
        f"Street: {STREET_NAMES.get(public.get('street'), public.get('street'))}.",
        f"Board: {describe_cards(public.get('community_cards'))}.",
        f"Pot: {public.get('pot')}. Your stack: {me.get('stack')}. To call: {to_call}.",
        f"Big blind: {public.get('big_blind')}. Smallest legal raise increment: {public.get('min_raise')}.",
    ]
    if opponents:
        lines.append("Opponents: " + "; ".join(opponents) + ".")
    rank = projection.get("hand_rank")
    if rank:
        lines.append(f"Your current best five-card hand: {rank.get('category')}.")
    lines.append("Legal actions: " + "; ".join(describe_action(action) for action in legal_actions) + ".")
    return "\n".join(lines)


BASE_RULES = """You are playing no-limit Texas Hold'em for play money. Weigh your hand
strength, the board, the pot odds and what your opponent's betting says, then pick exactly
one of the legal actions.

How to play well:
- Fold weak hands instead of calling or raising, especially when facing a large bet.
- Raising needs a reason: a strong made hand, a strong draw, or a real chance to fold out
  something better. Do not raise on every street by reflex.
- A bet or raise amount is the total you are raising TO for this street, not an increment.
- All-in is for very strong hands or a short stack, not a default move.
- Checking and calling are fine when your hand is playable but not strong."""

REPLY_FORMAT = """Reply with JSON only, no prose outside it:
{"reasoning": "<one short sentence explaining the choice>",
 "action": {"type": "<one of the legal action types>", "amount": <chips, only when that legal action carries an amount>}}"""


def system_prompt(policy) -> str:
    guidance = getattr(policy, "guidance", "") or ""
    parts = [BASE_RULES]
    if guidance:
        parts.append(f"Your style: {guidance}")
    parts.append(REPLY_FORMAT)
    return "\n\n".join(parts)
