# Blender 后台建模脚本：程序化构建岩石与沉木道具并导出 GLB
# 用法：blender.exe --background --python build_props.py -- batch
# 产物：public/models/props/rock-a.glb rock-b.glb rock-c.glb driftwood.glb
import bpy
import bmesh
import math
import sys
import os

OUT_DIR = r"D:\PersonalProject\zhiyu\public\models\props"


def reset_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for collection in (bpy.data.meshes, bpy.data.materials, bpy.data.cameras,
                       bpy.data.lights, bpy.data.images):
        for item in list(collection):
            collection.remove(item)


def _hash1(n):
    h = (n * 2654435761) & 0xFFFFFFFF
    h = ((h ^ (h >> 13)) * 1274126177) & 0xFFFFFFFF
    return ((h ^ (h >> 16)) & 0xFFFFFFFF) / 0xFFFFFFFF


def make_material(name, color, metallic=0.0, roughness=0.8):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (color[0], color[1], color[2], 1.0)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    return mat


def build_rock(seed, scale=(1.0, 0.85, 0.7), color=(0.30, 0.30, 0.31), subs=3):
    # 基础 icosphere + 确定性顶点扰动 + 非均匀缩放：块面感自然的石头
    # 扰动幅度收敛 + 细分加一级：块面圆润一些，避免读成冰块/水晶
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=subs, radius=1.0)
    obj = bpy.context.active_object
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    for i, v in enumerate(bm.verts):
        n1 = _hash1(seed * 1000 + i)
        n2 = _hash1(seed * 2000 + i)
        v.co.x += (n1 - 0.5) * 0.16
        v.co.y += (n2 - 0.5) * 0.16
        v.co.z += (_hash1(seed * 3000 + i) - 0.5) * 0.12
    # 底部压平：能稳定坐在砂面上
    for v in bm.verts:
        if v.co.z < -0.5:
            v.co.z = -0.5
    bm.to_mesh(obj.data)
    bm.free()
    obj.scale = scale
    mat = make_material("rock_mat_%d" % seed, color, roughness=0.95)
    obj.data.materials.append(mat)
    return obj


def build_driftwood():
    # 沉木：一截主干（弯）+ 两个分支，用多段圆柱拼出自然弯折
    group = []
    mat = make_material(
        "driftwood_mat", (0.16, 0.11, 0.075), roughness=0.92)
    # 主干：三段，逐段偏转
    segs = [
        ((0.0, 0.0, 0.0), 0.0, 0.55),
        ((0.0, 0.18, 0.42), -18, 0.48),
        ((-0.06, 0.36, 0.78), -34, 0.34),
    ]
    prev_top = None
    for i, (pos, tilt, r) in enumerate(segs):
        depth = 1.15 if i == 0 else 1.0
        bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=depth, vertices=14)
        seg = bpy.context.active_object
        seg.location = pos
        seg.rotation_euler = (math.radians(tilt), math.radians(-12), 0)
        seg.scale = (1.0, 1.0, 1.0)
        seg.data.materials.append(mat)
        # 微锥形：用编辑模式把顶端缩小，做出枝干收分
        bm = bmesh.new()
        bm.from_mesh(seg.data)
        top_z = max(v.co.z for v in bm.verts)
        for v in bm.verts:
            if v.co.z > top_z - 0.01:
                v.co.x *= 0.7
                v.co.y *= 0.7
        bm.to_mesh(seg.data)
        bm.free()
        group.append(seg)
        prev_top = seg
    # 分支
    for i, (bx, by, bz, r, d, rx, ry) in enumerate([
        (0.1, 0.05, 0.55, 0.12, 0.7, 55, 30),
        (-0.15, 0.3, 0.9, 0.09, 0.5, -50, -40),
    ]):
        bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=d, vertices=12)
        branch = bpy.context.active_object
        branch.location = (bx, by, bz)
        branch.rotation_euler = (math.radians(rx), math.radians(ry), 0)
        branch.data.materials.append(mat)
        group.append(branch)
    # 细根须：底部几根小锥，让底座不悬空
    for i in range(3):
        bpy.ops.mesh.primitive_cone_add(radius1=0.07, radius2=0.01, depth=0.5, vertices=8)
        root = bpy.context.active_object
        a = math.radians(120 * i)
        root.location = (0.22 * math.cos(a), 0.22 * math.sin(a), 0.05)
        root.rotation_euler = (math.radians(60 * math.cos(a)), math.radians(60 * math.sin(a)), 0)
        root.data.materials.append(mat)
        group.append(root)
    return group


def export_selected(objs, name):
    root = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(root)
    for o in objs:
        o.parent = root
    out = os.path.join(OUT_DIR, name + ".glb")
    os.makedirs(OUT_DIR, exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", export_apply=True)
    return out


def main():
    print("=== build_props 开始 ===")
    reset_scene()
    build_rock(7, scale=(1.0, 0.85, 0.7), color=(0.30, 0.30, 0.31))
    p = export_selected([o for o in bpy.data.objects if o.type == "MESH"], "rock-a")
    print("rock-a ->", p)

    reset_scene()
    build_rock(13, scale=(0.8, 1.0, 0.62), color=(0.24, 0.24, 0.26))
    p = export_selected([o for o in bpy.data.objects if o.type == "MESH"], "rock-b")
    print("rock-b ->", p)

    reset_scene()
    build_rock(21, scale=(1.35, 1.0, 0.55), color=(0.33, 0.33, 0.32))
    p = export_selected([o for o in bpy.data.objects if o.type == "MESH"], "rock-c")
    print("rock-c ->", p)

    reset_scene()
    group = build_driftwood()
    p = export_selected(group + [o for o in bpy.data.objects if o.type == "MESH" and o not in group], "driftwood")
    print("driftwood ->", p)
    print("=== build_props 结束 ===")


argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
if argv and argv[0] == "batch":
    main()
else:
    main()
