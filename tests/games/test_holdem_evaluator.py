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


def test_best_hand_returns_the_five_cards_behind_the_rank():
    from app.games.holdem.evaluator import best_hand

    seven = cards(
        (14, "clubs"),
        (13, "diamonds"),
        (12, "hearts"),
        (11, "spades"),
        (10, "clubs"),
        (2, "diamonds"),
        (3, "clubs"),
    )

    rank, five = best_hand(seven)

    assert rank == evaluate_hand(seven)
    assert len(five) == 5
    assert set(five) <= set(seven)
    assert sorted(card.rank for card in five) == [10, 11, 12, 13, 14]


def test_best_hand_prefers_the_boat_over_the_flush_draw():
    from app.games.holdem.evaluator import best_hand

    seven = cards(
        (8, "clubs"),
        (8, "diamonds"),
        (8, "hearts"),
        (4, "spades"),
        (4, "clubs"),
        (2, "clubs"),
        (7, "clubs"),
    )

    rank, five = best_hand(seven)

    assert rank.category_name == "full_house"
    assert sorted(card.rank for card in five) == [4, 4, 8, 8, 8]


def test_known_hand_comparisons_are_unchanged():
    """Ranking behaviour is load-bearing; retaining the five cards must not move it."""
    straight_flush = cards((14, "spades"), (13, "spades"), (12, "spades"), (11, "spades"), (10, "spades"))
    four_kind = cards((9, "clubs"), (9, "diamonds"), (9, "hearts"), (9, "spades"), (2, "clubs"))
    full_house = cards((8, "clubs"), (8, "diamonds"), (8, "hearts"), (4, "spades"), (4, "clubs"))
    flush = cards((14, "hearts"), (10, "hearts"), (7, "hearts"), (5, "hearts"), (3, "hearts"))
    straight = cards((9, "clubs"), (8, "diamonds"), (7, "hearts"), (6, "spades"), (5, "clubs"))
    wheel = cards((14, "spades"), (2, "clubs"), (3, "diamonds"), (4, "hearts"), (5, "spades"))
    trips = cards((6, "clubs"), (6, "diamonds"), (6, "hearts"), (13, "spades"), (2, "clubs"))
    two_pair = cards((11, "clubs"), (11, "diamonds"), (3, "hearts"), (3, "spades"), (9, "clubs"))
    pair = cards((11, "clubs"), (11, "diamonds"), (8, "hearts"), (5, "spades"), (2, "clubs"))
    high_card = cards((14, "clubs"), (12, "diamonds"), (9, "hearts"), (6, "spades"), (3, "clubs"))
    ladder = [straight_flush, four_kind, full_house, flush, straight, trips, two_pair, pair, high_card]

    for better, worse in zip(ladder, ladder[1:]):
        assert compare_hands(better, worse) > 0
        assert compare_hands(worse, better) < 0
    assert compare_hands(straight, wheel) > 0
    assert compare_hands(pair, pair) == 0
    assert [evaluate_hand(hand).category_name for hand in ladder] == [
        "straight_flush",
        "four_kind",
        "full_house",
        "flush",
        "straight",
        "three_kind",
        "two_pair",
        "pair",
        "high_card",
    ]
