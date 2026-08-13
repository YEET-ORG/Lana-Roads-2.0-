/**
 * Dev-only agent gallery (?agents=1): all 40 voxel animals in a numbered
 * grid, rotated to face the camera. Used to audit per-model orientation —
 * the source pack is not uniformly oriented, and AGENT_YAW_FIX in
 * assets.ts is maintained by eyeballing this grid.
 */
import { useEffect, useRef } from "react";
import * as THREE from "three";
import {
  AGENT_COUNT,
  agentId,
  instantiate,
  preloadAssets,
} from "../../game/renderer/assets";

export function AgentGallery() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current!;
    let disposed = false;
    let renderer: THREE.WebGLRenderer | null = null;
    void preloadAssets().then(() => {
      if (disposed) return;
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
      renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0x18243a);
      scene.add(new THREE.AmbientLight(0xffffff, 1.4));
      const sun = new THREE.DirectionalLight(0xffffff, 1.4);
      sun.position.set(4, 10, 8);
      scene.add(sun);

      const COLS = 8;
      const ROWS = Math.ceil(AGENT_COUNT / COLS);
      const SX = 2.2;
      const SZ = 3.0;
      const numberPlate = (n: number) => {
        const c = document.createElement("canvas");
        c.width = 128;
        c.height = 64;
        const g = c.getContext("2d")!;
        g.fillStyle = "#08111F";
        g.fillRect(0, 0, 128, 64);
        g.fillStyle = "#FFD23F";
        g.font = "bold 44px monospace";
        g.textAlign = "center";
        g.textBaseline = "middle";
        g.fillText(String(n).padStart(2, "0"), 64, 34);
        const tex = new THREE.CanvasTexture(c);
        const plate = new THREE.Mesh(
          new THREE.PlaneGeometry(1.1, 0.55),
          new THREE.MeshBasicMaterial({ map: tex }),
        );
        return plate;
      };
      for (let i = 0; i < AGENT_COUNT; i++) {
        const m = instantiate(agentId(i));
        const col = i % COLS;
        const row = Math.floor(i / COLS);
        m.position.set(col * SX, 0, row * SZ);
        // Default: yaw PI shows faces (for natively -z models). ?yaw=0
        // renders the in-game forward pose — faces visible there = reversed.
        m.rotation.y =
          new URLSearchParams(window.location.search).get("yaw") === "0" ? 0 : Math.PI;
        scene.add(m);
        const plate = numberPlate(i);
        plate.position.set(col * SX, 0.28, row * SZ + 1.15);
        plate.rotation.x = -0.6;
        scene.add(plate);
      }

      const w = canvas.clientWidth || 1200;
      const h = canvas.clientHeight || 900;
      renderer.setSize(w, h, false);
      const aspect = w / h;
      const vh = ROWS * SZ * 1.12;
      const cam = new THREE.OrthographicCamera(
        (-vh * aspect) / 2,
        (vh * aspect) / 2,
        vh / 2,
        -vh / 2,
        -50,
        160,
      );
      const cx = ((COLS - 1) * SX) / 2;
      const cz = ((ROWS - 1) * SZ) / 2;
      cam.position.set(cx, 15, cz + 15);
      cam.lookAt(cx, 0, cz);
      renderer.render(scene, cam);
    });
    return () => {
      disposed = true;
      renderer?.dispose();
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{ position: "fixed", inset: 0, width: "100%", height: "100%" }}
    />
  );
}
