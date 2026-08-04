import pytest

from server.game import (
    MAX_HEIGHT,
    Game,
    GameRuleError,
    MoveAction,
    PlaceAction,
    Player,
)


def test_place_consumes_reserve_and_changes_turn() -> None:
    game = Game()
    game.apply(Player.AMBER, PlaceAction(0, 0))
    assert game.board[(0, 0)] == [Player.AMBER]
    assert game.reserves[Player.AMBER] == 17
    assert game.turn is Player.TEAL


@pytest.mark.parametrize("coord", [(10**9, -(10**9)), (-(10**12), 10**12)])
def test_can_place_at_arbitrary_integer_coordinates(coord: tuple[int, int]) -> None:
    game = Game()
    game.apply(Player.AMBER, PlaceAction(*coord))
    assert game.board[coord] == [Player.AMBER]


def test_rejects_wrong_turn_occupied_cell_and_empty_reserve() -> None:
    game = Game()
    with pytest.raises(GameRuleError, match="amber's turn"):
        game.apply(Player.TEAL, PlaceAction(0, 0))
    game.apply(Player.AMBER, PlaceAction(0, 0))
    with pytest.raises(GameRuleError, match="empty"):
        game.apply(Player.TEAL, PlaceAction(0, 0))
    game.reserves[Player.TEAL] = 0
    with pytest.raises(GameRuleError, match="no stones"):
        game.apply(Player.TEAL, PlaceAction(1, 0))


def test_move_top_stones_as_ordered_unit() -> None:
    game = Game(
        board={(0, 0): [Player.TEAL, Player.AMBER, Player.TEAL, Player.AMBER]},
        turn=Player.AMBER,
    )
    game.apply(Player.AMBER, MoveAction((0, 0), (1, 0), 3))
    assert game.board[(0, 0)] == [Player.TEAL]
    assert game.board[(1, 0)] == [Player.AMBER, Player.TEAL, Player.AMBER]


def test_move_can_capture_control_by_covering_a_stack() -> None:
    game = Game(
        board={(0, 0): [Player.AMBER], (1, 0): [Player.TEAL]},
        turn=Player.AMBER,
    )
    game.apply(Player.AMBER, MoveAction((0, 0), (1, 0), 1))
    assert game.board[(1, 0)] == [Player.TEAL, Player.AMBER]


def test_move_has_no_artificial_edge() -> None:
    source = (10**12, -(10**12))
    destination = (source[0] + 1, source[1])
    game = Game(board={source: [Player.AMBER]}, turn=Player.AMBER)
    game.apply(Player.AMBER, MoveAction(source, destination, 1))
    assert game.board == {destination: [Player.AMBER]}


@pytest.mark.parametrize(
    ("action", "message"),
    [
        (MoveAction((0, 0), (2, 0), 1), "adjacent"),
        (MoveAction((0, 0), (1, -1), 1), "adjacent"),
        (MoveAction((1, 0), (0, 0), 1), "empty"),
        (MoveAction((0, 0), (1, 0), 0), "between"),
        (MoveAction((0, 0), (1, 0), 2), "more stones"),
    ],
)
def test_rejects_illegal_moves(action: MoveAction, message: str) -> None:
    game = Game(board={(0, 0): [Player.AMBER]}, turn=Player.AMBER)
    with pytest.raises(GameRuleError, match=message):
        game.apply(Player.AMBER, action)


def test_only_top_controller_can_move_stack() -> None:
    game = Game(board={(0, 0): [Player.AMBER, Player.TEAL]}, turn=Player.AMBER)
    with pytest.raises(GameRuleError, match="not controlled"):
        game.apply(Player.AMBER, MoveAction((0, 0), (1, 0), 1))


def test_destination_height_is_limited() -> None:
    game = Game(
        board={
            (0, 0): [Player.AMBER, Player.AMBER],
            (1, 0): [Player.TEAL] * (MAX_HEIGHT - 1),
        },
        turn=Player.AMBER,
    )
    with pytest.raises(GameRuleError, match="exceed"):
        game.apply(Player.AMBER, MoveAction((0, 0), (1, 0), 2))


@pytest.mark.parametrize(
    ("player", "path"),
    [
        (Player.AMBER, [(q, 0) for q in range(-3, 4)]),
        (Player.TEAL, [(0, r) for r in range(-3, 4)]),
    ],
)
def test_connected_component_with_seven_coordinate_extent_wins(
    player: Player, path: list[tuple[int, int]]
) -> None:
    game = Game(board={coord: [player] for coord in path})
    assert game.connection_winner(player) is player


@pytest.mark.parametrize(
    ("player", "path"),
    [
        (Player.AMBER, [(1000 + q, -800) for q in range(7)]),
        (Player.TEAL, [(-500, 2000 + r) for r in range(7)]),
    ],
)
def test_connection_victory_is_translation_invariant(
    player: Player, path: list[tuple[int, int]]
) -> None:
    game = Game(board={coord: [player] for coord in path})
    assert game.connection_winner(player) is player


@pytest.mark.parametrize(
    ("player", "path"),
    [
        (Player.AMBER, [(q, 0) for q in range(6)]),
        (Player.TEAL, [(0, r) for r in range(6)]),
        (Player.AMBER, [(0, r) for r in range(7)]),
        (Player.TEAL, [(q, 0) for q in range(7)]),
    ],
)
def test_connection_requires_full_extent_along_players_axis(
    player: Player, path: list[tuple[int, int]]
) -> None:
    assert Game(board={coord: [player] for coord in path}).connection_winner(player) is None


def test_extent_across_disconnected_components_does_not_win() -> None:
    board = {
        **{(q, 0): [Player.AMBER] for q in range(3)},
        **{(100 + q, 0): [Player.AMBER] for q in range(3)},
    }
    assert Game(board=board).connection_winner(Player.AMBER) is None


def test_diagonal_cells_do_not_form_a_connection() -> None:
    diagonal = {(coordinate, coordinate): [Player.AMBER] for coordinate in range(-3, 4)}
    game = Game(board=diagonal)
    assert game.connection_winner(Player.AMBER) is None


def test_covered_stones_do_not_form_connection() -> None:
    path = [(q, 0) for q in range(-3, 4)]
    board = {coord: [Player.AMBER] for coord in path}
    board[(0, 0)].append(Player.TEAL)
    game = Game(board=board)
    assert game.connection_winner(Player.AMBER) is None


def test_win_is_immediate_and_prevents_more_actions() -> None:
    board = {(q, 0): [Player.AMBER] for q in range(-3, 3)}
    game = Game(board=board, turn=Player.AMBER)
    game.apply(Player.AMBER, PlaceAction(3, 0))
    assert game.winner is Player.AMBER
    assert game.turn is Player.AMBER
    with pytest.raises(GameRuleError, match="already over"):
        game.apply(Player.AMBER, PlaceAction(0, 1))
