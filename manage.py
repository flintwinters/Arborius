#!/usr/bin/env python3
"""Single project entrypoint for development and verification."""

from __future__ import annotations

import os
import subprocess
from pathlib import Path

import typer
from rich.console import Console

app = typer.Typer(no_args_is_help=True, help="Build, test, and run Arborius.")
console = Console()
ROOT = Path(__file__).parent.resolve()


def run(command: list[str]) -> None:
    """Run a command from the repository root and fail clearly."""
    console.print(f"[dim]$ {' '.join(command)}[/dim]")
    environment = os.environ.copy()
    environment["UV_CACHE_DIR"] = str(ROOT / ".uv-cache")
    subprocess.run(command, cwd=ROOT, env=environment, check=True)


@app.command()
def bootstrap() -> None:
    """Install locked Python and JavaScript dependencies."""
    console.print(f"[dim]Using project-local uv cache: {ROOT / '.uv-cache'}[/dim]")
    run(["uv", "sync"])
    run(["npm", "install"])


@app.command()
def test() -> None:
    """Run the permanent Python test suite."""
    run(["uv", "run", "python", "-m", "pytest"])


@app.command()
def check() -> None:
    """Run all static checks and tests."""
    run(["uv", "run", "ruff", "check", "."])
    run(["npm", "run", "typecheck"])
    test()


@app.command()
def build() -> None:
    """Compile the production frontend ahead of time."""
    run(["npm", "run", "build"])


@app.command()
def dev(port: int = 8000) -> None:
    """Run FastAPI; it serves the compiled frontend when available."""
    run(["uv", "run", "uvicorn", "server.app:app", "--reload", "--port", str(port)])


if __name__ == "__main__":
    app()
