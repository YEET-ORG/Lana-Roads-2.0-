import { useEffect, useRef } from "react";
import * as THREE from "three";
import { agentId, instantiate, preloadAssets } from "../../game/renderer/assets";

/**
 * Small, isolated Three.js stage used by the pack reveal. It deliberately
 * reuses the exact gameplay GLB so the prize shown here is the agent players
 * will see in the world, not a disconnected illustration.
 */
export function AgentPackPreview({ modelId }: { modelId: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let disposed = false;
    let frame = 0;
    let observer: ResizeObserver | null = null;
    let renderer: THREE.WebGLRenderer | null = null;

    void preloadAssets().then(() => {
      if (disposed) return;

      renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
      renderer.outputColorSpace = THREE.SRGBColorSpace;

      const scene = new THREE.Scene();
      scene.add(new THREE.HemisphereLight(0xffffff, 0x223252, 2.1));
      const key = new THREE.DirectionalLight(0xffffff, 2.4);
      key.position.set(-3, 6, 5);
      scene.add(key);
      const rim = new THREE.DirectionalLight(0x57cff2, 1.7);
      rim.position.set(4, 2, -4);
      scene.add(rim);

      const model = instantiate(agentId(modelId));
      model.scale.multiplyScalar(1.55);
      model.rotation.y = Math.PI;
      scene.add(model);

      const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 30);
      camera.position.set(2.8, 2.15, 4.4);
      camera.lookAt(0, 0.72, 0);

      const resize = () => {
        if (!renderer) return;
        const width = Math.max(1, canvas.clientWidth);
        const height = Math.max(1, canvas.clientHeight);
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
      };
      observer = new ResizeObserver(resize);
      observer.observe(canvas);
      resize();

      const started = performance.now();
      const draw = (now: number) => {
        if (disposed || !renderer) return;
        const t = (now - started) / 1000;
        model.rotation.y = Math.PI + Math.sin(t * 0.8) * 0.28;
        model.position.y = Math.max(0, Math.sin(t * 2.4) * 0.035);
        renderer.render(scene, camera);
        frame = requestAnimationFrame(draw);
      };
      frame = requestAnimationFrame(draw);
    });

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer?.disconnect();
      renderer?.dispose();
    };
  }, [modelId]);

  return (
    <canvas
      ref={canvasRef}
      className="pack-agent-preview"
      role="img"
      aria-label="3D preview of the revealed agent"
    />
  );
}
