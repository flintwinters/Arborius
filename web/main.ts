import "./styles.css";

import { BoardView, type BoardCoordinate } from "./board";
import {
  cellKey,
  gameApi,
  playerLabel,
  type Facing,
  type GameAction,
  type GameState,
} from "./game";

const app = document.querySelector<HTMLElement>("#app");
if (!app) throw new Error("Application mount point is missing");

app.innerHTML = `
  <header><b>ARBORIUS</b><span id="turn"></span></header>
  <main id="board"></main>
  <aside class="intel">
    <p id="state" class="state" aria-live="polite"></p>
    <output id="prompt" class="prompt" aria-live="polite"></output>
    <h2>Tiles</h2>
    <div id="reserve" class="reserve"></div>
    <section id="placement-controls"><h2>Tile direction</h2>
      <div class="commands facing" aria-label="Tile direction"><button data-facing="N">↑ North</button><button data-facing="E">→ East</button><button data-facing="S">↓ South</button><button data-facing="W">← West</button></div>
    </section>
    <section id="selection-controls" hidden><h2 id="selection-title">Selected stack</h2>
      <label>Tiles to move <input id="carry" type="number" min="1" value="1"></label>
      <div class="commands"><button id="rotate-left">↶ Rotate</button><button id="rotate-right">Rotate ↷</button><button id="unplay">Return top tile</button><button id="scope">Rotate top</button></div>
    </section>
    <output id="log" class="notice" aria-live="assertive"></output>
    <div class="commands utility"><button id="cancel">Clear selection</button><button id="reset">New game</button></div>
  </aside>`;

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Required interface node is missing: ${selector}`);
  return element;
}

const boardHost = requireElement<HTMLElement>("#board");
const stateNode = requireElement<HTMLElement>("#state");
const reserveNode = requireElement<HTMLElement>("#reserve");
const logNode = requireElement<HTMLOutputElement>("#log");
const promptNode = requireElement<HTMLOutputElement>("#prompt");
const carryNode = requireElement<HTMLInputElement>("#carry");
const turnNode = requireElement<HTMLElement>("#turn");
const placementControlsNode = requireElement<HTMLElement>("#placement-controls");
const selectionControlsNode = requireElement<HTMLElement>("#selection-controls");
const selectionTitleNode = requireElement<HTMLElement>("#selection-title");

let game: GameState;
let selected: BoardCoordinate | null = null;
let selectedCount = 0;
let selectedReserve: string | null = null;
let placementFacing: Facing = "N";
let rotateWholeStack = false;
let busy = false;
let notice: { kind: "success" | "error"; text: string } | null = null;
const oppositeFacing: Record<Facing, Facing> = { N: "S", E: "W", S: "N", W: "E" };
const board = new BoardView(
  boardHost,
  (coordinate, count) => void choose(coordinate, count),
  (source, destination, count) => void move(source, destination, count),
);

function stackAt(coordinate: BoardCoordinate) {
  return game.board.find((cell) => cell.q === coordinate.q && cell.r === coordinate.r)?.stack ?? [];
}

const facingVector: Record<Facing, BoardCoordinate> = {
  N: { q: 0, r: -1 }, E: { q: 1, r: 0 }, S: { q: 0, r: 1 }, W: { q: -1, r: 0 },
};

function destinations(): BoardCoordinate[] {
  if (selected) {
    const facing = stackAt(selected).at(-1)?.facing;
    const vector = facing ? facingVector[facing] : null;
    return vector ? [{ q: selected.q + vector.q, r: selected.r + vector.r }] : [];
  }
  if (!selectedReserve) return [];
  if (game.move_number === 0) return [{ q: 0, r: 0 }];
  if (game.move_number === 1) {
    return [-1, 1].flatMap((q) => [-1, 1].map((r) => ({ q, r })));
  }
  const vector = facingVector[placementFacing];
  return game.board
    .filter((cell) => cell.stack.at(-1)?.owner === game.turn && !cell.stack.at(-1)?.frozen)
    .map((cell) => ({ q: cell.q - vector.q, r: cell.r - vector.r }))
    .filter((candidate) => stackAt(candidate).at(-1)?.owner !== (game.turn === "amber" ? "teal" : "amber"));
}

function promptText(): string {
  if (game.winner) return `${playerLabel(game.winner)} controls the canopy.`;
  if (busy) return "Resolving action…";
  if (selected) {
    const top = stackAt(selected).at(-1);
    const destination = destinations()[0];
    return destination
      ? `${selectedCount} tile${selectedCount === 1 ? "" : "s"} ready. Move ${top?.facing ?? "forward"} to the green marker, or choose an action below.`
      : "Choose an action for this stack.";
  }
  if (selectedReserve) {
    const tile = game.reserves[game.turn].find((candidate) => candidate.id === selectedReserve);
    return `${tile?.name ?? "Tile"} ready, facing ${placementFacing}. Place it on a green marker.`;
  }
  return "Choose one of your stacks, or choose a tile from reserve.";
}

function selectDefaultSetupTile(): void {
  if (game.move_number < 2 && selectedReserve === null) {
    selectedReserve = game.reserves[game.turn][0]?.id ?? null;
  }
}

function render(): void {
  board.setSelected(selected, selectedCount);
  board.setDestinations(destinations());
  board.update(game);
  turnNode.textContent = `Turn ${game.move_number + 1}`;
  const phase = game.move_number === 0 ? "Place at the center" : game.move_number === 1 ? "Place diagonally from the center" : "Choose a tile or stack";
  stateNode.innerHTML = game.winner
    ? `<strong>${playerLabel(game.winner)} wins</strong>`
    : `<strong class="${game.turn}">${playerLabel(game.turn)}</strong> to move<br><span>${phase}</span>`;
  promptNode.textContent = promptText();
  promptNode.classList.toggle("pending", busy);
  logNode.textContent = notice?.text ?? "";
  logNode.className = `notice${notice ? ` ${notice.kind}` : ""}`;
  reserveNode.innerHTML = game.reserves[game.turn].map((tile) =>
    `<button data-tile-id="${tile.id}" aria-pressed="${selectedReserve === tile.id}">${tile.name.toUpperCase()}</button>`,
  ).join("");
  document.querySelectorAll<HTMLButtonElement>("[data-facing]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.facing === placementFacing));
  });
  placementControlsNode.hidden = selectedReserve === null;
  selectionControlsNode.hidden = selected === null;
  document.querySelectorAll<HTMLButtonElement>("button").forEach((button) => {
    button.disabled = busy || (game.winner !== null && button.id !== "reset");
  });
  requireElement<HTMLButtonElement>("#cancel").disabled = busy || (selected === null && selectedReserve === null);
  if (selected) {
    const stack = stackAt(selected);
    selectionTitleNode.textContent = `${stack.at(-1)?.name ?? "Stack"} · ${stack.length} tile${stack.length === 1 ? "" : "s"}`;
  }
}

async function submit(action: GameAction): Promise<void> {
  if (busy) return;
  busy = true;
  notice = null;
  render();
  try {
    game = await gameApi.act(action);
    if (action.type === "place" && game.move_number === 1) {
      placementFacing = oppositeFacing[action.facing];
    }
    notice = { kind: "success", text: actionResult(action) };
    selected = null;
    selectedCount = 0;
    selectedReserve = null;
    selectDefaultSetupTile();
  } catch (error) {
    notice = {
      kind: "error",
      text: error instanceof Error ? sentenceCase(error.message) : "That action is not allowed.",
    };
  } finally {
    busy = false;
    render();
  }
}

function sentenceCase(message: string): string {
  const text = message.replace(/^\s+|\s+$/g, "");
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}${/[.!?]$/.test(text) ? "" : "."}`;
}

function actionResult(action: GameAction): string {
  if (action.type === "place") return "Tile placed. Turn passed.";
  if (action.type === "move") return `${action.count} tile${action.count === 1 ? "" : "s"} moved. Turn passed.`;
  if (action.type === "rotate") return `${action.whole_stack ? "Stack" : "Top tile"} rotated. Turn passed.`;
  return "Top tile returned to reserve. Turn passed.";
}

async function choose(coordinate: BoardCoordinate, count?: number): Promise<void> {
  if (game.winner || busy) return;
  const target = stackAt(coordinate);
  if (selectedReserve) {
    await submit({
      type: "place",
      player: game.turn,
      tile_id: selectedReserve,
      q: coordinate.q,
      r: coordinate.r,
      facing: placementFacing,
    });
    return;
  }
  if (!selected) {
    if (target.at(-1)?.owner === game.turn) {
      selected = coordinate;
      selectedCount = count ?? 1;
      carryNode.value = String(selectedCount);
      render();
    } else {
      notice = { kind: "error", text: target.length ? "That stack is controlled by your opponent." : "Choose one of your stacks or a reserve tile first." };
      render();
    }
    return;
  }
  if (cellKey(selected.q, selected.r) === cellKey(coordinate.q, coordinate.r)) {
    selected = null;
    selectedCount = 0;
    render();
    return;
  }
  await submit({
    type: "move",
    player: game.turn,
    from_q: selected.q,
    from_r: selected.r,
    to_q: coordinate.q,
    to_r: coordinate.r,
    count: selectedCount || Number(carryNode.value),
  });
}

async function move(
  source: BoardCoordinate,
  destination: BoardCoordinate,
  count: number,
): Promise<void> {
  const stack = stackAt(source);
  if (game.winner || busy) return;
  if (stack.at(-1)?.owner !== game.turn) {
    logNode.textContent = "That stack belongs to the other player.";
    return;
  }
  selected = source;
  selectedCount = count;
  await submit({
    type: "move",
    player: game.turn,
    from_q: source.q,
    from_r: source.r,
    to_q: destination.q,
    to_r: destination.r,
    count,
  });
}

function cancel(): void {
  selected = null;
  selectedCount = 0;
  selectedReserve = null;
  notice = null;
  render();
}

async function reset(): Promise<void> {
  if (busy) return;
  busy = true;
  notice = null;
  render();
  try {
    game = await gameApi.reset();
    selected = null;
    selectedCount = 0;
    selectedReserve = null;
    selectDefaultSetupTile();
    notice = { kind: "success", text: "New game ready. Amber begins." };
  } catch (error) {
    notice = { kind: "error", text: error instanceof Error ? error.message : "A new game could not begin." };
  } finally {
    busy = false;
    render();
  }
}

document.querySelector("#cancel")?.addEventListener("click", cancel);
document.querySelector("#reset")?.addEventListener("click", () => void reset());
reserveNode.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-tile-id]");
  if (!button) return;
  selectedReserve = button.dataset.tileId ?? null;
  selected = null;
  selectedCount = 0;
  notice = null;
  render();
});
document.querySelectorAll<HTMLButtonElement>("[data-facing]").forEach((button) => {
  button.addEventListener("click", () => {
    placementFacing = button.dataset.facing as Facing;
    notice = null;
    render();
  });
});
document.querySelector("#scope")?.addEventListener("click", () => {
  rotateWholeStack = !rotateWholeStack;
  requireElement<HTMLButtonElement>("#scope").textContent = `Rotate ${rotateWholeStack ? "stack" : "top"}`;
});
async function rotate(quarterTurns: -1 | 1): Promise<void> {
  if (!selected) {
    notice = { kind: "error", text: "Select one of your stacks first." };
    render();
    return;
  }
  await submit({
    type: "rotate",
    player: game.turn,
    q: selected.q,
    r: selected.r,
    quarter_turns: quarterTurns,
    whole_stack: rotateWholeStack,
  });
}
document.querySelector("#rotate-left")?.addEventListener("click", () => void rotate(-1));
document.querySelector("#rotate-right")?.addEventListener("click", () => void rotate(1));
document.querySelector("#unplay")?.addEventListener("click", () => {
  if (!selected) {
    notice = { kind: "error", text: "Select one of your stacks first." };
    render();
    return;
  }
  void submit({ type: "unplay", player: game.turn, q: selected.q, r: selected.r });
});
carryNode.addEventListener("change", () => {
  if (!selected) return;
  const height = stackAt(selected).length;
  selectedCount = Math.max(1, Math.min(Number(carryNode.value), height));
  carryNode.value = String(selectedCount);
  render();
});
gameApi.load().then((loaded) => {
  game = loaded;
  selectDefaultSetupTile();
  render();
}).catch(() => {
  notice = { kind: "error", text: "The game is unavailable. Try again." };
  logNode.textContent = notice.text;
  logNode.className = "notice error";
});
