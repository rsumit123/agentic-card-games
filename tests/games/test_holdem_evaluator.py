from app.games.cards import Card
from app.games.holdem.evaluator import compare_hands, evaluate_hand


def cards(*values):
    return tuple(Card(rank=rank, suit=suit) for rank, suit in values)


def test_standard_hand_categories_are_ranked():
    straight_flush = cards((14, "spades"), (13, "spades"), (12, "spades"), (11, "spades"), (10, "spades"))
    four_kind = cards((9, "clubs"), (9, "diamonds"), (9, "hearts"), (9, "spades"), (2, "clubs"))
    full_house = cards((8, "clubs"), (8, "diamonds"), (8, "hearts"), (4, "spades"), (4, "clubs"))

    assert evaluate_hand(straight_flush).category_name == "straight_flush"
    assert compare_hands(straight_flush, four_kind) > 0
    assert compare_hands(four_kind, full_house) > 0


def test_wheel_straight_uses_five_as_high():
    wheel = cards((14, "spades"), (2, "clubs"), (3, "diamonds"), (4, "hearts"), (5, "spades"))

    rank = evaluate_hand(wheel)

    assert rank.category_name == "straight"
    assert rank.tiebreakers == (5,)


def test_seven_cards_choose_best_five_and_ties_compare_equal():
    board = cards((14, "clubs"), (13, "diamonds"), (12, "hearts"), (11, "spades"), (2, "clubs"))
    player_a = board + cards((10, "clubs"), (3, "diamonds"))
    player_b = board + cards((10, "diamonds"), (3, "clubs"))

    assert evaluate_hand(player_a).category_name == "straight"
    assert compare_hands(player_a, player_b) == 0
