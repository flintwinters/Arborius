import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import { cellKey, type CellState, type GameState } from "./game";

export interface BoardCoordinate {
  q: number;
  r: number;
}

export interface StackSelection extends BoardCoordinate {
  count: number;
}

interface PointerInteraction {
  x: number;
  y: number;
  selection: StackSelection | null;
}

const COLORS = {
  amber: 0xfabd2f,
  teal: 0x8ec07c,
  board: 0x3c3836,
  empty: 0x504945,
  grid: 0x928374,
  selected: 0xfe8019,
};
const CELL_SIZE = 1.48;
const TILE_HEIGHT = 0.28;
const CLICK_DISTANCE = 5;

function worldPosition(q: number, r: number): THREE.Vector3 {
  return new THREE.Vector3(q * CELL_SIZE, 0, r * CELL_SIZE);
}

export class BoardView {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
  private readonly renderer = new THREE.WebGLRenderer({ antialias: true });
  private readonly controls: OrbitControls;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly cells = new THREE.Group();
  private readonly targets: THREE.Mesh[] = [];
  private selected: BoardCoordinate | null = null;
  private selectedCount = 0;
  private interaction: PointerInteraction | null = null;

  constructor(
    private readonly host: HTMLElement,
    private readonly onCell: (coordinate: BoardCoordinate, count?: number) => void,
    private readonly onMove: (
      source: BoardCoordinate,
      destination: BoardCoordinate,
      count: number,
    ) => void,
  ) {
    this.scene.background = new THREE.Color(0x1d2021);
    this.scene.add(this.cells);
    this.camera.position.set(9.5, 11.5, 12.5);
    this.camera.lookAt(0, 0, 0);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.domElement.setAttribute("aria-label", "Interactive three-dimensional game board");
    this.host.append(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = false;
    this.controls.enablePan = false;
    this.controls.minDistance = 10;
    this.controls.maxDistance = 26;
    this.controls.maxPolarAngle = Math.PI * 0.47;
    this.controls.addEventListener("change", () => this.render());

    const ambient = new THREE.HemisphereLight(0xebdbb2, 0x1d2021, 2.5);
    const key = new THREE.DirectionalLight(0xffffff, 3.5);
    key.position.set(-4, 10, 6);
    this.scene.add(ambient, key);

    this.renderer.domElement.addEventListener("pointerdown", (event) => this.handlePointerDown(event));
    this.renderer.domElement.addEventListener("pointercancel", () => this.cancelInteraction());
    this.renderer.domElement.addEventListener("pointerup", (event) => this.handlePointerUp(event));
    new ResizeObserver(() => this.resize()).observe(this.host);
    this.resize();
  }

  setSelected(coordinate: BoardCoordinate | null, count = 0): void {
    this.selected = coordinate;
    this.selectedCount = count;
  }

  update(state: GameState): void {
    this.cells.clear();
    this.targets.length = 0;
    const occupied = new Map(state.board.map((cell) => [cellKey(cell.q, cell.r), cell]));
    for (let q = -state.radius; q <= state.radius; q += 1) {
      for (let r = -state.radius; r <= state.radius; r += 1) {
        this.addCell(q, r, occupied.get(cellKey(q, r)));
      }
    }
    this.render();
  }

  private addCell(q: number, r: number, cell?: CellState): void {
    const position = worldPosition(q, r);
    const selected = this.selected?.q === q && this.selected.r === r;
    const base = new THREE.Mesh(
      new THREE.BoxGeometry(CELL_SIZE * 0.91, 0.12, CELL_SIZE * 0.91),
      new THREE.MeshStandardMaterial({
        color: selected ? COLORS.selected : COLORS.board,
        roughness: 0.72,
        metalness: 0.08,
      }),
    );
    base.position.copy(position);
    base.userData = { q, r };
    this.cells.add(base);
    this.targets.push(base);

    const outline = new THREE.LineSegments(
      new THREE.EdgesGeometry(base.geometry),
      new THREE.LineBasicMaterial({ color: selected ? COLORS.selected : COLORS.grid }),
    );
    outline.position.copy(position);
    this.cells.add(outline);

    cell?.stack.forEach((player, index) => {
      const carried = selected && index >= cell.stack.length - this.selectedCount;
      const tile = new THREE.Mesh(
        new THREE.BoxGeometry(CELL_SIZE * 0.76, TILE_HEIGHT, CELL_SIZE * 0.76),
        new THREE.MeshStandardMaterial({
          color: carried ? COLORS.selected : COLORS[player],
          roughness: 0.42,
          metalness: 0.12,
        }),
      );
      tile.position.set(position.x, 0.14 + TILE_HEIGHT * (index + 0.5), position.z);
      tile.userData = { q, r, count: cell.stack.length - index };
      this.cells.add(tile);
      this.targets.push(tile);
      const rim = new THREE.LineSegments(
        new THREE.EdgesGeometry(tile.geometry),
        new THREE.LineBasicMaterial({ color: player === "amber" ? 0xfff2a8 : 0xd5ffd0 }),
      );
      rim.position.copy(tile.position);
      this.cells.add(rim);
    });
  }

  private pick(event: PointerEvent): THREE.Intersection<THREE.Mesh> | undefined {
    const bounds = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(
      ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
      -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
    return this.raycaster.intersectObjects(this.targets, false)[0] as
      | THREE.Intersection<THREE.Mesh>
      | undefined;
  }

  private handlePointerDown(event: PointerEvent): void {
    const hit = this.pick(event);
    const count = hit?.object.userData.count as number | undefined;
    const coordinate = hit?.object.userData as BoardCoordinate | undefined;
    const selection = coordinate && count ? { ...coordinate, count } : null;
    this.interaction = { x: event.clientX, y: event.clientY, selection };
    if (selection) {
      this.controls.enabled = false;
      this.renderer.domElement.setPointerCapture(event.pointerId);
      this.onCell(selection, count);
    }
  }

  private handlePointerUp(event: PointerEvent): void {
    const interaction = this.interaction;
    this.cancelInteraction(event.pointerId);
    if (!interaction) return;

    const distance = Math.hypot(event.clientX - interaction.x, event.clientY - interaction.y);
    const hit = this.pick(event);
    const destination = hit?.object.userData as BoardCoordinate | undefined;
    if (interaction.selection && distance > CLICK_DISTANCE && destination) {
      this.onMove(interaction.selection, destination, interaction.selection.count);
      return;
    }
    if (distance <= CLICK_DISTANCE && destination) {
      const count = hit?.object.userData.count as number | undefined;
      this.onCell(destination, count);
    }
  }

  private cancelInteraction(pointerId?: number): void {
    this.interaction = null;
    this.controls.enabled = true;
    if (pointerId !== undefined && this.renderer.domElement.hasPointerCapture(pointerId)) {
      this.renderer.domElement.releasePointerCapture(pointerId);
    }
  }

  private resize(): void {
    const width = Math.max(this.host.clientWidth, 1);
    const height = Math.max(this.host.clientHeight, 1);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    this.render();
  }

  private render(): void {
    this.renderer.render(this.scene, this.camera);
  }
}
