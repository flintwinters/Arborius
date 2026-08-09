"""FastAPI transport for the server-authoritative Arborius game."""

from __future__ import annotations

import mimetypes
from pathlib import Path
from typing import Annotated, Literal

from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field

from server.game import (
    Facing,
    Game,
    GameRuleError,
    MoveAction,
    PlaceAction,
    Player,
    RotateAction,
    UnplayAction,
)


class PlaceRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["place"]
    player: Player
    tile_id: str
    q: int
    r: int
    facing: Facing


class MoveRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["move"]
    player: Player
    from_q: int
    from_r: int
    to_q: int
    to_r: int
    count: int


class RotateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["rotate"]
    player: Player
    q: int
    r: int
    quarter_turns: int
    whole_stack: bool = False
    count: int = 1


class UnplayRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: Literal["unplay"]
    player: Player
    q: int
    r: int


ActionRequest = Annotated[
    PlaceRequest | MoveRequest | RotateRequest | UnplayRequest, Field(discriminator="type")
]

app = FastAPI(title="Arborius", version="0.1.0")
game = Game()


@app.get("/api/game")
async def get_game() -> dict[str, object]:
    return game.to_dict()


@app.post("/api/game/reset")
async def reset_game() -> dict[str, object]:
    global game
    game = Game()
    return game.to_dict()


@app.post("/api/game/actions")
async def take_action(request: ActionRequest) -> dict[str, object]:
    if isinstance(request, PlaceRequest):
        action = PlaceAction(request.tile_id, request.q, request.r, request.facing)
    elif isinstance(request, MoveRequest):
        action = MoveAction(
            (request.from_q, request.from_r),
            (request.to_q, request.to_r),
            request.count,
        )
    elif isinstance(request, RotateRequest):
        action = RotateAction(
            request.q,
            request.r,
            request.quarter_turns,
            request.whole_stack,
            request.count,
        )
    else:
        action = UnplayAction(request.q, request.r)
    try:
        game.apply(request.player, action)
    except GameRuleError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    return game.to_dict()


DIST = Path(__file__).resolve().parents[1] / "dist"


@app.get("/{path:path}", include_in_schema=False)
async def serve_spa(path: str) -> Response:
    """Serve built assets when available and otherwise fall back to the SPA shell."""
    candidate = (DIST / path).resolve()
    if DIST.is_dir() and candidate.is_relative_to(DIST) and candidate.is_file():
        return _file_response(candidate)
    index = DIST / "index.html"
    if index.is_file() and not path.startswith("api/"):
        return _file_response(index)
    raise HTTPException(status_code=404, detail="Not found")


def _file_response(path: Path) -> Response:
    media_type, _ = mimetypes.guess_type(path.name)
    return Response(path.read_bytes(), media_type=media_type)
