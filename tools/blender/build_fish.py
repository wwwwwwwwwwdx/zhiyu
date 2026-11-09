# Blender 后台建模脚本：程序化构建符合 gltf-asset-spec 的鱼并导出 GLB
# 用法（-- 之后为参数）：
#   单条：blender.exe --background --python build_fish.py -- <fish_id> <output.glb>
#   批量：blender.exe --background --python build_fish.py -- batch
#
# 设计：用自定义网格（from_pydata）构建纺锤形鱼体与扁平鳍片，避免简单椭球/圆锥的拼接感。
# 各鱼种参数集中在 FISH_PARAMS，体现体型、尾鳍形状与真实配色差异。
import bpy
import math
import sys
import os

OUT_DIR = r"D:\PersonalProject\zhiyu\public\models\fish"

# 每种鱼的参数：身体截面、尾鳍、背鳍、臀鳍、配色
FISH_PARAMS = {
    "guppy": {
        "body": [
            (0.22, 0.012, 0.010), (0.18, 0.055, 0.042), (0.12, 0.095, 0.068),
            (0.05, 0.115, 0.078), (-0.03, 0.105, 0.072), (-0.10, 0.072, 0.050),
            (-0.16, 0.042, 0.028), (-0.20, 0.022, 0.016),
        ],
        "tail": [(-0.20, 0.030), (-0.26, 0.085), (-0.32, 0.135), (-0.36, 0.160)],
        "dorsal": [(0.08, 0.100, 0.115), (0.00, 0.115, 0.165), (-0.08, 0.090, 0.140), (-0.15, 0.045, 0.075)],
        "anal": [(-0.02, -0.100, -0.120), (-0.09, -0.075, -0.125), (-0.15, -0.040, -0.070)],
        "colors": {"body": (0.30, 0.52, 0.58), "tail": (0.92, 0.38, 0.22), "fin": (0.95, 0.62, 0.28)},
    },
    "neon": {
        "body": [
            (0.20, 0.010, 0.008), (0.16, 0.045, 0.032), (0.10, 0.075, 0.050),
            (0.04, 0.088, 0.058), (-0.03, 0.080, 0.052), (-0.09, 0.055, 0.036),
            (-0.14, 0.032, 0.020), (-0.18, 0.016, 0.012),
        ],
        "tail": [(-0.18, 0.020), (-0.23, 0.040), (-0.27, 0.055)],
        "dorsal": [(0.05, 0.085, 0.100), (-0.02, 0.080, 0.110), (-0.09, 0.050, 0.070)],
        "anal": [(-0.02, -0.075, -0.095), (-0.08, -0.055, -0.085), (-0.13, -0.030, -0.050)],
        "colors": {"body": (0.40, 0.60, 0.70), "tail": (0.85, 0.30, 0.25), "fin": (0.60, 0.75, 0.82)},
    },
    "cardinal": {
        "body": [
            (0.20, 0.010, 0.008), (0.16, 0.046, 0.033), (0.10, 0.078, 0.052),
            (0.04, 0.090, 0.060), (-0.03, 0.082, 0.054), (-0.09, 0.056, 0.037),
            (-0.14, 0.033, 0.021), (-0.18, 0.017, 0.012),
        ],
        "tail": [(-0.18, 0.020), (-0.23, 0.040), (-0.27, 0.055)],
        "dorsal": [(0.05, 0.087, 0.102), (-0.02, 0.082, 0.112), (-0.09, 0.051, 0.072)],
        "anal": [(-0.02, -0.077, -0.097), (-0.08, -0.056, -0.087), (-0.13, -0.031, -0.051)],
        "colors": {"body": (0.32, 0.55, 0.70), "tail": (0.80, 0.22, 0.20), "fin": (0.55, 0.72, 0.82)},
    },
    "zebra": {
        "body": [
            (0.21, 0.011, 0.009), (0.17, 0.050, 0.038), (0.11, 0.085, 0.060),
            (0.05, 0.100, 0.070), (-0.03, 0.092, 0.064), (-0.10, 0.062, 0.042),
            (-0.15, 0.035, 0.024), (-0.19, 0.018, 0.013),
        ],
        "tail": [(-0.19, 0.025), (-0.24, 0.045), (-0.28, 0.060)],
        "dorsal": [(0.06, 0.095, 0.115), (0.00, 0.100, 0.130), (-0.07, 0.065, 0.090), (-0.13, 0.035, 0.055)],
        "anal": [(-0.03, -0.088, -0.105), (-0.09, -0.060, -0.090), (-0.14, -0.032, -0.052)],
        "colors": {"body": (0.42, 0.58, 0.68), "tail": (0.70, 0.78, 0.82), "fin": (0.65, 0.75, 0.80)},
    },
    "mickey": {
        "body": [
            (0.21, 0.011, 0.009), (0.17, 0.050, 0.038), (0.11, 0.088, 0.062),
            (0.05, 0.105, 0.072), (-0.03, 0.096, 0.066), (-0.10, 0.066, 0.046),
            (-0.15, 0.038, 0.026), (-0.19, 0.020, 0.014),
        ],
        "tail": [(-0.19, 0.028), (-0.24, 0.050), (-0.28, 0.065)],
        "dorsal": [(0.06, 0.100, 0.118), (0.00, 0.105, 0.135), (-0.08, 0.062, 0.088)],
        "anal": [(-0.02, -0.092, -0.110), (-0.09, -0.060, -0.092), (-0.14, -0.032, -0.054)],
        "colors": {"body": (0.62, 0.65, 0.55), "tail": (0.85, 0.65, 0.35), "fin": (0.80, 0.72, 0.45)},
    },
    "molly": {
        "body": [
            (0.22, 0.013, 0.011), (0.18, 0.058, 0.046), (0.12, 0.100, 0.075),
            (0.05, 0.120, 0.085), (-0.03, 0.110, 0.078), (-0.10, 0.078, 0.055),
            (-0.16, 0.046, 0.032), (-0.20, 0.024, 0.018),
        ],
        "tail": [(-0.20, 0.030), (-0.25, 0.055), (-0.29, 0.070)],
        "dorsal": [(0.08, 0.115, 0.165), (0.01, 0.120, 0.185), (-0.07, 0.080, 0.130), (-0.14, 0.040, 0.070)],
        "anal": [(-0.02, -0.105, -0.125), (-0.09, -0.072, -0.105), (-0.15, -0.038, -0.062)],
        "colors": {"body": (0.16, 0.18, 0.20), "tail": (0.18, 0.20, 0.23), "fin": (0.20, 0.22, 0.25)},
    },
    "angelfish": {
        "body": [
            (0.18, 0.012, 0.008), (0.14, 0.070, 0.030), (0.08, 0.130, 0.045),
            (0.02, 0.160, 0.050), (-0.04, 0.145, 0.045), (-0.10, 0.100, 0.032),
            (-0.15, 0.050, 0.020), (-0.18, 0.020, 0.010),
        ],
        "tail": [(-0.18, 0.025), (-0.23, 0.045), (-0.27, 0.055)],
        "dorsal": [(0.08, 0.140, 0.200), (0.02, 0.160, 0.240), (-0.06, 0.130, 0.220), (-0.13, 0.070, 0.150), (-0.17, 0.030, 0.080)],
        "anal": [(0.04, -0.130, -0.180), (-0.03, -0.140, -0.210), (-0.10, -0.095, -0.170), (-0.15, -0.045, -0.090)],
        "colors": {"body": (0.65, 0.70, 0.72), "tail": (0.70, 0.75, 0.78), "fin": (0.68, 0.73, 0.76)},
    },
    "tiger-barb": {
        "body": [
            (0.19, 0.011, 0.009), (0.15, 0.060, 0.038), (0.09, 0.105, 0.058),
            (0.03, 0.125, 0.066), (-0.04, 0.112, 0.060), (-0.10, 0.075, 0.042),
            (-0.15, 0.040, 0.024), (-0.18, 0.018, 0.012),
        ],
        "tail": [(-0.18, 0.022), (-0.23, 0.042), (-0.27, 0.055)],
        "dorsal": [(0.06, 0.120, 0.155), (0.00, 0.125, 0.165), (-0.07, 0.078, 0.108), (-0.13, 0.038, 0.060)],
        "anal": [(-0.02, -0.108, -0.130), (-0.09, -0.072, -0.105), (-0.14, -0.036, -0.058)],
        "colors": {"body": (0.78, 0.58, 0.32), "tail": (0.82, 0.45, 0.28), "fin": (0.80, 0.50, 0.30)},
    },
    "goldfish": {
        # 金鱼：短圆身体、橙红、扇形尾
        "body": [
            (0.20, 0.014, 0.012), (0.16, 0.065, 0.052), (0.10, 0.115, 0.088),
            (0.03, 0.135, 0.098), (-0.04, 0.120, 0.088), (-0.10, 0.085, 0.062),
            (-0.15, 0.050, 0.036), (-0.18, 0.025, 0.018),
        ],
        "tail": [(-0.18, 0.035), (-0.24, 0.090), (-0.30, 0.140), (-0.34, 0.155)],
        "dorsal": [(0.06, 0.125, 0.155), (0.00, 0.130, 0.180), (-0.07, 0.085, 0.120), (-0.13, 0.040, 0.065)],
        "anal": [(-0.03, -0.115, -0.135), (-0.09, -0.075, -0.110), (-0.14, -0.038, -0.060)],
        "colors": {"body": (0.92, 0.42, 0.18), "tail": (0.95, 0.55, 0.25), "fin": (0.93, 0.48, 0.20)},
    },
    "betta": {
        # 斗鱼：细长身体、长飘带尾、蓝红
        "body": [
            (0.22, 0.009, 0.007), (0.17, 0.040, 0.028), (0.11, 0.070, 0.045),
            (0.04, 0.085, 0.052), (-0.03, 0.078, 0.048), (-0.09, 0.052, 0.032),
            (-0.14, 0.028, 0.018), (-0.17, 0.012, 0.008),
        ],
        "tail": [(-0.17, 0.020), (-0.26, 0.080), (-0.34, 0.160), (-0.40, 0.220), (-0.44, 0.200)],
        "dorsal": [(0.06, 0.085, 0.140), (-0.02, 0.090, 0.180), (-0.10, 0.055, 0.130), (-0.16, 0.025, 0.060)],
        "anal": [(-0.02, -0.085, -0.160), (-0.09, -0.070, -0.200), (-0.15, -0.035, -0.130)],
        "colors": {"body": (0.15, 0.30, 0.65), "tail": (0.75, 0.20, 0.30), "fin": (0.55, 0.25, 0.55)},
    },
    "platy": {
        # 月光鱼：小身、黄红
        "body": [
            (0.19, 0.010, 0.008), (0.15, 0.048, 0.036), (0.09, 0.082, 0.058),
            (0.03, 0.098, 0.066), (-0.04, 0.088, 0.060), (-0.10, 0.058, 0.040),
            (-0.15, 0.032, 0.022), (-0.18, 0.016, 0.011),
        ],
        "tail": [(-0.18, 0.022), (-0.23, 0.045), (-0.27, 0.060)],
        "dorsal": [(0.06, 0.092, 0.115), (0.00, 0.095, 0.125), (-0.07, 0.060, 0.085)],
        "anal": [(-0.02, -0.085, -0.105), (-0.08, -0.058, -0.090), (-0.13, -0.030, -0.052)],
        "colors": {"body": (0.95, 0.75, 0.25), "tail": (0.90, 0.35, 0.20), "fin": (0.92, 0.55, 0.25)},
    },
    "cory": {
        # 鼠鱼：底栖、短粗、灰褐
        "body": [
            (0.18, 0.012, 0.010), (0.14, 0.048, 0.038), (0.09, 0.078, 0.060),
            (0.03, 0.088, 0.066), (-0.03, 0.078, 0.058), (-0.08, 0.055, 0.040),
            (-0.12, 0.032, 0.024), (-0.15, 0.015, 0.010),
        ],
        "tail": [(-0.15, 0.018), (-0.19, 0.035), (-0.22, 0.045)],
        "dorsal": [(0.05, 0.075, 0.105), (-0.01, 0.070, 0.095), (-0.07, 0.045, 0.065)],
        "anal": [(-0.02, -0.065, -0.080), (-0.07, -0.048, -0.070), (-0.11, -0.025, -0.045)],
        "colors": {"body": (0.45, 0.40, 0.35), "tail": (0.50, 0.45, 0.40), "fin": (0.48, 0.43, 0.38)},
    },
}


def reset_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for collection in (bpy.data.meshes, bpy.data.materials, bpy.data.cameras, bpy.data.lights):
        for item in list(collection):
            collection.remove(item)


def make_material(name, color, metallic=0.05, roughness=0.5):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (color[0], color[1], color[2], 1.0)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = roughness
    mat.use_backface_culling = False
    return mat


def assign(obj, mat):
    obj.data.materials.append(mat)


def new_mesh(name, verts, faces, mat, smooth=True):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    if smooth:
        for poly in mesh.polygons:
            poly.use_smooth = True
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    assign(obj, mat)
    return obj


def build_body(stations, ring_segments=14):
    # Blender 约定：Z 为背腹（垂直）、Y 为左右；导出后 Blender Z→glTF Y、Blender Y→glTF Z
    verts = []
    faces = []
    for x, ry, rz in stations:
        for k in range(ring_segments):
            theta = 2 * math.pi * k / ring_segments
            verts.append((x, rz * math.cos(theta), ry * math.sin(theta)))
    n = ring_segments
    for i in range(len(stations) - 1):
        for k in range(n):
            a = i * n + k
            b = i * n + (k + 1) % n
            c = (i + 1) * n + (k + 1) % n
            d = (i + 1) * n + k
            faces.append((a, b, c, d))
    start_center = len(verts)
    verts.append((stations[0][0], 0, 0))
    for k in range(n):
        faces.append((start_center, k, (k + 1) % n))
    end_center = len(verts)
    base = (len(stations) - 1) * n
    verts.append((stations[-1][0], 0, 0))
    for k in range(n):
        faces.append((end_center, base + (k + 1) % n, base + k))
    return verts, faces


def build_symmetric_fin(rows, width_segments=6):
    # 尾鳍在背腹方向（Blender Z）展开，薄片厚度在 Blender Y=0
    verts = []
    faces = []
    for x, half in rows:
        for j in range(width_segments + 1):
            t = j / width_segments
            verts.append((x, 0.0, -half + 2 * half * t))
    w = width_segments
    for i in range(len(rows) - 1):
        for j in range(w):
            a = i * (w + 1) + j
            b = a + 1
            c = (i + 1) * (w + 1) + j + 1
            d = (i + 1) * (w + 1) + j
            faces.append((a, b, c, d))
    return verts, faces


def build_ranged_fin(rows):
    # 背鳍/臀鳍在背腹方向（Blender Z）展开
    verts = []
    faces = []
    for x, base_y, tip_y in rows:
        verts.append((x, 0.0, base_y))
        verts.append((x, 0.0, tip_y))
    for i in range(len(rows) - 1):
        faces.append((i * 2, i * 2 + 1, (i + 1) * 2 + 1, (i + 1) * 2))
    return verts, faces


def build_fish(fish_id, out_path):
    reset_scene()
    params = FISH_PARAMS[fish_id]
    colors = params["colors"]
    body_mat = make_material("%s_body_mat" % fish_id, colors["body"], metallic=0.08, roughness=0.42)
    tail_mat = make_material("%s_tail_mat" % fish_id, colors["tail"], metallic=0.02, roughness=0.5)
    fin_mat = make_material("%s_fin_mat" % fish_id, colors["fin"], metallic=0.02, roughness=0.55)
    eye_mat = make_material("%s_eye_mat" % fish_id, (0.02, 0.02, 0.02), metallic=0.0, roughness=0.12)

    bv, bf = build_body(params["body"])
    new_mesh("%s_body" % fish_id, bv, bf, body_mat)
    tv, tf = build_symmetric_fin(params["tail"])
    new_mesh("%s_tail" % fish_id, tv, tf, tail_mat)
    dv, df = build_ranged_fin(params["dorsal"])
    new_mesh("%s_dorsal" % fish_id, dv, df, fin_mat)
    av, af = build_ranged_fin(params["anal"])
    new_mesh("%s_anal" % fish_id, av, af, fin_mat)

    for side, s in (("L", 1), ("R", -1)):
        pverts, pfaces = build_ranged_fin([(0.06, 0.0, 0.0), (-0.02, -0.05, 0.0)])
        pobj = new_mesh("%s_pec_%s" % (fish_id, side), pverts, pfaces, fin_mat)
        # 左右在 Blender Y，腹偏在 Blender Z；绕左右轴（Blender Y）略朝外
        pobj.location = (0.04, s * 0.075, -0.02)
        pobj.rotation_euler = (0, math.radians(s * 35), 0)

    for side, s in (("L", 1), ("R", -1)):
        # 眼睛在头部左右（Blender Y），背侧（Blender Z 正，不随 side 变号）
        bpy.ops.mesh.primitive_uv_sphere_add(segments=12, ring_count=8, radius=0.022,
                                             location=(0.135, s * 0.052, 0.030))
        eye = bpy.context.active_object
        eye.name = "%s_eye_%s" % (fish_id, side)
        assign(eye, eye_mat)

    mesh_objs = [o for o in bpy.data.objects if o.type == "MESH"]
    import mathutils
    mins = [float("inf")] * 3
    maxs = [float("-inf")] * 3
    for obj in mesh_objs:
        for corner in obj.bound_box:
            world = obj.matrix_world @ mathutils.Vector(corner)
            for i in range(3):
                mins[i] = min(mins[i], world[i])
                maxs[i] = max(maxs[i], world[i])
    center = mathutils.Vector([(mins[i] + maxs[i]) / 2 for i in range(3)])
    for obj in mesh_objs:
        obj.location -= center
    length = maxs[0] - mins[0]

    bpy.ops.object.empty_add(type="PLAIN_AXES", location=(0, 0, 0))
    root = bpy.context.active_object
    root.name = fish_id
    for obj in mesh_objs:
        obj.parent = root

    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=out_path, export_format="GLB", export_apply=True)
    return length, len(mesh_objs), (os.path.getsize(out_path) / 1024 if os.path.exists(out_path) else 0)


# ---------- 入口 ----------
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
if argv and argv[0] == "batch":
    print("=== build_fish 批量开始，共 %d 种 ===" % len(FISH_PARAMS))
    for fish_id in FISH_PARAMS:
        out = os.path.join(OUT_DIR, fish_id + ".glb")
        length, parts, kb = build_fish(fish_id, out)
        print("%-11s 体长%.3f 部件%d 大小%.1fKB -> %s" % (fish_id, length, parts, kb, out))
    print("=== 批量结束 ===")
else:
    fish_id = argv[0] if len(argv) > 0 else "guppy"
    out_path = argv[1] if len(argv) > 1 else os.path.join(OUT_DIR, fish_id + ".glb")
    length, parts, kb = build_fish(fish_id, out_path)
    print("=== build_fish 单条 ===")
    print("%-11s 体长%.3f 部件%d 大小%.1fKB -> %s" % (fish_id, length, parts, kb, out_path))
