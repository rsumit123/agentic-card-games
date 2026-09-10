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


VERBS = {
    "fold": "folded",
    "check": "checked",
    "call": "called",
    "bet": "bet",
    "raise": "raised to",
    "all_in": "moved all in for",
}


def describe_history(actions, seat_id) -> str:
    """The betting so far, street by street.

    Without this the model sees only the chips currently in front of each
    player, so a seat that raised every street looks the same as one that
    called along, and there is no story to read.
    """
    by_street: dict[str, list[str]] = {}
    order: list[str] = []
    for entry in actions or ():
        street = str(entry.get("street"))
        if street not in by_street:
            by_street[street] = []
            order.append(street)
        who = "you" if entry.get("seat_id") == seat_id else f"seat {entry.get('seat_id')}"
        verb = VERBS.get(str(entry.get("type")), str(entry.get("type")))
        amount = entry.get("amount")
        by_street[street].append(f"{who} {verb} {amount}" if amount is not None else f"{who} {verb}")
    if not order:
        return ""
    lines = ["How the betting has gone this hand:"]
    for street in order:
        lines.append(f"  {street}: " + ", ".join(by_street[street]))
    return "\n".join(lines)


def describe_table(projection: Mapping[str, Any], legal_actions: list[Mapping[str, Any]]) -> str:
    public = projection.get("public", {})
    seat_id = projection.get("seat_id")
    me = next((player for player in public.get("players", ()) if player.get("seat_id") == seat_id), {})
    to_call = max(0, int(public.get("current_bet", 0)) - int(me.get("street_contribution", 0)))

    street = public.get("street")
    big_blind = int(public.get("big_blind", 0))
    unraised = street == "preflop" and int(public.get("current_bet", 0)) <= big_blind

    opponents = [
        f"seat {player['seat_id']} has {player['stack']} chips"
        + (
            f", {player['street_contribution']} in front"
            + (" (that is the big blind, not a raise)" if unraised and player.get("street_contribution") == big_blind else "")
            if player.get("street_contribution")
            else ""
        )
        + (" (folded)" if player.get("folded") else " (all in)" if player.get("all_in") else "")
        for player in public.get("players", ())
        if player.get("seat_id") != seat_id
    ]

    roles = []
    if public.get("dealer_seat") == seat_id:
        roles.append("the dealer")
    if public.get("small_blind_seat") == seat_id:
        roles.append("the small blind")
    if public.get("big_blind_seat") == seat_id:
        roles.append("the big blind")

    lines = [
        f"You are seat {seat_id}. Your cards: {describe_cards(projection.get('hole_cards'))}.",
        f"Street: {STREET_NAMES.get(public.get('street'), public.get('street'))}.",
        f"Board: {describe_cards(public.get('community_cards'))}.",
        f"Pot: {public.get('pot')}. Your stack: {me.get('stack')}. To call: {to_call}.",
        f"Big blind: {public.get('big_blind')}. Smallest legal raise increment: {public.get('min_raise')}.",
    ]
    if roles:
        lines.append("You are " + " and ".join(roles) + " this hand.")
    if unraised:
        lines.append("Nobody has raised. The only chips in the pot are the blinds.")
    if to_call > 0:
        pot = int(public.get("pot", 0))
        share = round(100 * to_call / (pot + to_call)) if pot + to_call else 0
        lines.append(
            f"Pot odds: calling {to_call} to win {pot} means you need to win about {share}% "
            "of the time to break even."
        )
    if opponents:
        lines.append("Opponents: " + "; ".join(opponents) + ".")
    rank = projection.get("hand_rank")
    if rank:
        lines.append(f"Your current best five-card hand: {rank.get('category')}.")
    history = describe_history(public.get("actions"), seat_id)
    if history:
        lines.append(history)
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
- Checking and calling are fine when your hand is playable but not strong.
- A cheap call is not the same as an expensive one. When the amount to call is small next
  to the pot, folding a playable hand is usually a mistake. Before the flop, posting or
  completing a blind is not the same as facing a raise. Folding every hand loses slowly.
- Read the betting. A player who has raised every street usually has a real hand; one who
  keeps checking and calling usually does not. Use that, and remember what you represented
  with your own earlier bets.
- Heads-up, hands play much better than they would at a full table. When nobody has raised
  and you are on the button or in the small blind, most reasonable hands are worth playing."""

REPLY_FORMAT = """Reply with JSON only, no prose outside it:
{"reasoning": "<why, in at most 20 words>",
 "action": {"type": "<one of the legal action types>", "amount": <chips, only when that legal action carries an amount>}}"""


def system_prompt(policy) -> str:
    guidance = getattr(policy, "guidance", "") or ""
    parts = [BASE_RULES]
    if guidance:
        parts.append(f"Your style: {guidance}")
    parts.append(REPLY_FORMAT)
    return "\n\n".join(parts)
