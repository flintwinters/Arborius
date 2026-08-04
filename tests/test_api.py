import asyncio

import httpx
import pytest

from server.app import app


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
    test_client = ApiClient()
    test_client.post("/api/game/reset")
    return test_client


def test_get_and_reset_game(client: ApiClient) -> None:
    state = client.get("/api/game").json()
    assert state["turn"] == "amber"
    assert state["radius"] == 3
    assert state["reserves"] == {"amber": 18, "teal": 18}
    assert state["board"] == []

    client.post("/api/game/actions", json={"type": "place", "player": "amber", "q": 0, "r": 0})
    reset = client.post("/api/game/reset")
    assert reset.status_code == 200
    assert reset.json()["board"] == []


def test_square_corner_is_valid_and_diagonal_move_is_rejected(client: ApiClient) -> None:
    placed = client.post(
        "/api/game/actions",
        json={"type": "place", "player": "amber", "q": 3, "r": 3},
    )
    assert placed.status_code == 200

    client.post(
        "/api/game/actions",
        json={"type": "place", "player": "teal", "q": 0, "r": 0},
    )
    moved = client.post(
        "/api/game/actions",
        json={
            "type": "move",
            "player": "amber",
            "from_q": 3,
            "from_r": 3,
            "to_q": 2,
            "to_r": 2,
            "count": 1,
        },
    )
    assert moved.status_code == 400
    assert "adjacent" in moved.json()["detail"]
    assert client.get("/api/game").json()["board"] == [
        {"q": 0, "r": 0, "stack": ["teal"]},
        {"q": 3, "r": 3, "stack": ["amber"]},
    ]


def test_place_and_move_round_trip(client: ApiClient) -> None:
    placed = client.post(
        "/api/game/actions",
        json={"type": "place", "player": "amber", "q": 0, "r": 0},
    )
    assert placed.status_code == 200
    assert placed.json()["board"] == [{"q": 0, "r": 0, "stack": ["amber"]}]

    client.post(
        "/api/game/actions",
        json={"type": "place", "player": "teal", "q": 2, "r": 0},
    )
    moved = client.post(
        "/api/game/actions",
        json={
            "type": "move",
            "player": "amber",
            "from_q": 0,
            "from_r": 0,
            "to_q": 1,
            "to_r": 0,
            "count": 1,
        },
    )
    assert moved.status_code == 200
    assert moved.json()["board"][0] == {"q": 1, "r": 0, "stack": ["amber"]}


def test_rule_violation_returns_400_without_mutation(client: ApiClient) -> None:
    response = client.post(
        "/api/game/actions",
        json={"type": "place", "player": "teal", "q": 0, "r": 0},
    )
    assert response.status_code == 400
    assert "amber's turn" in response.json()["detail"]
    assert client.get("/api/game").json()["board"] == []


@pytest.mark.parametrize(
    "payload",
    [
        {"type": "jump", "player": "amber", "q": 0, "r": 0},
        {"type": "place", "player": "violet", "q": 0, "r": 0},
        {"type": "move", "player": "amber", "from_q": 0},
        {"type": "place", "player": "amber", "q": 0, "r": 0, "surprise": True},
    ],
)
def test_malformed_actions_return_422(client: ApiClient, payload: dict[str, object]) -> None:
    assert client.post("/api/game/actions", json=payload).status_code == 422


def test_static_spa_fallback_and_api_404(client: ApiClient) -> None:
    assert client.get("/").status_code == 200
    assert client.get("/some/client/route").status_code == 200
    assert client.get("/api/missing").status_code == 404
