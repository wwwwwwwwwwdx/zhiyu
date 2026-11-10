# Blender 后台建模脚本：程序化构建三种水草并导出 GLB
# 用法（-- 之后为参数）：
#   单种：blender.exe --background --python build_plant.py -- <plant_id> <output.glb>
#   批量：blender.exe --background --python build_plant.py -- batch
#
# 设计：用自定义网格（from_pydata）构建卵形叶片、轮生针叶与苔藓团，
# 几何原点统一在底部（z=0），使渲染层缩放（生长）时从砂面向上长。
# 全部采用确定性角度计算，不使用随机数，保证可复现。
import bpy
import math
import sys
import os

OUT_DIR = r"D:\PersonalProject\zhiyu\public\models\plants"

# 三种水草的配色（叶片、茎）
PLANT_COLORS = {
    "anubias": {"leaf": (0.13, 0.30, 0.11), "stem": (0.18, 0.26, 0.10)},
    "hornwort": {"leaf": (0.33, 0.57, 0.24), "stem": (0.28, 0.48, 0.20)},
    "moss": {"leaf": (0.27, 0.50, 0.19), "stem": (0.22, 0.42, 0.16)},
    "rotala": {"leaf": (0.62, 0.22, 0.28), "stem": (0.30, 0.18, 0.16)},
    "sword": {"leaf": (0.18, 0.38, 0.14), "stem": (0.20, 0.30, 0.12)},
}


def reset_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for collection in (bpy.data.meshes, bpy.data.materials, bpy.data.cameras, bpy.data.lights):
        for item in list(collection):
            collection.remove(item)


def make_material(name, color, roughness=0.65):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (color[0], color[1], color[2], 1.0)
    bsdf.inputs["Metallic"].default_value = 0.0
    bsdf.inputs["Roughness"].default_value = roughness
    mat.use_backface_culling = False  # 双面，薄片正反都可见
    return mat


def new_mesh(name, verts, faces, mat, smooth=True):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    if smooth:
        for poly in mesh.polygons:
            poly.use_smooth = True
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(mat)
    return obj


def add_cylinder(name, radius, depth, location, mat):
    bpy.ops.mesh.primitive_cylinder_add(vertices=12, radius=radius, depth=depth, location=location)
    obj = bpy.context.active_object
    obj.name = name
    obj.data.materials.append(mat)
    return obj


# 一片卵形（带轻微弧面）叶片：基部在原点，长度沿 +Z，宽度沿 Y，弧面沿 X
def make_leaf(length, width, bend=0.05, seg_l=6, seg_w=3):
    verts = []
    faces = []
    for i in range(seg_l + 1):
        v = i / seg_l
        w = width * math.sin(math.pi * v) ** 0.7  # 两端窄、中间宽
        z = v * length
        for j in range(seg_w + 1):
            u = j / seg_w * 2 - 1
            y = u * w
            x = bend * math.sin(math.pi * v) * (1 - 0.3 * u * u)
            verts.append((x, y, z))
    row = seg_w + 1
    for i in range(seg_l):
        for j in range(seg_w):
            a = i * row + j
            b = a + 1
            c = (i + 1) * row + j + 1
            d = (i + 1) * row + j
            faces.append((a, b, c, d))
    return verts, faces


# 放置叶片：先绕 X 倾斜（向 +Y 倒），再绕 Z 转方位角
def orient_leaf(obj, azimuth, tilt, base_z=0.0):
    obj.rotation_euler = (tilt, 0.0, azimuth)
    obj.location = (0.0, 0.0, base_z)


# ---------- 水榕：短根茎 + 放射状宽叶 ----------
def build_anubias(leaf_mat, stem_mat):
    add_cylinder("anubias_rhizome", 0.09, 0.16, (0, 0, 0.08), stem_mat)
    base_z = 0.08
    # 外层 6 片：宽叶、向上斜展并向外拱，叶面互相叠压形成茂密叶簇
    outer = [0.60, 0.55, 0.58, 0.52, 0.57, 0.54]
    for k in range(6):
        verts, faces = make_leaf(outer[k], 0.27, bend=0.12, seg_l=10, seg_w=5)
        obj = new_mesh("anubias_outer_%d" % k, verts, faces, leaf_mat)
        orient_leaf(obj, 2 * math.pi * k / 6 + 0.4, math.radians(36), base_z + 0.02 * (k % 2))
    # 内层 5 片：更短更直立，填满簇心
    inner = [0.44, 0.40, 0.42, 0.38, 0.41]
    for k in range(5):
        verts, faces = make_leaf(inner[k], 0.22, bend=0.08, seg_l=9, seg_w=4)
        obj = new_mesh("anubias_inner_%d" % k, verts, faces, leaf_mat)
        orient_leaf(obj, 2 * math.pi * k / 5 + 0.9, math.radians(15), base_z + 0.05)


# ---------- 蜈蚣草：直立主茎 + 轮生细密针叶 ----------
def build_hornwort(leaf_mat, stem_mat):
    add_cylinder("hornwort_stem", 0.030, 1.02, (0, 0, 0.51), stem_mat)
    nodes = 12
    for n in range(nodes):
        z = 0.07 + n * 0.90 / (nodes - 1)
        needle_len = 0.26 * (1 - 0.45 * z)  # 越往上针叶越短
        for k in range(9):
            verts, faces = make_leaf(needle_len, 0.030, bend=0.012, seg_l=6, seg_w=2)
            obj = new_mesh("hornwort_n%d_%d" % (n, k), verts, faces, leaf_mat)
            azimuth = 2 * math.pi * k / 9 + n * 0.42  # 相邻节错开
            orient_leaf(obj, azimuth, math.radians(54), z)


# ---------- 莫丝：低矮垫状苔藓团 ----------
def build_moss(leaf_mat, stem_mat):
    add_cylinder("moss_base", 0.13, 0.08, (0, 0, 0.04), stem_mat)
    # 密实垫状：更密的短叶铺满半球，形成绒感
    count = 72
    for n in range(count):
        t = n / count
        incl = math.acos(1 - t)  # 0..pi/2，从中心向外
        az = n * 2.39996  # 黄金角，均匀分布
        r = 0.36 * (1 - 0.22 * t)
        x = r * math.sin(incl) * math.cos(az)
        y = r * math.sin(incl) * math.sin(az)
        z = 0.05 + r * 0.72 * math.cos(incl)  # 压扁的垫状
        leaf_len = 0.15 + 0.05 * (1 - t)
        verts, faces = make_leaf(leaf_len, 0.055, bend=0.025, seg_l=5, seg_w=3)
        obj = new_mesh("moss_leaf_%d" % n, verts, faces, leaf_mat)
        obj.rotation_euler = (incl, 0.0, az)
        obj.location = (x, y, z)


BUILDERS = {
    "anubias": build_anubias,
    "hornwort": build_hornwort,
    "moss": build_moss,
}


# ---------- 红宫廷：直立细茎 + 对生小叶，叶色偏红 ----------
def build_rotala(leaf_mat, stem_mat):
    add_cylinder("rotala_stem", 0.022, 1.05, (0, 0, 0.525), stem_mat)
    nodes = 14
    for n in range(nodes):
        z = 0.06 + n * 0.95 / (nodes - 1)
        leaf_len = 0.20 * (1 - 0.35 * z)
        # 对生：每节 2 片对生小叶
        for k in range(2):
            verts, faces = make_leaf(leaf_len, 0.055, bend=0.02, seg_l=6, seg_w=3)
            obj = new_mesh("rotala_n%d_%d" % (n, k), verts, faces, leaf_mat)
            azimuth = math.pi * k + n * 0.5
            orient_leaf(obj, azimuth, math.radians(60), z)


# ---------- 皇冠草：窄长叶从基部放射状弯出，避免"卷心菜"感 ----------
def build_sword(leaf_mat, stem_mat):
    add_cylinder("sword_base", 0.06, 0.08, (0, 0, 0.04), stem_mat)
    base_z = 0.05
    # 外层 6 片窄长叶：中等角度弯出，叶窄而长
    outer = [0.72, 0.66, 0.70, 0.64, 0.68, 0.65]
    for k in range(6):
        verts, faces = make_leaf(outer[k], 0.09, bend=0.18, seg_l=12, seg_w=3)
        obj = new_mesh("sword_outer_%d" % k, verts, faces, leaf_mat)
        orient_leaf(obj, 2 * math.pi * k / 6, math.radians(38), base_z)
    # 内层 4 片：短而直立
    inner = [0.45, 0.42, 0.44, 0.40]
    for k in range(4):
        verts, faces = make_leaf(inner[k], 0.07, bend=0.06, seg_l=9, seg_w=3)
        obj = new_mesh("sword_inner_%d" % k, verts, faces, leaf_mat)
        orient_leaf(obj, 2 * math.pi * k / 4 + 0.4, math.radians(12), base_z + 0.03)


BUILDERS["rotala"] = build_rotala
BUILDERS["sword"] = build_sword


def build_plant(plant_id, out_path):
    import mathutils
    reset_scene()
    colors = PLANT_COLORS[plant_id]
    leaf_mat = make_material("%s_leaf_mat" % plant_id, colors["leaf"],
                             roughness=0.5 if plant_id == "anubias" else 0.7)
    stem_mat = make_material("%s_stem_mat" % plant_id, colors["stem"], roughness=0.75)
    BUILDERS[plant_id](leaf_mat, stem_mat)

    mesh_objs = [o for o in bpy.data.objects if o.type == "MESH"]
    # 1) 先把各构件的旋转/位置烘焙进网格，得到世界坐标静态网格
    bpy.ops.object.select_all(action="DESELECT")
    for obj in mesh_objs:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = mesh_objs[0]
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

    # 2) 测量整体世界包围盒，归一化高度到 1，并让底部归零
    mins = [float("inf")] * 3
    maxs = [float("-inf")] * 3
    for obj in mesh_objs:
        for corner in obj.bound_box:
            world = obj.matrix_world @ mathutils.Vector(corner)
            for i in range(3):
                mins[i] = min(mins[i], world[i])
                maxs[i] = max(maxs[i], world[i])
    height = maxs[2] - mins[2]
    scale_factor = 1.0 / height

    bpy.ops.object.empty_add(type="PLAIN_AXES", location=(0, 0, 0))
    tmp = bpy.context.active_object
    for obj in mesh_objs:
        obj.parent = tmp
    tmp.scale = (scale_factor, scale_factor, scale_factor)
    tmp.location = (-mins[0] * scale_factor, -mins[1] * scale_factor, -mins[2] * scale_factor)

    bpy.ops.object.select_all(action="DESELECT")
    for obj in mesh_objs:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = mesh_objs[0]
    bpy.ops.object.parent_clear(type="CLEAR_KEEP_TRANSFORM")
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bpy.data.objects.remove(tmp, do_unlink=True)

    # 3) 重新挂到命名 root
    mesh_objs = [o for o in bpy.data.objects if o.type == "MESH"]
    bpy.ops.object.empty_add(type="PLAIN_AXES", location=(0, 0, 0))
    root = bpy.context.active_object
    root.name = plant_id
    for obj in mesh_objs:
        obj.parent = root

    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=out_path, export_format="GLB", export_apply=True)
    return len(mesh_objs), (os.path.getsize(out_path) / 1024 if os.path.exists(out_path) else 0)


# ---------- 入口 ----------
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
if argv and argv[0] == "batch":
    print("=== build_plant 批量开始，共 %d 种 ===" % len(BUILDERS))
    for plant_id in BUILDERS:
        out = os.path.join(OUT_DIR, plant_id + ".glb")
        parts, kb = build_plant(plant_id, out)
        print("%-10s 部件%d 大小%.1fKB -> %s" % (plant_id, parts, kb, out))
    print("=== 批量结束 ===")
else:
    plant_id = argv[0] if argv else "anubias"
    out_path = argv[1] if len(argv) > 1 else os.path.join(OUT_DIR, plant_id + ".glb")
    parts, kb = build_plant(plant_id, out_path)
    print("=== build_plant 单种 ===")
    print("%-10s 部件%d 大小%.1fKB -> %s" % (plant_id, parts, kb, out_path))
