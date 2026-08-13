/**
 * World-first menu backdrop (Crossy grammar, docs §"world-first menus"):
 * the real game world runs live behind the home UI — traffic drives by,
 * trains pass, the player's agent idles mid-world. No input, no collision;
 * the same WorldScene the game uses, on synthetic lanes.
 */
import { useEffect, useRef } from "react";
import { WorldScene } from "../../game/renderer/scene";
import { preloadAssets } from "../../game/renderer/assets";
import { makeLane, demoSeed } from "../../game/simulation/demoLanes";

export function MenuBackdrop({
  modelId,
  onScene,
}: {
  modelId: string;
  onScene?: (scene: WorldScene | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<WorldScene | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current!;
    let live = true;
    let scene: WorldScene | null = null;
    void preloadAssets().then(() => {
      if (!live) return;
      scene = new WorldScene(canvas, { modelId });
      sceneRef.current = scene;
      scene.resize();
      for (let r = 0; r < 36; r++) scene.setLane(r, makeLane(r, 11), demoSeed(11));
      // Rows 0–2 are always safe grass: the agent poses there.
      scene.setLocal(32, 2);
      onScene?.(scene);
    });
    const onResize = () => sceneRef.current?.resize();
    window.addEventListener("resize", onResize);
    return () => {
      live = false;
      onScene?.(null);
      window.removeEventListener("resize", onResize);
      scene?.destroy();
      scene = null;
      sceneRef.current = null;
    };
    // The scene swaps models via onScene/setLocalModel — never remount here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <canvas ref={canvasRef} className="menu-world" />;
}
