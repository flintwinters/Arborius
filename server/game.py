"""Pure, deterministic rules for the Arborius board game."""

from __future__ import annotations

from collections.abc import Iterator
from copy import deepcopy
from dataclasses import dataclass, field, replace
from enum import StrEnum
from typing import Final

type Coord = tuple[int, int]

ORTHOGONAL_DIRECTIONS: Final[tuple[Coord, ...]] = (
    (0, -1),
    (1, 0),
    (0, 1),
    (-1, 0),
)
EIGHT_DIRECTIONS: Final[tuple[Coord, ...]] = tuple(
    (q, r) for q in (-1, 0, 1) for r in (-1, 0, 1) if (q, r) != (0, 0)
)
STARTING_TILE_NAMES: Final[tuple[str, ...]] = (
    "horse",
    "vagrant",
    "castle",
    "soldier",
    "demon",
    "sword",
    "viking",
    "goar",
)


class Player(StrEnum):
    AMBER = "amber"
    TEAL = "teal"

    @property
    def opponent(self) -> Player:
        return Player.TEAL if self is Player.AMBER else Player.AMBER


class Facing(StrEnum):
    NORTH = "N"
    EAST = "E"
    SOUTH = "S"
    WEST = "W"

    @property
    def vector(self) -> Coord:
        return ORTHOGONAL_DIRECTIONS[list(Facing).index(self)]

    def rotated(self, quarter_turns: int) -> Facing:
        return list(Facing)[(list(Facing).index(self) + quarter_turns) % 4]

    @property
    def opposite(self) -> Facing:
        return self.rotated(2)


@dataclass(frozen=True, slots=True)
class Tile:
    id: str
    name: str
    owner: Player
    facing: Facing = Facing.NORTH
    frozen: bool = False

    def to_dict(self) -> dict[str, object]:
        return {
            "id": self.id,
            "name": self.name,
            "owner": self.owner.value,
            "facing": self.facing.value,
            "frozen": self.frozen,
        }


type Stack = list[Tile]


class GameRuleError(ValueError):
    """Raised when an action is not legal in the current position."""


@dataclass(frozen=True, slots=True)
class PlaceAction:
    tile_id: str
    q: int
    r: int
    facing: Facing


@dataclass(frozen=True, slots=True)
class MoveAction:
    source: Coord
    destination: Coord
    count: int


@dataclass(frozen=True, slots=True)
class RotateAction:
    q: int
    r: int
    quarter_turns: int
    whole_stack: bool = False
    count: int = 1


@dataclass(frozen=True, slots=True)
class UnplayAction:
    q: int
    r: int


type Action = PlaceAction | MoveAction | RotateAction | UnplayAction


def starting_reserves() -> dict[Player, list[Tile]]:
    return {
        player: [Tile(f"{player.value}-{name}", name, player) for name in STARTING_TILE_NAMES]
        for player in Player
    }


def adjacent(left: Coord, right: Coord) -> bool:
    return (right[0] - left[0], right[1] - left[1]) in ORTHOGONAL_DIRECTIONS


def _offset(coord: Coord, direction: Coord) -> Coord:
    return coord[0] + direction[0], coord[1] + direction[1]


@dataclass(slots=True)
class Game:
    """Mutable game aggregate; all rule decisions live in this class."""

    board: dict[Coord, Stack] = field(default_factory=dict)
    turn: Player = Player.AMBER
    reserves: dict[Player, list[Tile]] = field(default_factory=starting_reserves)
    winner: Player | None = None
    move_number: int = 0

    def apply(self, player: Player, action: Action) -> None:
        if self.winner is not None:
            raise GameRuleError("the game is already over")
        if player is not self.turn:
            raise GameRuleError(f"it is {self.turn.value}'s turn")

        self._perform(player, action)

        self.move_number += 1
        self.turn = player.opponent
        self.winner = player if not self.has_valid_action(self.turn) else None

    def has_valid_action(self, player: Player) -> bool:
        """Return whether player can perform any complete legal turn action."""
        return any(
            self._is_valid_action(player, action)
            for action in self._candidate_actions(player)
        )

    def valid_moves(self, player: Player) -> list[MoveAction]:
        """Return fully validated moves for the player's selectable stack suffixes."""
        if self.winner is not None:
            return []
        return [
            action
            for action in self._candidate_actions(player)
            if isinstance(action, MoveAction) and self._is_valid_action(player, action)
        ]

    def _is_valid_action(self, player: Player, action: Action) -> bool:
        trial = deepcopy(self)
        try:
            trial._perform(player, action)
        except GameRuleError:
            return False
        return True

    def _perform(self, player: Player, action: Action) -> None:
        if isinstance(action, PlaceAction):
            self._place(player, action)
        elif isinstance(action, MoveAction):
            self._move(player, action)
        elif isinstance(action, RotateAction):
            self._rotate(player, action)
        else:
            self._unplay(player, (action.q, action.r))

    def _candidate_actions(self, player: Player) -> Iterator[Action]:
        """Yield the finite action space; rule methods remain the legality authority."""
        for coord, stack in self.board.items():
            if stack[-1].owner is not player:
                continue
            destination = _offset(coord, stack[-1].facing.vector)
            for count in range(1, len(stack) + 1):
                yield MoveAction(coord, destination, count)
            yield RotateAction(*coord, -1)
            yield RotateAction(*coord, 1)
            yield RotateAction(*coord, -1, whole_stack=True)
            yield RotateAction(*coord, 1, whole_stack=True)
            yield UnplayAction(*coord)

        if not self.reserves[player]:
            return
        if self.move_number == 0:
            destinations = ((0, 0),)
        elif self.move_number == 1:
            destinations = ((-1, -1), (-1, 1), (1, -1), (1, 1))
        else:
            destinations = tuple(
                _offset(coord, (-facing.vector[0], -facing.vector[1]))
                for coord, stack in self.board.items()
                if stack[-1].owner is player and not stack[-1].frozen
                for facing in Facing
            )
        for tile in self.reserves[player]:
            for q, r in destinations:
                for facing in Facing:
                    yield PlaceAction(tile.id, q, r, facing)

    def _place(self, player: Player, action: PlaceAction) -> None:
        reserve = self.reserves[player]
        tile = next((candidate for candidate in reserve if candidate.id == action.tile_id), None)
        if tile is None:
            raise GameRuleError(f"tile {action.tile_id!r} is not in {player.value}'s reserve")
        coord = (action.q, action.r)

        if self.move_number == 0:
            if player is not Player.AMBER or coord != (0, 0):
                raise GameRuleError("Amber's first tile must be placed at the center (0, 0)")
        elif self.move_number == 1:
            if player is not Player.TEAL or coord not in {(-1, -1), (-1, 1), (1, -1), (1, 1)}:
                raise GameRuleError("Teal's first tile must be diagonally adjacent to the center")
            amber_facing = self.board[(0, 0)][-1].facing
            if action.facing is not amber_facing.opposite:
                raise GameRuleError("Teal's first tile must face opposite Amber's first tile")
        else:
            destination = self.board.get(coord)
            if destination and destination[-1].owner is not player:
                raise GameRuleError("a tile may never be placed atop an enemy-controlled stack")
            anchor_coord = _offset(coord, action.facing.vector)
            anchor = self.board.get(anchor_coord)
            if anchor_coord == coord or not anchor or anchor[-1].owner is not player:
                raise GameRuleError("the tile must face an orthogonally adjacent friendly stack")
            if anchor[-1].frozen:
                raise GameRuleError("a frozen tile cannot serve as a placement anchor")

        placed = replace(tile, facing=action.facing)
        self.board[coord] = [*self.board.get(coord, []), placed]
        reserve.remove(tile)

    def _move(self, player: Player, action: MoveAction) -> None:
        source, destination = action.source, action.destination
        source_stack = self.board.get(source)
        if not source_stack:
            raise GameRuleError("the source cell is empty")
        controller = source_stack[-1]
        if controller.owner is not player:
            raise GameRuleError("the source stack is not controlled by this player")
        if controller.frozen:
            raise GameRuleError("a frozen tile cannot control a move")
        if action.count < 1:
            raise GameRuleError("count must be at least 1")
        if action.count > len(source_stack):
            raise GameRuleError("cannot carry more tiles than the source stack contains")
        if destination != _offset(source, controller.facing.vector):
            raise GameRuleError("a stack must move exactly one cell forward")

        split_at = len(source_stack) - action.count
        destination_stack = self.board.get(destination, [])
        if len(destination_stack) > split_at + 1:
            raise GameRuleError("a stack cannot ascend more than one level")

        occupied_after = set(self.board)
        if split_at == 0:
            occupied_after.remove(source)
        occupied_after.add(destination)
        if not self._one_mind_connected(occupied_after):
            raise GameRuleError("moving that stack would break One Mind connectivity")

        carried = source_stack[split_at:]
        if split_at:
            self.board[source] = source_stack[:split_at]
        else:
            del self.board[source]
        self.board[destination] = [*destination_stack, *carried]

    def _rotate(self, player: Player, action: RotateAction) -> None:
        if action.quarter_turns not in (-1, 1):
            raise GameRuleError("rotation must be exactly -1 or +1 quarter turn")
        stack = self.board.get((action.q, action.r))
        if not stack:
            raise GameRuleError("the rotation cell is empty")
        if stack[-1].owner is not player:
            raise GameRuleError("the stack is not controlled by this player")
        if action.count < 1 or action.count > len(stack):
            raise GameRuleError("rotation count must select tiles from the controlled stack")
        targets = stack if action.whole_stack else stack[-action.count :]
        if any(tile.frozen for tile in targets):
            raise GameRuleError("a frozen tile cannot be rotated")
        rotated = [
            replace(tile, facing=tile.facing.rotated(action.quarter_turns)) for tile in targets
        ]
        stack[-len(targets) :] = rotated

    def _unplay(self, player: Player, coord: Coord) -> None:
        stack = self.board.get(coord)
        if not stack:
            raise GameRuleError("the unplay cell is empty")
        tile = stack[-1]
        if tile.owner is not player:
            raise GameRuleError("only a controlled uncovered tile may be unplayed")

        occupied_after = set(self.board)
        if len(stack) == 1:
            occupied_after.remove(coord)
        if not self._one_mind_connected(occupied_after):
            raise GameRuleError("unplaying that tile would break One Mind connectivity")
        stack.pop()
        if not stack:
            del self.board[coord]
        self.reserves[player].append(tile)

    @staticmethod
    def _one_mind_connected(occupied: set[Coord]) -> bool:
        if not occupied:
            return True
        reached = {next(iter(occupied))}
        pending = list(reached)
        while pending:
            coord = pending.pop()
            for direction in EIGHT_DIRECTIONS:
                neighbor = _offset(coord, direction)
                if neighbor in occupied and neighbor not in reached:
                    reached.add(neighbor)
                    pending.append(neighbor)
        return reached == occupied

    def to_dict(self) -> dict[str, object]:
        cells = [
            {"q": q, "r": r, "stack": [tile.to_dict() for tile in stack]}
            for (q, r), stack in sorted(self.board.items())
        ]
        return {
            "turn": self.turn.value,
            "winner": self.winner.value if self.winner else None,
            "move_number": self.move_number,
            "reserves": {
                player.value: [tile.to_dict() for tile in reserve]
                for player, reserve in self.reserves.items()
            },
            "board": cells,
            "legal_moves": [
                {
                    "from_q": action.source[0],
                    "from_r": action.source[1],
                    "to_q": action.destination[0],
                    "to_r": action.destination[1],
                    "count": action.count,
                }
                for action in self.valid_moves(self.turn)
            ],
        }
