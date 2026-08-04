import "./styles.css";

import { BoardView, type BoardCoordinate } from "./board";
import { cellKey, gameApi, playerLabel, type GameAction, type GameState } from "./game";

const app = document.querySelector<HTMLElement>("#app");
if (!app) throw new Error("Application mount point is missing");

app.innerHTML = `
  <header><b>ARBORIUS</b><span>CANOPY COMMAND // ONLINE</span><span id="clock">TURN 000</span></header>
  <section class="board-pane"><div class="titlebar">TACTICAL CANOPY // 7 × 7 ORTHOGONAL GRID</div><div id="board"></div></section>
  <aside class="intel">
    <div class="titlebar">GAME STATE</div>
    <dl id="state"></dl>
    <div class="titlebar">STACK INSPECTOR</div>
    <div id="inspect" class="readout">SELECT A CELL</div>
    <div class="titlebar">ACTION BUFFER</div>
    <label>CARRY COUNT <input id="carry" type="number" min="1" max="5" value="1"></label>
    <div id="buffer" class="readout">PLACE MODE // SELECT EMPTY CELL</div>
    <div class="commands"><button id="cancel">ESC CANCEL</button><button id="reset">R RESET</button></div>
    <div class="titlebar">RULE CORE</div>
    <ol><li>Place on any empty square.</li><li>Select your top-controlled stack, then an orthogonally adjacent square.</li><li>Carry up to five top tiles; stack height cannot exceed five.</li><li>Amber joins west/east. Teal joins north/south.</li></ol>
    <div class="titlebar">EVENT LOG</div><output id="log">SYSTEM READY</output>
  </aside>
  <footer><span>CLICK: SELECT / PLACE / MOVE</span><span>DRAG: ORBIT</span><span>WHEEL: ZOOM</span><span>ESC: CANCEL</span></footer>`;

function requireElement<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Required interface node is missing: ${selector}`);
  return element;
}

const boardHost = requireElement<HTMLElement>("#board");
const stateNode = requireElement<HTMLElement>("#state");
const inspectNode = requireElement<HTMLElement>("#inspect");
const bufferNode = requireElement<HTMLElement>("#buffer");
const logNode = requireElement<HTMLOutputElement>("#log");
const carryNode = requireElement<HTMLInputElement>("#carry");
const clockNode = requireElement<HTMLElement>("#clock");

let game: GameState;
let selected: BoardCoordinate | null = null;
let busy = false;
const board = new BoardView(boardHost, (coordinate) => void choose(coordinate));

function stackAt(coordinate: BoardCoordinate) {
  return game.board.find((cell) => cell.q === coordinate.q && cell.r === coordinate.r)?.stack ?? [];
}

function render(): void {
  board.setSelected(selected);
  board.update(game);
  clockNode.textContent = `TURN ${String(game.move_number).padStart(3, "0")}`;
  const winner = game.winner ? `${playerLabel(game.winner)} VICTORY` : "CONTESTED";
  stateNode.innerHTML = `<dt>ACTIVE</dt><dd class="${game.turn}">${playerLabel(game.turn)}</dd>
    <dt>STATUS</dt><dd>${winner}</dd><dt>AMBER RESERVE</dt><dd>${game.reserves.amber}</dd>
    <dt>TEAL RESERVE</dt><dd>${game.reserves.teal}</dd><dt>HEIGHT / CARRY</dt><dd>${game.max_height} / ${game.carry_limit}</dd>`;
  if (selected) {
    const stack = stackAt(selected);
    inspectNode.textContent = `CELL ${selected.q},${selected.r} // HEIGHT ${stack.length} // ${stack.length ? stack.map(playerLabel).join(" > ") : "EMPTY"}`;
    bufferNode.textContent = stack.length
      ? `MOVE SOURCE ${selected.q},${selected.r} // SELECT ADJACENT DESTINATION`
      : "PLACE MODE // SELECT EMPTY CELL";
  } else {
    inspectNode.textContent = "SELECT A CELL";
    bufferNode.textContent = "PLACE MODE // SELECT EMPTY CELL";
  }
}

async function submit(action: GameAction): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    game = await gameApi.act(action);
    logNode.textContent = `${playerLabel(action.player)} ${action.type.toUpperCase()} ACCEPTED`;
    selected = null;
  } catch (error) {
    logNode.textContent = `REJECTED // ${error instanceof Error ? error.message : "UNKNOWN ERROR"}`;
  } finally {
    busy = false;
    render();
  }
}

async function choose(coordinate: BoardCoordinate): Promise<void> {
  if (game.winner || busy) return;
  const target = stackAt(coordinate);
  if (!selected) {
    if (!target.length) {
      await submit({ type: "place", player: game.turn, ...coordinate });
      return;
    }
    if (target.at(-1) === game.turn) {
      selected = coordinate;
      render();
    } else {
      logNode.textContent = "REJECTED // OPPONENT CONTROLS THAT STACK";
    }
    return;
  }
  if (cellKey(selected.q, selected.r) === cellKey(coordinate.q, coordinate.r)) {
    selected = null;
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
    count: Number(carryNode.value),
  });
}

function cancel(): void {
  selected = null;
  render();
}

async function reset(): Promise<void> {
  game = await gameApi.reset();
  selected = null;
  logNode.textContent = "MATCH RESET // AMBER TO MOVE";
  render();
}

document.querySelector("#cancel")?.addEventListener("click", cancel);
document.querySelector("#reset")?.addEventListener("click", () => void reset());
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") cancel();
  if (event.key.toLowerCase() === "r") void reset();
});

gameApi.load().then((loaded) => {
  game = loaded;
  render();
}).catch((error: unknown) => {
  logNode.textContent = `OFFLINE // ${error instanceof Error ? error.message : "API UNAVAILABLE"}`;
});
