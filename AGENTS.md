# Project motivation

Arborius is a compact, legible strategy game about controlling a living, unbounded orthogonal canopy. The implementation should make deep spatial play easy to read: the rules remain deterministic and server-authoritative while the Three.js board communicates height, ownership, and legal actions immediately. Its Hex influence is mechanical—connected spans—not geometric or bounded by board edges.

# Architecture

- `server/` is the FastAPI application and authoritative pure-Python rules engine.
- `web/` is strict TypeScript compiled ahead of time by Vite; Three.js owns the board scene while semantic HTML owns controls and status.
- `tests/` exercises rules and HTTP behavior through the root `manage.py` workflow.
- `manage.py` is the single Typer/Rich entrypoint for setup, checks, builds, tests, and development.

# Current tasks

- Verify the integrated API and production frontend in a real browser.
- Improve accessibility and input feedback as playtesting reveals friction.
- Keep the permanent rules/API suite aligned with future mechanics.
