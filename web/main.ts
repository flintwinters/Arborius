import "./styles.css";

import { BoardView, type BoardCoordinate, type RotationPreview, type SelectionControlAction } from "./board";
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
    <output id="log" class="notice" aria-live="assertive"></output>
    <div class="commands utility"><button id="cancel">Clear selection</button><button id="reset">New game</button></div>
  </aside>
  <section id="game-over" class="game-over" role="dialog" aria-modal="true" aria-labelledby="game-over-title" hidden>
    <div class="game-over-card"><h2 id="game-over-title">Game over</h2><p id="game-over-message"></p><button id="play-again">New game</button></div>
  </section>`;

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
const turnNode = requireElement<HTMLElement>("#turn");
const gameOverNode = requireElement<HTMLElement>("#game-over");
const gameOverMessageNode = requireElement<HTMLElement>("#game-over-message");

let game: GameState;
let selected: BoardCoordinate | null = null;
let selectedCount = 0;
let proposedAction: GameAction | null = null;
let selectedReserve: string | null = null;
let pendingPlacement: BoardCoordinate | null = null;
let placementFacing: Facing = "N";
let rotateWholeStack = false;
let busy = false;
let notice: { kind: "success" | "error"; text: string } | null = null;
const oppositeFacing: Record<Facing, Facing> = { N: "S", E: "W", S: "N", W: "E" };
const board = new BoardView(
  boardHost,
  (coordinate, count) => void choose(coordinate, count),
  (source, destination, count) => void move(source, destination, count),
  (action) => void handlePlacementControl(action),
  (action) => void handleSelectionControl(action),
);

function stackAt(coordinate: BoardCoordinate) {
  return game.board.find((cell) => cell.q === coordinate.q && cell.r === coordinate.r)?.stack ?? [];
}

function canRotateSelection(): boolean {
  if (!selected) return false;
  const stack = stackAt(selected);
  const targets = rotateWholeStack ? stack : stack.slice(-selectedCount);
  return stack.at(-1)?.owner === game.turn && targets.length > 0 && targets.every((tile) => !tile.frozen);
}

const facingVector: Record<Facing, BoardCoordinate> = {
  N: { q: 0, r: -1 }, E: { q: 1, r: 0 }, S: { q: 0, r: 1 }, W: { q: -1, r: 0 },
};
const facings = Object.keys(facingVector) as Facing[];

function legalPlacementFacings(coordinate: BoardCoordinate): Facing[] {
  if (game.move_number === 0) return facings;
  if (game.move_number === 1) {
    const openingFacing = game.board[0]?.stack[0]?.facing;
    return openingFacing ? [oppositeFacing[openingFacing]] : [];
  }
  return facings.filter((facing) => {
    const vector = facingVector[facing];
    const anchor = stackAt({ q: coordinate.q + vector.q, r: coordinate.r + vector.r }).at(-1);
    return anchor?.owner === game.turn && !anchor.frozen;
  });
}

function destinations(): BoardCoordinate[] {
  if (selected) {
    const source = selected;
    return game.legal_moves
      .filter((move) => move.from_q === source.q
        && move.from_r === source.r
        && move.count === selectedCount)
      .map((move) => ({ q: move.to_q, r: move.to_r }));
  }
  if (!selectedReserve) return [];
  if (game.move_number === 0) return [{ q: 0, r: 0 }];
  if (game.move_number === 1) {
    return [-1, 1].flatMap((q) => [-1, 1].map((r) => ({ q, r })));
  }
  const candidates = game.board
    .filter((cell) => cell.stack.at(-1)?.owner === game.turn && !cell.stack.at(-1)?.frozen)
    .flatMap((cell) => facings.map((facing) => {
      const vector = facingVector[facing];
      return { q: cell.q - vector.q, r: cell.r - vector.r };
    }))
    .filter((candidate) => stackAt(candidate).at(-1)?.owner !== (game.turn === "amber" ? "teal" : "amber"));
  return candidates.filter((candidate, index) =>
    candidates.findIndex((other) => cellKey(other.q, other.r) === cellKey(candidate.q, candidate.r)) === index
  );
}

function isDestination(coordinate: BoardCoordinate): boolean {
  return destinations().some((destination) =>
    cellKey(destination.q, destination.r) === cellKey(coordinate.q, coordinate.r)
  );
}

function proposedMovePreview(): BoardCoordinate | null {
  if (proposedAction?.type !== "move") return null;
  return { q: proposedAction.to_q, r: proposedAction.to_r };
}

function proposedRotationPreview(): RotationPreview | null {
  if (proposedAction?.type !== "rotate") return null;
  return {
    coordinate: { q: proposedAction.q, r: proposedAction.r },
    count: proposedAction.count,
    wholeStack: proposedAction.whole_stack,
    quarterTurns: proposedAction.quarter_turns,
  };
}

function proposedActionText(): string {
  if (!proposedAction) return "";
  if (proposedAction.type === "move") return `Move proposed. Press End turn to move ${proposedAction.count} tile${proposedAction.count === 1 ? "" : "s"} to the marked stack.`;
  if (proposedAction.type === "rotate") return `Rotation proposed. Press End turn to rotate ${proposedAction.whole_stack ? "the stack" : `${proposedAction.count} tile${proposedAction.count === 1 ? "" : "s"}`}.`;
  if (proposedAction.type === "place") return `Placement proposed. Press End turn to place the tile.`;
  return "Return proposed. Press End turn to return the top tile.";
}

function propose(action: GameAction): void {
  proposedAction = action;
  notice = null;
  render();
}

function promptText(): string {
  if (game.winner) return `${playerLabel(game.winner)} controls the canopy.`;
  if (busy) return "Resolving action…";
  if (selected) {
    if (proposedAction) return proposedActionText();
    const top = stackAt(selected).at(-1);
    const destination = destinations()[0];
    return destination
      ? `${selectedCount} tile${selectedCount === 1 ? "" : "s"} ready. Move ${top?.facing ?? "forward"} to the green marker, or choose an action below.`
      : "Choose an action for this stack.";
  }
  if (selectedReserve) {
    if (proposedAction) return proposedActionText();
    const tile = game.reserves[game.turn].find((candidate) => candidate.id === selectedReserve);
    return pendingPlacement
      ? `${tile?.name ?? "Tile"} ready. Rotate it on the board, then end the turn.`
      : `${tile?.name ?? "Tile"} ready. Choose a green marker to preview it.`;
  }
  return "Choose one of your stacks, or choose a tile from reserve.";
}

function selectDefaultSetupTile(): void {
  if (game.move_number < 2 && selectedReserve === null) {
    selectedReserve = game.reserves[game.turn][0]?.id ?? null;
  }
}

function render(): void {
  board.setSelected(
    selected,
    selectedCount,
    rotateWholeStack,
    canRotateSelection(),
    proposedMovePreview(),
    proposedRotationPreview(),
    proposedAction !== null,
    busy || game.winner !== null,
  );
  board.setDestinations(destinations());
  const placementTile = game.reserves[game.turn].find((tile) => tile.id === selectedReserve);
  board.setPlacementPreview(pendingPlacement && placementTile
    ? {
        coordinate: pendingPlacement,
        tile: { ...placementTile, facing: placementFacing },
        canRotate: legalPlacementFacings(pendingPlacement).length > 1,
        canEndTurn: proposedAction?.type === "place",
      }
    : null);
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
    `<button data-tile-id="${tile.id}" aria-pressed="${selectedReserve === tile.id}">${tile.name}</button>`,
  ).join("");
  gameOverNode.hidden = game.winner === null;
  gameOverMessageNode.textContent = game.winner ? `${playerLabel(game.winner)} wins.` : "";
  document.querySelectorAll<HTMLButtonElement>("button").forEach((button) => {
    button.disabled = busy || (game.winner !== null && button.id !== "reset" && button.id !== "play-again");
  });
  requireElement<HTMLButtonElement>("#cancel").disabled = busy || (selected === null && selectedReserve === null);
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
    proposedAction = null;
    selectedReserve = null;
    pendingPlacement = null;
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
  if (action.type === "rotate") return `${action.whole_stack ? "Stack" : `${action.count} tile${action.count === 1 ? "" : "s"}`} rotated. Turn passed.`;
  return "Top tile returned to reserve. Turn passed.";
}

async function choose(coordinate: BoardCoordinate, count?: number): Promise<void> {
  if (game.winner || busy) return;
  const target = stackAt(coordinate);
  if (selectedReserve) {
    if (!destinations().some((destination) => cellKey(destination.q, destination.r) === cellKey(coordinate.q, coordinate.r))) {
      notice = { kind: "error", text: "Choose one of the green placement markers." };
      render();
      return;
    }
    pendingPlacement = coordinate;
    const legalFacings = legalPlacementFacings(coordinate);
    if (!legalFacings.includes(placementFacing) && legalFacings[0]) placementFacing = legalFacings[0];
    proposePlacement();
    return;
  }
  if (!selected) {
    if (target.at(-1)?.owner === game.turn) {
      selected = coordinate;
      selectedCount = count ?? 1;
      rotateWholeStack = false;
      proposedAction = null;
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
    proposedAction = null;
    render();
    return;
  }
  if (!isDestination(coordinate)) {
    notice = { kind: "error", text: "Choose one of the green movement markers." };
    render();
    return;
  }
  propose({
    type: "move",
    player: game.turn,
    from_q: selected.q,
    from_r: selected.r,
    to_q: coordinate.q,
    to_r: coordinate.r,
    count: selectedCount,
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
  if (!isDestination(destination)) {
    notice = { kind: "error", text: "Choose one of the green movement markers." };
    render();
    return;
  }
  propose({
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
  proposedAction = null;
  selectedReserve = null;
  pendingPlacement = null;
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
    proposedAction = null;
    selectedReserve = null;
    pendingPlacement = null;
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
document.querySelector("#play-again")?.addEventListener("click", () => void reset());
reserveNode.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-tile-id]");
  if (!button) return;
  selectedReserve = button.dataset.tileId ?? null;
  pendingPlacement = null;
  selected = null;
  selectedCount = 0;
  proposedAction = null;
  notice = null;
  render();
});
function proposePlacement(): void {
  if (!pendingPlacement || !selectedReserve) return;
  propose({
    type: "place",
    player: game.turn,
    tile_id: selectedReserve,
    q: pendingPlacement.q,
    r: pendingPlacement.r,
    facing: placementFacing,
  });
}

async function handlePlacementControl(action: "left" | "right" | "end-turn" | "cancel"): Promise<void> {
  if (action === "cancel") {
    pendingPlacement = null;
    proposedAction = null;
    render();
    return;
  }
  if (!pendingPlacement || !selectedReserve) return;
  if (action === "end-turn") {
    await endTurn();
    return;
  }
  const legalFacings = legalPlacementFacings(pendingPlacement);
  const currentIndex = legalFacings.indexOf(placementFacing);
  const step = action === "left" ? -1 : 1;
  const nextFacing = legalFacings[(currentIndex + step + legalFacings.length) % legalFacings.length];
  if (nextFacing) placementFacing = nextFacing;
  proposePlacement();
}
async function rotate(quarterTurns: -1 | 1): Promise<void> {
  if (!selected) {
    notice = { kind: "error", text: "Select one of your stacks first." };
    render();
    return;
  }
  propose({
    type: "rotate",
    player: game.turn,
    q: selected.q,
    r: selected.r,
    quarter_turns: quarterTurns,
    whole_stack: rotateWholeStack,
    count: selectedCount,
  });
}
async function handleSelectionControl(action: SelectionControlAction): Promise<void> {
  if (action === "cancel") {
    if (proposedAction) {
      proposedAction = null;
      render();
      return;
    }
    cancel();
    return;
  }
  if (action === "scope") {
    rotateWholeStack = !rotateWholeStack;
    render();
    return;
  }
  if (action === "end-turn") {
    await endTurn();
    return;
  }
  if (action === "left" || action === "right") {
    await rotate(action === "left" ? -1 : 1);
    return;
  }
  if (!selected) return;
  propose({ type: "unplay", player: game.turn, q: selected.q, r: selected.r });
}

async function endTurn(): Promise<void> {
  if (!proposedAction) return;
  await submit(proposedAction);
}
document.addEventListener("keydown", (event) => {
  if (event.target instanceof HTMLInputElement) return;
  if (event.key === "Escape") cancel();
  if (pendingPlacement && event.key.toLowerCase() === "q") void handlePlacementControl("left");
  if (pendingPlacement && event.key.toLowerCase() === "e") void handlePlacementControl("right");
  if (proposedAction && event.key === "Enter") void endTurn();
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
