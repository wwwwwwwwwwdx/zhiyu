# Blender 后台建模脚本：程序化构建 8 种装备并导出 GLB
# 用法（-- 之后为参数）：
#   单种：blender.exe --background --python build_equipment.py -- <equipment_id> <output.glb>
#   批量：blender.exe --background --python build_equipment.py -- batch
#
# 设计：用基本体（圆柱/立方体）组合真实设备形态，几何原点统一在底部，
# 导出前归一化高度到 1，保证商店图标与后续缸内摆放比例一致。
import bpy
import math
import sys
import os

OUT_DIR = r"D:\PersonalProject\zhiyu\public\models\equipment"

# 装备配色：深色外壳、金属、玻璃、发光
EQUIPMENT_COLORS = {
    # 统一为清透的浅灰蓝塑料观感：缸内水体、砂色都是浅色，深色装备会像黑块
    "housing": (0.34, 0.47, 0.53),    # 主外壳
    "housing2": (0.50, 0.63, 0.69),   # 次外壳
    "metal": (0.62, 0.66, 0.68),      # 金属
    "darkmetal": (0.40, 0.46, 0.50),
    "glass": (0.78, 0.88, 0.92),      # 玻璃/浅色
    "glow": (0.75, 0.90, 0.98),       # 发光
}


def reset_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for collection in (bpy.data.meshes, bpy.data.materials, bpy.data.cameras, bpy.data.lights):
        for item in list(collection):
            collection.remove(item)


def make_material(name, color, roughness=0.5, metallic=0.0,
                  transparent=False, emission=None, emission_strength=0.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (color[0], color[1], color[2], 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    if transparent:
        bsdf.inputs["Alpha"].default_value = 0.45
        mat.blend_method = "BLEND"
    if emission is not None:
        bsdf.inputs["Emission Color"].default_value = (emission[0], emission[1], emission[2], 1.0)
        bsdf.inputs["Emission Strength"].default_value = emission_strength
    return mat


def add_box(name, size, location, mat):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=location)
    obj = bpy.context.active_object
    obj.name = name
    obj.scale = (size[0] / 2, size[1] / 2, size[2] / 2)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(mat)
    return obj


def add_cyl(name, radius, depth, location, mat, vertices=20, rot=(0.0, 0.0, 0.0)):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=location)
    obj = bpy.context.active_object
    obj.name = name
    obj.rotation_euler = rot
    if any(rot):
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    obj.data.materials.append(mat)
    return obj


# ---------- 过滤器 ----------
def build_filter_wall(m_housing, m_housing2, m_metal, m_darkmetal, m_glass, m_glow):
    # 挂在缸壁的小方盒：主体 + 顶部挂扣 + 下垂进水管 + 横向出水嘴 + 指示灯
    # 各部件与主体留足重叠，避免在图标和缸内读成几个分离的方块
    add_box("fw_body", (0.42, 0.28, 0.55), (0, 0, 0.36), m_housing)
    add_box("fw_clip", (0.46, 0.32, 0.16), (0, 0, 0.60), m_housing2)
    add_cyl("fw_intake", 0.05, 0.36, (0, 0, -0.05), m_darkmetal, vertices=12)
    add_cyl("fw_spout", 0.05, 0.20, (0, 0.20, 0.18), m_metal, vertices=12, rot=(math.pi / 2, 0, 0))
    add_box("fw_led", (0.07, 0.05, 0.02), (0.15, 0, 0.645), m_glow)


def build_filter_canister(m_housing, m_housing2, m_metal, m_darkmetal, m_glass, m_glow):
    # 外置滤桶：圆柱桶 + 顶盖 + 两根向上的水管
    add_cyl("fc_body", 0.30, 0.72, (0, 0, 0.36), m_housing)
    add_cyl("fc_cap", 0.33, 0.14, (0, 0, 0.79), m_housing2)
    add_cyl("fc_pipe_l", 0.045, 0.34, (-0.14, 0, 1.02), m_metal, vertices=12)
    add_cyl("fc_pipe_r", 0.045, 0.34, (0.14, 0, 1.02), m_metal, vertices=12)
    add_box("fc_valve", (0.30, 0.16, 0.08), (0, 0, 0.90), m_housing2)


def build_filter_sump(m_housing, m_housing2, m_metal, m_darkmetal, m_glass, m_glow):
    # 底滤槽：敞口长方形缸 + 三个滤仓 + 三种滤材，读起来像真正的滤槽
    add_box("fs_bottom", (1.0, 0.5, 0.07), (0, 0, 0.035), m_housing)
    add_box("fs_wall_l", (0.09, 0.5, 0.42), (-0.455, 0, 0.245), m_housing)
    add_box("fs_wall_r", (0.09, 0.5, 0.42), (0.455, 0, 0.245), m_housing)
    add_box("fs_wall_f", (1.0, 0.09, 0.42), (0, -0.205, 0.245), m_housing)
    add_box("fs_wall_b", (1.0, 0.09, 0.42), (0, 0.205, 0.245), m_housing)
    # 两道隔板把槽分成三个滤仓
    add_box("fs_div1", (0.05, 0.42, 0.36), (-0.18, 0, 0.21), m_housing2)
    add_box("fs_div2", (0.05, 0.42, 0.36), (0.20, 0, 0.21), m_housing2)
    # 滤材：左侧粗海绵、中间陶瓷环、右侧细滤棉，用深浅区分仓室
    add_box("fs_media1", (0.20, 0.34, 0.26), (-0.37, 0, 0.17), m_darkmetal)
    add_box("fs_media2", (0.24, 0.34, 0.28), (0.01, 0, 0.18), m_housing2)
    add_box("fs_media3", (0.18, 0.34, 0.24), (0.33, 0, 0.16), m_metal)
    # 回缸出水管
    add_cyl("fs_out", 0.045, 0.26, (-0.30, 0, 0.58), m_metal, vertices=12)


# ---------- 灯具 ----------
def build_light_led(m_housing, m_housing2, m_metal, m_darkmetal, m_glass, m_glow):
    # 细长 LED 灯条：外壳 + 底部发光条
    add_box("ll_body", (1.1, 0.16, 0.12), (0, 0, 0.10), m_housing)
    add_box("ll_glow", (1.02, 0.12, 0.04), (0, 0, 0.03), m_glow)


def build_light_plant(m_housing, m_housing2, m_metal, m_darkmetal, m_glass, m_glow):
    # 水草造景灯：宽扁灯盘 + 底部两排发光
    add_box("lp_body", (0.95, 0.42, 0.12), (0, 0, 0.12), m_housing)
    add_box("lp_edge", (0.98, 0.45, 0.05), (0, 0, 0.18), m_housing2)
    add_box("lp_glow1", (0.82, 0.10, 0.035), (0, -0.11, 0.05), m_glow)
    add_box("lp_glow2", (0.82, 0.10, 0.035), (0, 0.11, 0.05), m_glow)


# ---------- 加热棒 ----------
def build_heater(m_housing, m_glass, m_metal, length, radius):
    # 细长管身 + 顶部金属帽；管身用不透明深色，水里才看得见
    total = length
    add_cyl("ht_tube", radius, total * 0.80, (0, 0, total * 0.40), m_housing, vertices=16)
    add_cyl("ht_cap", radius * 1.3, total * 0.12, (0, 0, total * 0.86), m_metal, vertices=16)


def build_heater_50(m_housing, m_housing2, m_metal, m_darkmetal, m_glass, m_glow):
    build_heater(m_housing, m_glass, m_metal, length=0.85, radius=0.075)


def build_heater_100(m_housing, m_housing2, m_metal, m_darkmetal, m_glass, m_glow):
    build_heater(m_housing, m_glass, m_metal, length=1.05, radius=0.09)


# ---------- CO2 ----------
def build_co2_system(m_housing, m_housing2, m_metal, m_darkmetal, m_glass, m_glow):
    # 钢瓶：圆柱瓶身 + 圆弧肩 + 顶部阀门 + 细管
    add_cyl("co_body", 0.22, 0.62, (0, 0, 0.31), m_metal)
    add_cyl("co_shoulder", 0.14, 0.12, (0, 0, 0.68), m_metal)
    add_cyl("co_neck", 0.06, 0.10, (0, 0, 0.79), m_darkmetal, vertices=12)
    add_box("co_valve", (0.16, 0.12, 0.10), (0, 0, 0.87), m_housing)
    add_cyl("co_tube", 0.025, 0.28, (0.12, 0, 0.98), m_darkmetal, vertices=8)


BUILDERS = {
    "filter-wall": build_filter_wall,
    "filter-canister": build_filter_canister,
    "filter-sump": build_filter_sump,
    "light-led": build_light_led,
    "light-plant": build_light_plant,
    "heater-50": build_heater_50,
    "heater-100": build_heater_100,
    "co2-system": build_co2_system,
}


def build_equipment(equipment_id, out_path):
    import mathutils
    reset_scene()
    m_housing = make_material("housing_mat", EQUIPMENT_COLORS["housing"], roughness=0.45, metallic=0.2)
    m_housing2 = make_material("housing2_mat", EQUIPMENT_COLORS["housing2"], roughness=0.4, metallic=0.25)
    m_metal = make_material("metal_mat", EQUIPMENT_COLORS["metal"], roughness=0.3, metallic=0.85)
    m_darkmetal = make_material("darkmetal_mat", EQUIPMENT_COLORS["darkmetal"], roughness=0.35, metallic=0.8)
    m_glass = make_material("glass_mat", EQUIPMENT_COLORS["glass"], roughness=0.15, metallic=0.0,
                            transparent=True)
    m_glow = make_material("glow_mat", EQUIPMENT_COLORS["glow"], roughness=0.3,
                           emission=EQUIPMENT_COLORS["glow"], emission_strength=2.0)
    BUILDERS[equipment_id](m_housing, m_housing2, m_metal, m_darkmetal, m_glass, m_glow)

    mesh_objs = [o for o in bpy.data.objects if o.type == "MESH"]
    bpy.ops.object.select_all(action="DESELECT")
    for obj in mesh_objs:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = mesh_objs[0]
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

    # 测量整体世界包围盒，归一化高度到 1，底部归零
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

    mesh_objs = [o for o in bpy.data.objects if o.type == "MESH"]
    bpy.ops.object.empty_add(type="PLAIN_AXES", location=(0, 0, 0))
    root = bpy.context.active_object
    root.name = equipment_id
    for obj in mesh_objs:
        obj.parent = root

    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=out_path, export_format="GLB", export_apply=True)
    return len(mesh_objs), (os.path.getsize(out_path) / 1024 if os.path.exists(out_path) else 0)


# ---------- 入口 ----------
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
if argv and argv[0] == "batch":
    print("=== build_equipment 批量开始，共 %d 种 ===" % len(BUILDERS))
    for equipment_id in BUILDERS:
        out = os.path.join(OUT_DIR, equipment_id + ".glb")
        parts, kb = build_equipment(equipment_id, out)
        print("%-16s 部件%d 大小%.1fKB -> %s" % (equipment_id, parts, kb, out))
    print("=== 批量结束 ===")
else:
    equipment_id = argv[0] if argv else "filter-wall"
    out_path = argv[1] if len(argv) > 1 else os.path.join(OUT_DIR, equipment_id + ".glb")
    parts, kb = build_equipment(equipment_id, out_path)
    print("=== build_equipment 单种 ===")
    print("%-16s 部件%d 大小%.1fKB -> %s" % (equipment_id, parts, kb, out_path))
