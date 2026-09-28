"""Stylised foliage: leaf-card trees, gradient grass clumps, lanterns, basalt rocks.

Leaf cards get custom normals pointing away from the canopy centre so each canopy
shades like one soft volume (the painterly look); grass blades carry a vertex colour
gradient (dark roots -> bright tips) and upward normals.
"""
import math
import random
import bmesh
import bpy
from mathutils import Vector, Matrix
from lib import apply_tf, box, cone, cyl, join, mat, origin_to, rod, sphere, tube

R = random.Random(23)

PALETTES = {
    "orange": ["#ff7a2e", "#ff5a1f", "#ffa23a", "#e0401c"],
    "pink": ["#ff5f9e", "#ff86b6", "#e0407e", "#ffb0cc"],
    "yellow": ["#ffc933", "#f2a91f", "#ffe066", "#d98f18"],
    "green": ["#6dbb3c", "#8fd14f", "#4f9a35", "#b0dc5a"],
    "red": ["#e8342e", "#ff5a3c", "#c21f33", "#ff7a4a"],
}


def leaf_mats(key):
    return [mat(f"Leaf_{key}_{i}", c, rough=0.9) for i, c in enumerate(PALETTES[key])]


def canopy(blobs, mats, cards=380, size=(0.34, 0.6), name="canopy"):
    """blobs: list of (centre, radius). Returns one mesh of scattered leaf cards."""
    bm = bmesh.new()
    normals = []
    mat_idx = []
    total_r = sum(r for _, r in blobs)
    for c, r in blobs:
        n = int(cards * r / total_r)
        for _ in range(n):
            # point biased to the outer shell of an ellipsoid
            d = Vector((R.gauss(0, 1), R.gauss(0, 1), R.gauss(0, 1))).normalized()
            rr = r * (0.35 + 0.65 * R.random() ** 0.45)
            p = Vector(c) + Vector((d.x * rr, d.y * rr, d.z * rr * 0.85))
            s = R.uniform(*size)
            # random orientation, roughly facing outward
            axis_a = d.cross(Vector((0, 0, 1)) if abs(d.z) < 0.9 else Vector((1, 0, 0))).normalized()
            axis_b = d.cross(axis_a).normalized()
            rot = R.uniform(0, math.pi)
            u = axis_a * math.cos(rot) + axis_b * math.sin(rot)
            v = d.cross(u).normalized()
            tilt = R.uniform(-0.6, 0.6)
            v = (v + d * tilt).normalized()
            quad = [p + u * s * 0.5, p + v * s * 0.35, p - u * s * 0.5, p - v * s * 0.35]  # diamond card
            vs = [bm.verts.new(q) for q in quad]
            bm.faces.new(vs)
            nrm = (p - Vector(c)).normalized()
            normals += [nrm] * 4
            # brighter shades toward the top
            h = (p.z - (c[2] - r)) / (2 * r)
            k = min(len(mats) - 1, max(0, int(R.random() * len(mats) * 0.6 + h * len(mats) * 0.5)))
            mat_idx.append(k)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(o)
    for m in mats:
        o.data.materials.append(m)
    for f, k in zip(o.data.polygons, mat_idx):
        f.material_index = k
    me.normals_split_custom_set_from_vertices([tuple(n) for n in normals])
    return o


def trunk(height, r, bark, branches=()):
    parts = [cone(r, r * 0.55, height, (0, 0, height / 2), bark, verts=8)]
    for (a, h, l, up) in branches:
        parts.append(tube([(0, 0, h), (math.cos(a) * l * 0.5, math.sin(a) * l * 0.5, h + up * 0.5), (math.cos(a) * l, math.sin(a) * l, h + up)],
                          r * 0.35, bark, name="branch"))
    return parts


def build_trees(out, done):
    bark = mat("BarkStylised", "#5b3a4a", rough=0.9)
    birch = mat("BirchStylised", "#f3e6e6", rough=0.9)
    variants = [
        ("tree_orange", "orange", [((0, 0, 3.6), 1.9), ((1.1, 0.4, 3.0), 1.3), ((-1.0, -0.3, 3.2), 1.35), ((0.2, -0.2, 4.6), 1.2)], 3.2, bark),
        ("tree_pink", "pink", [((0, 0, 3.3), 1.7), ((0.9, -0.5, 2.8), 1.2), ((-0.8, 0.6, 3.0), 1.2)], 2.8, bark),
        ("tree_yellow", "yellow", [((0, 0, 4.0), 1.5), ((0.2, 0.3, 5.1), 1.1), ((-0.4, -0.2, 3.1), 1.2)], 3.6, birch),
        ("tree_green", "green", [((0, 0, 3.5), 1.8), ((1.0, 0.5, 3.0), 1.2), ((-1.0, -0.4, 3.2), 1.3), ((0, 0.2, 4.5), 1.1)], 3.0, bark),
        ("tree_red", "red", [((0, 0, 3.0), 1.6), ((0.8, 0.3, 2.6), 1.1), ((-0.7, -0.4, 2.8), 1.1)], 2.6, bark),
    ]
    for name, pal, blobs, h, bk in variants:
        br = [(R.uniform(0, 6.28), h * R.uniform(0.55, 0.8), R.uniform(0.8, 1.3), R.uniform(0.5, 1.0)) for _ in range(3)]
        parts = trunk(h, 0.26, bk, br)
        if bk is birch:
            for i in range(7):
                a = R.uniform(0, 6.28)
                parts.append(box((0.07, 0.02, 0.05), (math.cos(a) * 0.2, math.sin(a) * 0.2, 0.4 + i * 0.45), mat("Ink", "#2a2230"), rot=(0, 0, a + math.pi / 2)))
        parts.append(canopy(blobs, leaf_mats(pal), cards=900))
        done(parts, name)

    # stylised pine: stacked leaf-card cones
    greens = [mat("Leaf_pine_0", "#2f7d52"), mat("Leaf_pine_1", "#3f9a5e"), mat("Leaf_pine_2", "#57b56b"), mat("Leaf_pine_3", "#256a4a")]
    parts = trunk(1.8, 0.24, bark)
    blobs = [((0, 0, 1.9 + i * 0.95), 1.55 - i * 0.28) for i in range(5)]
    parts.append(canopy(blobs, greens, cards=700, size=(0.3, 0.5)))
    done(parts, "tree_pine2")

    # flowering bush
    parts = [canopy([((0, 0, 0.6), 0.85), ((0.7, 0.2, 0.5), 0.6), ((-0.6, -0.3, 0.45), 0.55)], leaf_mats("pink"), cards=320, size=(0.2, 0.34), name="bush")]
    done(parts, "bush_pink")
    parts = [canopy([((0, 0, 0.55), 0.8), ((0.6, 0.3, 0.45), 0.6)], leaf_mats("yellow"), cards=280, size=(0.2, 0.34), name="bush")]
    done(parts, "bush_yellow")


def grass_clump(name, base_col, tip_col, blades=26, h=(0.35, 0.75), spread=0.35):
    bm = bmesh.new()
    col_layer = bm.loops.layers.color.new("Col")
    base_c, tip_c = Vector(base_col), Vector(tip_col)
    for i in range(blades):
        a = R.uniform(0, 6.28)
        rr = R.uniform(0, spread)
        bx, by = math.cos(a) * rr, math.sin(a) * rr
        height = R.uniform(*h) * (1.15 - rr / spread * 0.4)
        lean = R.uniform(0.15, 0.55)
        la = a + R.uniform(-0.6, 0.6)
        w = R.uniform(0.035, 0.06)
        side = Vector((-math.sin(la), math.cos(la), 0)) * w
        tip = Vector((bx + math.cos(la) * lean * height, by + math.sin(la) * lean * height, height))
        mid = Vector((bx + math.cos(la) * lean * height * 0.35, by + math.sin(la) * lean * height * 0.35, height * 0.55))
        base = Vector((bx, by, 0))
        v = [bm.verts.new(base - side), bm.verts.new(base + side), bm.verts.new(mid + side * 0.6), bm.verts.new(mid - side * 0.6), bm.verts.new(tip)]
        faces = [bm.faces.new((v[0], v[1], v[2], v[3])), bm.faces.new((v[3], v[2], v[4]))]
        heights = {v[0]: 0, v[1]: 0, v[2]: 0.55, v[3]: 0.55, v[4]: 1.0}
        shade = R.uniform(0.85, 1.1)
        for f in faces:
            for loop in f.loops:
                k = heights[loop.vert] ** 0.8
                c = base_c.lerp(tip_c, k) * shade
                loop[col_layer] = (min(1, c.x), min(1, c.y), min(1, c.z), 1.0)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(o)
    o.data.materials.append(mat("GrassClump", "#ffffff", rough=1.0))
    me.normals_split_custom_set_from_vertices([(0, 0, 1)] * len(me.vertices))
    # make "Col" the only colour layer so it is exported as COLOR_0
    for ca in list(me.color_attributes):
        if ca.name != "Col":
            me.color_attributes.remove(ca)
    me.color_attributes.active_color = me.color_attributes["Col"]
    me.color_attributes.render_color_index = 0
    return o


def lin(hexc):
    h = hexc.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple((x / 12.92) if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


def build_ground_cover(done):
    done([grass_clump("grass_clump", lin("#3d4a14"), lin("#e8c83c"))], "grass_clump")
    done([grass_clump("grass_clump_g", lin("#2d5a1c"), lin("#b8e05a"), blades=22)], "grass_clump_green")
    done([grass_clump("grass_tall", lin("#4a3a18"), lin("#f0b040"), blades=34, h=(0.7, 1.3), spread=0.5)], "grass_tall")


def build_props(done):
    stone = mat("StoneWarm", "#b98a7a", rough=0.9)
    stone2 = mat("StoneWarmDark", "#8a6070", rough=0.9)
    wood = mat("WoodWarm", "#c0703f", rough=0.8)
    lamp = mat("LanternLight", "#ffcf5a", rough=0.3, emit=3)
    iron = mat("IronDark", "#3a2f45", rough=0.6, metal=0.5)

    # stone lantern (reference: glowing box on a post)
    p = [box((0.5, 0.5, 0.2), (0, 0, 0.1), stone2, bev=0.04),
         box((0.26, 0.26, 0.9), (0, 0, 0.6), stone, bev=0.03),
         box((0.55, 0.55, 0.1), (0, 0, 1.1), stone2, bev=0.03),
         box((0.4, 0.4, 0.42), (0, 0, 1.36), lamp, bev=0.02)]
    for sx in (-1, 1):  # window lattice
        p.append(box((0.03, 0.42, 0.44), (sx * 0.2, 0, 1.36), wood))
        p.append(box((0.42, 0.03, 0.44), (0, sx * 0.2, 1.36), wood))
    p.append(rod((-0.2, -0.21, 1.16), (0.2, -0.21, 1.56), 0.012, wood, verts=4))
    p.append(rod((0.2, -0.21, 1.16), (-0.2, -0.21, 1.56), 0.012, wood, verts=4))
    p.append(cone(0.45, 0.05, 0.3, (0, 0, 1.72), stone2, verts=4, rot=(0, 0, math.pi / 4)))
    done(p, "lantern")

    # street lamp with a glowing head
    p = [cyl(0.14, 0.3, (0, 0, 0.15), iron, verts=8), cyl(0.06, 4.2, (0, 0, 2.3), iron, verts=8),
         tube([(0, 0, 4.3), (0, -0.3, 4.6), (0, -0.8, 4.55)], 0.05, iron),
         cone(0.28, 0.12, 0.3, (0, -0.85, 4.45), iron, verts=6),
         sphere(0.16, (0, -0.85, 4.3), lamp, scale=(1, 1, 0.7), seg=12, ring=8)]
    done(p, "street_lamp")

    # basalt column cluster
    p = []
    for i in range(7):
        a = i / 7 * 6.28 + R.uniform(-0.2, 0.2)
        rr = 0 if i == 0 else R.uniform(0.6, 0.9)
        h = R.uniform(0.6, 1.6) * (1.3 if i == 0 else 1)
        c = cyl(0.42, h, (math.cos(a) * rr, math.sin(a) * rr, h / 2), stone if i % 2 else stone2, verts=6, bev=0.03)
        c.rotation_euler.z = R.uniform(0, 1)
        apply_tf(c)
        p.append(c)
    done(p, "basalt")

    # wooden bench
    p = [box((1.6, 0.45, 0.06), (0, 0, 0.45), wood, bev=0.015)]
    for dz, dy in ((0.62, 0.2), (0.78, 0.22)):
        p.append(box((1.6, 0.05, 0.12), (0, dy, dz), wood, bev=0.015))
    for sx in (-0.7, 0.7):
        p.append(box((0.06, 0.45, 0.45), (sx, 0, 0.22), iron))
        p.append(box((0.06, 0.06, 0.45), (sx, 0.22, 0.65), iron))
    done(p, "bench")
