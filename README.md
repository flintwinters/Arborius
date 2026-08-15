# Arborius

Arborius is a strategy game about controlling a living, unbounded orthogonal
canopy. Players place, stack, rotate, and move tiles to build connected spans
while a three-dimensional board keeps height, ownership, and legal actions
visible.

The game is under active development. The bundled [rulebook](rules.pdf) is the
design reference; some advanced movement and Mind behavior is not implemented
yet.

## Architecture

- `server/` contains the authoritative pure-Python rules engine and FastAPI
  application.
- `web/` contains the strict TypeScript interface and Three.js board.
- `tests/` covers game rules, HTTP behavior, and project structure.
- `manage.py` is the single entrypoint for setup, verification, builds, and
  local development.

## Requirements

- Python 3.12 or newer
- [uv](https://docs.astral.sh/uv/)
- Node.js and npm

## Run locally

Install the locked dependencies:

```sh
uv run python manage.py bootstrap
```

Build the interface and start Arborius:

```sh
uv run python manage.py build
uv run python manage.py dev
```

Open <http://127.0.0.1:8000>. Use `--port` to select another port:

```sh
uv run python manage.py dev --port 8080
```

## Verify changes

Run the complete static-analysis and test workflow:

```sh
uv run python manage.py check
```

Run only the permanent test suite:

```sh
uv run python manage.py test
```

Create a production frontend build:

```sh
uv run python manage.py build
```
