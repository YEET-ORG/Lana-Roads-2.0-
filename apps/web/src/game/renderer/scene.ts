/**
 * Three.js world renderer. Owns the scene graph and render loop; React never
 * re-renders per frame. Renders authoritative state + one predicted local
 * step; all geometry is disposed on destroy().
 *
 * Motion follows docs/FRONTEND.md §15.1: hop = anticipation squash
 * (~45 ms) → sine arc with stretch (~120 ms) → landing squash (~60 ms);
 * blocked moves bump back in ~90 ms; the camera is critically damped and
 * frames the player below center. All animation is delta-time correct.
 */
import * as THREE from "three";
import {
  Lane,
  LANE_GRASS,
  LANE_RAIL,
  LANE_RIVER,
  LANE_ROAD,
  laneVehicles,
  logSubmerged,
  railPhaseVisual,
} from "../simulation/hazards";
import { agentId, instantiate, pickDeterministic, ROCK_POOL } from "./assets";
import { BlockDust, type Surface } from "./effects";
import { sfx } from "../audio";
import { arc, clamp01, easeOutBack, easeOutCubic, noise1d, smoothFactor } from "./tween";
import { getSettings, haptic } from "../../lib/settings";

export interface RemotePlayer {
  wallet: string;
  x: number;
  y: number;
  /**
   * The agent this player CHOSE, read from their on-chain identity.
   *
   * Without it every client guessed from the wallet hash, so a player who
   * picked a penguin appeared to everyone else as whatever their address
   * hashed to. Absent for a wallet that has never set an identity, which
   * falls back to that hash.
   */
  agent?: number;
  /** Display name from the same account; absent when they have not set one. */
  name?: string;
}

export type DeathCause = "water" | "impact" | "train";
export type Presentation = "play" | "menu";

export function deathHeadline(cause: DeathCause): string {
  if (cause === "water") return "SPLASHED!";
  if (cause === "train") return "TOASTED!";
  return "SQUISHED!";
}

/** Lana Roads palette (docs/FRONTEND.md §12.1). */
const COLORS = {
  sky: 0x57cff2,
  grass: 0x4be08f,
  grassAlt: 0x43cd82,
  grassEdge: 0x169b60,
  road: 0x2c3547,
  roadAlt: 0x333d52,
  river: 0x22b9e6,
  rail: 0x6b5d52,
  log: 0x8a5a2b,
  logBark: 0x6b4220,
  logEnd: 0xc9a06a,
  moss: 0x3aa35c,
  riverDeep: 0x0e6a92,
  bank: 0xd7efe8,
  train: 0xffd23f,
  trainCab: 0x18243a,
  trainTrim: 0xf45169,
  warning: 0xf45169,
  dust: 0xe8dfd0,
  shadow: 0x08111f,
  lamp: 0xfff1a8,
};

// ---- motion constants (ms unless noted) ----
const ANTICIPATION_MS = 45;
const HOP_MS = 120;
const LAND_MS = 65;
const BUMP_MS = 90;
const HOP_HEIGHT = 0.34; // tiles
const CHARGE_SQUASH = { y: 0.82, xz: 1.1 };
const STRETCH = { y: 1.14, xz: 0.94 };
const LAND_SQUASH = { y: 0.86, xz: 1.08 };
const PLAYER_HEIGHT = 0.85; // world units for a normalized 1-unit-tall agent

const WIDTH = 64;
/** Chunks always carry randomness; this only covers a row seen before its
 * chunk finished loading. */
const EMPTY_SEED = new Uint8Array(32);

/**
 * Draw a name onto a sprite.
 *
 * Chunky and high-contrast because it is read at a glance over a moving
 * world: heavy weight, dark outline, no background plate to fight with the
 * scene. The canvas is oversampled so it stays crisp when the camera is
 * close.
 */
function makeNameplate(name: string): THREE.Sprite {
  const scale = 4;
  const font = 34 * scale;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d")!;
  ctx.font = `800 ${font}px Nunito, system-ui, sans-serif`;
  const width = Math.ceil(ctx.measureText(name).width) + 24 * scale;
  canvas.width = width;
  canvas.height = Math.ceil(font * 1.6);
  const c = canvas.getContext("2d")!;
  c.font = `800 ${font}px Nunito, system-ui, sans-serif`;
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.lineJoin = "round";
  c.lineWidth = 8 * scale;
  c.strokeStyle = "rgba(8, 17, 31, 0.92)";
  c.strokeText(name, canvas.width / 2, canvas.height / 2);
  c.fillStyle = "#fffdf5";
  c.fillText(name, canvas.width / 2, canvas.height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }),
  );
  // Height fixed in world units; width follows the text so nothing squashes.
  const height = 0.34;
  sprite.scale.set((height * canvas.width) / canvas.height, height, 1);
  return sprite;
}

/** yaw per Direction (Forward = -z in scene space; the VoxelAnimals models
 * natively face -z, so Forward is yaw 0). */
function facingYaw(facing: number): number {
  // Direction enum: 0 Forward, 1 Backward, 2 Left, 3 Right (sdk order).
  switch (facing) {
    case 1:
      return Math.PI; // toward camera (+z)
    case 2:
      return Math.PI / 2;
    case 3:
      return -Math.PI / 2;
    default:
      return 0; // away (-z)
  }
}

type RigState =
  | { name: "idle" }
  | {
      name: "hop";
      from: THREE.Vector3;
      to: THREE.Vector3;
      start: number;
      duration: number;
      fromBodyY: number;
      fromScale: THREE.Vector3;
      skipAnticipation: boolean;
    }
  | { name: "land"; start: number }
  | { name: "dead"; cause: "impact" | "water"; start: number };

/**
 * A player rig: root (ground position) → body (hop offset, squash/stretch,
 * facing yaw) → model. Squash scales the body around its base so feet stay
 * planted; a blob shadow shrinks with hop height.
 */
class PlayerRig {
  root = new THREE.Group();
  body = new THREE.Group();
  shadow: THREE.Mesh;
  state: RigState = { name: "idle" };
  targetYaw = 0; // facing Forward (-z)
  private idlePhase = Math.random() * Math.PI * 2;
  private landed: ((at: THREE.Vector3) => void) | null = null;
  /** Recoil is additive body motion and must not replace a running hop. */
  private bumpStart = -Infinity;
  private bumpDir = new THREE.Vector3();

  private model: THREE.Object3D;
  private modelScale: number;

  constructor(
    modelId: string,
    scale: number,
    shadowMat: THREE.MeshBasicMaterial,
    shadowGeo: THREE.CircleGeometry,
  ) {
    this.modelScale = scale;
    this.model = instantiate(modelId);
    this.model.scale.setScalar(scale);
    this.body.add(this.model);
    this.body.rotation.y = this.targetYaw;
    this.root.add(this.body);
    this.shadow = new THREE.Mesh(shadowGeo, shadowMat);
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.02;
    this.root.add(this.shadow);
  }

  /**
   * A name floating over the player.
   *
   * A sprite rather than DOM: it has to sit in the world, behind the
   * things in front of it and above the player as the camera moves, and
   * following a 3D position with an HTML overlay costs a reprojection
   * every frame for every player.
   */
  private plate: THREE.Sprite | null = null;
  private plateName = "";

  currentName(): string {
    return this.plateName;
  }

  setName(name: string | undefined, height: number) {
    if ((name ?? "") === this.plateName) return;
    this.plateName = name ?? "";
    if (this.plate) {
      this.root.remove(this.plate);
      this.plate.material.map?.dispose();
      this.plate.material.dispose();
      this.plate = null;
    }
    if (!name) return;
    const sprite = makeNameplate(name);
    sprite.position.y = height + 0.42;
    this.root.add(sprite);
    this.plate = sprite;
  }

  /** Swap the visual model in place (agent picker preview). */
  setModel(modelId: string) {
    this.body.remove(this.model);
    this.model = instantiate(modelId);
    this.model.scale.setScalar(this.modelScale);
    this.body.add(this.model);
  }

  onLand(cb: (at: THREE.Vector3) => void) {
    this.landed = cb;
  }

  hopTo(target: THREE.Vector3, facing?: number) {
    if (this.state.name === "dead") return;
    if (facing != null) this.targetYaw = facingYaw(facing);
    const airborne = this.state.name === "hop";
    // The authoritative destination is still a tile center, but the visual
    // path starts exactly where the previous frame left the model. Snapping
    // an unfinished 120ms hop whenever input arrived at 60ms was the source
    // of the conspicuous stair-step movement under fast swipes.
    const from = this.root.position.clone();
    if (from.distanceToSquared(target) < 1e-6) return;
    const distance = from.distanceTo(target);
    this.state = {
      name: "hop",
      from,
      to: target.clone(),
      start: performance.now(),
      // Keep near-constant visual speed while allowing a slightly longer
      // catch-up when several accepted grid moves arrive during one hop.
      duration: Math.min(190, Math.max(90, HOP_MS * distance)),
      fromBodyY: this.body.position.y,
      fromScale: this.body.scale.clone(),
      // Chained hops keep momentum: no fresh anticipation mid-run.
      skipAnticipation: airborne,
    };
  }

  /** In-place hop for menu agent swaps. */
  flourish() {
    if (this.state.name === "dead") return;
    const here = this.root.position.clone();
    this.state = {
      name: "hop",
      from: here,
      to: here.clone(),
      start: performance.now(),
      duration: HOP_MS,
      fromBodyY: this.body.position.y,
      fromScale: this.body.scale.clone(),
      skipAnticipation: true,
    };
  }

  setVisualScale(scale: number) {
    this.modelScale = scale;
    this.model.scale.setScalar(scale);
  }

  /** Snap without animation (spawn / large corrections). */
  teleport(target: THREE.Vector3) {
    this.root.position.copy(target);
    this.state = { name: "idle" };
    this.bumpStart = -Infinity;
    this.body.position.x = 0;
    this.body.position.z = 0;
    this.body.position.y = 0;
    this.body.scale.set(1, 1, 1);
  }

  bump(dir: THREE.Vector3) {
    if (this.state.name === "dead") return;
    this.bumpDir.copy(dir).normalize();
    this.bumpStart = performance.now();
  }

  die(cause: "impact" | "water") {
    this.state = { name: "dead", cause, start: performance.now() };
  }

  revive() {
    if (this.state.name === "dead") {
      this.state = { name: "idle" };
      this.body.scale.set(1, 1, 1);
      this.body.position.x = 0;
      this.body.position.z = 0;
      this.body.position.y = 0;
      this.body.visible = true;
      this.shadow.visible = true;
    }
  }

  get dead() {
    return this.state.name === "dead";
  }

  update(dtMs: number, now: number) {
    // Facing eases toward target (≤80 ms feel).
    let dy = this.targetYaw - this.body.rotation.y;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    this.body.rotation.y += dy * smoothFactor(0.35, dtMs);

    const s = this.state;
    if (s.name === "hop") {
      const pre = s.skipAnticipation ? 0 : ANTICIPATION_MS;
      const t = now - s.start;
      if (t < pre) {
        // Anticipation: squash down before takeoff.
        const k = clamp01(t / pre);
        this.setSquash(
          THREE.MathUtils.lerp(s.fromScale.y, CHARGE_SQUASH.y, k),
          THREE.MathUtils.lerp(s.fromScale.x, CHARGE_SQUASH.xz, k),
        );
      } else {
        const k = clamp01((t - pre) / s.duration);
        // Linear horizontal + sine arc = the snappy Crossy hop; easing the
        // horizontal makes it feel like sliding, not hopping.
        this.root.position.lerpVectors(s.from, s.to, k);
        const a = arc(k);
        // Retargeting mid-air preserves current height and eases it into the
        // next arc, removing the vertical pop between chained hops.
        this.body.position.y = s.fromBodyY * (1 - easeOutCubic(k)) + a * HOP_HEIGHT;
        // Stretch peaks at takeoff, relaxes toward landing.
        const stretch = 1 - k * 0.6;
        const blend = easeOutCubic(clamp01(k * 2));
        const hopY = 1 + (STRETCH.y - 1) * a * stretch;
        const hopXZ = 1 + (STRETCH.xz - 1) * a * stretch;
        this.setSquash(
          THREE.MathUtils.lerp(s.fromScale.y, hopY, blend),
          THREE.MathUtils.lerp(s.fromScale.x, hopXZ, blend),
        );
        // Follow the drawn height, not the arc, so an interrupted hop keeps
        // its shadow small instead of popping back to full size.
        this.shadow.scale.setScalar(
          1 - clamp01(this.body.position.y / HOP_HEIGHT) * 0.35,
        );
        if (k >= 1) {
          this.root.position.copy(s.to);
          this.body.position.y = 0;
          this.shadow.scale.setScalar(1);
          this.state = { name: "land", start: now };
          this.landed?.(this.root.position);
        }
      }
    } else if (s.name === "land") {
      const k = clamp01((now - s.start) / LAND_MS);
      // Squash on impact, spring back with a touch of overshoot.
      const spring = easeOutBack(k);
      this.setSquash(
        LAND_SQUASH.y + (1 - LAND_SQUASH.y) * spring,
        LAND_SQUASH.xz + (1 - LAND_SQUASH.xz) * spring,
      );
      if (k >= 1) {
        this.setSquash(1, 1);
        this.state = { name: "idle" };
      }
    } else if (s.name === "dead") {
      const k = clamp01((now - s.start) / 90);
      if (s.cause === "impact") {
        // Pancake: flatten hard, spread out.
        this.setSquash(1 - k * 0.88, 1 + k * 0.55);
      } else {
        // Water: sink below the surface.
        this.body.position.y = -k * 0.9;
        this.setSquash(1 - k * 0.3, 1 - k * 0.2);
        this.shadow.visible = false;
        if (k >= 1) this.body.visible = false;
      }
    } else {
      // Idle: subtle breathe (scaleY 1↔1.02, ~1.5 s).
      const b = 1 + Math.sin(now / 240 + this.idlePhase) * 0.012;
      this.setSquash(b, 1 / Math.sqrt(b));
    }

    // Directional recoil is layered over the current hop/land/idle pose.
    // Cancelling locomotion here used to strand the root between tiles when
    // a blocked input or kick arrived during an unfinished hop.
    const bumpK = clamp01((now - this.bumpStart) / BUMP_MS);
    if (bumpK < 1 && s.name !== "dead") {
      const amount = arc(bumpK);
      this.body.position.x = this.bumpDir.x * amount * 0.22;
      this.body.position.z = this.bumpDir.z * amount * 0.22;
      this.body.scale.y *= 1 - amount * 0.12;
      this.body.scale.x *= 1 + amount * 0.08;
      this.body.scale.z *= 1 + amount * 0.08;
    } else {
      this.body.position.x = 0;
      this.body.position.z = 0;
    }
  }

  /** Volume-preserving-ish squash around the base of the body. */
  private setSquash(y: number, xz: number) {
    this.body.scale.set(xz, y, xz);
  }
}

export class WorldScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.OrthographicCamera;
  private laneMeshes = new Map<number, THREE.Group>();
  private lanes = new Map<number, Lane>();
  /** Committed chunk randomness per row — decides which car is which. */
  private laneSeeds = new Map<number, Uint8Array>();
  /** Conveyor index and model currently held by each mover slot. */
  private moverSlots = new Map<number, Array<{ index: number; assetId: string }>>();
  private remoteModels = new Map<string, string>();
  private movers = new Map<number, THREE.Object3D[]>();
  /**
   * One flat mark per traffic slot, drawn on the AUTHORITATIVE tiles.
   *
   * The car body is smoothed for the eye and therefore lags the program by
   * up to a step; these do not move between ticks. They are the contract
   * made visible: the span the program will kill you on, exactly where it
   * says it is.
   */
  private hazardMarks = new Map<number, THREE.Mesh[]>();
  private railStripMats = new Map<number, THREE.MeshLambertMaterial>();
  private players = new Map<string, PlayerRig>();
  private remoteTargets = new Map<string, THREE.Vector3>();
  private local: PlayerRig;
  private dust: BlockDust;
  private raf = 0;
  private disposed = false;
  private clock = new THREE.Clock();
  private localTarget = new THREE.Vector3(32.5, 0, 0);
  private camFocus = new THREE.Vector3(32.5, 0, 0);
  private trauma = 0;
  /** Hazard-clock freeze deadline (hit-stop: impacts pause the world). */
  private hitStopUntil = 0;
  private startMs = performance.now();
  private viewHeight = 13; // world units visible vertically
  private presentation: Presentation = "play";
  private waterTime = { value: 0 };
  private lastWhooshAt = 0;
  private lastBellAt = 0;
  lastDeathCause: DeathCause = "impact";
  /** Offset between authoritative world time and performance.now(). */
  worldTimeOffsetMs = 0;
  /** Offset the slot servo converges toward without stepping the scene. */
  private targetWorldTimeOffsetMs = 0;
  private worldClockReady = false;

  // ---- shared static resources (never disposed per lane) ----
  private unitBox = new THREE.BoxGeometry(1, 1, 1);
  private stripGeo = new THREE.BoxGeometry(1, 0.2, 1);
  private riverSurfaceGeo = new THREE.PlaneGeometry(1, 1, 40, 6);
  private wheelGeo = new THREE.CylinderGeometry(0.11, 0.11, 0.08, 8);
  private shadowGeo = new THREE.CircleGeometry(0.34, 12);
  private hazardMarkGeo = new THREE.PlaneGeometry(1, 1);
  private hazardMarkMat = new THREE.MeshBasicMaterial({
    color: 0x0b0f1a,
    transparent: true,
    opacity: 0.26,
    depthWrite: false,
  });
  private shadowMat = new THREE.MeshBasicMaterial({
    color: COLORS.shadow,
    transparent: true,
    opacity: 0.25,
    depthWrite: false,
  });
  private matWhite = new THREE.MeshLambertMaterial({ color: 0xffffff });
  // Per-tile checkerboard (Crossy signature): the grid must be readable on
  // grass. Two textures with swapped colors give the cross-row alternation.
  private matGrass = new THREE.MeshLambertMaterial({
    map: makeCheckerTexture(COLORS.grass, COLORS.grassAlt),
  });
  private matGrassAlt = new THREE.MeshLambertMaterial({
    map: makeCheckerTexture(COLORS.grassAlt, COLORS.grass),
  });
  private matGrassEdge = new THREE.MeshLambertMaterial({ color: COLORS.grassEdge });
  private matRoad = new THREE.MeshLambertMaterial({ color: COLORS.road });
  private matRoadAlt = new THREE.MeshLambertMaterial({ color: COLORS.roadAlt });
  private matRiverBed = new THREE.MeshLambertMaterial({ color: COLORS.riverDeep });
  private matWater: THREE.MeshLambertMaterial;
  private matBank = new THREE.MeshLambertMaterial({ color: COLORS.bank });
  private matLog = new THREE.MeshLambertMaterial({ color: COLORS.log });
  private matLogBark = new THREE.MeshLambertMaterial({ color: COLORS.logBark });
  private matLogEnd = new THREE.MeshLambertMaterial({ color: COLORS.logEnd });
  private matMoss = new THREE.MeshLambertMaterial({ color: COLORS.moss });
  private matDash = new THREE.MeshLambertMaterial({ color: 0xdde3ee });
  private matRailBar = new THREE.MeshLambertMaterial({ color: 0x3a3f4d });
  private matTrain = new THREE.MeshLambertMaterial({ color: COLORS.train });
  private matTrainCab = new THREE.MeshLambertMaterial({ color: COLORS.trainCab });
  private matTrainTrim = new THREE.MeshLambertMaterial({ color: COLORS.trainTrim });
  private matLamp = new THREE.MeshLambertMaterial({
    color: COLORS.lamp,
    emissive: new THREE.Color(0xffc44d),
    emissiveIntensity: 1.1,
  });

  /**
   * World time is not wall time.
   *
   * The program defines it as `slot * 50ms`, but slots do not arrive every
   * 50ms — measured 53.4ms on devnet-as. Advancing this clock one
   * millisecond per real millisecond therefore runs ~7% fast, and a client
   * that only corrects on a threshold spends its life snapping backwards.
   * The rate is part of the clock.
   */
  private worldRate = 1;

  setWorldClock(nowMs: number, rate = this.worldRate, hard = false) {
    const elapsed = performance.now() - this.startMs;
    // Changing the measured slot rate must not change displayed time. Rebase
    // first, then let phase correction converge independently every frame.
    const current = elapsed * this.worldRate + this.worldTimeOffsetMs;
    this.worldRate = rate;
    this.worldTimeOffsetMs = current - elapsed * rate;
    this.targetWorldTimeOffsetMs = nowMs - elapsed * rate;
    if (!this.worldClockReady || hard) {
      this.worldTimeOffsetMs = this.targetWorldTimeOffsetMs;
      this.worldClockReady = true;
    }
  }

  /** Practice mode: no chain, so world time simply runs at wall rate. */
  setWorldElapsed(elapsedMs: number) {
    this.setWorldClock(elapsedMs, 1, true);
  }

  laneAt(row: number): Lane | undefined {
    return this.lanes.get(row);
  }

  worldTimeMs(): number {
    return (performance.now() - this.startMs) * this.worldRate + this.worldTimeOffsetMs;
  }

  /**
   * Development hook: read the world clock from outside the bundle.
   *
   * Whether the screen agrees with the chain is a question about a running
   * client, and it cannot be answered from the outside without this. Dev
   * builds only — stripped from production.
   */
  private exposeClock() {
    if (!import.meta.env.DEV) return;
    const w = window as unknown as {
      __crossyClock?: () => number;
      __crossyRemotes?: () => unknown[];
      __crossyMotion?: () => unknown;
      __crossyMap?: () => unknown;
    };
    w.__crossyClock = () => this.worldTimeMs();
    w.__crossyMotion = () => ({
      state: this.local.state.name,
      visual: {
        x: this.local.root.position.x,
        y: this.local.body.position.y,
        z: this.local.root.position.z,
      },
      target: {
        x: this.localTarget.x,
        y: this.localTarget.y,
        z: this.localTarget.z,
      },
      worldTimeMs: this.worldTimeMs(),
    });
    w.__crossyMap = () => {
      let firstRow: number | null = null;
      let lastRow: number | null = null;
      for (const row of this.lanes.keys()) {
        firstRow = firstRow == null ? row : Math.min(firstRow, row);
        lastRow = lastRow == null ? row : Math.max(lastRow, row);
      }
      return { loadedRows: this.lanes.size, firstRow, lastRow };
    };
    // Who the world thinks the other players are. Whether a remote is drawn
    // as the agent they CHOSE is not visible from a screenshot when they
    // are off camera, and it is exactly the thing that used to be wrong.
    // What the GPU is being asked to do each frame. "Laggy" has two very
    // different causes — too much work, or a slow renderer — and draw
    // calls are what separates them.
    (window as unknown as { __crossyStats?: () => unknown }).__crossyStats = () => ({
      calls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      geometries: this.renderer.info.memory.geometries,
      textures: this.renderer.info.memory.textures,
      programs: this.renderer.info.programs?.length ?? 0,
    });
    w.__crossyRemotes = () =>
      [...this.players.entries()].map(([wallet, rig]) => ({
        wallet,
        model: this.remoteModels.get(wallet) ?? "(hashed)",
        name: rig.currentName(),
      }));
  }

  constructor(
    private canvas: HTMLCanvasElement,
    opts: { wallet?: string; modelId?: string } = {},
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.06;
    this.scene.background = new THREE.Color(COLORS.sky);
    // Fog only swallows the frontier; nearby lane colors must stay honest
    // (road vs river readability is a fairness issue, not just style).
    this.scene.fog = new THREE.Fog(COLORS.sky, 34, 58);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -50, 120);
    this.matWater = makeWaterMaterial(this.waterTime);

    const ambient = new THREE.AmbientLight(0xffffff, 1.15);
    const sun = new THREE.DirectionalLight(0xfff4dd, 1.5);
    sun.position.set(14, 30, 16);
    const fill = new THREE.DirectionalLight(0xbfe8ff, 0.35);
    fill.position.set(-10, 12, -8);
    this.scene.add(ambient, sun, fill);

    this.dust = new BlockDust(this.scene);

    // Grass apron behind the start line: rows < 0 are out of the world but
    // must read as solid ground, never as traversable space or water.
    for (let r = -1; r >= -10; r--) {
      const apron = new THREE.Mesh(this.stripGeo, this.matGrassEdge);
      apron.scale.set(WIDTH + 48, 1, 1);
      apron.position.set(WIDTH / 2, -0.12, -r);
      this.scene.add(apron);
    }

    // Local player model: explicit choice wins; otherwise deterministic
    // per wallet so "your animal" is stable across sessions.
    const modelId = opts.modelId ?? agentId(hashWallet(opts.wallet ?? "local"));
    this.local = new PlayerRig(modelId, PLAYER_HEIGHT, this.shadowMat, this.shadowGeo);
    this.local.root.position.copy(this.localTarget);
    this.local.onLand((at) => this.landedAt(at));
    this.scene.add(this.local.root);

    this.resize();
    this.exposeClock();
    this.clock.start();
    this.loop();
  }

  resize() {
    const w = this.canvas.clientWidth || 800;
    const h = this.canvas.clientHeight || 600;
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.setSize(w, h, false);
    const aspect = w / h;
    const vh = this.viewHeight;
    this.camera.top = vh / 2;
    this.camera.bottom = -vh / 2;
    this.camera.left = (-vh * aspect) / 2;
    this.camera.right = (vh * aspect) / 2;
    this.camera.updateProjectionMatrix();
  }

  /** Install or replace a revealed lane row. */
  setLane(row: number, lane: Lane, randomness?: Uint8Array) {
    this.lanes.set(row, lane);
    if (randomness) this.laneSeeds.set(row, randomness);
    const old = this.laneMeshes.get(row);
    if (old) {
      this.scene.remove(old);
      disposeLaneGroup(old);
      this.hazardMarks.delete(row);
      this.movers.delete(row);
      this.railStripMats.delete(row);
    }
    const group = new THREE.Group();

    // Playfield strip + darker out-of-bounds shoulders on both sides.
    const stripMat =
      lane.kind === LANE_GRASS
        ? row % 2
          ? this.matGrass
          : this.matGrassAlt
        : lane.kind === LANE_ROAD
          ? row % 2
            ? this.matRoad
            : this.matRoadAlt
          : lane.kind === LANE_RIVER
            ? this.matRiverBed
            : new THREE.MeshLambertMaterial({ color: COLORS.rail });
    if (lane.kind === LANE_RAIL)
      this.railStripMats.set(row, stripMat as THREE.MeshLambertMaterial);
    const strip = new THREE.Mesh(this.stripGeo, stripMat);
    strip.scale.set(WIDTH, 1, 1);
    // Water sits visibly lower than land — banks read as edges.
    strip.position.set(WIDTH / 2, lane.kind === LANE_RIVER ? -0.34 : -0.1, -row);
    group.add(strip);
    if (lane.kind === LANE_RIVER) {
      const surface = new THREE.Mesh(this.riverSurfaceGeo, this.matWater);
      surface.rotation.x = -Math.PI / 2;
      surface.scale.set(WIDTH, 1, 1);
      surface.position.set(WIDTH / 2, -0.13, -row);
      group.add(surface);
      for (const zOff of [-0.48, 0.48]) {
        const bank = new THREE.Mesh(this.unitBox, this.matBank);
        bank.scale.set(WIDTH, 0.07, 0.14);
        bank.position.set(WIDTH / 2, -0.09, -row + zOff);
        group.add(bank);
      }
    }
    for (const side of [-1, 1]) {
      const shoulder = new THREE.Mesh(this.stripGeo, this.matGrassEdge);
      shoulder.scale.set(24, 1, 1);
      shoulder.position.set(side === -1 ? -12 : WIDTH + 12, -0.12, -row);
      group.add(shoulder);
    }
    if (lane.kind === LANE_ROAD && this.lanes.get(row - 1)?.kind === LANE_ROAD) {
      // Dashed divider between adjacent road lanes (Crossy signature).
      const dashes = new THREE.InstancedMesh(this.unitBox, this.matDash, 22);
      const dummy = new THREE.Object3D();
      for (let i = 0; i < 22; i++) {
        dummy.position.set(i * 3 + 1, 0.01, -(row - 0.5));
        dummy.scale.set(0.55, 0.04, 0.09);
        dummy.updateMatrix();
        dashes.setMatrixAt(i, dummy.matrix);
      }
      dashes.instanceMatrix.needsUpdate = true;
      group.add(dashes);
    }
    if (lane.kind === LANE_RAIL) {
      // Two running rails over the ballast strip.
      for (const off of [-0.22, 0.22]) {
        const railBar = new THREE.Mesh(this.unitBox, this.matRailBar);
        railBar.scale.set(WIDTH, 0.06, 0.08);
        railBar.position.set(WIDTH / 2, 0.03, -row + off);
        group.add(railBar);
      }
    }

    if (lane.kind === LANE_GRASS) {
      // Voxel trees (stacked cubes, one InstancedMesh per lane): blockers
      // on the playfield plus sparse shoulder trees for depth.
      const positions: number[] = [];
      for (let x = 0; x < WIDTH; x++) {
        if (lane.blockerMask & (1n << BigInt(x))) positions.push(x);
      }
      for (let i = 0; i < 5; i++) {
        const h = (Math.imul(row + 31, 2654435761) ^ Math.imul(i + 17, 40503)) >>> 16;
        positions.push(i % 2 === 0 ? -2 - (h % 9) : WIDTH + 1 + (h % 9));
      }
      this.buildVoxelTrees(group, positions, row);
      // Shoulder rocks (outside the playfield, purely visual).
      const rockId = pickDeterministic(ROCK_POOL, row, 13);
      const rocks: number[] = [];
      for (let i = 0; i < 3; i++) {
        const h = (Math.imul(row + 7, 2246822519) ^ Math.imul(i + 3, 3266489917)) >>> 15;
        rocks.push(i % 2 === 0 ? -1 - (h % 12) : WIDTH + 2 + (h % 12));
      }
      this.addInstanced(group, rockId, rocks, row, 0.7, 5);
    } else {
      const count =
        lane.kind === LANE_RAIL ? 1 : Math.ceil(WIDTH / Math.max(2, lane.gapTiles)) + 2;
      const objs: THREE.Object3D[] = [];
      const slots: Array<{ index: number; assetId: string }> = [];
      for (let i = 0; i < count; i++) {
        let obj: THREE.Object3D;
        if (lane.kind === LANE_ROAD) {
          // The model is decided per *car*, not per pool slot, once the
          // lane starts moving — see `refreshVehicleSlot`. This is only the
          // initial fill.
          obj = this.buildVehicle(lane, "vehicle.compact.a");
        } else if (lane.kind === LANE_RIVER) {
          obj = this.buildLog(lane.footprint);
          this.addMoverShadow(obj, lane.footprint);
        } else {
          obj = this.buildTrain(lane.footprint);
          if (lane.dirPositive !== 1) obj.rotation.y = Math.PI;
          this.addMoverShadow(obj, Math.min(4, lane.footprint));
        }
        obj.visible = false;
        group.add(obj);
        objs.push(obj);
        slots.push({ index: Number.NaN, assetId: "vehicle.compact.a" });
      }
      this.movers.set(row, objs);
      this.moverSlots.set(row, slots);
      // Roads get the contract drawn on them. Rivers do not need it (logs
      // are slow and their footprint is where you STAND, not where you
      // die) and a rail's whole row is lethal at once, so position carries
      // no information there.
      if (lane.kind === LANE_ROAD) {
        const marks: THREE.Mesh[] = [];
        for (let i = 0; i < count; i++) {
          const mark = new THREE.Mesh(this.hazardMarkGeo, this.hazardMarkMat);
          mark.rotation.x = -Math.PI / 2;
          mark.position.y = 0.02;
          mark.visible = false;
          group.add(mark);
          marks.push(mark);
        }
        this.hazardMarks.set(row, marks);
      }
    }
    this.laneMeshes.set(row, group);
    this.scene.add(group);
  }

  /** One traffic mesh, scaled to the lane's canonical footprint. */
  private buildVehicle(lane: Lane, assetId: string): THREE.Object3D {
    const obj = instantiate(assetId);
    // Chunky Crossy proportions: slight visual overhang past the canonical
    // footprint (forgiving, never the reverse). Every vehicle gets the SAME
    // cross-lane width regardless of the model's intrinsic proportions, so
    // traffic reads uniform.
    const s = Math.max(1, lane.footprint) * 0.95 + 0.22;
    const widthRatio = (obj.userData?.widthRatio as number) ?? 0.5;
    const cross = Math.min(s * 1.25, 0.62 / Math.max(0.25, widthRatio));
    obj.scale.set(s, cross, cross);
    if (lane.dirPositive !== 1) obj.rotation.y = Math.PI;
    return obj;
  }

  /**
   * Make sure the mesh in `slot` is the model this car is supposed to be.
   *
   * Which car wears which body is derived from the chunk's committed
   * randomness and the car's conveyor index, so every client resolves the
   * same answer and a given car keeps its body for its whole journey. The
   * mesh is only rebuilt when a slot is recycled for a different car.
   */
  private refreshVehicleSlot(
    row: number,
    slot: number,
    lane: Lane,
    index: number,
    assetId: string,
  ): THREE.Object3D | undefined {
    const meshes = this.movers.get(row);
    const slots = this.moverSlots.get(row);
    if (!meshes || !slots) return undefined;
    const current = slots[slot];
    if (current && current.index === index && current.assetId === assetId) {
      return meshes[slot];
    }
    if (current && current.assetId === assetId) {
      slots[slot] = { index, assetId };
      return meshes[slot];
    }
    const group = this.laneMeshes.get(row);
    const old = meshes[slot];
    if (group && old) {
      group.remove(old);
      disposeLaneGroup(old as THREE.Group);
    }
    const replacement = this.buildVehicle(lane, assetId);
    replacement.visible = false;
    group?.add(replacement);
    meshes[slot] = replacement;
    slots[slot] = { index, assetId };
    return replacement;
  }

  private addInstanced(
    group: THREE.Group,
    assetId: string,
    xs: number[],
    row: number,
    scale: number,
    seed: number,
  ) {
    const template = instantiate(assetId);
    let source: THREE.Mesh | null = null;
    template.traverse((o) => {
      if (!source && o instanceof THREE.Mesh) source = o;
    });
    if (!source) return;
    const src = source as THREE.Mesh;
    const inst = new THREE.InstancedMesh(src.geometry, src.material, xs.length);
    const dummy = new THREE.Object3D();
    xs.forEach((x, i) => {
      const h = (Math.imul(x + 7, 374761393) ^ Math.imul(row + seed, 668265263)) >>> 13;
      dummy.position.set(x + 0.5, 0, -row);
      dummy.rotation.y = ((h % 4) * Math.PI) / 2;
      dummy.scale.setScalar(scale * (0.9 + ((h >>> 4) % 100) / 500));
      dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);
    });
    inst.instanceMatrix.needsUpdate = true;
    group.add(inst);
  }

  /**
   * Procedural voxel trees: brown cube trunk + 2–3 shrinking green cube
   * layers, per-tree height/tint variation, all parts in ONE InstancedMesh
   * (unit box + per-instance color) so a dense row stays a single draw call.
   */
  private buildVoxelTrees(group: THREE.Group, xs: number[], row: number) {
    if (xs.length === 0) return;
    interface Part {
      x: number;
      y: number;
      z: number;
      s: number;
      sy: number;
      color: number;
    }
    const parts: Part[] = [];
    const TRUNK = 0x7a4f26;
    const GREENS = [0x2f9e57, 0x2a8f4e, 0x37a75b];
    for (const x of xs) {
      const h = (Math.imul(x + 11, 374761393) ^ Math.imul(row + 5, 668265263)) >>> 9;
      const variant = h % 3; // 0 short, 1 medium, 2 tall
      const green = GREENS[(h >>> 3) % GREENS.length];
      const jitter = ((h >>> 6) % 100) / 1000 - 0.05; // ±0.05 tile
      const cx = x + 0.5 + jitter;
      const trunkH = 0.28 + variant * 0.14;
      parts.push({ x: cx, y: trunkH / 2, z: -row, s: 0.2, sy: trunkH, color: TRUNK });
      const layers = variant === 0 ? 2 : 3;
      let y = trunkH;
      let size = 0.66 + variant * 0.06;
      for (let l = 0; l < layers; l++) {
        const sy = size * 0.72;
        parts.push({
          x: cx,
          y: y + sy / 2,
          z: -row,
          s: size,
          sy,
          color: lighten(green, l * 0.12),
        });
        y += sy;
        size *= 0.72;
      }
    }
    const inst = new THREE.InstancedMesh(this.unitBox, this.matWhite, parts.length);
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    parts.forEach((p, i) => {
      dummy.position.set(p.x, p.y, p.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(p.s, p.sy, p.s);
      dummy.updateMatrix();
      inst.setMatrixAt(i, dummy.matrix);
      inst.setColorAt(i, color.setHex(p.color));
    });
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    group.add(inst);
  }

  private addMoverShadow(obj: THREE.Object3D, footprint: number) {
    const sh = new THREE.Mesh(this.shadowGeo, this.shadowMat);
    sh.rotation.x = -Math.PI / 2;
    sh.position.y = 0.015;
    sh.scale.set(Math.max(1.1, footprint * 0.42), 1, 0.85);
    obj.add(sh);
  }

  /** Voxel timber: one chunky box + square end-grain, same language as trees. */
  private buildLog(footprint: number): THREE.Object3D {
    const g = new THREE.Group();
    const len = Math.max(1, footprint) * 0.95;
    const body = new THREE.Mesh(this.unitBox, this.matLog);
    body.scale.set(len, 0.42, 0.72);
    body.position.y = 0.2;
    g.add(body);
    for (const t of [-0.18, 0.2]) {
      const band = new THREE.Mesh(this.unitBox, this.matLogBark);
      band.scale.set(0.12, 0.46, 0.76);
      band.position.set(t * len, 0.2, 0);
      g.add(band);
    }
    for (const side of [-1, 1]) {
      const cap = new THREE.Mesh(this.unitBox, this.matLogEnd);
      cap.scale.set(0.07, 0.34, 0.58);
      cap.position.set(side * (len / 2 + 0.01), 0.2, 0);
      g.add(cap);
      const pith = new THREE.Mesh(this.unitBox, this.matLogBark);
      pith.scale.set(0.04, 0.14, 0.22);
      pith.position.set(side * (len / 2 + 0.04), 0.2, 0);
      g.add(pith);
    }
    return g;
  }

  /** Original toy train (docs forbid the ripped Crossy train). */
  private buildTrain(footprint: number): THREE.Object3D {
    const g = new THREE.Group();
    const len = Math.max(2, footprint);
    const segCount = Math.max(2, Math.round(len / 2.35));
    const segLen = len / segCount;
    for (let i = 0; i < segCount; i++) {
      const isLoco = i === 0;
      const x = -len / 2 + segLen * (i + 0.5);
      if (isLoco) {
        const chassis = new THREE.Mesh(this.unitBox, this.matTrain);
        chassis.scale.set(segLen * 0.9, 0.28, 0.72);
        chassis.position.set(x, 0.28, 0);
        g.add(chassis);
        const cab = new THREE.Mesh(this.unitBox, this.matTrainCab);
        cab.scale.set(segLen * 0.38, 0.42, 0.7);
        cab.position.set(x + segLen * 0.18, 0.58, 0);
        g.add(cab);
        const nose = new THREE.Mesh(this.unitBox, this.matTrain);
        nose.scale.set(segLen * 0.42, 0.22, 0.58);
        nose.position.set(x - segLen * 0.16, 0.42, 0);
        g.add(nose);
        const cow = new THREE.Mesh(this.unitBox, this.matTrainTrim);
        cow.scale.set(0.14, 0.12, 0.78);
        cow.position.set(x - segLen * 0.42, 0.18, 0);
        g.add(cow);
        const stack = new THREE.Mesh(this.unitBox, this.matTrainCab);
        stack.scale.set(0.12, 0.22, 0.12);
        stack.position.set(x - segLen * 0.12, 0.68, 0);
        g.add(stack);
        const lamp = new THREE.Mesh(this.unitBox, this.matLamp);
        lamp.scale.set(0.08, 0.1, 0.1);
        lamp.position.set(x - segLen * 0.38, 0.44, 0);
        g.add(lamp);
        g.userData.lamp = this.matLamp;
      } else {
        const body = new THREE.Mesh(this.unitBox, this.matTrain);
        body.scale.set(segLen * 0.82, 0.46, 0.7);
        body.position.set(x, 0.36, 0);
        g.add(body);
        const window = new THREE.Mesh(this.unitBox, this.matTrainCab);
        window.scale.set(segLen * 0.62, 0.16, 0.72);
        window.position.set(x, 0.44, 0);
        g.add(window);
        const roof = new THREE.Mesh(this.unitBox, this.matTrainCab);
        roof.scale.set(segLen * 0.78, 0.08, 0.62);
        roof.position.set(x, 0.62, 0);
        g.add(roof);
        const coupler = new THREE.Mesh(this.unitBox, this.matLogBark);
        coupler.scale.set(segLen * 0.16, 0.06, 0.1);
        coupler.position.set(x - segLen * 0.48, 0.22, 0);
        g.add(coupler);
      }
      for (const [wx, wz] of [
        [x - segLen * 0.22, 0.32],
        [x + segLen * 0.22, 0.32],
        [x - segLen * 0.22, -0.32],
        [x + segLen * 0.22, -0.32],
      ]) {
        const wheel = new THREE.Mesh(this.wheelGeo, this.matTrainCab);
        wheel.rotation.z = Math.PI / 2;
        wheel.position.set(wx, 0.11, wz);
        g.add(wheel);
      }
    }
    return g;
  }

  // ---- local player intents (called by GameScreen) ----

  /** Authoritative/predicted local tile: the rig hops to it. */
  setLocal(x: number, y: number, facing?: number) {
    const target = new THREE.Vector3(x + 0.5, 0, -y);
    // Whether the TILE changed, not whether the mesh has caught up to it.
    // Authority repeats the same position several times a second (the
    // hazard crank rewrites the run), and mid-hop the rig is by definition
    // not at its target — restarting the hop on every one of those made
    // the player stutter in place and chirp on each repeat.
    const sameTile = this.localTarget.distanceToSquared(target) < 1e-9;
    // A visual can legitimately trail several predicted inputs. Only the
    // authoritative target-to-target delta identifies a real correction.
    const authoritativeJump = this.localTarget.distanceTo(target);
    this.localTarget.copy(target);
    if (facing != null) this.local.targetYaw = facingYaw(facing);
    if (authoritativeJump > 2.5) {
      // Large correction / spawn: ground snap with a network pulse.
      this.local.teleport(target);
      this.dust.burst(target, {
        count: 8,
        color: 0xffffff,
        speed: 1.2,
        up: 1.4,
        size: 0.06,
      });
    } else if (!sameTile) {
      this.local.hopTo(target, facing);
      sfx.hop();
    }
  }

  setFacing(facing: number) {
    this.local.targetYaw = facingYaw(facing);
  }

  /** Swap the local player's model live (agent picker preview). */
  setLocalModel(modelId: string) {
    this.local.setModel(modelId);
    this.local.flourish();
  }

  /** Your own name, over your own head — proof the identity is live. */
  setLocalName(name: string | undefined) {
    this.local.setName(name, PLAYER_HEIGHT);
  }

  flourishLocal() {
    this.local.flourish();
    sfx.hop();
  }

  setPresentation(mode: Presentation) {
    this.presentation = mode;
    this.viewHeight = mode === "menu" ? 6.6 : 13;
    this.local.setVisualScale(mode === "menu" ? PLAYER_HEIGHT * 1.55 : PLAYER_HEIGHT);
    this.resize();
  }

  private landedAt(at: THREE.Vector3) {
    const row = Math.round(-at.z);
    const surface = surfaceOf(this.lanes.get(row));
    this.dust.land(at.clone().setY(0.12), surface);
    if (surface === "river") sfx.plip();
    else if (surface === "road") sfx.landRoad();
    else if (surface === "rail") sfx.landRail();
    else sfx.landGrass();
  }

  /** Rejected move: directional bump-back, dust tick, no progression. */
  bumpLocal(dx: number, dy: number) {
    sfx.bump();
    this.local.bump(new THREE.Vector3(dx, 0, -dy));
    const at = this.local.root.position
      .clone()
      .add(new THREE.Vector3(dx * 0.5, 0.2, -dy * 0.5));
    this.dust.burst(at, { count: 4, color: 0xffffff, speed: 0.8, up: 1, size: 0.05 });
  }

  /** Kick accepted: directional stretch + dust + camera impulse. */
  kickLocal(facing: number) {
    this.local.targetYaw = facingYaw(facing);
    const dir = new THREE.Vector3(
      facing === 2 ? -1 : facing === 3 ? 1 : 0,
      0,
      facing === 0 ? -1 : facing === 1 ? 1 : 0,
    );
    this.local.bump(dir.clone().negate()); // recoil
    const at = this.local.root.position.clone().addScaledVector(dir, 1).setY(0.3);
    this.dust.burst(at, { count: 14, color: COLORS.dust, speed: 2.6, up: 2.2 });
    this.addTrauma(0.3);
    this.hitStopUntil = performance.now() + 45;
    sfx.kick();
  }

  /** Score milestone: gold confetti burst at the player + camera nudge. */
  celebrate() {
    const at = this.local.root.position.clone().setY(0.5);
    this.dust.burst(at, { count: 22, color: 0xffd23f, speed: 2.4, up: 3.2, size: 0.09 });
    this.dust.burst(at, { count: 10, color: 0xfffdf5, speed: 1.6, up: 2.4, size: 0.06 });
    this.addTrauma(0.12);
    sfx.fanfare();
  }

  /**
   * Local death.
   *
   * Pass the cause when the chain has said what it was — the program picks
   * it from the lane the run actually died on, which is not always the lane
   * the local mesh is standing on after a rejected move or a kick. Falls
   * back to reading the terrain under the mesh.
   */
  killLocal(cause?: DeathCause) {
    if (this.local.dead) return;
    if (cause === undefined) {
      const y = Math.round(-this.local.root.position.z);
      const lane = this.lanes.get(y);
      cause =
        lane?.kind === LANE_RIVER
          ? "water"
          : lane?.kind === LANE_RAIL
            ? "train"
            : "impact";
    }
    this.lastDeathCause = cause;
    this.local.die(cause === "water" ? "water" : "impact");
    const at = this.local.root.position.clone().setY(0.25);
    if (cause === "water") {
      this.dust.splash(at, true);
      sfx.splash();
    } else if (cause === "train") {
      this.dust.burst(at, { count: 16, color: 0xffd23f, speed: 3.2, up: 3.2 });
      this.dust.burst(at, { count: 10, color: 0xffffff, speed: 2.4, up: 2.6 });
      sfx.horn();
      sfx.death();
    } else {
      this.dust.burst(at, { count: 18, color: 0xffffff, speed: 3, up: 3 });
      sfx.death();
    }
    this.addTrauma(cause === "water" ? 0.45 : cause === "train" ? 0.95 : 0.8);
    if (cause !== "water") this.hitStopUntil = performance.now() + 110;
    haptic([20, 30, 20]);
  }

  reviveLocal() {
    this.local.revive();
  }

  get localDead() {
    return this.local.dead;
  }

  addTrauma(amount: number) {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  setRemotes(players: RemotePlayer[]) {
    const seen = new Set<string>();
    for (const p of players) {
      seen.add(p.wallet);
      let rig = this.players.get(p.wallet);
      const target = new THREE.Vector3(p.x + 0.5, 0, -p.y);
      // The agent they chose, or their address if they never chose one.
      const modelId = agentId(p.agent ?? hashWallet(p.wallet));
      if (!rig) {
        rig = new PlayerRig(
          modelId,
          PLAYER_HEIGHT * 0.92,
          this.shadowMat,
          this.shadowGeo,
        );
        rig.teleport(target);
        this.players.set(p.wallet, rig);
        this.scene.add(rig.root);
      }
      // A player can change agent mid-session; follow it.
      if (this.remoteModels.get(p.wallet) !== modelId) {
        this.remoteModels.set(p.wallet, modelId);
        rig.setModel(modelId);
      }
      rig.setName(p.name, PLAYER_HEIGHT * 0.92);
      const prev = this.remoteTargets.get(p.wallet);
      if (!prev || !prev.equals(target)) {
        this.remoteTargets.set(p.wallet, target);
        if (prev && prev.distanceTo(target) <= 2.5)
          rig.hopTo(target, yawFromDelta(target, prev));
        else rig.teleport(target);
      }
    }
    for (const [wallet, rig] of this.players) {
      if (!seen.has(wallet)) {
        this.scene.remove(rig.root);
        this.players.delete(wallet);
        this.remoteTargets.delete(wallet);
        this.remoteModels.delete(wallet);
      }
    }
  }

  /** Drop lane meshes far behind the camera (lane *data* stays for the
   * simulation mirror; a pruned row re-installs via setLane if revisited). */
  private pruneBehind(nearRow: number) {
    for (const [row, group] of this.laneMeshes) {
      if (row >= nearRow - 40) continue;
      this.scene.remove(group);
      group.traverse((o) => {
        if (o instanceof THREE.InstancedMesh) o.dispose();
      });
      this.railStripMats.get(row)?.dispose();
      this.railStripMats.delete(row);
      this.laneMeshes.delete(row);
      this.hazardMarks.delete(row);
      this.movers.delete(row);
    }
  }

  private frame = 0;

  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(0.05, this.clock.getDelta());
    const dtMs = dt * 1000;
    const now = performance.now();

    // Slot notifications update a target. Rendering closes the phase error
    // continuously, so cars, logs and trains never receive a clock step.
    if (this.worldClockReady) {
      this.worldTimeOffsetMs +=
        (this.targetWorldTimeOffsetMs - this.worldTimeOffsetMs) * smoothFactor(0.1, dtMs);
    }
    // Hit-stop: rewind the hazard clock by the frame delta so the world
    // freezes for a beat while the player animation keeps running.
    if (now < this.hitStopUntil) {
      this.worldTimeOffsetMs -= dtMs;
      this.targetWorldTimeOffsetMs -= dtMs;
    }
    const tMs = this.worldTimeMs();

    this.local.update(dtMs, now);
    for (const rig of this.players.values()) rig.update(dtMs, now);
    this.dust.update(dt);

    // Camera: critically damped follow; player framed below center so the
    // road ahead gets most of the screen. Lateral tracking is softer.
    const p = this.local.root.position;
    const lookAhead = this.presentation === "menu" ? 0.2 : 2.2;
    const camSide = this.presentation === "menu" ? 2.1 : 3.5;
    const camUp = this.presentation === "menu" ? 10.2 : 16;
    const camBack = this.presentation === "menu" ? 6.6 : 11;
    this.camFocus.x += (p.x - this.camFocus.x) * smoothFactor(0.07, dtMs);
    this.camFocus.z += (p.z - lookAhead - this.camFocus.z) * smoothFactor(0.12, dtMs);
    this.trauma = Math.max(0, this.trauma - dt * 1.4);
    const shake = this.trauma * this.trauma;
    const sx = shake * 0.4 * noise1d(now / 45, 1);
    const sz = shake * 0.4 * noise1d(now / 45, 2);
    const roll = shake * 0.05 * noise1d(now / 45, 3);
    // Three-quarter view: back and up from the focus, slightly yawed.
    this.camera.position.set(
      this.camFocus.x + camSide + sx,
      camUp,
      this.camFocus.z + camBack + sz,
    );
    this.camera.lookAt(this.camFocus.x + sx, 0, this.camFocus.z + sz);
    this.camera.rotation.z += roll;

    this.waterTime.value += dt;
    if (this.matWater.map) this.matWater.map.offset.x = this.waterTime.value * 0.07;

    // Hazard visuals from deterministic descriptors.
    const nearRow = Math.round(-p.z);
    // Read once per frame: the marks are a fairness aid, and a player who
    // finds them noisy can turn them off.
    const marksOn = getSettings().hazardMarks;
    if (++this.frame % 120 === 0) this.pruneBehind(nearRow);
    let riverNear = false;
    for (const [row, lane] of this.lanes) {
      const group = this.laneMeshes.get(row);
      if (group) {
        // Interest management: rows far outside the view skip work.
        const visible = row > nearRow - 14 && row < nearRow + 26;
        if (group.visible !== visible) group.visible = visible;
        if (!visible) continue;
      }
      if (lane.kind === LANE_RIVER && Math.abs(row - nearRow) < 4) riverNear = true;
      const meshes = this.movers.get(row);
      if (!meshes) continue;
      if (lane.kind === LANE_ROAD || lane.kind === LANE_RIVER) {
        const submerged = lane.kind === LANE_RIVER && logSubmerged(lane, tMs);
        // Authoritative traffic: positions and models both come from the
        // chain's own view of this lane, so what is drawn is what collides.
        const seed = this.laneSeeds.get(row) ?? EMPTY_SEED;
        const vehicles = laneVehicles(lane, row, seed, tMs);
        const seen = new Set<number>();
        for (const v of vehicles) {
          const slot = ((v.index % meshes.length) + meshes.length) % meshes.length;
          if (seen.has(slot)) continue; // more cars than slots: skip the overflow
          seen.add(slot);
          const m =
            lane.kind === LANE_ROAD
              ? this.refreshVehicleSlot(row, slot, lane, v.index, v.assetId)
              : meshes[slot];
          if (!m) continue;
          if (v.renderX < -6 || v.renderX > WIDTH + 6) {
            m.visible = false;
            continue;
          }
          // Life in the lanes: cars ride with a fast micro-bounce, logs
          // bob slowly on the water.
          const bob =
            lane.kind === LANE_ROAD
              ? Math.sin(tMs / 85 + v.x * 2.1) * 0.012
              : Math.sin(tMs / 420 + row * 1.7) * 0.025;
          // `renderX` glides across the tick and lands exactly on the
          // authoritative tile at every tick boundary, so the motion is
          // continuous without ever drawing a car where it is not.
          const cx = v.renderX + lane.footprint / 2;
          if (lane.kind === LANE_ROAD) {
            const prev = (m.userData.prevX as number) ?? cx;
            if (
              Math.abs(row - nearRow) < 3 &&
              (prev - p.x) * (cx - p.x) <= 0 &&
              Math.abs(prev - cx) > 0.2 &&
              now - this.lastWhooshAt > 280
            ) {
              sfx.whoosh();
              this.lastWhooshAt = now;
            }
            m.userData.prevX = cx;
          }
          m.position.x = cx;
          m.visible = true;
          m.position.y = (submerged ? -0.28 : 0) + bob;
          m.position.z = -row;
          // The mark sits on `v.x` — the tile the program has, not the one
          // the eye is being shown. Between ticks the body trails it, and
          // the gap IS the difference between what is drawn and what
          // collides. Showing it beats hiding it.
          const mark = this.hazardMarks.get(row)?.[slot];
          if (mark) {
            if (marksOn) {
              mark.position.set(v.x + lane.footprint / 2, 0.02, -row);
              mark.scale.set(lane.footprint * 0.96, 0.86, 1);
              mark.visible = true;
            } else if (mark.visible) {
              mark.visible = false;
            }
          }
        }
        const marks = this.hazardMarks.get(row);
        for (let i = 0; i < meshes.length; i++) {
          if (!seen.has(i)) meshes[i].visible = false;
          if (marks?.[i] && !seen.has(i)) marks[i].visible = false;
        }
      } else if (lane.kind === LANE_RAIL) {
        const { phase, trainX } = railPhaseVisual(lane, tMs);
        const blink = phase === "warning" && Math.floor(tMs / 220) % 2 === 0;
        const stripMat = this.railStripMats.get(row);
        if (stripMat) {
          // Stepped warning blink (voxel-arcade: hard steps, not fades).
          stripMat.color.set(blink ? COLORS.warning : COLORS.rail);
        }
        const prevPhase = meshes[0]?.userData.phase as string | undefined;
        if (
          phase === "warning" &&
          prevPhase !== "warning" &&
          Math.abs(row - nearRow) < 8
        ) {
          if (now - this.lastBellAt > 400) {
            sfx.bell();
            this.lastBellAt = now;
          }
        }
        if (phase === "train" && prevPhase !== "train" && Math.abs(row - nearRow) < 10) {
          sfx.horn();
          this.addTrauma(0.12);
        }
        const train = meshes[0];
        if (train) {
          train.userData.phase = phase;
          train.visible = phase === "train";
          train.position.set(trainX + lane.footprint / 2, 0, -row);
          const lamp = train.userData.lamp as THREE.MeshLambertMaterial | undefined;
          if (lamp) lamp.emissiveIntensity = phase === "train" ? 1.35 : 0.25;
        }
      }
    }
    sfx.river(riverNear && this.presentation === "play");
    this.renderer.render(this.scene, this.camera);
  };

  destroy() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.dust.dispose();
    sfx.river(false);
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh || o instanceof THREE.InstancedMesh) {
        o.geometry.dispose();
        const m = o.material as THREE.Material | THREE.Material[];
        (Array.isArray(m) ? m : [m]).forEach((x) => x.dispose());
      }
    });
    this.renderer.dispose();
  }
}

function disposeLaneGroup(group: THREE.Group) {
  // Shared geometries/materials survive; only per-lane resources die with
  // the group (instanced meshes share the template's geometry/material, so
  // nothing here owns GPU memory exclusively except rail strip materials).
  group.clear();
}

function hashWallet(wallet: string): number {
  let h = 5381;
  for (let i = 0; i < wallet.length; i++)
    h = (Math.imul(h, 33) ^ wallet.charCodeAt(i)) >>> 0;
  return h % 40;
}

/** 2×1-pixel repeating checker: one pixel per tile along the 64-wide strip. */
function makeCheckerTexture(colorA: number, colorB: number): THREE.Texture {
  const canvas = document.createElement("canvas");
  canvas.width = 2;
  canvas.height = 1;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = `#${colorA.toString(16).padStart(6, "0")}`;
  ctx.fillRect(0, 0, 1, 1);
  ctx.fillStyle = `#${colorB.toString(16).padStart(6, "0")}`;
  ctx.fillRect(1, 0, 1, 1);
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.wrapS = THREE.RepeatWrapping;
  tex.repeat.set(64 / 2, 1);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function lighten(hex: number, amount: number): number {
  const r = Math.min(255, ((hex >> 16) & 0xff) * (1 + amount));
  const g = Math.min(255, ((hex >> 8) & 0xff) * (1 + amount));
  const b = Math.min(255, (hex & 0xff) * (1 + amount));
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);
}

function yawFromDelta(to: THREE.Vector3, from: THREE.Vector3): number {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  if (Math.abs(dx) > Math.abs(dz)) return dx > 0 ? 3 : 2;
  return dz < 0 ? 0 : 1;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** Length from footprint; width/height from native ratios — never squash YZ by length. */
function fitVehicle(obj: THREE.Object3D, footprint: number) {
  const long = footprint >= 3;
  const widthRatio = (obj.userData?.widthRatio as number) ?? 0.45;
  const heightRatio = (obj.userData?.heightRatio as number) ?? 0.35;
  const length = Math.max(1, footprint) * 0.88 + 0.08;
  const targetW = long ? 0.7 : 0.58;
  const targetH = long ? 0.6 : 0.44;
  const scaleZ = clamp(targetW / Math.max(0.22, widthRatio), 0.7, 1.22);
  const scaleY = clamp(targetH / Math.max(0.18, heightRatio), 0.62, 1.45);
  obj.scale.set(length, scaleY, scaleZ);
}

function surfaceOf(lane: Lane | undefined): Surface {
  if (!lane) return "unknown";
  if (lane.kind === LANE_RIVER) return "river";
  if (lane.kind === LANE_ROAD) return "road";
  if (lane.kind === LANE_RAIL) return "rail";
  return "grass";
}

function makeWaterMaterial(uTime: { value: number }): THREE.MeshLambertMaterial {
  const tex = makeCheckerTexture(0x1eb4e6, 0x0d6fa3);
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(32, 2);
  const mat = new THREE.MeshLambertMaterial({
    map: tex,
    color: 0xffffff,
    fog: true,
  });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uTime;
    shader.vertexShader = `uniform float uTime;\n${shader.vertexShader}`;
    shader.vertexShader = shader.vertexShader.replace(
      "#include <begin_vertex>",
      `
      #include <begin_vertex>
      float wave = sin((position.x * 14.0) + uTime * 1.6) * 0.012;
      wave += sin((position.x * 6.0 - position.y * 8.0) - uTime * 1.1) * 0.01;
      transformed.z += floor(wave * 16.0) / 16.0;
      `,
    );
  };
  mat.customProgramCacheKey = () => "lana-water-v1";
  return mat;
}
