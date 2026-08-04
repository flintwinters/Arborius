from pathlib import Path

ROOT = Path(__file__).parents[1]


def test_required_project_entrypoints_exist() -> None:
    """Keep the documented one-command workflow wired to real entrypoints."""
    assert (ROOT / "manage.py").is_file()
    assert (ROOT / "server").is_dir() or (ROOT / "web").is_dir()
