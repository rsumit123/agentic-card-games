from __future__ import annotations

from dataclasses import replace
from typing import Iterable, Mapping

from ..cards import Card, shuffle_deck, standard_deck
from .actions import HoldemAction, normalize_action
from .evaluator import HandRank, evaluate_hand
from .state import HoldemState, PlayerState


class InvalidAction(ValueError):
    pass


def _replace_player(state: HoldemState, player: PlayerState) -> HoldemState:
    return replace(state, players=tuple(player if item.seat_id == player.seat_id else item for item in state.players))


def _next_seat(state: HoldemState, seat_id: int, *, eligible_only: bool = False) -> int | None:
    ordered = sorted(player.seat_id for player in state.players)
    if not ordered:
        return None
    start = ordered.index(seat_id)
    for offset in range(1, len(ordered) + 1):
        candidate = state.player(ordered[(start + offset) % len(ordered)])
        if not candidate.folded and (not eligible_only or (not candidate.all_in and candidate.stack >= 0)):
            return candidate.seat_id
    return None


def _funded_seat_order(stacks: Mapping[int, int]) -> list[int]:
    return sorted(seat_id for seat_id, stack in stacks.items() if stack > 0)


def _rotate_funded(order: list[int], dealer_seat: int) -> int:
    if dealer_seat in order:
        return dealer_seat
    return next((seat_id for seat_id in order if seat_id > dealer_seat), order[0])


def start_hand(
    stacks: Mapping[int, int],
    *,
    dealer_seat: int = 0,
    small_blind: int = 5,
    big_blind: int = 10,
    random_bytes: bytes | None = None,
    hand_number: int = 1,
) -> HoldemState:
    if len(stacks) not in {2, 3, 4}:
        raise ValueError("Hold'em tables must have two to four seats")
    funded = _funded_seat_order(stacks)
    if len(funded) < 2:
        raise ValueError("at least two funded seats are required")
    if small_blind <= 0 or big_blind != small_blind * 2:
        raise ValueError("big blind must be twice the small blind")
    dealer = _rotate_funded(funded, dealer_seat)
    dealer_index = funded.index(dealer)
    if len(funded) == 2:
        small = dealer
        big = funded[(dealer_index + 1) % len(funded)]
    else:
        small = funded[(dealer_index + 1) % len(funded)]
        big = funded[(dealer_index + 2) % len(funded)]

    deck = shuffle_deck(standard_deck(), random_bytes=random_bytes)
    holes: dict[int, list[Card]] = {seat_id: [] for seat_id in funded}
    deck_index = 0
    for _ in range(2):
        for seat_id in funded:
            holes[seat_id].append(deck[deck_index])
            deck_index += 1

    players = tuple(
        PlayerState(
            seat_id=seat_id,
            stack=stack,
            hole_cards=tuple(holes.get(seat_id, ())),
            folded=stack <= 0,
            all_in=stack <= 0,
        )
        for seat_id, stack in sorted(stacks.items())
    )
    state = HoldemState(
        players=players,
        deck=deck,
        deck_index=deck_index,
        community_cards=(),
        street="preflop",
        dealer_seat=dealer,
        small_blind_seat=small,
        big_blind_seat=big,
        current_seat=None,
        current_bet=big_blind,
        min_raise=big_blind,
        small_blind=small_blind,
        big_blind=big_blind,
        hand_number=hand_number,
    )
    for seat_id, blind in ((small, small_blind), (big, big_blind)):
        player = state.player(seat_id)
        paid = min(blind, player.stack)
        state = _replace_player(
            state,
            replace(
                player,
                stack=player.stack - paid,
                total_contribution=paid,
                street_contribution=paid,
                all_in=player.stack == paid,
            ),
        )
    state = replace(state, current_seat=dealer if len(funded) == 2 else _next_seat(state, big, eligible_only=True))
    return state


def _active_players(state: HoldemState) -> list[PlayerState]:
    return [player for player in state.players if not player.folded]


def _eligible_players(state: HoldemState) -> list[PlayerState]:
    return [player for player in _active_players(state) if not player.all_in and player.stack >= 0]


def legal_actions(state: HoldemState, seat_id: int) -> tuple[dict[str, object], ...]:
    if state.street == "complete" or state.current_seat != seat_id:
        return ()
    player = state.player(seat_id)
    to_call = max(0, state.current_bet - player.street_contribution)
    actions: list[dict[str, object]] = [{"type": "fold"}]
    if to_call == 0:
        actions.append({"type": "check"})
    else:
        actions.append({"type": "call", "amount": min(to_call, player.stack)})
    maximum = player.street_contribution + player.stack
    if state.current_bet == 0 and maximum >= state.min_raise:
        actions.append({"type": "bet", "min_amount": state.min_raise, "max_amount": maximum})
    elif state.current_bet > 0 and maximum >= state.current_bet + state.min_raise:
        actions.append(
            {
                "type": "raise",
                "min_amount": state.current_bet + state.min_raise,
                "max_amount": maximum,
            }
        )
    if player.stack > 0:
        actions.append({"type": "all_in", "amount": maximum})
    return tuple(actions)


def _round_complete(state: HoldemState) -> bool:
    eligible = _eligible_players(state)
    if not eligible:
        return True
    return all(player.has_acted and player.street_contribution == state.current_bet for player in eligible)


def _deal_next_street(state: HoldemState) -> HoldemState:
    index = state.deck_index + 1  # burn
    cards_to_deal = {"preflop": 3, "flop": 1, "turn": 1}.get(state.street)
    if cards_to_deal is None:
        return state
    board = state.community_cards + state.deck[index : index + cards_to_deal]
    next_street = {"preflop": "flop", "flop": "turn", "turn": "river"}[state.street]
    players = tuple(replace(player, street_contribution=0, has_acted=False) for player in state.players)
    next_state = replace(
        state,
        players=players,
        deck_index=index + cards_to_deal,
        community_cards=board,
        street=next_street,
        current_seat=None,
        current_bet=0,
        min_raise=state.big_blind,
    )
    eligible = _eligible_players(next_state)
    return replace(next_state, current_seat=_next_seat(next_state, state.dealer_seat, eligible_only=True) if eligible else None)


def _finish_fold(state: HoldemState) -> HoldemState:
    active = _active_players(state)
    if len(active) != 1:
        return state
    winner = active[0]
    payout = state.pot
    player = replace(winner, stack=winner.stack + payout)
    return _replace_player(
        replace(state, street="complete", current_seat=None, winners=(winner.seat_id,), payouts=((winner.seat_id, payout),)),
        player,
    )


def _runout(state: HoldemState) -> HoldemState:
    while state.street in {"preflop", "flop", "turn"}:
        state = _deal_next_street(state)
    return resolve_showdown(state)


def apply_action(state: HoldemState, seat_id: int, action: HoldemAction | Mapping[str, object]) -> HoldemState:
    if state.street == "complete":
        raise InvalidAction("hand is complete")
    if state.current_seat != seat_id:
        raise InvalidAction("out of turn")
    player = state.player(seat_id)
    if player.folded or player.all_in:
        raise InvalidAction("seat cannot act")
    try:
        action = normalize_action(action)
    except ValueError as exc:
        raise InvalidAction(str(exc)) from exc
    to_call = max(0, state.current_bet - player.street_contribution)
    maximum = player.street_contribution + player.stack
    target = None
    aggressive = False
    if action.type == "fold":
        updated = replace(player, folded=True, has_acted=True)
    elif action.type == "check":
        if to_call:
            raise InvalidAction("cannot check while facing a bet")
        updated = replace(player, has_acted=True)
    elif action.type == "call":
        if not to_call:
            raise InvalidAction("nothing to call")
        target = player.street_contribution + min(to_call, player.stack)
        updated = replace(
            player,
            stack=player.stack - (target - player.street_contribution),
            street_contribution=target,
            total_contribution=player.total_contribution + (target - player.street_contribution),
            all_in=player.stack == (target - player.street_contribution),
            has_acted=True,
        )
    elif action.type in {"bet", "raise"}:
        if action.amount is None:
            raise InvalidAction("bet and raise require an amount")
        target = action.amount
        minimum = state.min_raise if action.type == "bet" else state.current_bet + state.min_raise
        if (action.type == "bet" and state.current_bet != 0) or (action.type == "raise" and state.current_bet == 0):
            raise InvalidAction("wrong action for current bet")
        if target < minimum:
            raise InvalidAction("below minimum raise")
        if target > maximum:
            raise InvalidAction("amount exceeds stack")
        aggressive = target > state.current_bet
        updated = replace(
            player,
            stack=player.stack - (target - player.street_contribution),
            street_contribution=target,
            total_contribution=player.total_contribution + (target - player.street_contribution),
            all_in=target == maximum,
            has_acted=True,
        )
    elif action.type == "all_in":
        if player.stack <= 0:
            raise InvalidAction("seat is already all-in")
        target = maximum
        increase = target - state.current_bet
        aggressive = increase > 0
        updated = replace(
            player,
            stack=0,
            street_contribution=target,
            total_contribution=player.total_contribution + (target - player.street_contribution),
            all_in=True,
            has_acted=True,
        )
    else:  # pragma: no cover - normalize_action handles this
        raise InvalidAction("unknown action")

    state = _replace_player(state, updated)
    if action.type == "fold":
        return _finish_fold(state)
    if aggressive:
        increase = updated.street_contribution - state.current_bet
        new_min_raise = increase if increase >= state.min_raise else state.min_raise
        players = tuple(
            replace(item, has_acted=False) if item.seat_id != seat_id and not item.folded and not item.all_in else item
            for item in state.players
        )
        state = replace(state, players=players, current_bet=updated.street_contribution, min_raise=new_min_raise)
    if _round_complete(state):
        return _runout(state) if state.street == "river" or not _eligible_players(state) else _deal_next_street(state)
    next_seat = _next_seat(state, seat_id, eligible_only=True)
    return replace(state, current_seat=next_seat)


def resolve_showdown(state: HoldemState) -> HoldemState:
    if state.street == "complete":
        return state
    active = _active_players(state)
    if len(active) == 1:
        return _finish_fold(state)
    contributions = sorted({player.total_contribution for player in state.players if player.total_contribution > 0})
    payouts = {player.seat_id: 0 for player in state.players}
    previous = 0
    winners: list[int] = []
    for level in contributions:
        contributors = [player for player in state.players if player.total_contribution >= level]
        layer_amount = (level - previous) * len(contributors)
        eligible = [player for player in contributors if not player.folded]
        if eligible:
            ranks = {player.seat_id: evaluate_hand(player.hole_cards + state.community_cards) for player in eligible}
            best = max(ranks.values())
            layer_winners = sorted(seat_id for seat_id, rank in ranks.items() if rank == best)
            share, remainder = divmod(layer_amount, len(layer_winners))
            for index, seat_id in enumerate(layer_winners):
                payouts[seat_id] += share + (1 if index < remainder else 0)
            winners.extend(layer_winners)
        previous = level
    updated_players = tuple(replace(player, stack=player.stack + payouts[player.seat_id]) for player in state.players)
    winner_tuple = tuple(dict.fromkeys(sorted(winners)))
    return replace(
        state,
        players=updated_players,
        street="complete",
        current_seat=None,
        winners=winner_tuple,
        payouts=tuple((seat_id, amount) for seat_id, amount in sorted(payouts.items()) if amount),
    )


class HoldemModule:
    game_id = "holdem"
    ruleset_version = "1"

    def setup(self, seat_count: int, **kwargs):
        stacks = kwargs.pop("stacks", {seat_id: 1000 for seat_id in range(seat_count)})
        return start_hand(stacks, **kwargs)

    def legal_actions(self, state: HoldemState, seat_id: int):
        return legal_actions(state, seat_id)

    def transition(self, state: HoldemState, seat_id: int, action):
        next_state = apply_action(state, seat_id, action)
        from ..contracts import Transition

        return Transition(state=next_state, action=action, revision=state.hand_number + 1)

    def seat_projection(self, state: HoldemState, seat_id: int):
        return {"public": public_projection(state), "hole_cards": tuple(state.player(seat_id).hole_cards), "seat_id": seat_id}

    def public_projection(self, state: HoldemState):
        return public_projection(state)

    def timeout_action(self, state: HoldemState, seat_id: int):
        return {"type": "fold"}

    def ai_schema(self, state: HoldemState, seat_id: int):
        return {"type": "object", "properties": {"type": {"enum": [item["type"] for item in legal_actions(state, seat_id)]}}}


def public_projection(state: HoldemState) -> dict[str, object]:
    return {
        "street": state.street,
        "community_cards": state.community_cards,
        "pot": state.pot,
        "current_seat": state.current_seat,
        "players": tuple(
            {
                "seat_id": player.seat_id,
                "stack": player.stack,
                "folded": player.folded,
                "all_in": player.all_in,
                "contribution": player.total_contribution,
            }
            for player in state.players
        ),
    }
