import asyncio

import httpx
import pytest

import server.app as app_module
from server.app import app
from server.game import Facing, Game, Player, Tile


class ApiClient:
    def request(
        self, method: str, path: str, json: dict[str, object] | None = None
    ) -> httpx.Response:
        async def send() -> httpx.Response:
            transport = httpx.ASGITransport(app=app)
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
                return await client.request(method, path, json=json)

        return asyncio.run(send())

    def get(self, path: str) -> httpx.Response:
        return self.request("GET", path)

    def post(self, path: str, json: dict[str, object] | None = None) -> httpx.Response:
        return self.request("POST", path, json)


@pytest.fixture
def client() -> ApiClient:
    result = ApiClient()
    result.post("/api/game/reset")
    return result


def place(
    client: ApiClient, player: str, tile_id: str, q: int, r: int, facing: str
) -> httpx.Response:
    return client.post(
        "/api/game/actions",
        json={
            "type": "place",
            "player": player,
            "tile_id": tile_id,
            "q": q,
            "r": r,
            "facing": facing,
        },
    )


def test_get_reset_and_full_tile_schema(client: ApiClient) -> None:
    state = client.get("/api/game").json()
    assert state["turn"] == "amber"
    assert len(state["reserves"]["amber"]) == 8
    assert state["reserves"]["amber"][0] == {
        "id": "amber-horse",
        "name": "horse",
        "owner": "amber",
        "facing": "N",
        "frozen": False,
    }
    assert state["board"] == []
    assert state["legal_moves"] == []
    place(client, "amber", "amber-horse", 0, 0, "E")
    assert client.post("/api/game/reset").json()["board"] == []


def test_place_rotate_move_and_unplay_round_trip(client: ApiClient) -> None:
    first = place(client, "amber", "amber-horse", 0, 0, "E")
    assert first.status_code == 200
    assert first.json()["board"][0]["stack"][0]["id"] == "amber-horse"
    assert place(client, "teal", "teal-horse", 1, 1, "W").status_code == 200

    rotated = client.post(
        "/api/game/actions",
        json={
            "type": "rotate",
            "player": "amber",
            "q": 0,
            "r": 0,
            "quarter_turns": 1,
            "whole_stack": False,
        },
    )
    assert rotated.status_code == 200
    assert rotated.json()["board"][0]["stack"][0]["facing"] == "S"

    moved = client.post(
        "/api/game/actions",
        json={
            "type": "move",
            "player": "teal",
            "from_q": 1,
            "from_r": 1,
            "to_q": 0,
            "to_r": 1,
            "count": 1,
        },
    )
    assert moved.status_code == 200
    unplayed = client.post(
        "/api/game/actions",
        json={
            "type": "unplay",
            "player": "amber",
            "q": 0,
            "r": 0,
        },
    )
    assert unplayed.status_code == 200
    assert unplayed.json()["reserves"]["amber"][-1]["id"] == "amber-horse"


def test_rule_violation_is_400_without_mutation(client: ApiClient) -> None:
    before = client.get("/api/game").json()
    response = place(client, "teal", "teal-horse", 0, 0, "N")
    assert response.status_code == 400
    assert "amber's turn" in response.json()["detail"]
    assert client.get("/api/game").json() == before


def test_action_reports_winner_when_opponent_has_no_legal_action(
    client: ApiClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        app_module,
        "game",
        Game(
            board={(0, 0): [Tile("teal-horse", "horse", Player.TEAL)]},
            turn=Player.TEAL,
            reserves={Player.AMBER: [], Player.TEAL: []},
            move_number=2,
        ),
    )

    response = client.post(
        "/api/game/actions",
        json={
            "type": "rotate",
            "player": "teal",
            "q": 0,
            "r": 0,
            "quarter_turns": 1,
        },
    )

    assert response.status_code == 200
    assert response.json()["turn"] == "amber"
    assert response.json()["winner"] == "teal"
    assert response.json()["board"][0]["stack"][0]["facing"] == Facing.EAST


@pytest.mark.parametrize(
    "payload",
    [
        {"type": "jump", "player": "amber", "q": 0, "r": 0},
        {"type": "place", "player": "amber", "tile_id": "amber-horse", "q": 0, "r": 0},
        {
            "type": "place",
            "player": "amber",
            "tile_id": "amber-horse",
            "q": 0,
            "r": 0,
            "facing": "NE",
        },
        {"type": "rotate", "player": "amber", "q": 0, "r": 0, "quarter_turns": 1, "extra": True},
        {"type": "unplay", "player": "violet", "q": 0, "r": 0},
    ],
)
def test_malformed_actions_return_422(client: ApiClient, payload: dict[str, object]) -> None:
    assert client.post("/api/game/actions", json=payload).status_code == 422


def test_static_spa_fallback_and_api_404(client: ApiClient) -> None:
    assert client.get("/").status_code == 200
    assert client.get("/some/client/route").status_code == 200
    assert client.get("/api/missing").status_code == 404
