/**
 * Pooled block-dust particles (Voxel Arcade motif: squares, not sprites).
 * One InstancedMesh, fixed capacity, zero allocation per burst — bursts
 * recycle the oldest slots. Colors set per-instance.
 */
import * as THREE from "three";

const CAPACITY = 256;
const GRAVITY = -9.8;

interface Particle {
  life: number; // seconds remaining
  ttl: number;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  spin: number;
  size: number;
}

export class BlockDust {
  readonly mesh: THREE.InstancedMesh;
  private particles: Particle[] = [];
  private cursor = 0;
  private dummy = new THREE.Object3D();
  private color = new THREE.Color();

  constructor(scene: THREE.Scene) {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshLambertMaterial();
    this.mesh = new THREE.InstancedMesh(geo, mat, CAPACITY);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = CAPACITY;
    this.mesh.frustumCulled = false;
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
  }

  /**
   * Emit a radial burst. 300–600 ms lives, fade-by-shrink (opacity is per
   * material, not per instance — shrinking sells the same read).
   */
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
  splash(at: THREE.Vector3) {
    this.burst(at, { count: 16, color: 0x7db9ef, speed: 1.4, up: 3.4, size: 0.08 });
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
  }

  dispose() {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
