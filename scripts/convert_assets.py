# Headless Blender conversion: SourceAssets -> normalized runtime GLBs.
#
# Implements docs/ASSETS.md section 8: one preferred source format per asset,
# strip editor-only objects, apply transforms, normalize scale + pivot +
# ground contact, export optimized GLB, record a manifest entry with hash.
# Only APPROVED-SOURCE packs are listed here; HOLD / REFERENCE-ONLY packs
# (Free_Cars, pack_cartoon_cars, SportsCar_Yellow, Voxel_Animal_Asset_Pack,
# both Crossy Road rips, crossy_road_train.glb) are intentionally absent.
#
# Run:  blender --background --python scripts/convert_assets.py -- <repo_root>
import bpy
import hashlib
import json
import math
import os
import sys

argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
ROOT = argv[0] if argv else os.getcwd()
SRC = os.path.join(ROOT, "SourceAssets")
VOXEL = os.path.join(ROOT, "VoxelAnimals")
OUT = os.path.join(ROOT, "apps", "web", "public", "assets", "models")
MANIFEST_PATH = os.path.join(ROOT, "apps", "web", "public", "assets", "manifest.json")
os.makedirs(OUT, exist_ok=True)

DWS = os.path.join(SRC, "Low_Poly_Cars_DevilsWorkShop_V03", "Low_Poly_Cars_DevilsWorkShop_V03")
RGS_DIR = os.path.join(SRC, "Free_Low_Poly_Vehicles_Rgsdev", "Free Low Poly Vehicles Pack by Rgsdev")
FOREST = os.path.join(SRC, "KayKit_Forest_Nature_Pack_1.0_FREE", "KayKit_Forest_Nature_Pack_1.0_FREE")


def find_file(base, name):
    for dirpath, _dirs, files in os.walk(base):
        for f in files:
            if f.lower() == name.lower():
                return os.path.join(dirpath, f)
    raise FileNotFoundError(f"{name} under {base}")


# (id, kind, format, source path, texture path or None)
JOBS = []

# Devil's Work.shop — commercial license on file. Curated roster from FRONTEND.md 10.5.
for asset_id, fname, tex in [
    ("vehicle.compact.a", "Low_Poly_Vehicles_car01.fbx", "car01.png"),
    ("vehicle.compact.b", "Low_Poly_Vehicles_car02.fbx", "car02.png"),
    ("vehicle.compact.c", "Low_Poly_Vehicles_car03.fbx", "car03.png"),
    ("vehicle.police.a", "Low_Poly_Vehicles_carPolice.fbx", "carPolice.png"),
    ("vehicle.pickup.a", "Low_Poly_Vehicles_pickupTruck01.fbx", "pickupTruck01.png"),
    ("vehicle.bus.a", "Low_Poly_Vehicles_bus.fbx", "bus01.png"),
]:
    JOBS.append(
        (
            asset_id,
            "vehicle",
            "fbx",
            os.path.join(DWS, "FBX 2013", fname),
            os.path.join(DWS, "Texture", tex),
            "Low_Poly_Cars_DevilsWorkShop_V03",
        )
    )

# Rgsdev vehicles intentionally omitted: one coherent vehicle set
# (Devil's Work.shop) reads better than mixed art styles per lane.

# VoxelAnimals — purchased Unity pack (receipt held privately). All 40 agents.
for i in range(40):
    JOBS.append(
        (
            f"agent.voxel.{i:02d}",
            "agent",
            "obj",
            os.path.join(VOXEL, f"animal-{i}.obj"),
            None,
            "VoxelAnimals",
        )
    )

# KayKit Forest Nature — CC0. Rocks only: trees are procedural voxel builds.
for asset_id, fname in [
    ("prop.rock.a", "Rock_1_A_Color1.gltf"),
    ("prop.rock.b", "Rock_2_A_Color1.gltf"),
    ("prop.rock.c", "Rock_3_A_Color1.gltf"),
]:
    JOBS.append((asset_id, "prop", "gltf", find_file(FOREST, fname), None, "KayKit_Forest_Nature_Pack_1.0_FREE"))


def clean_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_model(fmt, path):
    if fmt == "fbx":
        bpy.ops.import_scene.fbx(filepath=path)
    elif fmt == "obj":
        if hasattr(bpy.ops.wm, "obj_import"):
            bpy.ops.wm.obj_import(filepath=path)
        else:
            bpy.ops.import_scene.obj(filepath=path)
    elif fmt == "gltf":
        bpy.ops.import_scene.gltf(filepath=path)


def meshes():
    return [o for o in bpy.context.scene.objects if o.type == "MESH"]


def strip_non_mesh():
    for o in list(bpy.context.scene.objects):
        if o.type != "MESH":
            bpy.data.objects.remove(o, do_unlink=True)


def join_all():
    ms = meshes()
    if len(ms) <= 1:
        return ms[0] if ms else None
    bpy.ops.object.select_all(action="DESELECT")
    for m in ms:
        m.select_set(True)
    bpy.context.view_layer.objects.active = ms[0]
    bpy.ops.object.join()
    return bpy.context.view_layer.objects.active


def world_bounds(obj):
    coords = [obj.matrix_world @ v.co for v in obj.data.vertices]
    xs = [c.x for c in coords]
    ys = [c.y for c in coords]
    zs = [c.z for c in coords]
    return (min(xs), max(xs)), (min(ys), max(ys)), (min(zs), max(zs))


def apply_all(obj):
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)


def assign_texture(obj, tex_path):
    img = bpy.data.images.load(tex_path)
    mat = bpy.data.materials.new(name="body")
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = 0.9
    node = mat.node_tree.nodes.new("ShaderNodeTexImage")
    node.image = img
    mat.node_tree.links.new(bsdf.inputs["Base Color"], node.outputs["Color"])
    obj.data.materials.clear()
    obj.data.materials.append(mat)


def normalize(obj, kind):
    apply_all(obj)
    (x0, x1), (y0, y1), (z0, z1) = world_bounds(obj)
    dx, dz = x1 - x0, z1 - z0
    # Vehicles travel along world X in-game: lay the long axis on X.
    # (Blender is Z-up here; glTF export converts to Y-up.)
    if kind == "vehicle" and dz > dx:
        obj.rotation_euler[2] = math.radians(90)
        apply_all(obj)
        (x0, x1), (y0, y1), (z0, z1) = world_bounds(obj)
        dx, dz = x1 - x0, z1 - z0
    dy = z1 - z0 if False else 0  # placeholder, recomputed below
    height = (y1 - y0) if False else 0
    # Uniform scale: vehicles to unit length on X, agents/props to unit height (Z in Blender).
    size = dx if kind == "vehicle" else (z1 - z0)
    if size <= 0:
        size = 1.0
    s = 1.0 / size
    obj.scale = (s, s, s)
    apply_all(obj)
    (x0, x1), (y0, y1), (z0, z1) = world_bounds(obj)
    # Pivot: centered on X/Y (Blender ground plane), resting on Z=0.
    obj.location.x -= (x0 + x1) / 2
    obj.location.y -= (y0 + y1) / 2
    obj.location.z -= z0
    apply_all(obj)


def export_glb(path):
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        export_yup=True,
        export_apply=True,
        export_animations=False,
        export_skins=False,
        export_morph=False,
    )


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


manifest = []
failures = []
for asset_id, kind, fmt, src_path, tex_path, pack in JOBS:
    out_path = os.path.join(OUT, asset_id + ".glb")
    try:
        clean_scene()
        import_model(fmt, src_path)
        strip_non_mesh()
        obj = join_all()
        if obj is None:
            raise RuntimeError("no mesh after import")
        if tex_path:
            assign_texture(obj, tex_path)
        normalize(obj, kind)
        tris = sum(len(p.vertices) - 2 for p in obj.data.polygons)
        export_glb(out_path)
        manifest.append(
            {
                "id": asset_id,
                "kind": kind,
                "sourcePack": pack,
                "sourceFile": os.path.relpath(src_path, ROOT).replace("\\", "/"),
                "outputFile": f"assets/models/{asset_id}.glb",
                "outputSha256": sha256(out_path),
                "triangles": tris,
                "bytes": os.path.getsize(out_path),
                "licenseStatus": "APPROVED-SOURCE",
                "preloadGroup": "gameplay-near" if kind != "prop" else "boot",
            }
        )
        print(f"[ok] {asset_id}  tris={tris}  bytes={os.path.getsize(out_path)}")
    except Exception as e:  # noqa: BLE001 — keep converting the rest
        failures.append({"id": asset_id, "error": str(e)})
        print(f"[FAIL] {asset_id}: {e}")

with open(MANIFEST_PATH, "w", encoding="utf-8") as f:
    json.dump({"assets": manifest, "failures": failures}, f, indent=2)
print(f"wrote {MANIFEST_PATH}: {len(manifest)} ok, {len(failures)} failed")
