import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import { cellKey, type CellState, type GameState } from "./game";

export interface BoardCoordinate {
  q: number;
  r: number;
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

  constructor(
    private readonly host: HTMLElement,
    private readonly onCell: (coordinate: BoardCoordinate) => void,
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

    this.renderer.domElement.addEventListener("pointerup", (event) => this.pick(event));
    new ResizeObserver(() => this.resize()).observe(this.host);
    this.resize();
  }

  setSelected(coordinate: BoardCoordinate | null): void {
    this.selected = coordinate;
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
      const tile = new THREE.Mesh(
        new THREE.BoxGeometry(CELL_SIZE * 0.76, TILE_HEIGHT, CELL_SIZE * 0.76),
        new THREE.MeshStandardMaterial({
          color: COLORS[player],
          roughness: 0.42,
          metalness: 0.12,
        }),
      );
      tile.position.set(position.x, 0.14 + TILE_HEIGHT * (index + 0.5), position.z);
      tile.userData = { q, r };
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

  private pick(event: PointerEvent): void {
    const bounds = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(
      ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
      -((event.clientY - bounds.top) / bounds.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObjects(this.targets, false)[0];
    if (hit) {
      this.onCell(hit.object.userData as BoardCoordinate);
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
