from __future__ import annotations

import pytest

from app.games.cards import Card, standard_deck, shuffle_deck


def test_standard_deck_has_52_unique_cards():
    deck = standard_deck()

    assert len(deck) == 52
    assert len(set(deck)) == 52
    assert all(isinstance(card, Card) for card in deck)


def test_shuffle_is_deterministic_for_injected_random_bytes():
    random_bytes = bytes(range(256)) * 2

    first = shuffle_deck(standard_deck(), random_bytes=random_bytes)
    second = shuffle_deck(standard_deck(), random_bytes=random_bytes)

    assert first == second
    assert first != standard_deck()
    assert set(first) == set(standard_deck())


def test_card_is_immutable_and_validates_values():
    card = Card(rank=14, suit="spades")

    with pytest.raises((AttributeError, TypeError)):
        card.rank = 2
    with pytest.raises(ValueError):
        Card(rank=1, suit="spades")
    with pytest.raises(ValueError):
        Card(rank=14, suit="stars")
