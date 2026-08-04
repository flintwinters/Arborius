export type Player = "amber" | "teal";

export interface CellState {
  q: number;
  r: number;
  stack: Player[];
}

export interface GameState {
  max_height: number;
  carry_limit: number;
  turn: Player;
  winner: Player | null;
  move_number: number;
  reserves: Record<Player, number>;
  board: CellState[];
}

export type GameAction =
  | { type: "place"; player: Player; q: number; r: number }
  | {
      type: "move";
      player: Player;
      from_q: number;
      from_r: number;
      to_q: number;
      to_r: number;
      count: number;
    };

async function request(path: string, init?: RequestInit): Promise<GameState> {
  const response = await fetch(path, init);
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
