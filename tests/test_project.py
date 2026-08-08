import re
from pathlib import Path

ROOT = Path(__file__).parents[1]
PLAYER_FACING_SOURCES = (
    ROOT / "index.html",
    ROOT / "web" / "main.ts",
    ROOT / "web" / "board.ts",
    ROOT / "server" / "game.py",
)
TECHNICAL_UI_TERMS = (
    "api",
    "authentication",
    "browser",
    "cache",
    "client",
    "cookie",
    "database",
    "http",
    "json",
    "local storage",
    "recover",
    "request",
    "server",
    "session",
    "token",
)


def test_required_project_entrypoints_exist() -> None:
    """Keep the documented one-command workflow wired to real entrypoints."""
    assert (ROOT / "manage.py").is_file()
    assert (ROOT / "server").is_dir() or (ROOT / "web").is_dir()


def test_player_facing_copy_does_not_expose_implementation_terminology() -> None:
    """Keep implementation concepts out of every source that renders game copy."""
    forbidden = re.compile(
        rf"\b(?:{'|'.join(map(re.escape, TECHNICAL_UI_TERMS))})\b",
        re.IGNORECASE,
    )
    violations = {
        path.relative_to(ROOT).as_posix(): sorted(set(forbidden.findall(path.read_text())))
        for path in PLAYER_FACING_SOURCES
        if forbidden.search(path.read_text())
    }
    assert not violations, f"replace technical UI terminology with player language: {violations}"
