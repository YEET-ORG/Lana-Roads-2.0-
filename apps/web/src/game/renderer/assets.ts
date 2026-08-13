/**
 * Runtime asset registry: loads the converted GLB derivatives listed in
 * public/assets/manifest.json (produced by scripts/convert_assets.py).
 *
 * Gameplay authority NEVER comes from these meshes — footprints, collision
 * and timing stay with the canonical lane data. A missing model yields a
 * footprint-correct fallback box, never a hidden hazard (ASSETS.md rule).
 */
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

export interface AssetRecord {
  id: string;
  kind: "vehicle" | "agent" | "prop";
  outputFile: string;
}

const loader = new GLTFLoader();
const templates = new Map<string, THREE.Group>();
let records: AssetRecord[] = [];
let ready: Promise<void> | null = null;

/** One coherent vehicle set (Devil's Work.shop). Order matters: index = variant id. */
export const VEHICLE_POOL = [
  "vehicle.compact.a",
  "vehicle.compact.b",
  "vehicle.compact.c",
  "vehicle.pickup.a",
  "vehicle.police.a",
];
/** Long-footprint lanes read better with long vehicles. */
export const LONG_VEHICLE_POOL = ["vehicle.bus.a"];
export const ROCK_POOL = ["prop.rock.a", "prop.rock.b", "prop.rock.c"];
export const AGENT_COUNT = 40;
/** Source models that face +z instead of -z (audited via ?agents=1 grid
 * and in-game reports). */
const AGENT_YAW_FIX = new Set([5, 6, 7, 27, 28, 29, 33, 37]);
/** Per-model size boosts for animals that read too small after box-fit
 * normalization (small bodies under tall ears/crests). Audited visually. */
const AGENT_SCALE_FIX: Record<number, number> = {
  5: 1.3,
  9: 1.15,
  13: 1.15,
  14: 1.15,
  15: 1.2,
  27: 1.25,
  34: 1.15,
  36: 1.3,
};
export const agentId = (n: number) =>
  `agent.voxel.${String(((n % AGENT_COUNT) + AGENT_COUNT) % AGENT_COUNT).padStart(2, "0")}`;

async function loadTemplate(rec: AssetRecord): Promise<void> {
  try {
    const gltf = await loader.loadAsync(`/${rec.outputFile}`);
    const inner = gltf.scene;
    inner.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        const m = o.material as THREE.MeshStandardMaterial;
        // Voxel-arcade look: flat-ish shading, no PBR shine.
        if (m && "roughness" in m) {
          m.roughness = 1;
          m.metalness = 0;
        }
        o.castShadow = false;
        o.receiveShadow = false;
      }
    });
    const template = normalizeTemplate(inner, rec.kind);
    if (rec.kind === "agent") {
      const idx = Number(rec.id.slice(-2));
      if (AGENT_YAW_FIX.has(idx)) inner.rotation.y += Math.PI;
      const boost = AGENT_SCALE_FIX[idx];
      if (boost) inner.scale.multiplyScalar(boost);
    }
    templates.set(rec.id, template);
  } catch (e) {
    console.warn(`asset ${rec.id} failed to load; using fallback`, e);
  }
}

/**
 * Measured normalization (source packs disagree on axes and units, and the
 * offline converter can't always tell a model's front): vehicles get their
 * long horizontal axis rotated onto X and unit length; agents and props get
 * unit height. Everything is centered with ground contact at y = 0. The
 * cross-section ratios are stashed for lane-fit clamping at spawn time.
 */
function normalizeTemplate(inner: THREE.Group, kind: string): THREE.Group {
  const wrapper = new THREE.Group();
  wrapper.add(inner);
  let box = new THREE.Box3().setFromObject(inner);
  let size = box.getSize(new THREE.Vector3());
  if (kind === "vehicle" && size.z > size.x) {
    inner.rotation.y = Math.PI / 2;
    box = new THREE.Box3().setFromObject(inner);
    size = box.getSize(new THREE.Vector3());
  }
  let s: number;
  if (kind === "vehicle") {
    s = size.x > 1e-6 ? 1 / size.x : 1;
  } else if (kind === "agent") {
    // Box-fit: every animal fits ONE TILE regardless of body shape.
    // Long/flat bodies (whale, croc) shrink to the tile; tall thin ones
    // normalize by height. Caps: 0.95 wide/deep, 1.15 tall.
    s = Math.min(
      0.95 / Math.max(1e-6, size.x),
      0.95 / Math.max(1e-6, size.z),
      1.15 / Math.max(1e-6, size.y),
    );
  } else {
    s = size.y > 1e-6 ? 1 / size.y : 1;
  }
  inner.scale.multiplyScalar(s);
  box = new THREE.Box3().setFromObject(inner);
  size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  inner.position.x -= center.x;
  inner.position.z -= center.z;
  inner.position.y -= box.min.y;
  wrapper.userData = { widthRatio: size.z, heightRatio: size.y };
  return wrapper;
}

/** Kick off loading. Resolves when the manifest + all models are settled. */
export function preloadAssets(): Promise<void> {
  if (ready) return ready;
  ready = (async () => {
    const res = await fetch("/assets/manifest.json");
    if (!res.ok) throw new Error(`manifest: HTTP ${res.status}`);
    const manifest = (await res.json()) as { assets: AssetRecord[] };
    records = manifest.assets;
    await Promise.all(records.map(loadTemplate));
  })().catch((e) => {
    console.warn("asset preload failed; fallback primitives everywhere", e);
  });
  return ready;
}

const FALLBACK_COLORS: Record<string, number> = {
  vehicle: 0xf45169,
  agent: 0xfffdf5,
  prop: 0x169b60,
};

/**
 * Instantiate a model by id. `null` id or missing template returns a
 * footprint-correct fallback box so hazards are never invisible.
 */
export function instantiate(id: string): THREE.Object3D {
  const template = templates.get(id);
  if (template) {
    // Static low-poly models: clone shares geometry + material (cheap).
    return template.clone(true);
  }
  const kind = id.startsWith("vehicle")
    ? "vehicle"
    : id.startsWith("agent")
      ? "agent"
      : "prop";
  const box = new THREE.Mesh(
    new THREE.BoxGeometry(
      1,
      kind === "vehicle" ? 0.5 : 0.8,
      kind === "vehicle" ? 0.8 : 0.8,
    ),
    new THREE.MeshLambertMaterial({ color: FALLBACK_COLORS[kind] }),
  );
  box.position.y = kind === "vehicle" ? 0.25 : 0.4;
  const g = new THREE.Group();
  g.add(box);
  return g;
}

export function hasTemplate(id: string): boolean {
  return templates.has(id);
}

/**
 * Deterministic variant pick: every client must resolve the same model for
 * the same lane (canonical visual variant, never per-client random).
 */
export function pickDeterministic<T>(pool: T[], seedA: number, seedB: number): T {
  let h = 2166136261 >>> 0;
  h = Math.imul(h ^ seedA, 16777619) >>> 0;
  h = Math.imul(h ^ seedB, 16777619) >>> 0;
  return pool[h % pool.length];
}
