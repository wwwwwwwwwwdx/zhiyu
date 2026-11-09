# 检查 glb 各 accessor 的整体包围盒，验证体型差异
import struct, json, sys, os

def bbox(path):
    with open(path, 'rb') as f:
        data = f.read()
    clen = struct.unpack('<I', data[12:16])[0]
    js = json.loads(data[20:20 + clen])
    mins = [1e9] * 3
    maxs = [-1e9] * 3
    for acc in js['accessors']:
        if 'min' in acc and 'max' in acc and len(acc['min']) == 3:
            for i in range(3):
                mins[i] = min(mins[i], acc['min'][i])
                maxs[i] = max(maxs[i], acc['max'][i])
    return mins, maxs

fish_base = r"D:\PersonalProject\zhiyu\public\models\fish"
plant_base = r"D:\PersonalProject\zhiyu\public\models\plants"
# 用法：inspect_glb.py [fish|plant] <name1> <name2> ...；默认 fish
if sys.argv[1:] and sys.argv[1] in ("fish", "plant"):
    base = plant_base if sys.argv[1] == "plant" else fish_base
    names = sys.argv[2:]
else:
    base = fish_base
    names = sys.argv[1:]
for name in names:
    p = os.path.join(base, name + ".glb")
    mn, mx = bbox(p)
    print("%-11s Xlen=%.3f Ylen=%.3f Zlen=%.3f" %
          (name, mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]))
