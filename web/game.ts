export type Player = "amber" | "teal";
export type Facing = "N" | "E" | "S" | "W";

export interface Tile {
  id: string;
  name: string;
  owner: Player;
  facing: Facing;
  frozen: boolean;
}

export interface CellState {
  q: number;
  r: number;
  stack: Tile[];
}

export interface GameState {
  turn: Player;
  winner: Player | null;
  move_number: number;
  reserves: Record<Player, Tile[]>;
  board: CellState[];
}

export type GameAction =
  | { type: "place"; player: Player; tile_id: string; q: number; r: number; facing: Facing }
  | {
      type: "move";
      player: Player;
      from_q: number;
      from_r: number;
      to_q: number;
      to_r: number;
      count: number;
    }
  | { type: "rotate"; player: Player; q: number; r: number; quarter_turns: -1 | 1; whole_stack: boolean }
  | { type: "unplay"; player: Player; q: number; r: number };

async function request(path: string, init?: RequestInit): Promise<GameState> {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new Error("The game is unavailable. Try again.");
  }
  const body = (await response.json()) as GameState | { detail?: string };
  if (!response.ok) {
    throw new Error("detail" in body ? body.detail ?? "Action rejected" : "Action rejected");
  }
  return body as GameState;
}

export const gameApi = {
  load: () => request("/api/game"),
  reset: () => request("/api/game/reset", { method: "POST" }),
  act: (action: GameAction) =>
    request("/api/game/actions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(action),
    }),
};

export const cellKey = (q: number, r: number): string => `${q},${r}`;

export function playerLabel(player: Player): string {
  return player.toUpperCase();
}
