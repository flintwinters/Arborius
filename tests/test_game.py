import pytest

from server.game import (
    BOARD_RADIUS,
    MAX_HEIGHT,
    Game,
    GameRuleError,
    MoveAction,
    PlaceAction,
    Player,
    is_on_board,
)


def test_radius_three_board_geometry() -> None:
    cells = [
        (q, r)
        for q in range(-BOARD_RADIUS, BOARD_RADIUS + 1)
        for r in range(-BOARD_RADIUS, BOARD_RADIUS + 1)
        if is_on_board((q, r))
    ]
    assert len(cells) == 37
    assert is_on_board((3, -3))
    assert not is_on_board((3, 1))


def test_place_consumes_reserve_and_changes_turn() -> None:
    game = Game()
    game.apply(Player.AMBER, PlaceAction(0, 0))
    assert game.board[(0, 0)] == [Player.AMBER]
    assert game.reserves[Player.AMBER] == 17
    assert game.turn is Player.TEAL


@pytest.mark.parametrize("coord", [(4, 0), (0, -4), (3, 1)])
def test_cannot_place_off_board(coord: tuple[int, int]) -> None:
    with pytest.raises(GameRuleError, match="outside"):
        Game().apply(Player.AMBER, PlaceAction(*coord))


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


@pytest.mark.parametrize(
    ("action", "message"),
    [
        (MoveAction((0, 0), (2, 0), 1), "adjacent"),
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
def test_connection_wins_across_players_axis(player: Player, path: list[tuple[int, int]]) -> None:
    game = Game(board={coord: [player] for coord in path})
    assert game.connection_winner(player) is player


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

