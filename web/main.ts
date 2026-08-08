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
  <header><b>ARBORIUS</b><span>CANOPY COMMAND // ONLINE</span><span id="clock">TURN 000</span></header>
  <section class="board-pane"><div class="titlebar">TACTICAL CANOPY // UNBOUNDED ORTHOGONAL FIELD</div><div id="board"></div></section>
  <aside class="intel">
    <div class="titlebar">GAME STATE</div>
    <dl id="state"></dl>
    <div class="titlebar">REVEALED ARMY</div>
    <div id="reserve" class="reserve"></div>
    <div class="titlebar">PLACEMENT ROTATION</div>
    <div class="commands placement-rotation"><button id="placement-left" title="Rotate placement left (Q)">↶ Q</button><strong id="placement-facing">↑ N</strong><button id="placement-right" title="Rotate placement right (E)">E ↷</button></div>
    <div class="commands facing" aria-label="Placement facing"><button data-facing="N">↑ N</button><button data-facing="E">→ E</button><button data-facing="S">↓ S</button><button data-facing="W">← W</button></div>
    <div class="titlebar">STACK INSPECTOR</div>
    <div id="inspect" class="readout">SELECT A CELL</div>
    <div class="titlebar">ACTION BUFFER</div>
    <label>CARRY COUNT <input id="carry" type="number" min="1" value="1"></label>
    <div id="buffer" class="readout">PLACE MODE // SELECT EMPTY CELL</div>
    <div class="commands"><button id="rotate-left">↶ ABILITY ROTATE</button><button id="rotate-right">↷ ABILITY ROTATE</button><button id="unplay">UNPLAY TOP</button><button id="scope">SCOPE: TOP</button><button id="cancel">ESC CANCEL</button><button id="reset">R RESET</button></div>
    <div class="titlebar">RULE CORE</div>
    <ol><li>Setup: Amber at center; Teal diagonally adjacent and opposite-facing.</li><li>Play beside a friendly tile and face it. Friendly stacking still needs a separate anchor.</li><li>Never play atop an enemy or toward a frozen anchor.</li><li>Unplay only an uncovered tile without splitting the One Mind.</li></ol>
    <div class="titlebar">EVENT LOG</div><output id="log">SYSTEM READY</output>
  </aside>
  <footer><span>CLICK: SELECT / PLACE</span><span>Q / E: ROTATE PLACEMENT</span><span>DRAG TILE: MOVE STACK</span><span>ESC: CANCEL</span></footer>`;

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Required interface node is missing: ${selector}`);
  return element;
}

const boardHost = requireElement<HTMLElement>("#board");
const stateNode = requireElement<HTMLElement>("#state");
const reserveNode = requireElement<HTMLElement>("#reserve");
const inspectNode = requireElement<HTMLElement>("#inspect");
const bufferNode = requireElement<HTMLElement>("#buffer");
const logNode = requireElement<HTMLOutputElement>("#log");
const carryNode = requireElement<HTMLInputElement>("#carry");
const clockNode = requireElement<HTMLElement>("#clock");
const placementFacingNode = requireElement<HTMLElement>("#placement-facing");

let game: GameState;
let selected: BoardCoordinate | null = null;
let selectedCount = 0;
let selectedReserve: string | null = null;
let placementFacing: Facing = "N";
let rotateWholeStack = false;
let busy = false;
const oppositeFacing: Record<Facing, Facing> = { N: "S", E: "W", S: "N", W: "E" };
const facings: readonly Facing[] = ["N", "E", "S", "W"];
const facingArrows: Record<Facing, string> = { N: "↑", E: "→", S: "↓", W: "←" };
const board = new BoardView(
  boardHost,
  (coordinate, count) => void choose(coordinate, count),
  (source, destination, count) => void move(source, destination, count),
);

function stackAt(coordinate: BoardCoordinate) {
  return game.board.find((cell) => cell.q === coordinate.q && cell.r === coordinate.r)?.stack ?? [];
}

function selectDefaultSetupTile(): void {
  if (game.move_number < 2 && selectedReserve === null) {
    selectedReserve = game.reserves[game.turn][0]?.id ?? null;
  }
}

function render(): void {
  board.setSelected(selected, selectedCount);
  board.update(game);
  clockNode.textContent = `TURN ${String(game.move_number).padStart(3, "0")}`;
  const winner = game.winner ? `${playerLabel(game.winner)} VICTORY` : "ACTIVE";
  const phase = game.move_number === 0 ? "SETUP // AMBER CENTER" : game.move_number === 1 ? "SETUP // TEAL DIAGONAL" : "PLAY";
  stateNode.innerHTML = `<dt>ACTIVE</dt><dd class="${game.turn}">${playerLabel(game.turn)}</dd>
    <dt>PHASE</dt><dd>${phase}</dd><dt>STATUS</dt><dd>${winner}</dd><dt>AMBER RESERVE</dt><dd>${game.reserves.amber.length}</dd>
    <dt>TEAL RESERVE</dt><dd>${game.reserves.teal.length}</dd>`;
  reserveNode.innerHTML = game.reserves[game.turn].map((tile) =>
    `<button data-tile-id="${tile.id}" aria-pressed="${selectedReserve === tile.id}">${tile.name.toUpperCase()}</button>`,
  ).join("");
  placementFacingNode.textContent = `${facingArrows[placementFacing]} ${placementFacing}`;
  document.querySelectorAll<HTMLButtonElement>("[data-facing]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.facing === placementFacing));
  });
  if (selected) {
    const stack = stackAt(selected);
    inspectNode.textContent = `CELL ${selected.q},${selected.r} // HEIGHT ${stack.length} // ${stack.length ? stack.map((tile) => `${tile.name.toUpperCase()}:${playerLabel(tile.owner)}:${tile.facing}${tile.frozen ? ":FROZEN" : ""}`).join(" > ") : "EMPTY"}`;
    bufferNode.textContent = stack.length
      ? `MOVE ${selectedCount} FROM ${selected.q},${selected.r} // CLICK OR DRAG TO DESTINATION`
      : "PLACE MODE // SELECT EMPTY CELL";
  } else {
    inspectNode.textContent = "SELECT A CELL";
    bufferNode.textContent = selectedReserve
      ? `PLAY ${selectedReserve.toUpperCase()} // FACING ${placementFacing}`
      : "SELECT A RESERVE TILE OR BOARD STACK";
  }
}

async function submit(action: GameAction): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    game = await gameApi.act(action);
    if (action.type === "place" && game.move_number === 1) {
      placementFacing = oppositeFacing[action.facing];
    }
    logNode.textContent = `${playerLabel(action.player)} ${action.type.toUpperCase()} ACCEPTED`;
    selected = null;
    selectedCount = 0;
    selectedReserve = null;
    selectDefaultSetupTile();
  } catch (error) {
    logNode.textContent = `REJECTED // ${error instanceof Error ? error.message : "UNKNOWN ERROR"}`;
  } finally {
    busy = false;
    render();
  }
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
      logNode.textContent = "REJECTED // OPPONENT CONTROLS THAT STACK";
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
    logNode.textContent = "REJECTED // OPPONENT CONTROLS THAT STACK";
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
  render();
}

async function reset(): Promise<void> {
  game = await gameApi.reset();
  selected = null;
  selectedCount = 0;
  selectedReserve = null;
  selectDefaultSetupTile();
  logNode.textContent = "MATCH RESET // AMBER TO MOVE";
  render();
}

document.querySelector("#cancel")?.addEventListener("click", cancel);
document.querySelector("#reset")?.addEventListener("click", () => void reset());
reserveNode.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-tile-id]");
  if (!button) return;
  selectedReserve = button.dataset.tileId ?? null;
  selected = null;
  selectedCount = 0;
  render();
});
document.querySelectorAll<HTMLButtonElement>("[data-facing]").forEach((button) => {
  button.addEventListener("click", () => {
    placementFacing = button.dataset.facing as Facing;
    render();
  });
});
function rotatePlacement(quarterTurns: -1 | 1): void {
  const facingIndex = facings.indexOf(placementFacing);
  const rotatedFacing = facings[(facingIndex + quarterTurns + facings.length) % facings.length];
  if (!rotatedFacing) throw new Error("Placement rotation produced an invalid facing");
  placementFacing = rotatedFacing;
  render();
}
document.querySelector("#placement-left")?.addEventListener("click", () => rotatePlacement(-1));
document.querySelector("#placement-right")?.addEventListener("click", () => rotatePlacement(1));
document.querySelector("#scope")?.addEventListener("click", () => {
  rotateWholeStack = !rotateWholeStack;
  requireElement<HTMLButtonElement>("#scope").textContent = `SCOPE: ${rotateWholeStack ? "STACK" : "TOP"}`;
});
async function rotate(quarterTurns: -1 | 1): Promise<void> {
  if (!selected) {
    logNode.textContent = "REJECTED // SELECT A CONTROLLED STACK";
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
    logNode.textContent = "REJECTED // SELECT A CONTROLLED STACK";
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
document.addEventListener("keydown", (event) => {
  if (event.target instanceof HTMLInputElement) return;
  if (event.key === "Escape") cancel();
  if (event.key.toLowerCase() === "q") rotatePlacement(-1);
  if (event.key.toLowerCase() === "e") rotatePlacement(1);
  if (event.key.toLowerCase() === "r") void reset();
});

gameApi.load().then((loaded) => {
  game = loaded;
  selectDefaultSetupTile();
  render();
}).catch((error: unknown) => {
  logNode.textContent = `OFFLINE // ${error instanceof Error ? error.message : "API UNAVAILABLE"}`;
});
