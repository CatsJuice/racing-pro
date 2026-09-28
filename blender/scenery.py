"""Track-side props. Every object has its origin at its base centre (z = 0); fronts face -Y."""
import math
import os
import random
import bpy
from mathutils import Vector
from lib import (OUT, PREVIEW, activate, apply_tf, bevel, box, cone, cyl, export, extrude_poly, flat, ico, join, mat,
                 origin_to, render_preview, reset, rod, smooth, sphere, subsurf, text_mesh, torus, tube)

R = random.Random(11)


def M():
    return dict(
        bark=mat("Bark", "#7a4b2a", rough=0.9),
        birch=mat("Birch", "#efeae0", rough=0.9),
        leaf=mat("Leaf", "#3fa34d", rough=0.9),
        leaf2=mat("LeafLight", "#7ccc4f", rough=0.9),
        leaf3=mat("LeafDark", "#2b7a3b", rough=0.9),
        leaf4=mat("LeafYellow", "#b7d84a", rough=0.9),
        grass=mat("GrassBlade", "#78c850", rough=0.9),
        grass2=mat("GrassBlade2", "#a6e070", rough=0.9),
        rock=mat("Rock", "#9aa0a8", rough=1.0),
        rock2=mat("RockDark", "#7d838c", rough=1.0),
        orange=mat("ConeOrange", "#ff7a1a", rough=0.6),
        white=mat("White", "#f5f5f5", rough=0.6),
        black=mat("Black", "#1c1c1f", rough=0.8),
        red=mat("Red", "#e63946", rough=0.5),
        blue=mat("Blue", "#2f6fdf", rough=0.5),
        yellow=mat("Yellow", "#ffd23f", rough=0.5),
        green=mat("Green", "#43aa8b", rough=0.5),
        concrete=mat("Concrete", "#c9c5bd", rough=0.9),
        concrete2=mat("ConcreteDark", "#a8a49c", rough=0.9),
        steel=mat("Steel", "#9aa3ad", rough=0.3, metal=0.8),
        glass=mat("Glass", "#9fd3ff", rough=0.1, metal=0.2),
        lamp=mat("RedLight", "#ff2a2a", rough=0.2, emit=3),
        floodlight=mat("FloodLight", "#fff3c4", rough=0.2, emit=2),
        skin=mat("Skin", "#f2c29b", rough=0.7),
        skin2=mat("Skin2", "#c68c5a", rough=0.7),
        hair=mat("Hair", "#3b2a20", rough=0.9),
        cloud=mat("Cloud", "#ffffff", rough=1.0),
        snow=mat("Snow", "#f4f7fb", rough=1.0),
        mountain=mat("Mountain", "#6f9c5c", rough=1.0),
        mountain2=mat("MountainRock", "#8c8f7d", rough=1.0),
        petal_r=mat("PetalRed", "#ff5d73", rough=0.7),
        petal_y=mat("PetalYellow", "#ffe066", rough=0.7),
        petal_w=mat("PetalWhite", "#ffffff", rough=0.7),
        petal_p=mat("PetalPurple", "#b388ff", rough=0.7),
        seat_r=mat("SeatRed", "#e63946", rough=0.6),
        seat_b=mat("SeatBlue", "#2f6fdf", rough=0.6),
        seat_y=mat("SeatYellow", "#ffd23f", rough=0.6),
    )


SHIRTS = ["#e63946", "#2f6fdf", "#ffd23f", "#43aa8b", "#f3722c", "#9b5de5", "#f15bb5", "#ffffff", "#1d3557"]


def shirt(i):
    return mat("Shirt%d" % i, SHIRTS[i])


def person(x, y, z, m, scale=1.0, wave=False, facing=0.0, hat=None):
    """Chunky cartoon spectator standing at (x, y, z), facing -Y rotated by `facing`."""
    s = scale
    parts = [
        box((0.22 * s, 0.16 * s, 0.42 * s), (0, 0, 0.22 * s), mat("Trouser", "#34405a"), bev=0.04 * s),
        box((0.36 * s, 0.24 * s, 0.4 * s), (0, 0, 0.62 * s), shirt(R.randrange(len(SHIRTS))), bev=0.07 * s),
        sphere(0.14 * s, (0, 0, 0.96 * s), m["skin"] if R.random() > 0.3 else m["skin2"], seg=12, ring=8),
        sphere(0.145 * s, (0, 0.02 * s, 1.0 * s), m["hair"], scale=(1, 1, 0.6), seg=12, ring=8),
    ]
    if hat:
        parts.append(cyl(0.16 * s, 0.05 * s, (0, 0, 1.08 * s), hat, verts=12))
        parts.append(box((0.2 * s, 0.14 * s, 0.015 * s), (0, -0.14 * s, 1.06 * s), hat))
    if wave:
        sm = parts[1].data.materials[0]
        parts.append(rod((0.17 * s, 0, 0.75 * s), (0.3 * s, -0.05 * s, 1.15 * s), 0.05 * s, sm, verts=6))
        if R.random() > 0.5:  # waving a little flag
            parts.append(rod((0.3 * s, -0.05 * s, 1.1 * s), (0.32 * s, -0.05 * s, 1.55 * s), 0.01, m["black"], verts=5))
            parts.append(box((0.01, 0.25 * s, 0.16 * s), (0.32 * s, 0.08 * s, 1.47 * s), R.choice([m["red"], m["yellow"], m["blue"]])))
    else:
        for sx in (-1, 1):
            parts.append(rod((sx * 0.19 * s, 0, 0.78 * s), (sx * 0.21 * s, 0, 0.45 * s), 0.05 * s, parts[1].data.materials[0], verts=6))
    o = join(parts, "person")
    o.rotation_euler.z = facing
    o.location = (x, y, z)
    apply_tf(o)
    return o


def jag(o, amount, seed):
    rr = random.Random(seed)
    for v in o.data.vertices:
        v.co += Vector((rr.uniform(-1, 1), rr.uniform(-1, 1), rr.uniform(-0.4, 0.4))) * amount


def build_scenery():
    reset()
    m = M()
    out = []

    def done(parts, name):
        o = join(parts, name)
        origin_to(o)
        out.append(o)
        return o

    # ------------------------------------------------------------------ vegetation
    # pine: 5 jagged tiers
    p = [cone(0.3, 0.18, 1.6, (0, 0, 0.8), m["bark"], verts=8)]
    for i, (r, z, mm) in enumerate(((2.3, 1.7, m["leaf3"]), (1.95, 2.7, m["leaf"]), (1.6, 3.6, m["leaf3"]), (1.2, 4.45, m["leaf"]), (0.75, 5.2, m["leaf2"]))):
        c = cone(r, 0.08, 1.7, (0, 0, z), mm, verts=11)
        c.rotation_euler.z = i * 0.5
        apply_tf(c)
        jag(c, 0.12, i)
        flat(c)
        p.append(c)
    done(p, "tree_pine")

    # tall slim cypress / poplar
    p = [cyl(0.18, 1.2, (0, 0, 0.6), m["bark"], verts=7)]
    for i in range(4):
        e = ico(0.95 - i * 0.12, (0, 0, 1.8 + i * 1.25), m["leaf"] if i % 2 else m["leaf3"], sub=2, scale=(1, 1, 1.5), jitter=0.08, rng=R)
        p.append(e)
    done(p, "tree_poplar")

    # round deciduous tree with branches
    p = [cone(0.34, 0.22, 2.4, (0, 0, 1.2), m["bark"], verts=8)]
    for a, h, l in ((0.3, 1.8, 0.9), (2.4, 2.0, 0.8), (4.3, 1.6, 0.7)):
        p.append(rod((0, 0, h), (math.cos(a) * l, math.sin(a) * l, h + 0.8), 0.1, m["bark"], verts=6))
    for (x, y, z, r, mm) in ((0, 0, 3.4, 1.7, m["leaf"]), (1.0, 0.4, 2.9, 1.2, m["leaf2"]), (-0.9, -0.3, 3.0, 1.25, m["leaf3"]),
                             (0.3, -0.8, 4.1, 1.05, m["leaf2"]), (-0.4, 0.8, 3.9, 1.0, m["leaf"])):
        p.append(ico(r, (x, y, z), mm, sub=2, jitter=0.1, rng=R))
    done(p, "tree_round")

    # birch
    p = [cyl(0.16, 3.6, (0, 0, 1.8), m["birch"], verts=10)]
    for i in range(9):
        z = 0.3 + i * 0.37
        a = R.uniform(0, 6.28)
        p.append(box((0.08, 0.02, 0.05), (math.cos(a) * 0.16, math.sin(a) * 0.16, z), m["black"], rot=(0, 0, a + math.pi / 2)))
    for (x, y, z, r) in ((0, 0, 3.9, 1.1), (0.6, 0.2, 3.4, 0.8), (-0.5, -0.2, 3.5, 0.85), (0.1, 0.3, 4.6, 0.7)):
        p.append(ico(r, (x, y, z), m["leaf4"] if R.random() > 0.5 else m["leaf2"], sub=2, jitter=0.08, rng=R))
    done(p, "tree_birch")

    # bushes
    p = [ico(0.9, (0, 0, 0.6), m["leaf"], sub=2, jitter=0.08, rng=R), ico(0.7, (0.8, 0.2, 0.45), m["leaf2"], sub=2, jitter=0.08, rng=R),
         ico(0.65, (-0.7, -0.2, 0.4), m["leaf3"], sub=2, jitter=0.08, rng=R)]
    done(p, "bush")
    p = [ico(0.8, (0, 0, 0.5), m["leaf3"], sub=2, jitter=0.06, rng=R), ico(0.6, (0.7, 0.1, 0.38), m["leaf"], sub=2, jitter=0.06, rng=R)]
    for i in range(14):
        a = R.uniform(0, 6.28)
        el = R.uniform(0.2, 1.2)
        rr = 0.8 * math.cos(el * 0.6)
        pos = (math.cos(a) * rr * 0.9 + (0.3 if i % 2 else 0), math.sin(a) * rr * 0.9, 0.5 + math.sin(el) * 0.55)
        p.append(ico(0.09, pos, R.choice([m["petal_r"], m["petal_y"], m["petal_w"]]), sub=1))
    done(p, "bush_flower")

    # grass tuft
    p = []
    for i in range(9):
        a = i / 9 * 6.28 + R.uniform(-0.3, 0.3)
        lean = R.uniform(0.15, 0.45)
        h = R.uniform(0.35, 0.6)
        b = cone(0.05, 0.0, h, (0, 0, h / 2), m["grass"] if i % 2 else m["grass2"], verts=3)
        b.rotation_euler = (math.sin(a) * lean, -math.cos(a) * lean, a)
        b.location = (math.cos(a) * 0.08, math.sin(a) * 0.08, 0)
        apply_tf(b)
        p.append(b)
    done(p, "grass_tuft")

    # flower patch
    p = []
    for i in range(7):
        x, y = R.uniform(-0.35, 0.35), R.uniform(-0.35, 0.35)
        h = R.uniform(0.25, 0.45)
        p.append(rod((x, y, 0), (x, y, h), 0.012, m["grass"], verts=4))
        petal = R.choice([m["petal_r"], m["petal_y"], m["petal_w"], m["petal_p"]])
        for k in range(5):
            a = k / 5 * 6.28
            p.append(sphere(0.035, (x + math.cos(a) * 0.04, y + math.sin(a) * 0.04, h), petal, seg=6, ring=4))
        p.append(sphere(0.025, (x, y, h + 0.01), m["petal_y"], seg=6, ring=4))
        p.append(cone(0.04, 0.0, 0.1, (x + 0.03, y, h * 0.4), m["grass2"], verts=3, rot=(0.6, 0, 0)))
    done(p, "flowers")

    # rocks
    r = ico(1.0, (0, 0, 0.45), m["rock"], sub=2, scale=(1.3, 1.0, 0.75), jitter=0.16, rng=R)
    r2 = ico(0.5, (0.9, 0.4, 0.25), m["rock2"], sub=1, jitter=0.1, rng=R)
    done([r, r2], "rock")

    # ------------------------------------------------------------------ track equipment
    # traffic cone with reflective bands
    p = [box((0.5, 0.5, 0.05), (0, 0, 0.025), m["orange"], bev=0.02),
         cone(0.2, 0.03, 0.7, (0, 0, 0.4), m["orange"], verts=24)]
    for z, r0 in ((0.32, 0.158), (0.52, 0.1)):
        p.append(cone(r0 + 0.006, r0 - 0.022, 0.08, (0, 0, z), m["white"], verts=24))
    done(p, "cone")

    # tire stack with bolted cap
    p = []
    for i in range(4):
        mm = m["black"] if i % 2 == 0 else (m["red"] if i == 1 else m["white"])
        p.append(torus(0.42, 0.16, (0, 0, 0.16 + i * 0.3), mm, major=28, minor=10, name="tire"))
        for k in range(10):
            a = k / 10 * 6.28
            p.append(box((0.03, 0.14, 0.02), (math.cos(a) * 0.55, math.sin(a) * 0.55, 0.16 + i * 0.3), m["black"], rot=(0, 1.2, a)))
    p.append(cyl(0.5, 0.04, (0, 0, 1.12), m["concrete2"], verts=20))
    done(p, "tire_stack")

    # catch fence panel: 4 m wide, posts at both ends (spans X)
    p = []
    for x in (-2.0, 2.0):
        p.append(cyl(0.06, 3.2, (x, 0, 1.6), m["steel"], verts=8))
        p.append(rod((x, 0, 3.2), (x, -0.5, 3.6), 0.05, m["steel"], verts=6))
    for z in (0.05, 1.6, 3.15):
        p.append(rod((-2, 0, z), (2, 0, z), 0.03, m["steel"], verts=6))
    for i in range(17):  # diamond mesh
        x = -2 + i * 0.25
        p.append(rod((x, 0, 0.05), (min(2, x + 3.1 * 0.5), 0, min(3.15, 0.05 + 3.1)), 0.008, m["steel"], verts=4))
        p.append(rod((x, 0, 0.05), (max(-2, x - 3.1 * 0.5), 0, min(3.15, 0.05 + 3.1)), 0.008, m["steel"], verts=4))
    done(p, "fence")

    # marshal post: booth, awning, flags, extinguisher
    p = [box((2.2, 1.8, 0.2), (0, 0, 0.1), m["concrete"], bev=0.03),
         box((1.8, 1.4, 1.9), (0, 0.1, 1.15), m["white"], bev=0.05),
         box((1.6, 0.05, 0.7), (0, -0.62, 1.45), m["glass"]),
         box((2.3, 1.9, 0.12), (0, 0.05, 2.18), m["red"], bev=0.03),
         box((2.3, 0.4, 0.06), (0, -1.05, 2.05), m["red"], rot=(0.35, 0, 0)),
         text_mesh("MARSHAL", 0.22, (0, -0.64, 0.75), (math.pi / 2, 0, 0), m["red"], extrude=0.01)]
    p.append(cyl(0.12, 0.5, (0.8, -0.8, 0.45), m["red"], verts=12))
    p.append(cyl(0.05, 0.1, (0.8, -0.8, 0.75), m["black"], verts=8))
    p.append(cyl(0.035, 3.6, (-1.0, -0.8, 1.8), m["steel"], verts=6))
    fl = extrude_poly([(0, 0), (0.7, 0.05), (0.72, -0.45), (0, -0.5)], 0.02, m["yellow"], plane="xz", name="flag")
    fl.location = (-0.98, -0.8, 3.55)
    apply_tf(fl)
    p.append(fl)
    done(p, "marshal_post")

    # floodlight tower
    p = [cyl(0.3, 0.4, (0, 0, 0.2), m["concrete"], verts=12), cone(0.22, 0.12, 14, (0, 0, 7.2), m["steel"], verts=10),
         box((3.0, 0.3, 0.25), (0, 0, 14.0), m["steel"]), box((3.0, 0.3, 0.25), (0, 0, 15.3), m["steel"])]
    for x in (-1.4, 1.4):
        p.append(box((0.12, 0.2, 1.5), (x, 0, 14.65), m["steel"]))
    for r_ in range(2):
        for c in range(4):
            x = -1.05 + c * 0.7
            z = 14.35 + r_ * 0.62
            p.append(box((0.55, 0.3, 0.45), (x, -0.1, z), m["black"], bev=0.04))
            p.append(box((0.45, 0.04, 0.35), (x, -0.27, z), m["floodlight"]))
    for i in range(20):  # ladder rungs
        p.append(box((0.3, 0.03, 0.03), (0, 0.26, 0.8 + i * 0.65), m["steel"]))
    done(p, "light_tower")

    # flag pole
    p = [cyl(0.06, 7, (0, 0, 3.5), m["steel"], verts=8), sphere(0.1, (0, 0, 7.05), m["yellow"], seg=10, ring=6)]
    wave = []
    for i in range(7):
        x = 0.1 + i * 0.28
        wave.append([Vector((x, math.sin(i * 0.9) * 0.12, 6.9)), Vector((x, math.sin(i * 0.9) * 0.12, 5.7))])
    import bmesh
    bm = bmesh.new()
    vs = [[bm.verts.new(v) for v in r_] for r_ in wave]
    for a, b in zip(vs, vs[1:]):
        bm.faces.new((a[0], b[0], b[1], a[1]))
    me = bpy.data.meshes.new("flagcloth")
    bm.to_mesh(me)
    fo = bpy.data.objects.new("flagcloth", me)
    bpy.context.collection.objects.link(fo)
    fo.data.materials.append(m["red"])
    from lib import solidify
    solidify(fo, 0.02)
    smooth(fo, 60)
    p.append(fo)
    done(p, "flag_pole")

    # small crowd of standing spectators (behind fences)
    p = []
    for i in range(6):
        x = -2.2 + i * 0.85 + R.uniform(-0.15, 0.15)
        y = R.uniform(-0.3, 0.3)
        p.append(person(x, y, 0, m, scale=R.uniform(0.9, 1.1), wave=R.random() > 0.55, facing=R.uniform(-0.3, 0.3),
                        hat=R.choice([None, None, m["red"], m["blue"], m["yellow"]])))
    done(p, "crowd")

    # TV camera tower
    p = []
    for sx in (-1, 1):
        for sy in (-1, 1):
            p.append(cyl(0.06, 6, (sx * 1.0, sy * 1.0, 3), m["steel"], verts=6))
    for z in (1.5, 3.0, 4.5):
        for (a, b) in (((-1, -1), (1, -1)), ((1, -1), (1, 1)), ((1, 1), (-1, 1)), ((-1, 1), (-1, -1))):
            p.append(rod((a[0], a[1], z), (b[0], b[1], z), 0.03, m["steel"], verts=5))
            p.append(rod((a[0], a[1], z - 1.5), (b[0], b[1], z), 0.02, m["steel"], verts=4))
    p.append(box((2.6, 2.6, 0.15), (0, 0, 6.05), m["concrete2"]))
    for (a, b) in (((-1.3, -1.3), (1.3, -1.3)), ((1.3, -1.3), (1.3, 1.3)), ((1.3, 1.3), (-1.3, 1.3)), ((-1.3, 1.3), (-1.3, -1.3))):
        p.append(rod((a[0], a[1], 7.0), (b[0], b[1], 7.0), 0.035, m["yellow"], verts=6))
    for (x, y) in ((-1.3, -1.3), (1.3, -1.3), (1.3, 1.3), (-1.3, 1.3)):
        p.append(rod((x, y, 6.1), (x, y, 7.0), 0.03, m["yellow"], verts=6))
    p.append(person(0.3, 0.3, 6.12, m, facing=0.2))
    p.append(box((0.35, 0.6, 0.35), (-0.25, -0.3, 7.25), m["black"], bev=0.04))
    p.append(cyl(0.12, 0.3, (-0.25, -0.7, 7.25), m["black"], rot=(math.pi / 2, 0, 0), verts=12))
    p.append(cyl(0.02, 1.1, (-0.25, -0.3, 6.62), m["steel"], verts=6))
    p.append(box((0.9, 0.6, 0.4), (0, 1.8, 6.45), m["blue"]))
    p.append(text_mesh("TV", 0.3, (0, 1.49, 6.45), (math.pi / 2, 0, 0), m["white"], extrude=0.01))
    done(p, "tv_tower")

    # ------------------------------------------------------------------ buildings
    # grandstand: 22 m wide, faces -Y
    p = []
    rows = 7
    for i in range(rows):
        h = 0.55 + i * 0.55
        p.append(box((22, 1.15, h), (0, i * 1.15, h / 2), m["concrete"] if i % 2 else m["concrete2"], name="step"))
        seatm = [m["seat_r"], m["seat_b"], m["seat_y"]][(i // 2) % 3]
        for j in range(26):
            x = -10.4 + j * 0.8
            if abs(x) < 0.5 or abs(abs(x) - 7) < 0.45:
                continue  # aisles
            z0 = h
            p.append(box((0.5, 0.35, 0.12), (x, i * 1.15 - 0.2, z0 + 0.3), seatm, bev=0.03))
            p.append(box((0.5, 0.08, 0.35), (x, i * 1.15 + 0.02, z0 + 0.5), seatm, bev=0.03))
            if R.random() < 0.72:
                p.append(person(x, i * 1.15 - 0.2, z0 + 0.05, m, scale=0.85, wave=R.random() < 0.25, facing=R.uniform(-0.25, 0.25),
                                hat=R.choice([None, None, None, m["red"], m["yellow"]])))
    for ax in (-7, 0, 7):  # aisle rails
        p.append(tube([(ax, -0.4, 1.3), (ax, rows * 1.15 - 0.6, rows * 0.55 + 1.0)], 0.04, m["steel"]))
    # side walls
    for sx in (-1, 1):
        p.append(extrude_poly([(-0.6, 0), (rows * 1.15, 0), (rows * 1.15, rows * 0.55 + 0.3), (-0.6, 0.55)], 0.3, m["white"], plane="yz", name="wall"))
        p[-1].location.x = sx * 11.1
        apply_tf(p[-1])
    # roof: columns, truss and sheet
    back = rows * 1.15
    top = rows * 0.55 + 4.2
    for x in (-10.5, -3.5, 3.5, 10.5):
        p.append(cyl(0.18, top, (x, back, top / 2), m["steel"], verts=10))
        p.append(tube([(x, back, top), (x, back / 2, top + 0.4), (x, -1.2, top + 0.1)], 0.12, m["steel"]))
        p.append(rod((x, back, top - 2.2), (x, back / 2, top + 0.35), 0.06, m["steel"], verts=6))
    roof = box((23, back + 2.2, 0.18), (0, back / 2 - 0.4, top + 0.45), m["white"], bev=0.05)
    roof.rotation_euler.x = math.radians(-3)
    apply_tf(roof)
    p.append(roof)
    for i in range(8):
        p.append(box((2.85, 0.1, 0.7), (-10 + i * 2.86, -1.35, top), m["red"] if i % 2 == 0 else m["white"], name="valance"))
    for x in (-10.5, -3.5, 3.5, 10.5):  # flags on the roof
        p.append(cyl(0.04, 2.2, (x, back / 2, top + 1.6), m["steel"], verts=6))
        fl = extrude_poly([(0, 0), (1.0, 0.1), (1.0, -0.5), (0, -0.6)], 0.03, R.choice([m["red"], m["yellow"], m["blue"], m["green"]]), plane="xz")
        fl.location = (x + 0.04, back / 2, top + 2.6)
        apply_tf(fl)
        p.append(fl)
    # advertising boards along the front
    for i in range(6):
        col = [m["yellow"], m["blue"], m["red"]][i % 3]
        x = -9.2 + i * 3.7
        p.append(box((3.5, 0.15, 0.9), (x, -1.0, 0.45), col, bev=0.03))
        p.append(text_mesh(["TURBO", "RACING", "PRO", "GRIP", "SPEED", "NITRO"][i], 0.42, (x, -1.09, 0.45), (math.pi / 2, 0, 0),
                           m["white"] if col is not m["yellow"] else m["black"], extrude=0.01))
    done(p, "grandstand")

    # start / finish gantry: 16 m inner width, spans X, road along Y
    p = []
    for sx in (-1, 1):
        p.append(box((0.9, 0.9, 7.2), (sx * 8.45, 0, 3.6), m["red"], bev=0.12))
        p.append(box((1.3, 1.3, 0.4), (sx * 8.45, 0, 0.2), m["concrete"], bev=0.05))
        for z in (1.5, 3.0, 4.5):
            p.append(box((0.95, 0.95, 0.12), (sx * 8.45, 0, z), m["white"]))
    # truss beam
    for dy in (-0.45, 0.45):
        for dz in (6.9, 7.9):
            p.append(rod((-8.5, dy, dz), (8.5, dy, dz), 0.07, m["steel"], verts=8))
    for i in range(18):
        x = -8.5 + i * 1.0
        for dy in (-0.45, 0.45):
            p.append(rod((x, dy, 6.9), (x + 1, dy, 7.9), 0.035, m["steel"], verts=5))
        p.append(rod((x, -0.45, 6.9), (x, 0.45, 6.9), 0.03, m["steel"], verts=5))
    # checkered banner on both sides
    for i in range(22):
        for j in range(2):
            mm = m["black"] if (i + j) % 2 == 0 else m["white"]
            for dy in (-0.52, 0.52):
                p.append(box((0.77, 0.03, 0.35), (-8.1 + i * 0.77, dy, 8.35 + j * 0.35), mm))
    for dy, rz in ((-0.56, 0), (0.56, math.pi)):
        p.append(box((6.4, 0.05, 0.7), (0, dy, 9.25), m["red"], bev=0.02))
        p.append(text_mesh("RACING PRO", 0.55, (0, dy * 1.04, 9.25), (math.pi / 2, 0, rz), m["white"], extrude=0.01))
    # start lights and LED timer
    p.append(box((3.6, 0.45, 0.8), (0, -0.8, 6.3), m["black"], bev=0.06))
    for i in range(5):
        p.append(sphere(0.21, (-1.4 + i * 0.7, -1.05, 6.3), m["lamp"], seg=14, ring=8))
        p.append(cyl(0.26, 0.06, (-1.4 + i * 0.7, -1.02, 6.3), m["steel"], rot=(math.pi / 2, 0, 0), verts=16))
    p.append(box((2.6, 0.2, 0.7), (4.8, -0.6, 6.3), m["black"], bev=0.04))
    p.append(text_mesh("0:00.000", 0.4, (4.8, -0.72, 6.3), (math.pi / 2, 0, 0), m["floodlight"], extrude=0.01))
    done(p, "gantry")

    # pit building (24 m wide, garages face -Y)
    p = [box((24, 10, 5), (0, 5, 2.5), m["white"], bev=0.1), box((24.6, 10.6, 0.35), (0, 5, 5.15), m["blue"], bev=0.05)]
    for i in range(5):
        x = -9.6 + i * 4.8
        p.append(box((3.9, 0.1, 3.5), (x, -0.02, 1.75), m["concrete2"], name="door"))
        for k in range(10):
            p.append(box((3.9, 0.12, 0.04), (x, -0.07, 0.2 + k * 0.34), m["steel"], name="doorline"))
        p.append(box((4.1, 0.2, 0.2), (x, -0.08, 3.6), [m["red"], m["yellow"], m["blue"], m["green"], m["red"]][i], name="sign"))
        p.append(text_mesh(str(i + 1), 0.45, (x + 1.55, -0.2, 3.1), (math.pi / 2, 0, 0), m["black"], extrude=0.02))
    p.append(box((24, 0.1, 0.9), (0, -0.06, 4.35), m["glass"], name="windows"))
    for i in range(13):
        p.append(box((0.08, 0.14, 0.9), (-12 + i * 2, -0.1, 4.35), m["steel"]))
    # rooftop control tower, railing, AC units, antenna, big sign
    p += [box((5, 3.4, 2.6), (6, 5, 6.6), m["glass"], bev=0.08), box((5.4, 3.8, 0.25), (6, 5, 8.0), m["blue"], bev=0.04)]
    for i in range(6):
        p.append(box((0.08, 3.45, 2.6), (3.6 + i * 0.95, 5, 6.6), m["white"]))
    for x in (-11.8, 11.8):
        p.append(rod((x, 0.2, 5.9), (x, 9.8, 5.9), 0.04, m["steel"], verts=6))
    p.append(rod((-11.8, 0.2, 5.9), (11.8, 0.2, 5.9), 0.04, m["steel"], verts=6))
    for i in range(25):
        p.append(rod((-12 + i, 0.2, 5.3), (-12 + i, 0.2, 5.9), 0.025, m["steel"], verts=5))
    for x in (-7, -4.5):
        p.append(box((1.6, 1.2, 0.9), (x, 6, 5.75), m["concrete2"], bev=0.05))
        p.append(cyl(0.45, 0.06, (x, 6, 6.22), m["black"], verts=16))
    p.append(rod((8.2, 6, 8.1), (8.2, 6, 10.5), 0.04, m["steel"], verts=6))
    p.append(box((6, 0.3, 1.2), (-5, 1.0, 6.3), m["red"], bev=0.06))
    p.append(text_mesh("PIT LANE", 0.75, (-5, 0.82, 6.3), (math.pi / 2, 0, 0), m["white"], extrude=0.02))
    done(p, "pit_building")

    # billboard with lights and bracing
    p = [rod((-2.5, 0, 0), (-2.5, 0, 4), 0.14, m["steel"]), rod((2.5, 0, 0), (2.5, 0, 4), 0.14, m["steel"]),
         rod((-2.5, 0, 0.4), (2.5, 0, 2.4), 0.05, m["steel"], verts=6), rod((2.5, 0, 0.4), (-2.5, 0, 2.4), 0.05, m["steel"], verts=6),
         box((7.2, 0.3, 2.8), (0, 0, 4.3), m["yellow"], bev=0.1),
         box((6.7, 0.05, 2.3), (0, -0.16, 4.3), m["blue"]),
         text_mesh("TURBO", 1.2, (0, -0.2, 4.35), (math.pi / 2, 0, 0), m["yellow"], extrude=0.03),
         box((7.0, 0.8, 0.08), (0, -0.4, 2.9), m["steel"])]
    for x in (-2.4, 0, 2.4):
        p.append(rod((x, -0.1, 5.7), (x, -0.6, 6.0), 0.03, m["steel"], verts=6))
        p.append(cone(0.14, 0.2, 0.25, (x, -0.65, 6.0), m["black"], verts=12, rot=(1.9, 0, 0)))
    done(p, "billboard")

    # marquee tent with table
    p = [box((4, 4, 0.1), (0, 0, 0.05), m["concrete"])]
    for sx in (-1, 1):
        for sy in (-1, 1):
            p.append(rod((sx * 1.9, sy * 1.9, 0), (sx * 1.9, sy * 1.9, 2.2), 0.05, m["steel"], verts=6))
    tent = cone(2.9, 0.05, 1.5, (0, 0, 2.95), m["white"], verts=4, name="tentroof")
    tent.rotation_euler.z = math.pi / 4
    apply_tf(tent)
    flat(tent)
    p.append(tent)
    for i in range(8):
        a = i * math.pi / 4 + math.pi / 8
        p.append(box((1.3, 0.05, 0.35), (math.cos(a) * 2.02, math.sin(a) * 2.02, 2.1), m["red"] if i % 2 else m["white"], rot=(0, 0, a + math.pi / 2)))
    p.append(box((1.8, 0.8, 0.06), (0, 0, 0.85), m["white"]))
    for sx in (-1, 1):
        for sy in (-1, 1):
            p.append(rod((sx * 0.8, sy * 0.35, 0.1), (sx * 0.8, sy * 0.35, 0.82), 0.025, m["steel"], verts=5))
    p.append(cyl(0.15, 0.35, (0.5, 0, 1.05), m["red"], verts=12))
    p.append(person(-0.4, 0.8, 0.1, m, facing=math.pi))
    done(p, "tent")

    # ------------------------------------------------------------------ sky & horizon
    p = []
    for (x, y, z, r) in ((0, 0, 0, 3), (3, 0.5, -0.5, 2.2), (-3, -0.3, -0.6, 2.3), (1.2, 1, 1.4, 2), (-1.4, -0.5, 1, 1.8), (4.8, 0, -1, 1.5)):
        s = sphere(r, (x, y, z + 3), m["cloud"], seg=20, ring=12)
        p.append(s)
    done(p, "cloud")

    p = [sphere(4.0, (0, 0, 9), m["red"], scale=(1, 1, 1.15), seg=24, ring=16, name="envelope")]
    for i in range(0, 12, 2):
        s = sphere(4.04, (0, 0, 9), m["yellow"], scale=(0.13, 1, 1.15), seg=24, ring=16, name="gore")
        s.rotation_euler.z = i * math.pi / 12
        apply_tf(s)
        p.append(s)
    p.append(cone(1.2, 0.5, 1.4, (0, 0, 4.4), m["red"], verts=16))
    p.append(box((1.6, 1.6, 1.2), (0, 0, 0.6), m["bark"], bev=0.12, name="basket"))
    p.append(torus(0.8, 0.07, (0, 0, 1.2), m["bark"], major=4, minor=6))
    for sx in (-1, 1):
        for sy in (-1, 1):
            p.append(rod((sx * 0.75, sy * 0.75, 1.2), (sx * 0.9, sy * 0.9, 4.0), 0.03, m["black"], verts=5))
    done(p, "balloon")

    for k, (w, h, mm) in enumerate(((140, 60, m["mountain"]), (180, 90, m["mountain2"]))):
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=3, radius=1, location=(0, 0, 0))
        mo = bpy.context.active_object
        rr = random.Random(40 + k)
        for v in mo.data.vertices:
            if v.co.z < 0:
                v.co.z = 0
            v.co += Vector((rr.uniform(-1, 1), rr.uniform(-1, 1), rr.uniform(-1, 1))) * 0.08 * max(0, v.co.z)
        mo.scale = (w, w * 0.7, h)
        apply_tf(mo)
        mo.data.materials.append(mm)
        # snow cap on the tall one, grass tint on lower faces
        if k == 1:
            mo.data.materials.append(m["snow"])
            mo.data.materials.append(m["mountain"])
            for f in mo.data.polygons:
                z = f.center.z
                f.material_index = 1 if z > h * 0.72 else (2 if z < h * 0.25 else 0)
        flat(mo)
        mo.name = "mountain" if k == 0 else "mountain_snow"
        origin_to(mo)
        out.append(mo)

    from foliage import build_ground_cover, build_props, build_trees
    build_trees(out, done)
    build_ground_cover(done)
    build_props(done)

    export(os.path.join(OUT, "scenery.glb"), out)
    if PREVIEW:
        big = {"mountain", "mountain_snow", "cloud", "balloon"}
        items = [o for o in out if o.name not in big]
        for o in out:
            o.hide_render = o.name in big
        for i, o in enumerate(items):
            o.location.x = (i % 6) * 28 - 70
            o.location.y = (i // 6) * 28
        render_preview("scenery.png", target=(0, 28, 3), dist=160, elev=30, azim=0, ortho=150)
        for i, o in enumerate(items):
            o.hide_render = o.name not in ("grandstand",)
        for o in out:
            if o.name == "grandstand":
                o.location = (0, 0, 0)
        render_preview("grandstand.png", target=(0, 3, 3), dist=30, elev=18, azim=-25)
        showcase = ["tree_orange", "tree_pink", "tree_yellow", "tree_green", "tree_red", "tree_pine2", "bush_pink", "grass_clump", "grass_tall", "lantern", "street_lamp", "basalt"]
        for o in out:
            o.hide_render = o.name not in showcase
            if o.name in showcase:
                i = showcase.index(o.name)
                o.location = ((i % 6) * 5 - 12.5, (i // 6) * 7, 0)
        render_preview("foliage.png", target=(0, 3.5, 2.5), dist=32, elev=15, azim=0)
