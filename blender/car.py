"""GT race car body (faces -Y, left = +X, ground z = 0)."""
import math
from mathutils import Vector
from lib import (OUT, box, bvh, cone, cut, cyl, decal, extrude_poly, hit, join, line_decal, loft, mat, origin_to,
                 render_preview, reset, rod, smooth, sphere, stick, subsurf, text_mesh, torus, tube, at_origin,
                 bevel, apply_tf, export, solidify)
import bpy
import os

WB = 1.30       # axle distance from centre
TW = 0.80       # wheel centre lateral offset
WR = 0.32       # wheel radius

# L (front +), z bottom, z top (centre line), half width, shoulder height
BODY_T = [
    (-2.27, 0.37, 0.66, 0.60, 0.58),
    (-2.22, 0.29, 0.77, 0.76, 0.67),
    (-2.08, 0.23, 0.83, 0.84, 0.72),
    (-1.80, 0.21, 0.855, 0.86, 0.745),
    (-1.30, 0.21, 0.86, 0.855, 0.75),
    (-0.90, 0.20, 0.86, 0.845, 0.745),
    (-0.30, 0.20, 0.86, 0.84, 0.74),
    (0.30, 0.20, 0.85, 0.84, 0.735),
    (0.90, 0.20, 0.83, 0.845, 0.725),
    (1.30, 0.21, 0.795, 0.85, 0.71),
    (1.70, 0.21, 0.735, 0.83, 0.67),
    (2.00, 0.23, 0.65, 0.77, 0.61),
    (2.20, 0.27, 0.555, 0.67, 0.535),
    (2.31, 0.34, 0.47, 0.55, 0.46),
]

CABIN = [  # L, hw bottom, hw top, z bottom, z top
    (-1.90, 0.79, 0.55, 0.78, 0.87),
    (-1.55, 0.82, 0.61, 0.78, 1.13),
    (-1.00, 0.835, 0.645, 0.78, 1.275),
    (-0.10, 0.835, 0.655, 0.78, 1.305),
    (0.35, 0.825, 0.635, 0.78, 1.25),
    (1.00, 0.80, 0.575, 0.78, 0.83),
]


def interp(table, L, idx):
    if L <= table[0][0]:
        return table[0][idx]
    for a, b in zip(table, table[1:]):
        if a[0] <= L <= b[0]:
            k = (L - a[0]) / (b[0] - a[0])
            k = k * k * (3 - 2 * k) * 0.35 + k * 0.65  # slightly eased
            return a[idx] + (b[idx] - a[idx]) * k
    return table[-1][idx]


def body_params(L):
    zb, zt, hw, zs = (interp(BODY_T, L, i) for i in (1, 2, 3, 4))
    for Lw, amp, zamp in ((WB, 0.062, 0.03), (-WB, 0.078, 0.034)):
        g = math.exp(-((L - Lw) / 0.52) ** 2)
        hw += amp * g
        zs += zamp * g
    zs = min(zs, zt - 0.012)
    return zb, zt, hw, zs


def body_ring(L):
    zb, zt, hw, zs = body_params(L)
    tuck = 0.09
    top_mid = zs + (zt - zs) * 0.55
    half = [
        (0.0, zb), (hw * 0.5, zb), (hw - tuck, zb + 0.004), (hw - tuck * 0.45, zb + 0.05),
        (hw - 0.012, zb + (zs - zb) * 0.45), (hw, zs - 0.085), (hw - 0.004, zs - 0.025),
        (hw - 0.028, zs + min(0.012, (zt - zs) * 0.4)),  # shoulder crease
        (hw - 0.10, top_mid), (hw * 0.62, zt - 0.01), (hw * 0.3, zt - 0.002), (0.0, zt),
    ]
    ring = half + [(-x, z) for x, z in reversed(half[1:-1])]
    return [Vector((x, -L, z)) for x, z in ring]


def squircle_ring(L, hw_b, hw_t, zb, zt, n=28, p=4.5):
    pts = []
    for i in range(n):
        t = 2 * math.pi * i / n
        c, s = math.cos(t), math.sin(t)
        u = math.copysign(abs(c) ** (2 / p), c)
        v = math.copysign(abs(s) ** (2 / p), s)
        k = (v + 1) / 2
        hw = hw_b + (hw_t - hw_b) * k
        pts.append(Vector((u * hw, -L, zb + k * (zt - zb))))
    return pts


STATIONS = [-2.27, -2.245, -2.21, -2.15, -2.06, -1.93, -1.75, -1.55, -1.38, -1.22, -1.05, -0.8, -0.5, -0.2,
            0.1, 0.4, 0.7, 0.95, 1.12, 1.3, 1.48, 1.65, 1.8, 1.95, 2.08, 2.18, 2.25, 2.29, 2.31]


def build_car():
    reset()
    M = dict(
        paint=mat("Paint", "#e63946", rough=0.3, metal=0.1),
        stripe=mat("Stripe", "#ffffff", rough=0.4),
        glass=mat("Glass", "#1d2b44", rough=0.1, metal=0.2),
        trim=mat("Trim", "#15161b", rough=0.7),
        liner=mat("Liner", "#26272d", rough=0.95),
        carbon=mat("Carbon", "#2a2d33", rough=0.35, metal=0.3),
        chrome=mat("Chrome", "#d8dde3", rough=0.12, metal=1.0),
        head=mat("HeadLight", "#fff6d8", rough=0.1, emit=3),
        drl=mat("DrlLight", "#e8f4ff", rough=0.1, emit=4),
        tail=mat("TailLight", "#ff2233", rough=0.2, emit=2.5),
        amber=mat("IndicatorLight", "#ffa200", rough=0.2, emit=1.5),
        lens=mat("LensGlass", "#dfe9f5", rough=0.05),
        grille=mat("Grille", "#0d0d10", rough=0.9),
        mesh=mat("MeshGrille", "#4a4e57", rough=0.4, metal=0.7),
        decal=mat("Decal", "#f4f4f4", rough=0.5),
        ink=mat("Ink", "#111111", rough=0.5),
        line=mat("PanelLine", "#141418", rough=0.9),
        yellow=mat("Badge", "#ffd23f", rough=0.3, metal=0.4),
        heat=mat("HeatTint", "#6b5aa8", rough=0.2, metal=0.9),
        strap=mat("Strap", "#ff3b3b", rough=0.8),
    )
    P = []

    # ------------------------------------------------------------------ body shell
    body = loft([body_ring(L) for L in STATIONS], M["paint"], "shell")
    subsurf(body, 2)
    for L in (WB, -WB):  # wheel arches, lined inside
        bpy.ops.mesh.primitive_cylinder_add(vertices=64, radius=WR + 0.072, depth=3, location=(0, -L, WR + 0.012),
                                            rotation=(0, math.pi / 2, 0))
        cut(body, bpy.context.active_object, M["liner"])
    for sx in (-1, 1):  # headlight pockets
        bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=16, radius=1, location=(sx * 0.56, -2.12, 0.555))
        c = bpy.context.active_object
        c.scale = (0.25, 0.17, 0.085)
        c.rotation_euler = (0.12, 0, sx * 0.34)
        cut(body, c, M["trim"])
        bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=16, radius=1, location=(sx * 0.6, 2.24, 0.665))
        c = bpy.context.active_object
        c.scale = (0.24, 0.12, 0.065)
        c.rotation_euler = (0, 0, -sx * 0.3)
        cut(body, c, M["trim"])
    # lower front intake
    cut(body, box((0.96, 0.4, 0.17), (0, -2.3, 0.335), M["trim"], bev=0.04, seg=3), M["trim"])
    assert len(body.data.vertices) > 1000, "boolean destroyed the body" 
    smooth(body, 32)
    tb = bvh(body)

    # ------------------------------------------------------------------ cabin
    cabin = loft([squircle_ring(L, hb, ht, zb, zt) for L, hb, ht, zb, zt in CABIN], M["paint"], "cabin")
    subsurf(cabin, 2)
    smooth(cabin, 32)
    tc = bvh(cabin)

    def cab_top(L):
        return interp(CABIN, L, 4)

    def window(grid_fn, axis, negative):
        P.append(decal(cabin, grid_fn(0.035), M["trim"], axis=axis, negative=negative, offset=0.004))
        P.append(decal(cabin, grid_fn(0.0), M["glass"], axis=axis, negative=negative, offset=0.008))

    def windshield(g):
        rows = []
        for i in range(14):
            k = i / 13
            z = 0.965 - g + k * (0.245 + 2 * g)
            hw = 0.6 + g - 0.14 * k
            rows.append([Vector((x, -4.0, z)) for x in [(-hw + 2 * hw * j / 16) for j in range(17)]])
        return rows

    def rear_window(g):
        rows = []
        for i in range(12):
            k = i / 11
            z = 0.95 - g + k * (0.19 + 2 * g)
            hw = 0.55 + g - 0.11 * k
            rows.append([Vector((x, 4.0, z)) for x in [(-hw + 2 * hw * j / 16) for j in range(17)]])
        return rows

    window(windshield, "y", False)
    window(rear_window, "y", True)
    for sx in (-1, 1):
        def side(g, L0, L1):
            def grid(gg):
                rows = []
                for i in range(28):
                    L = (L0 - gg) + (L1 - L0 + 2 * gg) * i / 27
                    top = cab_top(L) - 0.14 + gg
                    if L > 0.4:
                        top = min(top, 0.9 + (0.95 - L) * 0.7 + gg)
                    top = max(top, 0.91)
                    rows.append([Vector((sx * 4.0, -L, 0.885 - gg + (top - 0.885 + gg) * j / 8)) for j in range(9)])
                return rows
            return grid
        # one black trim around both windows (the B pillar becomes gloss black), glass split in two
        P.append(decal(cabin, side(0, -1.42, 0.84)(0.03), M["trim"], axis="x", negative=sx > 0, offset=0.004))
        P.append(decal(cabin, side(0, -1.4, -0.55)(0.0), M["glass"], axis="x", negative=sx > 0, offset=0.008))
        P.append(decal(cabin, side(0, -0.4, 0.82)(0.0), M["glass"], axis="x", negative=sx > 0, offset=0.008))

    # ------------------------------------------------------------------ stripes & lines
    for x0, x1 in ((-0.27, -0.15), (0.15, 0.27)):
        for target, L0, L1 in ((body, 1.02, 2.3), (body, -2.24, -1.93), (cabin, -1.45, 0.28)):
            rows = []
            for i in range(31):
                L = L0 + (L1 - L0) * i / 30
                rows.append([Vector((x, -L, 3.0)) for x in (x0, (x0 + x1) / 2, x1)])
            P.append(decal(target, rows, M["stripe"], axis="z", negative=True, offset=0.005))
    for sx in (-1, 1):
        # accent line along the shoulder crease
        pts = [(-L, body_params(L)[3] - 0.04) for L in [i / 10 for i in range(-19, 20)]]
        P.append(line_decal(body, pts, 0.028, M["stripe"], axis="x", negative=sx > 0, sign=sx))
        # door shut lines
        door = [(-0.62, 0.79), (-0.64, 0.56), (-0.61, 0.33), (-0.55, 0.305), (0.45, 0.305), (0.52, 0.33), (0.55, 0.56), (0.54, 0.79)]
        P.append(line_decal(body, door, 0.011, M["line"], axis="x", negative=sx > 0, sign=sx))
        # hood shut lines
        P.append(line_decal(body, [(sx * 0.6, -1.03), (sx * 0.63, -1.5), (sx * 0.6, -1.85), (sx * 0.5, -2.08)], 0.011, M["line"], axis="z"))
    P.append(line_decal(body, [(-0.58, 2.21), (-0.62, 1.95), (0.62, 1.95), (0.58, 2.21)], 0.011, M["line"], axis="z"))

    # ------------------------------------------------------------------ headlights
    for sx in (-1, 1):
        for k, (dx, dz) in enumerate(((0.07, 0.0), (-0.08, 0.0))):
            x = sx * (0.56 + dx)
            loc, nor = hit(tb, (x, -4, 0.56 + dz), (0, 1, 0))
            ring_ = torus(0.048, 0.009, (0, 0, 0), M["chrome"], rot=(math.pi / 2, 0, 0), major=24, minor=6)
            lensd = cyl(0.042, 0.012, (0, 0, 0), M["head"], rot=(math.pi / 2, 0, 0), verts=24)
            P.append(stick(at_origin([ring_, lensd], "proj"), (0, -1, 0), loc, Vector((0, -1, 0)), off=0.012))
        # DRL light guide along the lower edge of the pocket
        pts = []
        for i in range(7):
            t = i / 6
            x = sx * (0.36 + 0.4 * t)
            z = 0.505 + 0.06 * t * t
            loc, nor = hit(tb, (x, -4, z), (0, 1, 0))
            pts.append(loc + Vector((0, -0.01, 0)))
        P.append(tube(pts, 0.011, M["drl"], name="drl"))
        # clear lens cover over the whole pocket
        cover = sphere(1, (sx * 0.56, -2.09, 0.555), M["lens"], scale=(0.235, 0.14, 0.078), seg=32, ring=16,
                       rot=(0.12, 0, sx * 0.34))
        P.append(cover)
        # indicator on the fender
        loc, nor = hit(tb, (sx * 4, -1.95, 0.5), (-sx, 0, 0))
        ind = sphere(0.04, (0, 0, 0), M["amber"], scale=(0.35, 1.3, 0.7))
        P.append(stick(ind, (sx, 0, 0), loc, nor, off=0.0))
        # fog light in the bumper
        loc, nor = hit(tb, (sx * 0.62, -4, 0.3), (0, 1, 0))
        fr = torus(0.045, 0.01, (0, 0, 0), M["chrome"], rot=(math.pi / 2, 0, 0), major=24, minor=6)
        fl = cyl(0.04, 0.02, (0, 0, 0), M["head"], rot=(math.pi / 2, 0, 0))
        P.append(stick(at_origin([fr, fl], "fog"), (0, -1, 0), loc, nor, off=0.006))

    # hexagon mesh in the lower intake
    hexes = []
    for r in range(4):
        for c in range(18):
            x = -0.43 + c * 0.05 + (0.025 if r % 2 else 0)
            if abs(x) > 0.45:
                continue
            hexes.append(torus(0.024, 0.0045, (x, -2.2, 0.27 + r * 0.043), M["mesh"], rot=(math.pi / 2, 0, math.pi / 6),
                               major=6, minor=4, name="hex"))
    P.append(join(hexes, "hexmesh"))
    # front badge
    loc, nor = hit(tb, (0, -4, 0.52), (0, 1, 0))
    badge = cyl(0.06, 0.012, (0, 0, 0), M["yellow"], rot=(math.pi / 2, 0, 0), verts=32, bev=0.004)
    bt = text_mesh("R", 0.07, (0, -0.01, 0), (math.pi / 2, 0, 0), M["ink"], extrude=0.003)
    apply_tf(bt)
    P.append(stick(at_origin([badge, bt], "badge"), (0, -1, 0), loc, nor, off=0.004))

    # ------------------------------------------------------------------ hood details
    for sx in (-1, 1):
        loc, nor = hit(tb, (sx * 0.4, -1.55, 3), (0, 0, -1))
        parts = [box((0.26, 0.3, 0.02), (0, 0, 0), M["grille"], bev=0.008, name="ventframe")]
        for i in range(6):
            parts.append(box((0.24, 0.018, 0.028), (0, -0.12 + i * 0.048, 0.008), M["carbon"], rot=(0.5, 0, 0), name="slat"))
        P.append(stick(at_origin(parts, "hoodvent"), (0, 0, 1), loc, nor, off=0.002))
        loc, nor = hit(tb, (sx * 0.52, -1.98, 3), (0, 0, -1))
        pin = cyl(0.024, 0.012, (0, 0, 0), M["chrome"], verts=16)
        pc = cyl(0.01, 0.016, (0, 0, 0), M["ink"], verts=8)
        P.append(stick(at_origin([pin, pc], "pin"), (0, 0, 1), loc, nor, off=0.004))
    # wipers
    for x in (-0.28, 0.22):
        a, _ = hit(tc, (x - 0.24, -4, 0.95), (0, 1, 0))
        b, _ = hit(tc, (x + 0.2, -4, 1.0), (0, 1, 0))
        P.append(tube([a + Vector((0, -0.015, 0)), b + Vector((0, -0.015, 0))], 0.009, M["trim"], name="wiper"))
    # windshield banner
    loc, nor = hit(tc, (0, -4, 1.19), (0, 1, 0))
    ban = text_mesh("RACING PRO", 0.075, (0, 0, 0), (math.pi / 2, 0, 0), M["decal"], extrude=0.002)
    apply_tf(ban)
    P.append(stick(ban, (0, -1, 0), loc, nor, off=0.012))

    # ------------------------------------------------------------------ sides
    for sx in (-1, 1):
        face = (sx, 0, 0)
        # fender vent behind the front wheel
        loc, nor = hit(tb, (sx * 4, -0.77, 0.52), (-sx, 0, 0))
        parts = [box((0.02, 0.2, 0.15), (0, 0, 0), M["grille"], bev=0.01, name="vframe")]
        for i in range(3):
            parts.append(box((0.03, 0.17, 0.018), (sx * 0.006, 0, -0.045 + i * 0.045), M["carbon"], rot=(0, -sx * 0.5, 0), name="vslat"))
        P.append(stick(at_origin(parts, "fendervent"), face, loc, nor, off=0.004))
        # door handle
        loc, nor = hit(tb, (sx * 4, 0.32, 0.64), (-sx, 0, 0))
        hd = box((0.014, 0.15, 0.028), (0, 0, 0), M["chrome"], bev=0.006)
        P.append(stick(hd, face, loc, nor, off=0.004))
        # number roundel + number
        loc, nor = hit(tb, (sx * 4, 0.0, 0.52), (-sx, 0, 0))
        disc = cyl(0.19, 0.006, (0, 0, 0), M["decal"], rot=(0, math.pi / 2, 0), verts=40)
        ring_ = torus(0.19, 0.008, (0, 0, 0), M["ink"], rot=(0, math.pi / 2, 0), major=40, minor=4)
        num = text_mesh("27", 0.22, (sx * 0.005, 0, 0), (math.pi / 2, 0, sx * math.pi / 2), M["ink"], extrude=0.003)
        apply_tf(num)
        P.append(stick(at_origin([disc, ring_, num], "roundel"), face, loc, nor, off=0.006))
        # sponsor on the rocker
        loc, nor = hit(tb, (sx * 4, 0.02, 0.305), (-sx, 0, 0))
        sp = text_mesh("TURBO  RACING", 0.055, (0, 0, 0), (math.pi / 2, 0, sx * math.pi / 2), M["decal"], extrude=0.002)
        apply_tf(sp)
        P.append(stick(sp, face, loc, nor, off=0.004))
        # side skirt blade
        loc, nor = hit(tb, (sx * 4, 0.0, 0.25), (-sx, 0, 0))
        sk = box((0.06, 1.6, 0.05), (loc.x + sx * 0.02, -0.02, 0.22), M["carbon"], bev=0.015)
        P.append(sk)
        # mirror on a carbon stalk
        base, nor = hit(tb, (sx * 4, -0.66, 0.8), (-sx, 0, 0))
        pod_c = Vector((sx * 1.03, -0.62, 0.97))
        P.append(tube([base, base + Vector((sx * 0.08, 0.02, 0.1)), pod_c + Vector((-sx * 0.05, 0.02, -0.02))], 0.016, M["carbon"], name="stalk"))
        P.append(sphere(0.1, pod_c, M["paint"], scale=(0.9, 0.62, 0.55), name="mirror"))
        P.append(sphere(0.085, pod_c + Vector((0, 0.045, 0)), M["chrome"], scale=(0.9, 0.12, 0.5), name="mirrorglass"))
    # fuel filler on the roof's rear quarter
    loc, nor = hit(tc, (-0.5, 1.2, 3), (0, 0, -1))
    fr = cyl(0.055, 0.012, (0, 0, 0), M["chrome"], verts=24, bev=0.003)
    fc = cyl(0.04, 0.02, (0, 0, 0), M["ink"], verts=24)
    P.append(stick(at_origin([fr, fc], "filler"), (0, 0, 1), loc, nor, off=0.004))
    # roof number and scoop
    loc, nor = hit(tc, (0, 0.55, 3), (0, 0, -1))
    rd = cyl(0.24, 0.006, (0, 0, 0), M["decal"], verts=40)
    rn = text_mesh("27", 0.3, (0, 0, 0.004), (0, 0, math.pi / 2), M["ink"], extrude=0.003)
    apply_tf(rn)
    P.append(stick(at_origin([rd, rn], "roofnum"), (0, 0, 1), loc, nor, off=0.004))
    loc, nor = hit(tc, (0, -0.2, 3), (0, 0, -1))
    sc = box((0.26, 0.3, 0.07), (0, 0, 0.02), M["paint"], bev=0.03)
    sm = box((0.2, 0.04, 0.04), (0, -0.15, 0.025), M["grille"], bev=0.01)
    P.append(stick(at_origin([sc, sm], "scoop"), (0, 0, 1), loc, nor, off=0.0))
    P.append(rod((-0.36, 1.3, 1.1), (-0.37, 1.55, 1.42), 0.007, M["trim"], name="antenna"))

    # ------------------------------------------------------------------ rear
    for sx in (-1, 1):
        # LED bars in the tail light pocket
        for k, z in enumerate((0.645, 0.668, 0.69)):
            pts = []
            for i in range(6):
                x = sx * (0.42 + 0.34 * i / 5)
                loc, nor = hit(tb, (x, 4, z), (0, -1, 0))
                pts.append(loc + Vector((0, 0.008, 0)))
            P.append(tube(pts, 0.0075, M["tail"], name="led"))
        loc, nor = hit(tb, (sx * 0.8, 4, 0.56), (0, -1, 0))
        P.append(stick(box((0.1, 0.02, 0.04), (0, 0, 0), M["amber"], bev=0.008), (0, 1, 0), loc, nor, off=0.004))
        # quad exhaust
        for dx in (0.34, 0.49):
            x = sx * dx
            tip = cyl(0.048, 0.24, (x, 2.2, 0.27), M["chrome"], rot=(math.pi / 2, 0, 0), verts=24)
            ring_ = torus(0.047, 0.006, (x, 2.3, 0.27), M["heat"], rot=(math.pi / 2, 0, 0), major=24, minor=6)
            inner = cyl(0.037, 0.03, (x, 2.31, 0.27), M["grille"], rot=(math.pi / 2, 0, 0), verts=20)
            P += [tip, ring_, inner]
    # rear fog light & plate
    loc, nor = hit(tb, (0, 4, 0.33), (0, -1, 0))
    P.append(stick(box((0.1, 0.02, 0.05), (0, 0, 0), M["tail"], bev=0.01), (0, 1, 0), loc, nor, off=0.004))
    loc, nor = hit(tb, (0, 4, 0.47), (0, -1, 0))
    plate = box((0.5, 0.012, 0.12), (0, 0, 0), M["decal"], bev=0.01)
    ptxt = text_mesh("RC-27", 0.08, (0, 0.008, 0), (math.pi / 2, 0, math.pi), M["ink"], extrude=0.002)
    apply_tf(ptxt)
    P.append(stick(at_origin([plate, ptxt], "plate"), (0, 1, 0), loc, nor, off=0.006))
    # diffuser
    P.append(box((1.5, 0.4, 0.03), (0, 2.02, 0.2), M["carbon"], name="diffuser"))
    for i in range(7):
        x = -0.6 + i * 0.2
        if abs(abs(x) - 0.415) < 0.1:
            continue
        P.append(box((0.015, 0.4, 0.13), (x, 2.05, 0.25), M["carbon"], name="fin"))
    # tow straps
    for y, x, face in ((-2.28, 0.42, -1), (2.24, -0.25, 1)):
        P.append(tube([(x - 0.05, y, 0.3), (x - 0.04, y + face * 0.08, 0.22), (x + 0.04, y + face * 0.08, 0.22), (x + 0.05, y, 0.3)],
                      0.012, M["strap"], name="strap"))
    # underbody
    P.append(box((1.5, 4.1, 0.02), (0, 0, 0.2), M["carbon"], name="floor"))

    body_all = join([body, cabin] + P, "CarBody")
    origin_to(body_all)

    # ------------------------------------------------------------------ splitter (scaled with front downforce in game)
    outline = [(-0.9, -2.08), (0.9, -2.08), (0.93, -2.2), (0.84, -2.36), (0.5, -2.43), (-0.5, -2.43), (-0.84, -2.36), (-0.93, -2.2)]
    sp = [extrude_poly(outline, 0.025, M["carbon"], plane="xy", name="splitter")]
    sp[0].location.z = 0.2
    apply_tf(sp[0])
    for sx in (-1, 1):
        sp.append(box((0.02, 0.26, 0.09), (sx * 0.9, -2.25, 0.25), M["carbon"], bev=0.006, name="fence"))
        sp.append(rod((sx * 0.4, -2.38, 0.21), (sx * 0.38, -2.22, 0.33), 0.01, M["chrome"], name="support"))
        for k in range(2):
            loc, nor = hit(tb, (sx * 4, -2.05, 0.3 + k * 0.08), (-sx, 0, 0))
            cn = box((0.2, 0.1, 0.012), (0, 0, 0), M["carbon"], bev=0.004, rot=(0, sx * 0.25, 0))
            cn.location = loc + Vector((sx * 0.06, -0.05, 0))
            apply_tf(cn)
            sp.append(cn)
    splitter = join(sp, "Splitter")
    origin_to(splitter, (0, -2.2, 0.2))

    # ------------------------------------------------------------------ dual-element rear wing
    def airfoil(chord, x0, x1, y0, z0, aoa, n=18):
        rings = []
        for x in (x0, x0 * 0.35, x1 * 0.35, x1):
            ring = []
            for i in range(n):
                t = 2 * math.pi * i / n
                u = (math.cos(t) + 1) / 2  # 0..1 along chord
                thick = 0.12 * chord * math.sin(t) * (1 - u) ** 0.5 * (1.2 if math.sin(t) > 0 else 0.6)
                camber = 0.06 * chord * math.sin(math.pi * u)
                yy, zz = u * chord, camber + thick
                ca, sa = math.cos(aoa), math.sin(aoa)
                ring.append(Vector((x, y0 + yy * ca, z0 + yy * sa + zz)))
            rings.append(ring)
        o = loft(rings, M["carbon"], "blade")
        subsurf(o, 1)
        smooth(o, 40)
        return o
    wing_parts = [airfoil(0.36, -0.88, 0.88, 1.84, 1.2, 0.08), airfoil(0.2, -0.88, 0.88, 2.16, 1.25, 0.42)]
    plate = [(1.78, 1.08), (2.3, 1.1), (2.4, 1.28), (2.36, 1.42), (2.1, 1.4), (1.84, 1.3), (1.76, 1.18)]
    for sx in (-1, 1):
        ep = extrude_poly(plate, 0.018, M["paint"], plane="yz", name="endplate")
        ep.location.x = sx * 0.9
        apply_tf(ep)
        bevel(ep, 0.006, 2)
        wing_parts.append(ep)
    wing_parts.append(box((1.76, 0.012, 0.03), (0, 2.36, 1.36), M["stripe"], name="gurney"))
    wing = join(wing_parts, "WingBlade")
    origin_to(wing, (0, 2.0, 1.2))
    mounts = []
    for sx in (-1, 1):
        base, _ = hit(tb, (sx * 0.42, 1.95, 3), (0, 0, -1))
        mounts.append(tube([base, base + Vector((0, 0.05, 0.22)), Vector((sx * 0.42, 2.1, 1.33)), Vector((sx * 0.42, 1.98, 1.31)),
                            Vector((sx * 0.42, 1.95, 1.235))], 0.022, M["carbon"], name="swan"))
        mounts.append(box((0.012, 0.12, 0.06), (sx * 0.42, 2.0, 0.86), M["carbon"], bev=0.004, name="foot"))
    wmount = join(mounts, "WingMount")
    origin_to(wmount)

    export(os.path.join(OUT, "car.glb"), [body_all, splitter, wing, wmount])
    render_preview("car.png", target=(0, 0, 0.6), dist=7.2)
    render_preview("car_rear.png", target=(0, 0, 0.6), dist=7.2, azim=145)
    render_preview("car_side.png", target=(0, 0, 0.6), dist=7.5, elev=5, azim=-90)
    render_preview("car_front.png", target=(0, -1.6, 0.5), dist=3.6, elev=12, azim=-20)
