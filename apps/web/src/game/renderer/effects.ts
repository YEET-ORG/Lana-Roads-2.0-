/**
 * Pooled voxel particles + expanding wake rings.
 * One InstancedMesh for cubes, a handful of ring meshes; bursts recycle
 * the oldest slots so hops never allocate.
 */
import * as THREE from "three";

const CAPACITY = 640;
const GRAVITY = -9.8;
const RING_COUNT = 10;

interface Particle {
  life: number;
  ttl: number;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  spin: number;
  size: number;
}

interface Ring {
  life: number;
  ttl: number;
  mesh: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
}

export type Surface = "grass" | "road" | "river" | "rail" | "unknown";

export class BlockDust {
  readonly mesh: THREE.InstancedMesh;
  private particles: Particle[] = [];
  private cursor = 0;
  private dummy = new THREE.Object3D();
  private color = new THREE.Color();
  private rings: Ring[] = [];

  constructor(scene: THREE.Scene) {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshLambertMaterial();
    this.mesh = new THREE.InstancedMesh(geo, mat, CAPACITY);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = CAPACITY;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    for (let i = 0; i < CAPACITY; i++) {
      this.particles.push({
        life: 0,
        ttl: 1,
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        spin: 0,
        size: 0.1,
      });
      this.dummy.scale.setScalar(0.0001);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
      this.mesh.setColorAt(i, this.color.setHex(0xffffff));
    }
    scene.add(this.mesh);

    const ringGeo = new THREE.RingGeometry(0.18, 0.28, 20);
    for (let i = 0; i < RING_COUNT; i++) {
      const ringMat = new THREE.MeshBasicMaterial({
        color: 0xb7e7ff,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(ringGeo, ringMat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.visible = false;
      mesh.renderOrder = 3;
      scene.add(mesh);
      this.rings.push({ life: 0, ttl: 1, mesh });
    }
  }

  burst(
    at: THREE.Vector3,
    opts: {
      count?: number;
      color?: number;
      speed?: number;
      up?: number;
      size?: number;
    } = {},
  ) {
    const { count = 10, color = 0xd8cfc0, speed = 2.2, up = 2.6, size = 0.09 } = opts;
    for (let i = 0; i < count; i++) {
      const p = this.particles[this.cursor];
      const slot = this.cursor;
      this.cursor = (this.cursor + 1) % CAPACITY;
      const a = Math.random() * Math.PI * 2;
      const r = (0.4 + Math.random() * 0.6) * speed;
      p.pos.copy(at);
      p.vel.set(Math.cos(a) * r, up * (0.5 + Math.random() * 0.7), Math.sin(a) * r);
      p.ttl = 0.3 + Math.random() * 0.3;
      p.life = p.ttl;
      p.spin = (Math.random() - 0.5) * 12;
      p.size = size * (0.7 + Math.random() * 0.8);
      this.mesh.setColorAt(slot, this.color.setHex(color));
    }
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  /** Water splash: mostly-vertical droplets in river blue. */
  splash(at: THREE.Vector3, heavy = false) {
    this.burst(at, {
      count: heavy ? 22 : 14,
      color: 0x7ec8ef,
      speed: heavy ? 1.8 : 1.35,
      up: heavy ? 4.2 : 3.2,
      size: heavy ? 0.09 : 0.07,
    });
    this.burst(at, {
      count: heavy ? 10 : 6,
      color: 0xe8f7ff,
      speed: heavy ? 1.1 : 0.8,
      up: heavy ? 2.4 : 1.8,
      size: 0.05,
    });
    this.ring(at, heavy ? 0xd4f0ff : 0xb7e7ff, heavy ? 0.55 : 0.38);
  }

  land(at: THREE.Vector3, surface: Surface) {
    switch (surface) {
      case "river":
        this.splash(at, false);
        break;
      case "road":
        this.burst(at, { count: 5, color: 0x6b7384, speed: 1.1, up: 1.2, size: 0.05 });
        break;
      case "rail":
        this.burst(at, { count: 6, color: 0xffd23f, speed: 1.3, up: 1.5, size: 0.045 });
        this.burst(at, { count: 3, color: 0xfff6c8, speed: 0.7, up: 1.8, size: 0.035 });
        break;
      default:
        this.burst(at, { count: 6, color: 0xe8dfd0, speed: 1.35, up: 1.55, size: 0.065 });
        break;
    }
  }

  ring(at: THREE.Vector3, color: number, scale = 0.4) {
    let best = this.rings[0];
    for (const r of this.rings) {
      if (r.life <= 0) {
        best = r;
        break;
      }
      if (r.life < best.life) best = r;
    }
    best.ttl = 0.38;
    best.life = best.ttl;
    best.mesh.visible = true;
    best.mesh.position.set(at.x, 0.06, at.z);
    best.mesh.scale.setScalar(scale);
    best.mesh.material.color.setHex(color);
    best.mesh.material.opacity = 0.7;
  }

  update(dt: number) {
    let any = false;
    for (let i = 0; i < CAPACITY; i++) {
      const p = this.particles[i];
      if (p.life <= 0) continue;
      any = true;
      p.life -= dt;
      p.vel.y += GRAVITY * dt;
      p.pos.addScaledVector(p.vel, dt);
      if (p.pos.y < 0.02) {
        p.pos.y = 0.02;
        p.vel.y *= -0.3;
        p.vel.x *= 0.7;
        p.vel.z *= 0.7;
      }
      const t = Math.max(0, p.life / p.ttl);
      this.dummy.position.copy(p.pos);
      this.dummy.rotation.set(p.spin * p.life, p.spin * 0.7 * p.life, 0);
      this.dummy.scale.setScalar(p.size * t);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
    }
    if (any) this.mesh.instanceMatrix.needsUpdate = true;

    for (const r of this.rings) {
      if (r.life <= 0) {
        if (r.mesh.visible) r.mesh.visible = false;
        continue;
      }
      r.life -= dt;
      const k = 1 - r.life / r.ttl;
      r.mesh.scale.setScalar(0.35 + k * 1.15);
      r.mesh.material.opacity = (1 - k) * 0.65;
      if (r.life <= 0) r.mesh.visible = false;
    }
  }

  dispose() {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    for (const r of this.rings) {
      r.mesh.geometry.dispose();
      r.mesh.material.dispose();
    }
  }
}
