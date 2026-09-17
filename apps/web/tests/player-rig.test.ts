import assert from "node:assert/strict";
import test from "node:test";
import * as THREE from "three";
import { PlayerRig } from "../src/game/renderer/scene";

test("teleport fully restores a rig hidden by a water death", () => {
  const rig = new PlayerRig(
    "agent.test",
    1,
    new THREE.MeshBasicMaterial(),
    new THREE.CircleGeometry(0.34, 12),
  );

  rig.die("water");
  rig.update(100, performance.now() + 100);
  assert.equal(rig.body.visible, false, "water death should hide the body");
  assert.equal(rig.shadow.visible, false, "water death should hide the shadow");

  rig.teleport(new THREE.Vector3(32.5, 0, 0));

  assert.equal(rig.state.name, "idle");
  assert.equal(rig.body.visible, true, "respawn must restore the body");
  assert.equal(rig.shadow.visible, true, "respawn must restore the shadow");
  assert.deepEqual(rig.body.position.toArray(), [0, 0, 0]);
  assert.deepEqual(rig.body.scale.toArray(), [1, 1, 1]);
  assert.deepEqual(rig.shadow.scale.toArray(), [1, 1, 1]);
});
