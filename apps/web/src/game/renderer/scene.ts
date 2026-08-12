/**
 * Three.js world renderer. Owns the scene graph and render loop; React never
 * re-renders per frame. Renders authoritative state + one predicted local
 * step; all geometry is disposed on destroy().
 */
import * as THREE from "three";
import {
  Lane,
  LANE_GRASS,
  LANE_RAIL,
  LANE_RIVER,
  LANE_ROAD,
  laneObjects,
  logSubmerged,
  railPhase,
} from "../simulation/hazards";

export interface RemotePlayer {
  wallet: string;
  x: number;
  y: number;
}

const COLORS = {
  grass: 0x69b34c,
  grassAlt: 0x5aa143,
  road: 0x3d3d47,
  river: 0x3d7dd8,
  rail: 0x6b5d52,
  blocker: 0x2e5d24,
  car: 0xd9483b,
  log: 0x8a5a2b,
  train: 0xffd23f,
  local: 0xffffff,
  remote: 0xffa8e2,
  warning: 0xff3333,
};

export class WorldScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private laneMeshes = new Map<number, THREE.Group>();
  private lanes = new Map<number, Lane>();
  private movers = new Map<number, THREE.Mesh[]>();
  private players = new Map<string, THREE.Mesh>();
  private localMesh: THREE.Mesh;
  private raf = 0;
  private disposed = false;
  /** Visual position lerp target for the local player. */
  private localTarget = new THREE.Vector3(32, 0, 0);
  private startMs = performance.now();
  /** Offset between authoritative world time and performance.now(). */
  worldTimeOffsetMs = 0;

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.scene.background = new THREE.Color(0x1a2333);
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200);

    const ambient = new THREE.AmbientLight(0xffffff, 0.8);
    const sun = new THREE.DirectionalLight(0xffffff, 1.2);
    sun.position.set(20, 30, 10);
    this.scene.add(ambient, sun);

    const geo = new THREE.BoxGeometry(0.8, 0.8, 0.8);
    const mat = new THREE.MeshLambertMaterial({ color: COLORS.local });
    this.localMesh = new THREE.Mesh(geo, mat);
    this.scene.add(this.localMesh);

    this.resize();
    this.loop();
  }

  resize() {
    const w = this.canvas.clientWidth || 800;
    const h = this.canvas.clientHeight || 600;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Install or replace a revealed lane row. */
  setLane(row: number, lane: Lane) {
    this.lanes.set(row, lane);
    const old = this.laneMeshes.get(row);
    if (old) {
      this.scene.remove(old);
      old.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          (o.material as THREE.Material).dispose();
        }
      });
      this.movers.delete(row);
    }
    const group = new THREE.Group();
    const baseColor =
      lane.kind === LANE_GRASS
        ? row % 2
          ? COLORS.grass
          : COLORS.grassAlt
        : lane.kind === LANE_ROAD
          ? COLORS.road
          : lane.kind === LANE_RIVER
            ? COLORS.river
            : COLORS.rail;
    const strip = new THREE.Mesh(
      new THREE.BoxGeometry(64, 0.2, 1),
      new THREE.MeshLambertMaterial({ color: baseColor }),
    );
    strip.position.set(32, -0.1, -row);
    group.add(strip);

    if (lane.kind === LANE_GRASS) {
      for (let x = 0; x < 64; x++) {
        if (lane.blockerMask & (1n << BigInt(x))) {
          const tree = new THREE.Mesh(
            new THREE.ConeGeometry(0.35, 0.9, 6),
            new THREE.MeshLambertMaterial({ color: COLORS.blocker }),
          );
          tree.position.set(x + 0.5, 0.45, -row);
          group.add(tree);
        }
      }
    } else {
      // Pool of mover meshes reused each frame.
      const moverColor =
        lane.kind === LANE_ROAD
          ? COLORS.car
          : lane.kind === LANE_RIVER
            ? COLORS.log
            : COLORS.train;
      const count =
        lane.kind === LANE_RAIL ? 1 : Math.ceil(64 / Math.max(2, lane.gapTiles)) + 2;
      const meshes: THREE.Mesh[] = [];
      for (let i = 0; i < count; i++) {
        const m = new THREE.Mesh(
          new THREE.BoxGeometry(Math.max(1, lane.footprint) * 0.95, 0.5, 0.8),
          new THREE.MeshLambertMaterial({ color: moverColor }),
        );
        m.visible = false;
        group.add(m);
        meshes.push(m);
      }
      this.movers.set(row, meshes);
    }
    this.laneMeshes.set(row, group);
    this.scene.add(group);
  }

  /** Authoritative local tile (smoothly approached by the visual mesh). */
  setLocal(x: number, y: number) {
    this.localTarget.set(x + 0.5, 0.4, -y);
  }

  setRemotes(players: RemotePlayer[]) {
    const seen = new Set<string>();
    for (const p of players) {
      seen.add(p.wallet);
      let mesh = this.players.get(p.wallet);
      if (!mesh) {
        mesh = new THREE.Mesh(
          new THREE.BoxGeometry(0.7, 0.7, 0.7),
          new THREE.MeshLambertMaterial({ color: COLORS.remote }),
        );
        this.players.set(p.wallet, mesh);
        this.scene.add(mesh);
      }
      mesh.position.set(p.x + 0.5, 0.35, -p.y);
    }
    for (const [wallet, mesh] of this.players) {
      if (!seen.has(wallet)) {
        this.scene.remove(mesh);
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
        this.players.delete(wallet);
      }
    }
  }

  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const tMs = performance.now() - this.startMs + this.worldTimeOffsetMs;

    // Smooth local follow + camera.
    this.localMesh.position.lerp(this.localTarget, 0.25);
    const cam = this.localMesh.position;
    this.camera.position.set(cam.x, 14, cam.z + 10);
    this.camera.lookAt(cam.x, 0, cam.z - 3);

    // Hazard visuals from deterministic descriptors.
    for (const [row, lane] of this.lanes) {
      const meshes = this.movers.get(row);
      if (!meshes) continue;
      if (lane.kind === LANE_ROAD || lane.kind === LANE_RIVER) {
        const xs = laneObjects(lane, tMs);
        const submerged = lane.kind === LANE_RIVER && logSubmerged(lane, tMs);
        meshes.forEach((m, i) => {
          const x = xs[i];
          if (x === undefined || x < -4 || x > 68) {
            m.visible = false;
            return;
          }
          m.visible = true;
          m.position.set(x + lane.footprint / 2, submerged ? -0.15 : 0.25, -row);
        });
      } else if (lane.kind === LANE_RAIL) {
        const { phase, trainX } = railPhase(lane, tMs);
        const strip = this.laneMeshes.get(row)?.children[0] as THREE.Mesh | undefined;
        if (strip) {
          (strip.material as THREE.MeshLambertMaterial).color.set(
            phase === "warning" ? COLORS.warning : COLORS.rail,
          );
        }
        const train = meshes[0];
        if (train) {
          train.visible = phase === "train";
          train.position.set(trainX + lane.footprint / 2, 0.35, -row);
        }
      }
    }
    this.renderer.render(this.scene, this.camera);
  };

  destroy() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.scene.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        const m = o.material as THREE.Material | THREE.Material[];
        (Array.isArray(m) ? m : [m]).forEach((x) => x.dispose());
      }
    });
    this.renderer.dispose();
  }
}
