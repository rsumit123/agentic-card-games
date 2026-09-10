import json
from pathlib import Path

from app.games.holdem.engine import start_hand
from app.rooms.actor import RoomActor
from fastapi.encoders import jsonable_encoder


FIXTURE = Path(__file__).resolve().parents[1] / "frontend" / "tests" / "fixtures" / "snapshot.json"


def test_frontend_snapshot_fixture_matches_projection_keys():
    state = start_hand({1: 1000, 2: 1000}, random_bytes=bytes(range(256)) * 4)
    projection = jsonable_encoder(RoomActor(1, state, player_names={1: "Ana", 2: "Rivers (AI)"}).snapshot_for(1))
    fixture = json.loads(FIXTURE.read_text())
    assert set(fixture["payload"].keys()) == set(projection.keys())
    assert set(fixture["payload"]["public"].keys()) == set(projection["public"].keys())
    assert set(fixture["payload"]["public"]["players"][0].keys()) == set(projection["public"]["players"][0].keys())
