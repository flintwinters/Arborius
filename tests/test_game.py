import pytest

from server.game import (
    Facing,
    Game,
    GameRuleError,
    MoveAction,
    PlaceAction,
    Player,
    RotateAction,
    Tile,
    UnplayAction,
)


def tile(
    identifier: str, owner: Player, facing: Facing = Facing.NORTH, *, frozen: bool = False
) -> Tile:
    return Tile(identifier, identifier.split("-")[-1], owner, facing, frozen)


def test_starting_armies_are_unique_named_tiles() -> None:
    game = Game()
    expected = {"horse", "vagrant", "castle", "soldier", "demon", "sword", "viking", "goar"}
    assert {item.name for item in game.reserves[Player.AMBER]} == expected
    assert {item.name for item in game.reserves[Player.TEAL]} == expected
    assert len({item.id for reserve in game.reserves.values() for item in reserve}) == 16


def test_opening_places_center_then_diagonal_with_opposite_facing() -> None:
    game = Game()
    game.apply(Player.AMBER, PlaceAction("amber-horse", 0, 0, Facing.EAST))
    game.apply(Player.TEAL, PlaceAction("teal-goar", 1, 1, Facing.WEST))
    assert game.board[(0, 0)][-1] == tile("amber-horse", Player.AMBER, Facing.EAST)
    assert game.board[(1, 1)][-1] == tile("teal-goar", Player.TEAL, Facing.WEST)
    assert len(game.reserves[Player.AMBER]) == 7


@pytest.mark.parametrize(
    ("action", "message"),
    [
        (PlaceAction("amber-horse", 1, 0, Facing.NORTH), "center"),
        (PlaceAction("missing", 0, 0, Facing.NORTH), "not in"),
    ],
)
def test_rejects_invalid_first_placement(action: PlaceAction, message: str) -> None:
    with pytest.raises(GameRuleError, match=message):
        Game().apply(Player.AMBER, action)


def test_rejects_teal_opening_position_or_facing() -> None:
    game = Game()
    game.apply(Player.AMBER, PlaceAction("amber-horse", 0, 0, Facing.SOUTH))
    with pytest.raises(GameRuleError, match="diagonally"):
        game.apply(Player.TEAL, PlaceAction("teal-horse", 0, 1, Facing.NORTH))
    with pytest.raises(GameRuleError, match="opposite"):
        game.apply(Player.TEAL, PlaceAction("teal-horse", 1, 1, Facing.EAST))


def test_later_placement_faces_distinct_friendly_anchor_and_can_stack() -> None:
    anchor = tile("amber-horse", Player.AMBER)
    destination_tile = tile("amber-castle", Player.AMBER)
    game = Game(
        board={(0, 0): [anchor], (1, 0): [destination_tile]},
        turn=Player.AMBER,
        move_number=2,
    )
    game.apply(Player.AMBER, PlaceAction("amber-goar", 1, 0, Facing.WEST))
    assert [item.id for item in game.board[(1, 0)]] == ["amber-castle", "amber-goar"]


def test_later_placement_rejects_enemy_destination_wrong_facing_and_frozen_anchor() -> None:
    reserve = {Player.AMBER: [tile("amber-goar", Player.AMBER)], Player.TEAL: []}
    cases = [
        (
            {
                (0, 0): [tile("amber-horse", Player.AMBER)],
                (1, 0): [tile("teal-horse", Player.TEAL)],
            },
            Facing.WEST,
            "enemy",
        ),
        ({(0, 0): [tile("amber-horse", Player.AMBER)]}, Facing.EAST, "face"),
        ({(0, 0): [tile("amber-horse", Player.AMBER, frozen=True)]}, Facing.WEST, "frozen"),
    ]
    for board, facing, message in cases:
        game = Game(
            board=board,
            reserves={key: list(value) for key, value in reserve.items()},
            move_number=2,
        )
        with pytest.raises(GameRuleError, match=message):
            game.apply(Player.AMBER, PlaceAction("amber-goar", 1, 0, facing))


def test_move_preserves_tiles_and_has_no_height_or_carry_cap() -> None:
    source = [tile(f"amber-{index}", Player.AMBER) for index in range(8)]
    destination = [tile(f"teal-{index}", Player.TEAL) for index in range(8)]
    game = Game(board={(0, 0): source, (1, 0): destination}, move_number=2)
    game.apply(Player.AMBER, MoveAction((0, 0), (1, 0), 8))
    assert (0, 0) not in game.board
    assert game.board[(1, 0)] == [*destination, *source]


def test_move_requires_orthogonal_adjacency_control_and_valid_count() -> None:
    game = Game(board={(0, 0): [tile("teal-horse", Player.TEAL)]}, move_number=2)
    with pytest.raises(GameRuleError, match="controlled"):
        game.apply(Player.AMBER, MoveAction((0, 0), (1, 0), 1))
    game.board[(0, 0)] = [tile("amber-horse", Player.AMBER)]
    with pytest.raises(GameRuleError, match="adjacent"):
        game.apply(Player.AMBER, MoveAction((0, 0), (1, 1), 1))
    with pytest.raises(GameRuleError, match="at least"):
        game.apply(Player.AMBER, MoveAction((0, 0), (1, 0), 0))


def test_rotate_top_or_whole_stack_preserves_order() -> None:
    lower = tile("teal-horse", Player.TEAL, Facing.NORTH)
    upper = tile("amber-horse", Player.AMBER, Facing.EAST)
    game = Game(board={(0, 0): [lower, upper]}, move_number=2)
    game.apply(Player.AMBER, RotateAction(0, 0, 1))
    assert [item.facing for item in game.board[(0, 0)]] == [Facing.NORTH, Facing.SOUTH]

    game.turn = Player.AMBER
    game.apply(Player.AMBER, RotateAction(0, 0, -1, whole_stack=True))
    assert [item.id for item in game.board[(0, 0)]] == ["teal-horse", "amber-horse"]
    assert [item.facing for item in game.board[(0, 0)]] == [Facing.WEST, Facing.EAST]


def test_rotate_rejects_frozen_target_non_control_and_non_quarter_turn() -> None:
    game = Game(board={(0, 0): [tile("amber-horse", Player.AMBER, frozen=True)]}, move_number=2)
    with pytest.raises(GameRuleError, match="frozen"):
        game.apply(Player.AMBER, RotateAction(0, 0, 1))
    with pytest.raises(GameRuleError, match="exactly"):
        game.apply(Player.AMBER, RotateAction(0, 0, 2))


def test_unplay_returns_top_tile_when_eight_neighbor_connectivity_remains() -> None:
    removed = tile("amber-horse", Player.AMBER, Facing.EAST)
    board = {
        (0, 0): [tile("teal-horse", Player.TEAL), removed],
        (1, 1): [tile("teal-goar", Player.TEAL)],
    }
    game = Game(board=board, move_number=2)
    game.apply(Player.AMBER, UnplayAction(0, 0))
    assert game.board[(0, 0)] == [tile("teal-horse", Player.TEAL)]
    assert game.reserves[Player.AMBER][-1] is removed


def test_unplay_rejects_disconnect_and_enemy_top() -> None:
    bridge = tile("amber-horse", Player.AMBER)
    game = Game(
        board={
            (-1, 0): [tile("a", Player.AMBER)],
            (0, 0): [bridge],
            (1, 0): [tile("b", Player.TEAL)],
        },
        move_number=2,
    )
    with pytest.raises(GameRuleError, match="connectivity"):
        game.apply(Player.AMBER, UnplayAction(0, 0))
    with pytest.raises(GameRuleError, match="controlled"):
        game.apply(Player.AMBER, UnplayAction(1, 0))


def test_serialization_contains_complete_tiles_and_no_invented_limits() -> None:
    state = Game().to_dict()
    assert "max_height" not in state and "carry_limit" not in state
    assert state["reserves"]["amber"][0] == {
        "id": "amber-horse",
        "name": "horse",
        "owner": "amber",
        "facing": "N",
        "frozen": False,
    }
    assert state["winner"] is None
