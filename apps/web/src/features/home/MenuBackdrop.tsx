/**
 * World-first menu backdrop (Crossy grammar, docs §"world-first menus"):
 * the real game world runs live behind the home UI — traffic drives by,
 * trains pass, the player's agent idles on a grass pocket in the foreground.
 */
import { useEffect, useRef } from "react";
import { WorldScene } from "../../game/renderer/scene";
import { preloadAssets } from "../../game/renderer/assets";
import { demoSeed, makeGrassLane, makeLane } from "../../game/simulation/demoLanes";

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
      scene.setPresentation("menu");
      scene.resize();
      for (let r = 0; r < 36; r++) {
        scene.setLane(r, r < 5 ? makeGrassLane() : makeLane(r, 11), demoSeed(11));
      }
      scene.setLocal(32, 1);
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
