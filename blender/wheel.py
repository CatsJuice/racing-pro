"""Wheel (spins) + brake caliper (static). Outer face points +X, centre at origin."""
import math
import os
from mathutils import Vector
from lib import (OUT, apply_tf, at_origin, bevel, cyl, export, join, mat, origin_to, render_preview, reset, revolve,
                 rod, sphere, text_mesh, torus, tube)

R = 0.32
W = 0.25


def build_wheel():
    reset()
    rubber = mat("Rubber", "#1f2126", rough=0.95)
    groove = mat("Groove", "#0c0d10", rough=1.0)
    letters = mat("TireText", "#eeeeee", rough=0.6)
    band = mat("TireBand", "#ffd23f", rough=0.6)
    rim = mat("Rim", "#c9ced6", rough=0.18, metal=1.0)
    lip = mat("RimLip", "#eef2f6", rough=0.05, metal=1.0)
    dark = mat("RimDark", "#2d3038", rough=0.5, metal=0.5)
    disc = mat("Disc", "#8a8f98", rough=0.35, metal=1.0)
    hat = mat("DiscHat", "#c89b3c", rough=0.3, metal=0.9)
    hole = mat("DiscHole", "#26282e", rough=0.8)
    cal = mat("Caliper", "#e52d27", rough=0.3)
    nut = mat("Nut", "#f1c40f", rough=0.3, metal=0.8)
    white = mat("CalText", "#ffffff")
    hw = W / 2

    parts = []
    # ---------------------------------------------------------------- tire: rounded shoulders, bulged sidewalls
    side = [(R - 0.07, hw + 0.004), (R - 0.095, hw + 0.006), (0.225, hw - 0.005), (0.212, hw - 0.018)]
    # build a closed loop: tread (+x shoulder -> -x shoulder) then sidewalls
    loop = []
    for i in range(9):
        a = math.pi / 2 * i / 8
        loop.append((R - 0.045 + math.cos(a) * 0.045, hw - 0.045 + math.sin(a) * 0.045))
    loop += side
    loop += [(r, -x) for r, x in reversed(side)]
    for i in range(9):
        a = math.pi / 2 - math.pi / 2 * i / 8
        loop.append((R - 0.045 + math.cos(a) * 0.045, -(hw - 0.045 + math.sin(a) * 0.045)))
    tire = revolve(loop, rubber, segs=64, name="tire")
    parts.append(tire)
    for x in (-0.045, 0.045):
        parts.append(torus(R + 0.0005, 0.007, (x, 0, 0), groove, rot=(0, math.pi / 2, 0), major=64, minor=6, name="groove"))
    parts.append(torus(R - 0.075, 0.006, (hw + 0.004, 0, 0), band, rot=(0, math.pi / 2, 0), major=64, minor=5, name="band"))
    # sidewall lettering around the outer face
    text = "RACING PRO  ·  RACING PRO  ·  "
    for i, ch in enumerate(text):
        if ch == " ":
            continue
        a = 2 * math.pi * i / len(text)
        t = text_mesh(ch, 0.032, (0, 0, 0), (math.pi / 2, 0, math.pi / 2), letters, extrude=0.0015, name="ch")
        apply_tf(t)
        t.rotation_euler = (-a, 0, 0)
        t.location = (hw + 0.007, math.sin(a) * (R - 0.047), math.cos(a) * (R - 0.047))
        apply_tf(t)
        parts.append(t)

    # ---------------------------------------------------------------- rim
    parts.append(revolve([(0.2, -0.105), (0.213, -0.105), (0.213, 0.09), (0.2, 0.09)], dark, segs=48, name="barrel"))
    parts.append(torus(0.214, 0.013, (0.093, 0, 0), lip, rot=(0, math.pi / 2, 0), major=64, minor=8, name="lip"))
    parts.append(cyl(0.2, 0.01, (-0.07, 0, 0), dark, rot=(0, math.pi / 2, 0), verts=48, name="backplate"))
    for i in range(5):
        a = 2 * math.pi * i / 5
        def p(r, x, da=0.0):
            return Vector((x, math.sin(a + da) * r, math.cos(a + da) * r))
        # Y spoke: stem then two branches to the rim
        parts.append(tube([p(0.06, 0.104), p(0.1, 0.1), p(0.13, 0.094)], 0.015, rim, name="stem"))
        for da in (-0.2, 0.2):
            parts.append(tube([p(0.13, 0.094), p(0.165, 0.088, da * 0.6), p(0.2, 0.082, da)], 0.011, rim, name="branch"))
        parts.append(sphere(0.012, p(0.2, 0.084, 0.2), rim, seg=10, ring=6))
        parts.append(sphere(0.012, p(0.2, 0.084, -0.2), rim, seg=10, ring=6))
    parts.append(cyl(0.072, 0.03, (0.1, 0, 0), rim, rot=(0, math.pi / 2, 0), verts=32, bev=0.008, name="hub"))
    parts.append(cyl(0.042, 0.03, (0.122, 0, 0), nut, rot=(0, math.pi / 2, 0), verts=6, bev=0.003, name="centrelock"))
    parts.append(cyl(0.018, 0.02, (0.14, 0, 0), cal, rot=(0, math.pi / 2, 0), verts=16, name="pin"))
    va = math.radians(200)
    parts.append(rod((0.07, math.sin(va) * 0.205, math.cos(va) * 0.205), (0.1, math.sin(va) * 0.19, math.cos(va) * 0.19), 0.005, lip, name="valve"))

    # ---------------------------------------------------------------- drilled, two-piece brake disc
    parts.append(revolve([(0.095, -0.012), (0.18, -0.012), (0.18, 0.012), (0.095, 0.012)], disc, segs=48, name="disc"))
    parts.append(torus(0.18, 0.002, (0, 0, 0), hole, rot=(0, math.pi / 2, 0), major=48, minor=4, name="vent"))
    holes = []
    for ri, r in enumerate((0.12, 0.14, 0.16)):
        for i in range(18):
            a = 2 * math.pi * i / 18 + ri * 0.11
            holes.append(cyl(0.005, 0.006, (0.011, math.sin(a) * r, math.cos(a) * r), hole, rot=(0, math.pi / 2, 0), verts=6, name="hole"))
    parts.append(join(holes, "holes"))
    parts.append(cyl(0.095, 0.05, (0.02, 0, 0), hat, rot=(0, math.pi / 2, 0), verts=32, bev=0.006, name="hat"))
    for i in range(5):
        a = 2 * math.pi * i / 5 + 0.3
        parts.append(cyl(0.008, 0.012, (0.05, math.sin(a) * 0.055, math.cos(a) * 0.055), rim, rot=(0, math.pi / 2, 0), verts=8, name="bolt"))
    wheel = join(parts, "Wheel")
    origin_to(wheel)

    # ---------------------------------------------------------------- monoblock caliper (static)
    c = [revolve([(0.143, -0.032), (0.198, -0.032), (0.198, 0.038), (0.143, 0.038)], cal,
                 segs=16, a0=math.radians(95), a1=math.radians(165), name="caliper")]
    bevel(c[0], 0.008, 2, angle=30)
    mid = math.radians(130)
    lt = text_mesh("RP", 0.03, (0, 0, 0), (math.pi / 2, 0, math.pi / 2), white, extrude=0.0015)
    apply_tf(lt)
    lt.rotation_euler = (-mid, 0, 0)
    lt.location = (0.04, math.sin(mid) * 0.17, math.cos(mid) * 0.17)
    apply_tf(lt)
    c.append(lt)
    na = math.radians(100)
    c.append(cyl(0.005, 0.014, (0.02, math.sin(na) * 0.2, math.cos(na) * 0.2), lip, verts=8, name="bleed"))
    caliper = join(c, "Caliper")
    origin_to(caliper)

    export(os.path.join(OUT, "wheel.glb"), [wheel, caliper])
    render_preview("wheel.png", target=(0, 0, 0), dist=1.35, elev=10, azim=70)
    render_preview("wheel_side.png", target=(0, 0, 0), dist=1.2, elev=5, azim=90)
