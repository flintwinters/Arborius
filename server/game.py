"""Pure, deterministic rules for the Arborius board game."""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Final

STARTING_RESERVE: Final = 18
MAX_HEIGHT: Final = 5
CARRY_LIMIT: Final = 5
WINNING_EXTENT: Final = 6

type Coord = tuple[int, int]
type Stack = list[Player]

ORTHOGONAL_DIRECTIONS: Final[tuple[Coord, ...]] = (
    (1, 0),
    (0, -1),
    (-1, 0),
    (0, 1),
)


class Player(StrEnum):
    AMBER = "amber"
    TEAL = "teal"

    @property
    def opponent(self) -> Player:
        return Player.TEAL if self is Player.AMBER else Player.AMBER


class GameRuleError(ValueError):
    """Raised when an action is not legal in the current position."""


@dataclass(frozen=True, slots=True)
class PlaceAction:
    q: int
    r: int


@dataclass(frozen=True, slots=True)
class MoveAction:
    source: Coord
    destination: Coord
    count: int


type Action = PlaceAction | MoveAction


def adjacent(left: Coord, right: Coord) -> bool:
    difference = (right[0] - left[0], right[1] - left[1])
    return difference in ORTHOGONAL_DIRECTIONS


@dataclass(slots=True)
class Game:
    """Mutable game aggregate; all rule decisions live in this class."""

    board: dict[Coord, Stack] = field(default_factory=dict)
    turn: Player = Player.AMBER
    reserves: dict[Player, int] = field(
        default_factory=lambda: {Player.AMBER: STARTING_RESERVE, Player.TEAL: STARTING_RESERVE}
    )
    winner: Player | None = None
    move_number: int = 0

    def apply(self, player: Player, action: Action) -> None:
        if self.winner is not None:
            raise GameRuleError("the game is already over")
        if player is not self.turn:
            raise GameRuleError(f"it is {self.turn.value}'s turn")

        if isinstance(action, PlaceAction):
            self._place(player, (action.q, action.r))
        else:
            self._move(player, action)

        self.move_number += 1
        self.winner = self.connection_winner(player)
        if self.winner is None:
            self.turn = player.opponent

    def _place(self, player: Player, coord: Coord) -> None:
        if coord in self.board:
            raise GameRuleError("stones may only be placed on an empty cell")
        if self.reserves[player] <= 0:
            raise GameRuleError(f"{player.value} has no stones in reserve")
        self.board[coord] = [player]
        self.reserves[player] -= 1

    def _move(self, player: Player, action: MoveAction) -> None:
        source, destination = action.source, action.destination
        if not adjacent(source, destination):
            raise GameRuleError("a stack may only move to an adjacent cell")

        source_stack = self.board.get(source)
        if not source_stack:
            raise GameRuleError("the source cell is empty")
        if source_stack[-1] is not player:
            raise GameRuleError("the source stack is not controlled by this player")
        if not 1 <= action.count <= CARRY_LIMIT:
            raise GameRuleError(f"count must be between 1 and {CARRY_LIMIT}")
        if action.count > len(source_stack):
            raise GameRuleError("cannot carry more stones than the source stack contains")

        destination_stack = self.board.get(destination, [])
        if len(destination_stack) + action.count > MAX_HEIGHT:
            raise GameRuleError(f"a stack may not exceed height {MAX_HEIGHT}")

        split_at = len(source_stack) - action.count
        carried = source_stack[split_at:]
        remaining = source_stack[:split_at]
        if remaining:
            self.board[source] = remaining
        else:
            del self.board[source]
        self.board[destination] = [*destination_stack, *carried]

    def connection_winner(self, player: Player) -> Player | None:
        controlled = {coord for coord, stack in self.board.items() if stack[-1] is player}
        axis = 0 if player is Player.AMBER else 1
        unvisited = set(controlled)
        while unvisited:
            start = unvisited.pop()
            pending = deque([start])
            minimum = maximum = start[axis]
            while pending:
                coord = pending.popleft()
                minimum = min(minimum, coord[axis])
                maximum = max(maximum, coord[axis])
                for dq, dr in ORTHOGONAL_DIRECTIONS:
                    neighbor = (coord[0] + dq, coord[1] + dr)
                    if neighbor in unvisited:
                        unvisited.remove(neighbor)
                        pending.append(neighbor)
            if maximum - minimum >= WINNING_EXTENT:
                return player
        return None

    def to_dict(self) -> dict[str, object]:
        cells = [
            {"q": q, "r": r, "stack": [stone.value for stone in stack]}
            for (q, r), stack in sorted(self.board.items())
        ]
        return {
            "max_height": MAX_HEIGHT,
            "carry_limit": CARRY_LIMIT,
            "turn": self.turn.value,
            "winner": self.winner.value if self.winner else None,
            "move_number": self.move_number,
            "reserves": {player.value: count for player, count in self.reserves.items()},
            "board": cells,
        }
