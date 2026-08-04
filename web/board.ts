import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import { type CellState, type GameState } from "./game";

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
  grid: 0x928374,
  selected: 0xfe8019,
};
const CELL_SIZE = 1.48;
const TILE_HEIGHT = 0.28;
const CLICK_DISTANCE = 5;
const GROUND_SIZE = 2000;
const GRID_RADIUS = 50;

function worldPosition(q: number, r: number): THREE.Vector3 {
  return new THREE.Vector3(q * CELL_SIZE, 0, r * CELL_SIZE);
}

function createGrid(): THREE.LineSegments {
  const extent = GRID_RADIUS * CELL_SIZE;
  const vertices: number[] = [];
  for (let index = -GRID_RADIUS; index <= GRID_RADIUS; index += 1) {
    const offset = (index - 0.5) * CELL_SIZE;
    vertices.push(-extent, 0, offset, extent, 0, offset);
    vertices.push(offset, 0, -extent, offset, 0, extent);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  return new THREE.LineSegments(
    geometry,
    new THREE.LineBasicMaterial({ color: COLORS.grid, transparent: true, opacity: 0.52 }),
  );
}

function createField(): THREE.InstancedMesh {
  const width = GRID_RADIUS * 2 + 1;
  const field = new THREE.InstancedMesh(
    new THREE.BoxGeometry(CELL_SIZE * 0.91, 0.08, CELL_SIZE * 0.91),
    new THREE.MeshStandardMaterial({ color: 0x3c3836, roughness: 0.78, metalness: 0.04 }),
    width * width,
  );
  const matrix = new THREE.Matrix4();
  let instance = 0;
  for (let q = -GRID_RADIUS; q <= GRID_RADIUS; q += 1) {
    for (let r = -GRID_RADIUS; r <= GRID_RADIUS; r += 1) {
      matrix.makeTranslation(q * CELL_SIZE, 0, r * CELL_SIZE);
      field.setMatrixAt(instance, matrix);
      instance += 1;
    }
  }
  field.instanceMatrix.needsUpdate = true;
  return field;
}

export class BoardView {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(38, 1, 0.1, 2200);
  private readonly renderer = new THREE.WebGLRenderer({ antialias: true });
  private readonly controls: OrbitControls;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly cells = new THREE.Group();
  private readonly targets: THREE.Mesh[] = [];
  private readonly ground = new THREE.Mesh(
    new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
  );
  private readonly grid = createGrid();
  private readonly field = createField();
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
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.y = -0.02;
    this.grid.position.y = -0.01;
    this.scene.add(this.ground, this.field, this.grid, this.cells);
    this.targets.push(this.ground);
    this.camera.position.set(9.5, 11.5, 12.5);
    this.camera.lookAt(0, 0, 0);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.domElement.setAttribute("aria-label", "Interactive three-dimensional game board");
    this.host.append(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = false;
    this.controls.enablePan = true;
    this.controls.minDistance = 10;
    this.controls.maxDistance = 60;
    this.controls.maxPolarAngle = Math.PI * 0.47;
    this.controls.addEventListener("change", () => {
      this.centerGround();
      this.render();
    });

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
    this.targets.length = 1;
    state.board.forEach((cell) => this.addCell(cell));
    if (this.selected && !state.board.some((cell) => cell.q === this.selected?.q && cell.r === this.selected?.r)) {
      this.addSelectionMarker(this.selected);
    }
    this.render();
  }

  private addCell(cell: CellState): void {
    const { q, r } = cell;
    const position = worldPosition(q, r);
    const selected = this.selected?.q === q && this.selected.r === r;
    cell.stack.forEach((player, index) => {
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

  private addSelectionMarker(coordinate: BoardCoordinate): void {
    const marker = new THREE.Mesh(
      new THREE.PlaneGeometry(CELL_SIZE * 0.88, CELL_SIZE * 0.88),
      new THREE.MeshBasicMaterial({ color: COLORS.selected, transparent: true, opacity: 0.42 }),
    );
    marker.rotation.x = -Math.PI / 2;
    marker.position.copy(worldPosition(coordinate.q, coordinate.r));
    marker.position.y = 0.01;
    this.cells.add(marker);
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
    const coordinate = hit ? this.coordinateForHit(hit) : undefined;
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
    const destination = hit ? this.coordinateForHit(hit) : undefined;
    if (interaction.selection && distance > CLICK_DISTANCE && destination) {
      this.onMove(interaction.selection, destination, interaction.selection.count);
      return;
    }
    if (distance <= CLICK_DISTANCE && destination) {
      const count = hit?.object.userData.count as number | undefined;
      this.onCell(destination, count);
    }
  }

  private coordinateForHit(hit: THREE.Intersection<THREE.Mesh>): BoardCoordinate {
    const q = hit.object === this.ground
      ? Math.round(hit.point.x / CELL_SIZE)
      : (hit.object.userData.q as number);
    const r = hit.object === this.ground
      ? Math.round(hit.point.z / CELL_SIZE)
      : (hit.object.userData.r as number);
    return { q, r };
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

  private centerGround(): void {
    const x = Math.round(this.controls.target.x / CELL_SIZE) * CELL_SIZE;
    const z = Math.round(this.controls.target.z / CELL_SIZE) * CELL_SIZE;
    this.ground.position.set(x, -0.02, z);
    this.field.position.set(x, 0, z);
    this.grid.position.set(x, -0.01, z);
  }

  private render(): void {
    this.renderer.render(this.scene, this.camera);
  }
}
