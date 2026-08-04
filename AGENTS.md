# Project motivation

Arborius is a compact, legible strategy game about controlling a living hexagonal canopy. The implementation should make deep spatial play easy to read: the rules remain deterministic and server-authoritative while the Three.js board communicates height, ownership, and legal actions immediately.

# Architecture

- `server/` is the FastAPI application and authoritative pure-Python rules engine.
- `web/` is strict TypeScript compiled ahead of time by Vite; Three.js owns the board scene while semantic HTML owns controls and status.
- `tests/` exercises rules and HTTP behavior through the root `manage.py` workflow.
- `manage.py` is the single Typer/Rich entrypoint for setup, checks, builds, tests, and development.

# Current tasks

- Establish the reproducible Python and TypeScript toolchains.
- Implement and test the deterministic stacking/connection rules.
- Build the dense Gruvbox operator UI and interactive Three.js board.
- Verify production build and end-to-end gameplay flow.

