import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import { type CellState, type Facing, type GameState, type Tile } from "./game";

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
  target: 0xb8bb26,
};
const CELL_SIZE = 1.48;
const TILE_HEIGHT = 0.28;
const CLICK_DISTANCE = 5;
const FIELD_PADDING = 1;

function worldPosition(q: number, r: number): THREE.Vector3 {
  return new THREE.Vector3(q * CELL_SIZE, 0, r * CELL_SIZE);
}

const FACING_ROTATION: Record<Facing, number> = {
  N: 0,
  E: -Math.PI / 2,
  S: Math.PI,
  W: Math.PI / 2,
};

function createFacingArrow(tile: Tile): THREE.Mesh {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0.3);
  shape.lineTo(-0.18, -0.2);
  shape.lineTo(0.18, -0.2);
  shape.closePath();
  const arrow = new THREE.Mesh(
    new THREE.ShapeGeometry(shape),
    new THREE.MeshBasicMaterial({ color: tile.frozen ? 0x665c54 : 0x1d2021, side: THREE.DoubleSide }),
  );
  arrow.rotation.set(-Math.PI / 2, 0, FACING_ROTATION[tile.facing]);
  return arrow;
}

export class BoardView {
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(38, 1, 0.1, 2200);
  private readonly renderer = new THREE.WebGLRenderer({ antialias: true });
  private readonly controls: OrbitControls;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly cells = new THREE.Group();
  private readonly ghost = new THREE.Group();
  private readonly hints = new THREE.Group();
  private readonly targets: THREE.Mesh[] = [];
  private readonly ground = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
  );
  private field: THREE.LineSegments | null = null;
  private selected: BoardCoordinate | null = null;
  private selectedCount = 0;
  private destinations: BoardCoordinate[] = [];
  private interaction: PointerInteraction | null = null;
  private state: GameState | null = null;

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
    this.scene.add(this.ground, this.hints, this.cells, this.ghost);
    this.targets.push(this.ground);
    this.camera.position.set(9.5, 11.5, 12.5);
    this.camera.lookAt(0, 0, 0);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.domElement.setAttribute("aria-label", "Interactive three-dimensional game board");
    this.host.append(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = false;
    this.controls.enablePan = false;
    this.controls.minDistance = 10;
    this.controls.maxDistance = 60;
    this.controls.maxPolarAngle = Math.PI * 0.47;
    this.controls.addEventListener("change", () => this.render());

    const ambient = new THREE.HemisphereLight(0xebdbb2, 0x1d2021, 2.5);
    const key = new THREE.DirectionalLight(0xffffff, 3.5);
    key.position.set(-4, 10, 6);
    this.scene.add(ambient, key);

    this.renderer.domElement.addEventListener("pointerdown", (event) => this.handlePointerDown(event));
    this.renderer.domElement.addEventListener("pointermove", (event) => this.handlePointerMove(event));
    this.renderer.domElement.addEventListener("pointercancel", () => this.cancelInteraction());
    this.renderer.domElement.addEventListener("pointerup", (event) => this.handlePointerUp(event));
    new ResizeObserver(() => this.resize()).observe(this.host);
    this.resize();
  }

  setSelected(coordinate: BoardCoordinate | null, count = 0): void {
    this.selected = coordinate;
    this.selectedCount = count;
  }

  setDestinations(destinations: BoardCoordinate[]): void {
    this.destinations = destinations;
  }

  update(state: GameState): void {
    this.state = state;
    this.cells.clear();
    this.targets.length = 1;
    this.updateField(state.board);
    this.updateHints();
    state.board.forEach((cell) => this.addCell(cell));
    if (this.selected && !state.board.some((cell) => cell.q === this.selected?.q && cell.r === this.selected?.r)) {
      this.addSelectionMarker(this.selected);
    }
    this.render();
  }

  private updateHints(): void {
    this.hints.clear();
    this.destinations.forEach((coordinate) => {
      const marker = new THREE.Mesh(
        new THREE.RingGeometry(CELL_SIZE * 0.31, CELL_SIZE * 0.41, 4),
        new THREE.MeshBasicMaterial({
          color: COLORS.target,
          transparent: true,
          opacity: 0.86,
          side: THREE.DoubleSide,
        }),
      );
      marker.rotation.set(-Math.PI / 2, 0, Math.PI / 4);
      marker.position.copy(worldPosition(coordinate.q, coordinate.r));
      const height = this.state?.board.find(
        (cell) => cell.q === coordinate.q && cell.r === coordinate.r,
      )?.stack.length ?? 0;
      marker.position.y = 0.02 + height * TILE_HEIGHT;
      this.hints.add(marker);
    });
  }

  private updateField(board: CellState[]): void {
    if (this.field) {
      this.scene.remove(this.field);
      this.field.geometry.dispose();
      if (Array.isArray(this.field.material)) {
        this.field.material.forEach((material) => material.dispose());
      } else {
        this.field.material.dispose();
      }
    }

    const qValues = board.map((cell) => cell.q);
    const rValues = board.map((cell) => cell.r);
    const minQ = (qValues.length ? Math.min(...qValues) : -1) - FIELD_PADDING;
    const maxQ = (qValues.length ? Math.max(...qValues) : 1) + FIELD_PADDING;
    const minR = (rValues.length ? Math.min(...rValues) : -1) - FIELD_PADDING;
    const maxR = (rValues.length ? Math.max(...rValues) : 1) + FIELD_PADDING;
    const columns = maxQ - minQ + 1;
    const rows = maxR - minR + 1;
    const left = (minQ - 0.5) * CELL_SIZE;
    const right = (maxQ + 0.5) * CELL_SIZE;
    const near = (minR - 0.5) * CELL_SIZE;
    const far = (maxR + 0.5) * CELL_SIZE;
    const vertices: number[] = [];
    for (let q = minQ; q <= maxQ + 1; q += 1) {
      const x = (q - 0.5) * CELL_SIZE;
      vertices.push(x, 0, near, x, 0, far);
    }
    for (let r = minR; r <= maxR + 1; r += 1) {
      const z = (r - 0.5) * CELL_SIZE;
      vertices.push(left, 0, z, right, 0, z);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
    const field = new THREE.LineSegments(
      geometry,
      new THREE.LineBasicMaterial({ color: COLORS.grid }),
    );
    this.field = field;
    this.scene.add(field);

    const centerQ = (minQ + maxQ) / 2;
    const centerR = (minR + maxR) / 2;
    this.ground.position.set(centerQ * CELL_SIZE, -0.02, centerR * CELL_SIZE);
    this.ground.scale.set(columns * CELL_SIZE, rows * CELL_SIZE, 1);
  }

  private addCell(cell: CellState): void {
    const { q, r } = cell;
    const position = worldPosition(q, r);
    const selected = this.selected?.q === q && this.selected.r === r;
    cell.stack.forEach((tileState, index) => {
      const carried = selected && index >= cell.stack.length - this.selectedCount;
      const tile = new THREE.Mesh(
        new THREE.BoxGeometry(CELL_SIZE * 0.76, TILE_HEIGHT, CELL_SIZE * 0.76),
        new THREE.MeshStandardMaterial({
          color: carried ? COLORS.selected : COLORS[tileState.owner],
          roughness: 0.42,
          metalness: 0.12,
        }),
      );
      tile.position.set(position.x, 0.14 + TILE_HEIGHT * (index + 0.5), position.z);
      tile.userData = { q, r, count: cell.stack.length - index };
      this.cells.add(tile);
      this.targets.push(tile);
      const arrow = createFacingArrow(tileState);
      arrow.position.set(position.x, tile.position.y + TILE_HEIGHT / 2 + 0.006, position.z);
      this.cells.add(arrow);
      const rim = new THREE.LineSegments(
        new THREE.EdgesGeometry(tile.geometry),
        new THREE.LineBasicMaterial({
          color: tileState.owner === "amber" ? 0xfff2a8 : 0xd5ffd0,
        }),
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
      this.createGhost(selection);
      this.positionGhost(selection);
    }
  }

  private handlePointerMove(event: PointerEvent): void {
    if (!this.interaction?.selection) return;
    const hit = this.pick(event);
    if (!hit) {
      this.ghost.visible = false;
      return;
    }
    this.positionGhost(this.coordinateForHit(hit), hit.point);
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
    this.clearGhost();
    if (pointerId !== undefined && this.renderer.domElement.hasPointerCapture(pointerId)) {
      this.renderer.domElement.releasePointerCapture(pointerId);
    }
  }

  private createGhost(selection: StackSelection): void {
    this.clearGhost();
    const stack = this.state?.board.find(
      (cell) => cell.q === selection.q && cell.r === selection.r,
    )?.stack;
    if (!stack) return;

    stack.slice(-selection.count).forEach((tileState, index) => {
      const tile = new THREE.Mesh(
        new THREE.BoxGeometry(CELL_SIZE * 0.76, TILE_HEIGHT, CELL_SIZE * 0.76),
        new THREE.MeshStandardMaterial({
          color: COLORS[tileState.owner],
          transparent: true,
          opacity: 0.48,
          depthWrite: false,
          roughness: 0.35,
          metalness: 0.08,
        }),
      );
      tile.position.y = TILE_HEIGHT * (index + 0.5);
      this.ghost.add(tile);
      const arrow = createFacingArrow(tileState);
      arrow.position.y = TILE_HEIGHT * (index + 1) + 0.006;
      this.ghost.add(arrow);
    });
  }

  private positionGhost(destination: BoardCoordinate, pointer?: THREE.Vector3): void {
    let destinationHeight = this.state?.board.find(
      (cell) => cell.q === destination.q && cell.r === destination.r,
    )?.stack.length ?? 0;
    const source = this.interaction?.selection;
    if (source?.q === destination.q && source.r === destination.r) {
      destinationHeight -= source.count;
    }
    const position = worldPosition(destination.q, destination.r);
    this.ghost.position.set(
      pointer?.x ?? position.x,
      0.14 + destinationHeight * TILE_HEIGHT,
      pointer?.z ?? position.z,
    );
    this.ghost.visible = true;
    this.render();
  }

  private clearGhost(): void {
    this.ghost.children.forEach((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      child.geometry.dispose();
      if (Array.isArray(child.material)) {
        child.material.forEach((material) => material.dispose());
      } else {
        child.material.dispose();
      }
    });
    this.ghost.clear();
    this.ghost.visible = false;
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
