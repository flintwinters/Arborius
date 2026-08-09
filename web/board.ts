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

export type PlacementControlAction = "left" | "confirm" | "right" | "cancel";
export type SelectionControlAction = "left" | "right" | "scope" | "unplay" | "cancel";

export interface PlacementPreview {
  coordinate: BoardCoordinate;
  tile: Tile;
  canRotate: boolean;
}

interface PointerInteraction {
  x: number;
  y: number;
  selection: StackSelection | null;
}

const COLORS = {
  amber: 0xf4c84a,
  teal: 0x68bfa6,
  grid: 0x596b68,
  selected: 0xf19a4b,
  hovered: 0xf6b95f,
  target: 0xc2d957,
};
const CELL_SIZE = 1.48;
const TILE_WIDTH = CELL_SIZE * 0.76;
const TILE_HEIGHT = 0.28;
const TILE_BASE_Y = 0.14;
const SURFACE_CLEARANCE = 0.018;
const CLICK_DISTANCE = 5;
const FIELD_PADDING = 1;
const tileIconTextures = new Map<string, THREE.CanvasTexture>();

function worldPosition(q: number, r: number): THREE.Vector3 {
  return new THREE.Vector3(q * CELL_SIZE, 0, r * CELL_SIZE);
}

function stackSurfaceY(height: number): number {
  return height > 0 ? TILE_BASE_Y + height * TILE_HEIGHT : 0;
}

function createTileGeometry(): THREE.BoxGeometry {
  const geometry = new THREE.BoxGeometry(TILE_WIDTH, TILE_HEIGHT, TILE_WIDTH);
  const positions = geometry.getAttribute("position");
  const normals = geometry.getAttribute("normal");
  const shades: number[] = [];
  for (let index = 0; index < positions.count; index += 1) {
    const heightRatio = positions.getY(index) / TILE_HEIGHT + 0.5;
    const normalY = normals.getY(index);
    const planarGradient = ((positions.getX(index) - positions.getZ(index)) / TILE_WIDTH) * 0.007;
    const sideGradient = (1 - Math.abs(normalY)) * heightRatio * 0.018;
    const shade = 0.952 + normalY * 0.006 + planarGradient + sideGradient;
    shades.push(shade, shade, shade);
  }
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(shades, 3));
  return geometry;
}

const FACING_ROTATION: Record<Facing, number> = {
  N: 0,
  E: -Math.PI / 2,
  S: Math.PI,
  W: Math.PI / 2,
};
const FACING_VECTOR: Record<Facing, { x: number; z: number }> = {
  N: { x: 0, z: -1 }, E: { x: 1, z: 0 }, S: { x: 0, z: 1 }, W: { x: -1, z: 0 },
};

function directionMarkerMaterial(map?: THREE.Texture, opacity = 0.44): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color: 0x26302d,
    map,
    transparent: true,
    opacity,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}

function createFacingArrow(tile: Tile): THREE.Mesh {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0.085);
  shape.lineTo(-0.045, -0.055);
  shape.lineTo(0.045, -0.055);
  shape.closePath();
  const arrow = new THREE.Mesh(
    new THREE.ShapeGeometry(shape),
    directionMarkerMaterial(),
  );
  arrow.rotation.set(-Math.PI / 2, 0, FACING_ROTATION[tile.facing]);
  const vector = FACING_VECTOR[tile.facing];
  const edgeOffset = TILE_WIDTH / 2 - 0.1;
  arrow.position.set(vector.x * edgeOffset, 0, vector.z * edgeOffset);
  return arrow;
}

function tileIconTexture(name: string): THREE.CanvasTexture {
  const cached = tileIconTextures.get(name);
  if (cached) return cached;
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Tile icon drawing is unavailable");
  context.strokeStyle = "#ffffff";
  context.fillStyle = "#ffffff";
  context.lineWidth = 9;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.beginPath();
  if (name === "horse") {
    context.arc(64, 61, 31, Math.PI * 0.1, Math.PI * 0.9, true);
    context.moveTo(34, 54); context.lineTo(34, 91);
    context.moveTo(94, 54); context.lineTo(94, 91);
  } else if (name === "vagrant") {
    context.moveTo(42, 94); context.lineTo(68, 31); context.lineTo(87, 94);
    context.moveTo(30, 70); context.lineTo(97, 70);
  } else if (name === "castle") {
    context.moveTo(30, 94); context.lineTo(30, 38); context.lineTo(47, 38);
    context.lineTo(47, 53); context.lineTo(64, 53); context.lineTo(64, 38);
    context.lineTo(81, 38); context.lineTo(81, 53); context.lineTo(98, 53);
    context.lineTo(98, 94); context.closePath();
  } else if (name === "soldier") {
    context.moveTo(64, 28); context.lineTo(94, 42); context.lineTo(86, 80);
    context.lineTo(64, 101); context.lineTo(42, 80); context.lineTo(34, 42);
    context.closePath();
  } else if (name === "demon") {
    context.arc(64, 67, 27, Math.PI, 0);
    context.moveTo(37, 66); context.lineTo(28, 42); context.lineTo(45, 51);
    context.moveTo(91, 66); context.lineTo(100, 42); context.lineTo(83, 51);
    context.moveTo(37, 67); context.lineTo(42, 93); context.lineTo(86, 93); context.lineTo(91, 67);
  } else if (name === "sword") {
    context.moveTo(35, 95); context.lineTo(89, 31);
    context.moveTo(73, 31); context.lineTo(91, 29); context.lineTo(89, 47);
    context.moveTo(38, 72); context.lineTo(57, 89);
  } else if (name === "viking") {
    context.moveTo(31, 36); context.quadraticCurveTo(36, 68, 64, 92);
    context.quadraticCurveTo(92, 68, 97, 36);
    context.moveTo(42, 74); context.lineTo(52, 64);
    context.moveTo(86, 74); context.lineTo(76, 64);
  } else {
    context.arc(64, 64, 32, 0, Math.PI * 1.7);
    context.arc(64, 64, 17, Math.PI * 1.7, Math.PI * 0.25, true);
  }
  context.stroke();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  tileIconTextures.set(name, texture);
  return texture;
}

function createTileIcon(tile: Tile): THREE.Group {
  const icon = new THREE.Mesh(
    new THREE.PlaneGeometry(TILE_WIDTH * 0.42, TILE_WIDTH * 0.42),
    directionMarkerMaterial(tileIconTexture(tile.name), 1),
  );
  icon.rotation.x = -Math.PI / 2;
  const tileIcon = new THREE.Group();
  tileIcon.rotation.y = FACING_ROTATION[tile.facing];
  tileIcon.add(icon);
  return tileIcon;
}

const FACE_SPECS: Record<Facing, {
  x: number;
  z: number;
  rotation: number;
  localRight: Facing;
}> = {
  N: { x: 0, z: -1, rotation: Math.PI, localRight: "W" },
  E: { x: 1, z: 0, rotation: Math.PI / 2, localRight: "N" },
  S: { x: 0, z: 1, rotation: 0, localRight: "E" },
  W: { x: -1, z: 0, rotation: -Math.PI / 2, localRight: "S" },
};
const FACING_ORDER: Facing[] = ["N", "E", "S", "W"];

function createSideDirectionMarkers(tile: Tile, position: THREE.Vector3): THREE.Mesh[] {
  const facingIndex = FACING_ORDER.indexOf(tile.facing);
  const left = FACING_ORDER[(facingIndex + 3) % 4];
  const right = FACING_ORDER[(facingIndex + 1) % 4];
  if (!left || !right) return [];
  const material = directionMarkerMaterial();
  const offset = TILE_WIDTH / 2 + 0.004;
  const markerForFace = (face: Facing, geometry: THREE.BufferGeometry): THREE.Mesh => {
    const spec = FACE_SPECS[face];
    const marker = new THREE.Mesh(geometry, material);
    marker.position.set(position.x + spec.x * offset, position.y, position.z + spec.z * offset);
    marker.rotation.y = spec.rotation;
    return marker;
  };

  const dot = markerForFace(tile.facing, new THREE.CircleGeometry(TILE_HEIGHT * 0.13, 16));
  const arrowShape = new THREE.Shape();
  arrowShape.moveTo(TILE_HEIGHT * 0.25, 0);
  arrowShape.lineTo(-TILE_HEIGHT * 0.08, TILE_HEIGHT * 0.16);
  arrowShape.lineTo(-TILE_HEIGHT * 0.08, TILE_HEIGHT * 0.06);
  arrowShape.lineTo(-TILE_HEIGHT * 0.25, TILE_HEIGHT * 0.06);
  arrowShape.lineTo(-TILE_HEIGHT * 0.25, -TILE_HEIGHT * 0.06);
  arrowShape.lineTo(-TILE_HEIGHT * 0.08, -TILE_HEIGHT * 0.06);
  arrowShape.lineTo(-TILE_HEIGHT * 0.08, -TILE_HEIGHT * 0.16);
  arrowShape.closePath();
  const arrows = [left, right].map((face) => {
    const arrow = markerForFace(face, new THREE.ShapeGeometry(arrowShape));
    if (FACE_SPECS[face].localRight !== tile.facing) arrow.rotateZ(Math.PI);
    return arrow;
  });
  return [dot, ...arrows];
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
  private readonly placementGhost = new THREE.Group();
  private readonly placementControls = document.createElement("div");
  private readonly selectionControls = document.createElement("div");
  private readonly targets: THREE.Mesh[] = [];
  private readonly ground = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
  );
  private field: THREE.LineSegments | null = null;
  private selected: BoardCoordinate | null = null;
  private selectedCount = 0;
  private rotateWholeStack = false;
  private proposedMove: BoardCoordinate | null = null;
  private actionControlsDisabled = false;
  private hovered: StackSelection | null = null;
  private destinations: BoardCoordinate[] = [];
  private placementPreview: PlacementPreview | null = null;
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
    private readonly onPlacementControl: (action: PlacementControlAction) => void,
    private readonly onSelectionControl: (action: SelectionControlAction) => void,
  ) {
    this.scene.background = new THREE.Color(0x171c1d);
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.y = -0.02;
    this.scene.add(this.ground, this.hints, this.cells, this.placementGhost, this.ghost);
    this.targets.push(this.ground);
    this.camera.position.set(9.5, 11.5, 12.5);
    this.camera.lookAt(0, 0, 0);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.domElement.setAttribute("aria-label", "Interactive three-dimensional game board");
    this.host.append(this.renderer.domElement);
    this.placementControls.className = "board-placement-controls";
    this.placementControls.setAttribute("role", "group");
    this.placementControls.setAttribute("aria-label", "Place tile");
    this.placementControls.innerHTML = `<button data-placement-action="left" aria-label="Rotate tile left">↶</button><button data-placement-action="confirm" aria-label="Confirm placement">Place</button><button data-placement-action="right" aria-label="Rotate tile right">↷</button><button data-placement-action="cancel" aria-label="Cancel placement preview">×</button>`;
    this.placementControls.hidden = true;
    this.placementControls.addEventListener("pointerdown", (event) => event.stopPropagation());
    this.placementControls.addEventListener("click", (event) => {
      event.stopPropagation();
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-placement-action]");
      const action = button?.dataset.placementAction as PlacementControlAction | undefined;
      if (action) this.onPlacementControl(action);
    });
    this.host.append(this.placementControls);

    this.selectionControls.className = "board-selection-controls";
    this.selectionControls.setAttribute("role", "group");
    this.selectionControls.setAttribute("aria-label", "Selected tile actions");
    this.selectionControls.hidden = true;
    this.selectionControls.addEventListener("pointerdown", (event) => event.stopPropagation());
    this.selectionControls.addEventListener("click", (event) => {
      event.stopPropagation();
      const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-selection-action]");
      const action = button?.dataset.selectionAction as SelectionControlAction | undefined;
      if (action) this.onSelectionControl(action);
    });
    this.host.append(this.selectionControls);

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
    this.renderer.domElement.addEventListener("pointerleave", () => this.setHovered(null));
    this.renderer.domElement.addEventListener("pointercancel", () => this.cancelInteraction());
    this.renderer.domElement.addEventListener("pointerup", (event) => this.handlePointerUp(event));
    new ResizeObserver(() => this.resize()).observe(this.host);
    this.resize();
  }

  setSelected(
    coordinate: BoardCoordinate | null,
    count = 0,
    rotateWholeStack = false,
    proposedMove: BoardCoordinate | null = null,
    actionControlsDisabled = false,
  ): void {
    this.selected = coordinate;
    this.selectedCount = count;
    this.rotateWholeStack = rotateWholeStack;
    this.proposedMove = proposedMove;
    this.actionControlsDisabled = actionControlsDisabled;
    if (coordinate) this.setHovered(null);
  }

  setDestinations(destinations: BoardCoordinate[]): void {
    this.destinations = destinations;
    if (destinations.length > 0) this.setHovered(null);
  }

  setPlacementPreview(preview: PlacementPreview | null): void {
    this.placementPreview = preview;
  }

  update(state: GameState): void {
    this.state = state;
    this.normalizeHovered();
    this.cells.clear();
    this.targets.length = 1;
    this.updateField(state.board);
    this.updateHints();
    state.board.forEach((cell) => this.addCell(cell));
    this.updatePlacementPreview();
    this.updateMovePreview();
    this.updateSelectionControls();
    if (this.selected && !state.board.some((cell) => cell.q === this.selected?.q && cell.r === this.selected?.r)) {
      this.addSelectionMarker(this.selected);
    }
    this.render();
  }

  private updatePlacementPreview(): void {
    this.clearGroup(this.placementGhost);
    this.placementControls.hidden = this.placementPreview === null;
    if (!this.placementPreview) return;

    this.placementControls.querySelectorAll<HTMLButtonElement>("[data-placement-action='left'], [data-placement-action='right']")
      .forEach((button) => { button.disabled = !this.placementPreview?.canRotate; });

    const { coordinate, tile: tileState } = this.placementPreview;
    const destinationHeight = this.state?.board.find(
      (cell) => cell.q === coordinate.q && cell.r === coordinate.r,
    )?.stack.length ?? 0;
    const tile = new THREE.Mesh(
      createTileGeometry(),
      new THREE.MeshStandardMaterial({
        color: COLORS[tileState.owner],
        transparent: true,
        opacity: 0.76,
        roughness: 0.42,
        metalness: 0.12,
        vertexColors: true,
      }),
    );
    tile.position.y = TILE_BASE_Y + TILE_HEIGHT * (destinationHeight + 0.5);
    this.placementGhost.add(tile);
    const arrow = createFacingArrow(tileState);
    arrow.position.y = tile.position.y + TILE_HEIGHT / 2 + 0.006;
    const icon = createTileIcon(tileState);
    icon.position.y = arrow.position.y;
    this.placementGhost.add(arrow, icon);
    this.placementGhost.position.copy(worldPosition(coordinate.q, coordinate.r));
  }

  private updateSelectionControls(): void {
    if (!this.selected) {
      this.selectionControls.hidden = true;
      return;
    }
    const stack = this.state?.board.find(
      (cell) => cell.q === this.selected?.q && cell.r === this.selected?.r,
    )?.stack;
    if (!stack) {
      this.selectionControls.hidden = true;
      return;
    }
    const top = stack.at(-1);
    this.selectionControls.hidden = false;
    const rotationScope = this.rotateWholeStack ? "stack" : `${this.selectedCount} tile${this.selectedCount === 1 ? "" : "s"}`;
    const title = this.proposedMove
      ? `Move to ${this.proposedMove.q}, ${this.proposedMove.r} ready`
      : `${top?.name ?? "Stack"} · ${this.selectedCount} tile${this.selectedCount === 1 ? "" : "s"}`;
    this.selectionControls.innerHTML = `<span class="board-selection-title">${title}</span><button data-selection-action="left" aria-label="Rotate tile left">↶</button><button data-selection-action="scope">Rotate ${rotationScope}</button><button data-selection-action="right" aria-label="Rotate tile right">↷</button><button data-selection-action="unplay">Return top tile</button><button data-selection-action="cancel" aria-label="Clear selection">×</button>`;
    this.selectionControls.querySelectorAll<HTMLButtonElement>("button").forEach((button) => {
      button.disabled = this.actionControlsDisabled;
    });
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
      marker.position.y = stackSurfaceY(height) + SURFACE_CLEARANCE;
      this.hints.add(marker);
    });
  }

  private updateMovePreview(): void {
    if (!this.selected || !this.proposedMove) {
      this.clearGhost();
      return;
    }
    this.createGhost({ ...this.selected, count: this.selectedCount });
    this.positionGhost(this.proposedMove);
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
      const hovered = this.hovered?.q === q && this.hovered.r === r;
      const carried = selected && index >= cell.stack.length - this.selectedCount;
      const previewed = hovered && index >= cell.stack.length - (this.hovered?.count ?? 0);
      const tile = new THREE.Mesh(
        createTileGeometry(),
        new THREE.MeshStandardMaterial({
          color: carried ? COLORS.selected : previewed ? COLORS.hovered : COLORS[tileState.owner],
          roughness: 0.42,
          metalness: 0.12,
          vertexColors: true,
        }),
      );
      tile.position.set(position.x, TILE_BASE_Y + TILE_HEIGHT * (index + 0.5), position.z);
      tile.userData = { q, r, count: cell.stack.length - index, owner: tileState.owner };
      this.cells.add(tile);
      this.targets.push(tile);
      const arrow = createFacingArrow(tileState);
      arrow.position.add(new THREE.Vector3(position.x, tile.position.y + TILE_HEIGHT / 2 + 0.006, position.z));
      const icon = createTileIcon(tileState);
      icon.position.set(position.x, arrow.position.y, position.z);
      this.cells.add(arrow, icon);
      this.cells.add(...createSideDirectionMarkers(tileState, tile.position));
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
    const hit = this.pick(event);
    if (!this.interaction?.selection) {
      this.previewSelection(hit);
      return;
    }
    if (!hit) {
      this.ghost.visible = false;
      return;
    }
    this.positionGhost(this.coordinateForHit(hit), hit.point);
  }

  private previewSelection(hit: THREE.Intersection<THREE.Mesh> | undefined): void {
    if (this.selected || this.destinations.length > 0 || hit?.object === this.ground) {
      this.setHovered(null);
      return;
    }
    const count = hit?.object.userData.count as number | undefined;
    if (!hit || !count) {
      this.setHovered(null);
      return;
    }
    const coordinate = this.coordinateForHit(hit);
    const controller = this.state?.board.find(
      (cell) => cell.q === coordinate.q && cell.r === coordinate.r,
    )?.stack.at(-1);
    if (controller?.owner !== this.state?.turn) {
      this.setHovered(null);
      return;
    }
    this.setHovered({ ...coordinate, count });
  }

  private setHovered(selection: StackSelection | null): void {
    const unchanged = this.hovered?.q === selection?.q
      && this.hovered?.r === selection?.r
      && this.hovered?.count === selection?.count;
    if (unchanged) return;
    this.hovered = selection;
    this.renderer.domElement.classList.toggle("selecting-stack", selection !== null);
    this.updateTileHighlights();
  }

  private normalizeHovered(): void {
    if (!this.hovered) return;
    const stack = this.state?.board.find(
      (cell) => cell.q === this.hovered?.q && cell.r === this.hovered?.r,
    )?.stack;
    if (!stack || stack.at(-1)?.owner !== this.state?.turn || this.hovered.count > stack.length) {
      this.hovered = null;
      this.renderer.domElement.classList.remove("selecting-stack");
    }
  }

  private updateTileHighlights(): void {
    this.targets.slice(1).forEach((tile) => {
      const { q, r, count, owner } = tile.userData as {
        q: number; r: number; count: number; owner: Tile["owner"];
      };
      const selected = this.selected?.q === q && this.selected.r === r && count <= this.selectedCount;
      const hovered = this.hovered?.q === q && this.hovered.r === r && count <= this.hovered.count;
      const material = tile.material as THREE.MeshStandardMaterial;
      material.color.setHex(selected ? COLORS.selected : hovered ? COLORS.hovered : COLORS[owner]);
    });
    this.render();
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
        createTileGeometry(),
        new THREE.MeshStandardMaterial({
          color: COLORS[tileState.owner],
          transparent: true,
          opacity: 0.48,
          depthWrite: false,
          roughness: 0.35,
          metalness: 0.08,
          vertexColors: true,
        }),
      );
      tile.position.y = TILE_HEIGHT * (index + 0.5);
      this.ghost.add(tile);
      const arrow = createFacingArrow(tileState);
      arrow.position.y = TILE_HEIGHT * (index + 1) + 0.006;
      const icon = createTileIcon(tileState);
      icon.position.y = arrow.position.y;
      icon.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return;
        const material = child.material as THREE.MeshBasicMaterial;
        material.opacity *= 0.48;
        material.depthWrite = false;
      });
      this.ghost.add(arrow, icon);
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
      TILE_BASE_Y + destinationHeight * TILE_HEIGHT,
      pointer?.z ?? position.z,
    );
    this.ghost.visible = true;
    this.render();
  }

  private clearGhost(): void {
    this.clearGroup(this.ghost);
    this.ghost.visible = false;
  }

  private clearGroup(group: THREE.Group): void {
    group.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) return;
      child.geometry.dispose();
      if (Array.isArray(child.material)) {
        child.material.forEach((material) => material.dispose());
      } else {
        child.material.dispose();
      }
    });
    group.clear();
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
    this.positionPlacementControls();
    this.positionSelectionControls();
  }

  private positionPlacementControls(): void {
    if (!this.placementPreview || this.placementControls.hidden) return;
    const { coordinate } = this.placementPreview;
    const destinationHeight = this.state?.board.find(
      (cell) => cell.q === coordinate.q && cell.r === coordinate.r,
    )?.stack.length ?? 0;
    this.positionBoardControls(
      this.placementControls,
      coordinate,
      0.58 + TILE_HEIGHT * destinationHeight,
    );
  }

  private positionSelectionControls(): void {
    if (!this.selected || this.selectionControls.hidden) return;
    const stackHeight = this.state?.board.find(
      (cell) => cell.q === this.selected?.q && cell.r === this.selected?.r,
    )?.stack.length;
    if (!stackHeight) return;
    this.positionBoardControls(
      this.selectionControls,
      this.selected,
      TILE_BASE_Y + TILE_HEIGHT * stackHeight + 0.16,
    );
  }

  private positionBoardControls(element: HTMLElement, coordinate: BoardCoordinate, height: number): void {
    const projected = worldPosition(coordinate.q, coordinate.r);
    projected.y = height;
    projected.project(this.camera);
    const visible = projected.z > -1 && projected.z < 1;
    element.style.visibility = visible ? "visible" : "hidden";
    element.style.left = `${(projected.x * 0.5 + 0.5) * this.host.clientWidth}px`;
    element.style.top = `${(-projected.y * 0.5 + 0.5) * this.host.clientHeight}px`;
  }
}
