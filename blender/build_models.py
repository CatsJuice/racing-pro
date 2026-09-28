"""
Procedural cartoon models for Racing Pro.

Run:  pnpm models
      (= Blender --background --factory-startup --python blender/build_models.py)

Outputs GLB files into public/models/.  Pass `-- --preview` to also render PNG
previews into blender/previews/.

Conventions (Blender space, Z up):
  * the car faces -Y  (glTF export converts to three.js +Z forward)
  * ground is z = 0, every scenery object has its origin at its base center
  * material names are meaningful to the game: "Paint" is recoloured with the
    car colour, "Stripe" with the accent colour, "Glass" is made translucent,
    "*Light" materials stay emissive.
"""
import bpy
import bmesh
import math
import os
import random
import sys
from mathutils import Vector, Euler

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, "..", "public", "models"))
PREVIEW_DIR = os.path.join(HERE, "previews")
PREVIEW = "--preview" in sys.argv
os.makedirs(OUT, exist_ok=True)

random.seed(7)

# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------
MATS = {}


def srgb(h):
    h = h.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple((x / 12.92) if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    MATS.clear()


def mat(name, color, rough=0.6, metal=0.0, emit=0.0):
    if name in MATS:
        return MATS[name]
    m = bpy.data.materials.new(name)
    try:
        m.use_nodes = True
    except Exception:
        pass
    b = m.node_tree.nodes.get("Principled BSDF")
    col = srgb(color)
    b.inputs["Base Color"].default_value = (*col, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    if emit:
        b.inputs["Emission Color"].default_value = (*col, 1)
        b.inputs["Emission Strength"].default_value = emit
    m.diffuse_color = (*col, 1)
    MATS[name] = m
    return m


def activate(o):
    bpy.ops.object.select_all(action="DESELECT")
    o.select_set(True)
    bpy.context.view_layer.objects.active = o


def set_mat(o, m):
    o.data.materials.clear()
    o.data.materials.append(m)


def apply_mods(o):
    activate(o)
    for md in list(o.modifiers):
        bpy.ops.object.modifier_apply(modifier=md.name)


def smooth(o, angle=40):
    activate(o)
    try:
        bpy.ops.object.shade_smooth_by_angle(angle=math.radians(angle))
    except Exception:
        bpy.ops.object.shade_smooth()


def flat(o):
    activate(o)
    bpy.ops.object.shade_flat()


def bevel(o, w, seg=2):
    md = o.modifiers.new("bevel", "BEVEL")
    md.width = w
    md.segments = seg
    md.limit_method = "ANGLE"
    apply_mods(o)


def subsurf(o, lv=2):
    md = o.modifiers.new("sub", "SUBSURF")
    md.levels = lv
    md.render_levels = lv
    apply_mods(o)


def finish(o, name, m, rot=None):
    o.name = name
    if rot is not None:
        o.rotation_euler = rot
    activate(o)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    set_mat(o, m)
    return o


def box(size, loc, m, bev=0.0, rot=(0, 0, 0), name="box"):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    o = bpy.context.active_object
    o.scale = size
    finish(o, name, m, rot)
    if bev:
        bevel(o, bev, 2)
    return o


def cyl(r, depth, loc, m, rot=(0, 0, 0), verts=24, bev=0.0, name="cyl", r2=None):
    if r2 is None:
        bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=depth, location=loc)
    else:
        bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r, radius2=r2, depth=depth, location=loc)
    o = bpy.context.active_object
    finish(o, name, m, rot)
    if bev:
        bevel(o, bev, 2)
    smooth(o, 50)
    return o


def cone(r1, r2, depth, loc, m, verts=16, rot=(0, 0, 0), name="cone"):
    return cyl(r1, depth, loc, m, rot=rot, verts=verts, name=name, r2=r2)


def sphere(r, loc, m, scale=(1, 1, 1), seg=24, ring=14, name="sphere", rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=ring, radius=r, location=loc)
    o = bpy.context.active_object
    o.scale = scale
    finish(o, name, m, rot)
    smooth(o, 80)
    return o


def ico(r, loc, m, sub=1, scale=(1, 1, 1), jitter=0.0, name="ico"):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=sub, radius=r, location=loc)
    o = bpy.context.active_object
    o.scale = scale
    if jitter:
        for v in o.data.vertices:
            v.co += Vector((random.uniform(-1, 1), random.uniform(-1, 1), random.uniform(-1, 1))) * jitter
    finish(o, name, m)
    flat(o)
    return o


def torus(R, r, loc, m, rot=(0, 0, 0), major=32, minor=10, name="torus"):
    bpy.ops.mesh.primitive_torus_add(major_radius=R, minor_radius=r, major_segments=major,
                                     minor_segments=minor, location=loc)
    o = bpy.context.active_object
    finish(o, name, m, rot)
    smooth(o, 80)
    return o


def rod(p1, p2, r, m, verts=10, name="rod"):
    p1, p2 = Vector(p1), Vector(p2)
    d = p2 - p1
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=d.length, location=(p1 + p2) / 2)
    o = bpy.context.active_object
    o.rotation_euler = d.to_track_quat("Z", "Y").to_euler()
    finish(o, name, m)
    smooth(o, 60)
    return o


def mesh_obj(name, bm, m):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(o)
    set_mat(o, m)
    return o


def loft(sections, m, name="loft", cap=True):
    """sections: list of rings (list of 3D points) with identical counts."""
    bm = bmesh.new()
    rings = [[bm.verts.new(p) for p in s] for s in sections]
    n = len(sections[0])
    for a, b in zip(rings, rings[1:]):
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new((a[i], a[j], b[j], b[i]))
    if cap:
        bm.faces.new(rings[0])
        bm.faces.new(rings[-1][::-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return mesh_obj(name, bm, m)


def revolve(profile, m, segs=32, name="rev"):
    """profile: closed loop of (radius, x) points, revolved around the X axis."""
    bm = bmesh.new()
    rings = []
    for i in range(segs):
        a = 2 * math.pi * i / segs
        rings.append([bm.verts.new((x, math.sin(a) * r, math.cos(a) * r)) for r, x in profile])
    n = len(profile)
    for i in range(segs):
        A, B = rings[i], rings[(i + 1) % segs]
        for j in range(n):
            k = (j + 1) % n
            bm.faces.new((A[j], A[k], B[k], B[j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    o = mesh_obj(name, bm, m)
    smooth(o, 50)
    return o


def join(objs, name):
    objs = [o for o in objs if o is not None]
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    o = bpy.context.active_object
    o.name = name
    o.data.name = name
    return o


def origin_to(o, p=(0, 0, 0)):
    bpy.context.scene.cursor.location = p
    activate(o)
    bpy.ops.object.origin_set(type="ORIGIN_CURSOR")
    bpy.context.scene.cursor.location = (0, 0, 0)


def cut(target, cutter):
    md = target.modifiers.new("bool", "BOOLEAN")
    md.operation = "DIFFERENCE"
    md.object = cutter
    apply_mods(target)
    bpy.data.objects.remove(cutter, do_unlink=True)


def text_mesh(s, size, loc, rot, m, extrude=0.004, name="text"):
    bpy.ops.object.text_add(location=loc, rotation=rot)
    t = bpy.context.active_object
    t.data.body = s
    t.data.size = size
    t.data.extrude = extrude
    t.data.align_x = "CENTER"
    t.data.align_y = "CENTER"
    activate(t)
    bpy.ops.object.convert(target="MESH")
    o = bpy.context.active_object
    o.name = name
    set_mat(o, m)
    return o


def export(path, objs):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True,
                              export_apply=True, export_yup=True)
    print("exported", path)


def render_preview(fname, target=(0, 0, 0.6), dist=7.0, elev=22, azim=-40, ortho=None):
    if not PREVIEW:
        return
    os.makedirs(PREVIEW_DIR, exist_ok=True)
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_WORKBENCH"
    sc.display.shading.light = "STUDIO"
    sc.display.shading.color_type = "MATERIAL"
    sc.display.shading.show_cavity = True
    sc.display.shading.show_object_outline = True
    sc.render.resolution_x = 960
    sc.render.resolution_y = 640
    cam_data = bpy.data.cameras.new("cam")
    if ortho:
        cam_data.type = "ORTHO"
        cam_data.ortho_scale = ortho
    cam = bpy.data.objects.new("cam", cam_data)
    sc.collection.objects.link(cam)
    t = Vector(target)
    e, a = math.radians(elev), math.radians(azim)
    cam.location = t + Vector((math.cos(e) * math.sin(a), -math.cos(e) * math.cos(a), math.sin(e))) * dist
    cam.rotation_euler = (t - cam.location).to_track_quat("-Z", "Y").to_euler()
    sc.camera = cam
    sc.render.filepath = os.path.join(PREVIEW_DIR, fname)
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam, do_unlink=True)


# --------------------------------------------------------------------------
# car
# --------------------------------------------------------------------------
WB_HALF = 1.30     # front/rear axle distance from centre
TRACK_HALF = 0.80  # wheel centre lateral offset
WHEEL_R = 0.32


def squircle_ring(L, hw_b, hw_t, zb, zt, n=28, p=3.2, x_scale=1.0):
    """Rounded section at length L (front positive). Blender y = -L."""
    pts = []
    for i in range(n):
        t = 2 * math.pi * i / n
        c, s = math.cos(t), math.sin(t)
        u = math.copysign(abs(c) ** (2 / p), c)
        v = math.copysign(abs(s) ** (2 / p), s)
        k = (v + 1) / 2
        hw = hw_b + (hw_t - hw_b) * k
        pts.append(Vector((u * hw * x_scale, -L, zb + k * (zt - zb))))
    return pts


BODY = [  # L, half width bottom, half width top, z bottom, z top
    (-2.20, 0.66, 0.60, 0.33, 0.70),
    (-2.14, 0.84, 0.78, 0.25, 0.80),
    (-1.85, 0.90, 0.85, 0.21, 0.85),
    (-1.30, 0.93, 0.87, 0.20, 0.87),
    (-0.50, 0.91, 0.85, 0.20, 0.87),
    (0.50, 0.90, 0.84, 0.20, 0.86),
    (1.30, 0.92, 0.85, 0.20, 0.82),
    (1.85, 0.88, 0.80, 0.20, 0.72),
    (2.12, 0.78, 0.70, 0.22, 0.58),
    (2.24, 0.62, 0.54, 0.29, 0.47),
]

CABIN = [  # L, hw bottom, hw top, z bottom, z top
    (-1.88, 0.80, 0.56, 0.78, 0.88),
    (-1.50, 0.83, 0.62, 0.78, 1.16),
    (-0.95, 0.84, 0.65, 0.78, 1.28),
    (-0.10, 0.84, 0.66, 0.78, 1.31),
    (0.35, 0.83, 0.64, 0.78, 1.25),
    (0.98, 0.81, 0.58, 0.78, 0.84),
]


def interp(table, L, idx):
    for a, b in zip(table, table[1:]):
        if a[0] <= L <= b[0]:
            k = (L - a[0]) / (b[0] - a[0])
            return a[idx] + (b[idx] - a[idx]) * k
    return table[0][idx] if L < table[0][0] else table[-1][idx]


def decal(target, grid, m, axis="z", negative=True, offset=0.006, thick=0.004):
    """grid: rows of 3D points (all rows same length). Projected onto target along axis."""
    bm = bmesh.new()
    rows = [[bm.verts.new(p) for p in r] for r in grid]
    for a, b in zip(rows, rows[1:]):
        for j in range(len(a) - 1):
            bm.faces.new((a[j], a[j + 1], b[j + 1], b[j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    o = mesh_obj("decal", bm, m)
    md = o.modifiers.new("sw", "SHRINKWRAP")
    md.target = target
    md.wrap_method = "PROJECT"
    setattr(md, "use_project_" + axis, True)
    md.use_negative_direction = negative
    md.use_positive_direction = not negative
    md.offset = offset
    so = o.modifiers.new("solid", "SOLIDIFY")
    so.thickness = thick
    so.offset = 0
    apply_mods(o)
    smooth(o, 60)
    return o


def stripe(target, L0, L1, x0, x1, m, steps=30):
    """Projects a strip down onto `target` (shrinkwrap) to create a conforming decal."""
    bm = bmesh.new()
    rows = []
    for i in range(steps + 1):
        L = L0 + (L1 - L0) * i / steps
        rows.append([bm.verts.new((x, -L, 3.0)) for x in (x0, (x0 + x1) / 2, x1)])
    for a, b in zip(rows, rows[1:]):
        for j in range(2):
            bm.faces.new((a[j], a[j + 1], b[j + 1], b[j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    o = mesh_obj("stripe", bm, m)
    for f in o.data.polygons:
        if f.normal.z < 0:
            f.flip()
    md = o.modifiers.new("sw", "SHRINKWRAP")
    md.target = target
    md.wrap_method = "PROJECT"
    md.use_project_z = True
    md.use_negative_direction = True
    md.use_positive_direction = False
    md.offset = 0.006
    so = o.modifiers.new("solid", "SOLIDIFY")
    so.thickness = 0.004
    apply_mods(o)
    smooth(o, 60)
    return o


def build_car():
    reset()
    paint = mat("Paint", "#e63946", rough=0.35, metal=0.1)
    stripe_m = mat("Stripe", "#ffffff", rough=0.4)
    glass = mat("Glass", "#1d2b44", rough=0.1, metal=0.2)
    black = mat("Trim", "#1a1a1e", rough=0.8)
    carbon = mat("Carbon", "#2a2d33", rough=0.4, metal=0.3)
    chrome = mat("Chrome", "#d8dde3", rough=0.15, metal=1.0)
    head = mat("HeadLight", "#fff6d8", rough=0.1, emit=3)
    tail = mat("TailLight", "#ff2233", rough=0.2, emit=2.5)
    orange = mat("IndicatorLight", "#ffa200", rough=0.2, emit=1.5)
    grille = mat("Grille", "#0d0d10", rough=0.9)
    white = mat("Decal", "#f4f4f4", rough=0.5)
    ink = mat("Ink", "#111111", rough=0.5)
    seat = mat("Seat", "#30343c", rough=0.9)
    helmet = mat("Helmet", "#ffd23f", rough=0.3)
    visor = mat("Visor", "#111a2a", rough=0.05, metal=0.5)

    parts = []

    # --- main body shell, lofted and subdivided
    body = loft([squircle_ring(*s) for s in BODY], paint, "shell")
    subsurf(body, 2)
    # wheel arches
    for L in (WB_HALF, -WB_HALF):
        bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=WHEEL_R + 0.075, depth=3,
                                            location=(0, -L, WHEEL_R + 0.01), rotation=(0, math.pi / 2, 0))
        cut(body, bpy.context.active_object)
    smooth(body, 35)

    # arch flares (half torus of black plastic)
    for L in (WB_HALF, -WB_HALF):
        for sx in (-1, 1):
            t = torus(WHEEL_R + 0.085, 0.035, (sx * 0.9, -L, WHEEL_R + 0.01), black,
                      rot=(0, math.pi / 2, 0), major=40, minor=8, name="flare")
            bm = bmesh.new()
            bm.from_mesh(t.data)
            bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < WHEEL_R - 0.06], context="VERTS")
            bm.to_mesh(t.data)
            bm.free()
            parts.append(t)

    # --- stripes on hood / trunk (before the cabin exists)
    for x0, x1 in ((-0.28, -0.15), (0.15, 0.28)):
        parts.append(stripe(body, 1.02, 2.2, x0, x1, stripe_m))
        parts.append(stripe(body, -2.16, -1.9, x0, x1, stripe_m, steps=8))

    # --- cabin (painted), windows are projected glass decals => pillars stay in body colour
    cabin = loft([squircle_ring(L, hb, ht, zb, zt, n=24, p=4.5) for L, hb, ht, zb, zt in CABIN], paint, "cabin")
    subsurf(cabin, 2)
    smooth(cabin, 35)

    def cab_top(L):
        return interp(CABIN, L, 4)

    # windshield: projected from the front (+L => -Y) toward +Y
    ws = []
    for i in range(7):
        k = i / 6
        z = 0.96 + k * 0.24
        hw = 0.66 - 0.16 * k
        ws.append([Vector((x, -4.0, z)) for x in [(-hw + 2 * hw * j / 8) for j in range(9)]])
    parts.append(decal(cabin, ws, glass, axis="y", negative=False))
    # rear window: projected from behind toward -Y
    rw = []
    for i in range(6):
        k = i / 5
        z = 0.93 + k * 0.22
        hw = 0.6 - 0.12 * k
        rw.append([Vector((x, 4.0, z)) for x in [(-hw + 2 * hw * j / 8) for j in range(9)]])
    parts.append(decal(cabin, rw, glass, axis="y", negative=True))
    # side windows, split by the B pillar
    for sx in (-1, 1):
        for L0, L1 in ((-1.42, -0.52), (-0.36, 0.86)):
            rows = []
            for i in range(13):
                L = L0 + (L1 - L0) * i / 12
                ztop = max(0.9, cab_top(L) - 0.1 - (0.12 if L > 0.5 else 0) * (L - 0.5) / 0.36)
                ztop = min(ztop, cab_top(L) - 0.08)
                rows.append([Vector((sx * 4.0, -L, 0.88 + (ztop - 0.88) * j / 4)) for j in range(5)])
            parts.append(decal(cabin, rows, glass, axis="x", negative=sx > 0))
    for x0, x1 in ((-0.28, -0.15), (0.15, 0.28)):
        parts.append(stripe(cabin, -1.4, 0.3, x0, x1, stripe_m))

    # --- lights
    for sx in (-1, 1):
        parts.append(sphere(0.15, (sx * 0.58, -2.1, 0.58), head, scale=(1.25, 0.55, 0.62), name="headlight",
                            rot=(0, 0, sx * 0.35)))
        parts.append(sphere(0.17, (sx * 0.575, -2.06, 0.58), black, scale=(1.25, 0.5, 0.66), name="housing",
                            rot=(0, 0, sx * 0.35)))
        parts.append(sphere(0.045, (sx * 0.8, -1.97, 0.5), orange, scale=(1, 1.4, 0.8), name="indicator"))
        parts.append(box((0.32, 0.06, 0.1), (sx * 0.58, 2.16, 0.68), tail, bev=0.025, name="taillight"))
        parts.append(box((0.12, 0.05, 0.07), (sx * 0.76, 2.13, 0.68), orange, bev=0.02, name="rearind"))
        # side door handle
        parts.append(box((0.02, 0.16, 0.035), (sx * 0.89, -0.05, 0.72), chrome, bev=0.008, name="handle"))
        # side skirt
        parts.append(box((0.07, 1.7, 0.07), (sx * 0.8, 0.0, 0.26), carbon, bev=0.02, name="skirt"))
        # mirror
        parts.append(rod((sx * 0.82, -0.78, 0.86), (sx * 1.0, -0.72, 0.93), 0.02, black, name="mirrorarm"))
        m1 = sphere(0.1, (sx * 1.03, -0.7, 0.95), paint, scale=(0.9, 0.7, 0.55), name="mirror")
        m2 = box((0.13, 0.02, 0.08), (sx * 1.03, -0.64, 0.95), chrome, name="mirrorglass")
        parts += [m1, m2]
        # number roundel & number on the door
        rx = sx * 0.915
        parts.append(cyl(0.2, 0.01, (rx, 0.05, 0.55), white, rot=(0, math.pi / 2, 0), verts=32, name="roundel"))
        parts.append(text_mesh("27", 0.24, (rx + sx * 0.008, 0.05, 0.55),
                               (math.pi / 2, 0, sx * math.pi / 2), ink, name="number"))
        # exhaust
        parts.append(cyl(0.055, 0.25, (sx * 0.45, 2.2, 0.28), chrome, rot=(math.pi / 2, 0, 0), name="exhaust"))
        parts.append(cyl(0.04, 0.02, (sx * 0.45, 2.33, 0.28), grille, rot=(math.pi / 2, 0, 0), name="exhaust_in"))
        # hood vents
        parts.append(box((0.22, 0.28, 0.04), (sx * 0.5, -1.5, 0.79), grille, bev=0.012, rot=(-0.15, 0, 0), name="vent"))
        # fuel cap
        if sx > 0:
            parts.append(cyl(0.07, 0.02, (0.9, 1.7, 0.72), chrome, rot=(0, math.pi / 2, 0), name="fuel"))
    # rear light bar
    parts.append(box((0.8, 0.03, 0.035), (0, 2.18, 0.68), tail, name="lightbar"))

    # --- grille with slats
    parts.append(box((0.8, 0.08, 0.22), (0, -2.19, 0.34), grille, bev=0.03, name="grille"))
    for i in range(4):
        parts.append(box((0.76, 0.03, 0.018), (0, -2.24, 0.26 + i * 0.055), chrome, name="slat"))
    # rear plate + diffuser
    parts.append(box((0.5, 0.02, 0.13), (0, 2.23, 0.45), white, bev=0.01, name="plate"))
    parts.append(text_mesh("RC-27", 0.08, (0, 2.245, 0.45), (math.pi / 2, 0, math.pi), ink, name="platetext"))
    parts.append(box((1.5, 0.35, 0.05), (0, 2.02, 0.2), carbon, name="diffuser"))
    for i in range(5):
        parts.append(box((0.02, 0.35, 0.12), (-0.5 + i * 0.25, 2.05, 0.24), carbon, name="fin"))
    # hood scoop
    parts.append(box((0.42, 0.5, 0.1), (0, -1.45, 0.81), paint, bev=0.04, rot=(-0.12, 0, 0), name="scoop"))
    parts.append(box((0.32, 0.03, 0.05), (0, -1.71, 0.85), grille, name="scoopmouth"))
    # wipers
    for sx in (-0.3, 0.2):
        parts.append(rod((sx - 0.25, -1.02, 0.86), (sx + 0.2, -0.93, 0.93), 0.012, black, name="wiper"))
    # antenna + tow hook
    parts.append(rod((0.3, 0.8, 1.26), (0.3, 1.05, 1.62), 0.008, black, name="antenna"))
    parts.append(torus(0.06, 0.012, (0.55, -2.22, 0.3), mat("TowHook", "#ff3b3b"), rot=(0, 0, 0), name="tow"))

    body_all = join([body, cabin] + parts, "CarBody")
    origin_to(body_all)

    # --- front splitter (scaled with front downforce in game)
    sp = [box((1.8, 0.3, 0.035), (0, -2.22, 0.21), carbon, bev=0.01, name="splitter")]
    for sx in (-1, 1):
        sp.append(box((0.22, 0.04, 0.08), (sx * 0.72, -2.1, 0.33), carbon, rot=(0, sx * 0.3, sx * 0.4), name="canard"))
        sp.append(box((0.02, 0.28, 0.1), (sx * 0.88, -2.2, 0.25), carbon, name="spend"))
    splitter = join(sp, "Splitter")
    origin_to(splitter, (0, -2.2, 0.2))

    # --- rear wing (blade pivot rotates with rear downforce in game)
    af = []
    for x in (-0.9, -0.3, 0.3, 0.9):
        ring = []
        for i in range(16):
            t = 2 * math.pi * i / 16
            # simple cambered airfoil in y-z plane, chord 0.36
            cy = 0.18 * math.cos(t)
            cz = 0.03 * math.sin(t) * (1 + 0.6 * math.cos(t)) + 0.02 * (1 - (cy / 0.18) ** 2)
            ring.append(Vector((x, 2.0 + cy, 1.2 + cz)))
        af.append(ring)
    blade = loft(af, carbon, "blade")
    subsurf(blade, 1)
    smooth(blade, 40)
    bl = [blade]
    for sx in (-1, 1):
        bl.append(box((0.02, 0.46, 0.24), (sx * 0.91, 2.02, 1.17), paint, bev=0.01, name="endplate"))
    bl.append(box((1.6, 0.06, 0.02), (0, 2.2, 1.24), stripe_m, name="gurney"))
    wing = join(bl, "WingBlade")
    origin_to(wing, (0, 2.0, 1.2))
    mounts = []
    for sx in (-1, 1):
        mounts.append(rod((sx * 0.45, 2.02, 0.84), (sx * 0.45, 2.02, 1.12), 0.03, carbon, name="pylon"))
        mounts.append(rod((sx * 0.45, 2.02, 1.12), (sx * 0.45, 1.96, 1.2), 0.03, carbon, name="pylon2"))
    wmount = join(mounts, "WingMount")
    origin_to(wmount)

    objs = [body_all, splitter, wing, wmount]
    export(os.path.join(OUT, "car.glb"), objs)
    render_preview("car.png", target=(0, 0, 0.6), dist=7.5)
    render_preview("car_rear.png", target=(0, 0, 0.6), dist=7.5, azim=150)


def build_wheel():
    reset()
    rubber = mat("Rubber", "#202226", rough=0.95)
    band = mat("TireBand", "#ffd23f", rough=0.6)
    rim = mat("Rim", "#c9ced6", rough=0.2, metal=1.0)
    dark = mat("RimDark", "#2d3038", rough=0.5, metal=0.5)
    disc = mat("Disc", "#8a8f98", rough=0.35, metal=1.0)
    cal = mat("Caliper", "#e52d27", rough=0.3)
    nut = mat("Nut", "#f1c40f", rough=0.3, metal=0.8)

    R, W = WHEEL_R, 0.25
    parts = []
    # tire: revolved rounded profile (ring, so the rim is visible)
    prof = []
    ri, hw = 0.205, W / 2
    for i in range(7):  # outer shoulder +x
        a = math.pi / 2 * i / 6
        prof.append((R - 0.05 + math.sin(a) * 0.05, hw - 0.05 + math.cos(a) * 0.05))
    for i in range(7):  # outer shoulder -x
        a = math.pi / 2 + math.pi / 2 * i / 6
        prof.append((R - 0.05 + math.sin(a) * 0.05, -hw + 0.05 + math.cos(a) * 0.05))
    prof += [(ri, -hw + 0.02), (ri, hw - 0.02)]
    parts.append(revolve(prof, rubber, segs=48, name="tire"))
    # chunky tread blocks
    n = 30
    for i in range(n):
        a = 2 * math.pi * i / n + (math.pi / n if False else 0)
        for x in (-0.06, 0.06):
            aa = a + (math.pi / n if x > 0 else 0)
            b = box((0.09, 0.05, 0.03), (x, 0, R - 0.008), rubber, bev=0.008, name="tread")
            b.rotation_euler = (-aa, 0, 0)
            b.location = (0, 0, 0)
            activate(b)
            bpy.ops.object.transform_apply(rotation=True, location=False)
            parts.append(b)
    # sidewall colour band on the outer face (+X)
    parts.append(torus(R - 0.055, 0.01, (hw - 0.004, 0, 0), band, rot=(0, math.pi / 2, 0), major=48, minor=6, name="band"))
    # rim barrel (open tube) + back plate
    parts.append(revolve([(0.2, -0.11), (0.212, -0.11), (0.212, 0.1), (0.2, 0.1)], dark, segs=40, name="barrel"))
    parts.append(cyl(0.2, 0.01, (-0.06, 0, 0), dark, rot=(0, math.pi / 2, 0), verts=40, name="backplate"))
    parts.append(torus(0.212, 0.016, (0.1, 0, 0), rim, rot=(0, math.pi / 2, 0), major=40, minor=8, name="lip"))
    # spokes: 6 twin-spokes, concave
    for i in range(6):
        a = 2 * math.pi * i / 6
        for off in (-0.1, 0.1):
            aa = a + off
            p1 = (0.1, math.sin(a) * 0.05, math.cos(a) * 0.05)
            p2 = (0.075, math.sin(aa) * 0.2, math.cos(aa) * 0.2)
            parts.append(rod(p1, p2, 0.017, rim, verts=8, name="spoke"))
    parts.append(cyl(0.065, 0.04, (0.095, 0, 0), rim, rot=(0, math.pi / 2, 0), verts=24, bev=0.01, name="hub"))
    parts.append(cyl(0.03, 0.03, (0.12, 0, 0), cal, rot=(0, math.pi / 2, 0), verts=16, name="cap"))
    for i in range(5):
        a = 2 * math.pi * i / 5
        parts.append(cyl(0.011, 0.03, (0.115, math.sin(a) * 0.045, math.cos(a) * 0.045), nut,
                         rot=(0, math.pi / 2, 0), verts=6, name="nut"))
    # brake disc (rotates with the wheel)
    parts.append(cyl(0.18, 0.025, (0.0, 0, 0), disc, rot=(0, math.pi / 2, 0), verts=40, name="disc"))
    parts.append(cyl(0.08, 0.04, (0.02, 0, 0), dark, rot=(0, math.pi / 2, 0), verts=24, name="bell"))
    wheel = join(parts, "Wheel")
    origin_to(wheel)

    # caliper does not spin: separate object
    c = []
    for k in range(5):
        a = math.radians(100 + k * 12)
        c.append(box((0.05, 0.05, 0.045), (0.03, math.sin(a) * 0.165, math.cos(a) * 0.165), cal, bev=0.012,
                     rot=(-a, 0, 0), name="calseg"))
    c.append(text_mesh("RP", 0.035, (0.057, math.sin(math.radians(124)) * 0.165, math.cos(math.radians(124)) * 0.165),
                       (math.radians(124) * -1 + math.pi / 2, 0, math.pi / 2), mat("CalText", "#ffffff"), name="caltxt"))
    caliper = join(c, "Caliper")
    origin_to(caliper)

    export(os.path.join(OUT, "wheel.glb"), [wheel, caliper])
    render_preview("wheel.png", target=(0, 0, 0), dist=1.4, elev=10, azim=70)


# --------------------------------------------------------------------------
# scenery
# --------------------------------------------------------------------------
def build_scenery():
    reset()
    bark = mat("Bark", "#7a4b2a", rough=0.9)
    leaf1 = mat("Leaf", "#3fa34d", rough=0.9)
    leaf2 = mat("LeafLight", "#6cc24a", rough=0.9)
    leaf3 = mat("LeafDark", "#2b7a3b", rough=0.9)
    rock_m = mat("Rock", "#9aa0a8", rough=1.0)
    orange = mat("ConeOrange", "#ff7a1a", rough=0.6)
    white = mat("White", "#f5f5f5", rough=0.6)
    black = mat("Black", "#1c1c1f", rough=0.8)
    red = mat("Red", "#e63946", rough=0.5)
    blue = mat("Blue", "#2f6fdf", rough=0.5)
    yellow = mat("Yellow", "#ffd23f", rough=0.5)
    grey = mat("Concrete", "#c9c5bd", rough=0.9)
    steel = mat("Steel", "#9aa3ad", rough=0.3, metal=0.8)
    glass = mat("Glass", "#9fd3ff", rough=0.1, metal=0.2)
    lamp = mat("RedLight", "#ff2a2a", rough=0.2, emit=3)
    skin = mat("Skin", "#f2c29b", rough=0.7)
    cloud_m = mat("Cloud", "#ffffff", rough=1.0)
    shirt_cols = ["#e63946", "#2f6fdf", "#ffd23f", "#43aa8b", "#f3722c", "#9b5de5", "#f15bb5", "#ffffff"]
    shirts = [mat("Shirt%d" % i, c) for i, c in enumerate(shirt_cols)]

    out = []

    def place(o, x):
        o.location.x += x
        activate(o)
        bpy.ops.object.transform_apply(location=True)

    # pine tree
    p = [cyl(0.25, 1.4, (0, 0, 0.7), bark, verts=8, name="trunk")]
    for i, (r, z, m) in enumerate(((2.2, 1.9, leaf3), (1.75, 3.2, leaf1), (1.25, 4.4, leaf2))):
        c = cone(r, 0.05, 2.0, (0, 0, z), m, verts=9, name="pinecone")
        c.rotation_euler.z = i * 0.4
        flat(c)
        p.append(c)
    t = join(p, "tree_pine")
    origin_to(t)
    out.append(t)

    # round tree
    p = [cyl(0.28, 2.2, (0, 0, 1.1), bark, verts=8, name="trunk")]
    p.append(rod((0, 0, 1.6), (0.7, 0, 2.4), 0.12, bark, verts=6))
    for (x, y, z, r, m) in ((0, 0, 3.2, 1.6, leaf1), (0.9, 0.3, 2.7, 1.1, leaf2), (-0.8, -0.2, 2.8, 1.2, leaf3),
                            (0.2, -0.6, 3.9, 1.0, leaf2)):
        p.append(ico(r, (x, y, z), m, sub=1, jitter=0.12))
    t = join(p, "tree_round")
    origin_to(t)
    out.append(t)

    # bush
    p = [ico(0.9, (0, 0, 0.6), leaf1, jitter=0.1), ico(0.7, (0.8, 0.2, 0.45), leaf2, jitter=0.1),
         ico(0.65, (-0.7, -0.2, 0.4), leaf3, jitter=0.1)]
    t = join(p, "bush")
    origin_to(t)
    out.append(t)

    # rock
    r = ico(1.0, (0, 0, 0.5), rock_m, sub=2, scale=(1.3, 1.0, 0.8), jitter=0.18, name="rock")
    origin_to(r)
    out.append(r)

    # traffic cone
    p = [box((0.5, 0.5, 0.05), (0, 0, 0.025), orange, bev=0.02),
         cone(0.2, 0.03, 0.7, (0, 0, 0.4), orange, verts=20),
         cone(0.15, 0.1, 0.12, (0, 0, 0.42), white, verts=20)]
    p[-1].scale = (1.02, 1.02, 1)
    t = join(p, "cone")
    origin_to(t)
    out.append(t)

    # tire stack
    p = []
    for i in range(4):
        m = black if i % 2 == 0 else (red if i == 1 else white)
        p.append(torus(0.42, 0.17, (0, 0, 0.17 + i * 0.32), m, major=24, minor=10, name="tire"))
    t = join(p, "tire_stack")
    origin_to(t)
    out.append(t)

    # grandstand (20m wide, faces -Y)
    p = []
    for i in range(6):
        p.append(box((20, 1.2, 0.6 + i * 0.6), (0, i * 1.2, (0.6 + i * 0.6) / 2), grey, name="step"))
        # benches + crowd
        for j in range(24):
            x = -9.4 + j * 0.82
            if random.random() < 0.8:
                sm = random.choice(shirts)
                z0 = 0.6 + i * 0.6
                p.append(box((0.4, 0.3, 0.5), (x, i * 1.2 - 0.1, z0 + 0.25), sm, bev=0.08, name="body"))
                p.append(sphere(0.16, (x, i * 1.2 - 0.12, z0 + 0.65), skin, seg=10, ring=6, name="head"))
                if random.random() < 0.25:  # waving arm
                    p.append(rod((x + 0.2, i * 1.2 - 0.1, z0 + 0.4), (x + 0.35, i * 1.2 - 0.15, z0 + 0.95), 0.05, sm, verts=6))
        p.append(box((20, 0.25, 0.08), (0, i * 1.2 - 0.45, 0.6 + i * 0.6 + 0.04), random.choice([red, blue, yellow]), name="bench"))
    for x in (-10, -3.3, 3.3, 10):
        p.append(rod((x, 6.6, 0), (x, 6.6, 6.5), 0.15, steel))
        p.append(rod((x, -0.6, 0), (x, -0.6, 5.5), 0.1, steel))
    roof = box((21, 8.2, 0.2), (0, 3.0, 6.0), white, name="roof")
    roof.rotation_euler.x = math.radians(-8)
    activate(roof)
    bpy.ops.object.transform_apply(rotation=True)
    p.append(roof)
    for i in range(7):
        p.append(box((3.0, 0.1, 0.8), (-9 + i * 3, -1.05, 5.6), red if i % 2 == 0 else white, name="valance"))
    p.append(box((20, 0.1, 1.0), (0, 6.7, 3.5), blue, name="backwall"))
    t = join(p, "grandstand")
    origin_to(t)
    out.append(t)
    place(t, 0)

    # start / finish gantry: 16m inner width, spans X, road along Y
    p = []
    for sx in (-1, 1):
        p.append(box((0.8, 0.8, 7.0), (sx * 8.4, 0, 3.5), red, bev=0.1, name="pillar"))
        p.append(box((1.2, 1.2, 0.4), (sx * 8.4, 0, 0.2), grey, bev=0.05, name="base"))
    p.append(box((17.6, 1.0, 1.6), (0, 0, 7.3), white, bev=0.1, name="beam"))
    # checkered band
    for i in range(22):
        for j in range(2):
            m = black if (i + j) % 2 == 0 else white
            p.append(box((0.78, 0.04, 0.38), (-8.2 + i * 0.78, -0.52, 6.8 + j * 0.38), m, name="check"))
            p.append(box((0.78, 0.04, 0.38), (-8.2 + i * 0.78, 0.52, 6.8 + j * 0.38), m, name="check"))
    p.append(box((6.0, 0.06, 0.6), (0, -0.53, 7.75), red, name="banner"))
    p.append(text_mesh("RACING PRO", 0.5, (0, -0.57, 7.75), (math.pi / 2, 0, 0), white, name="title"))
    p.append(text_mesh("RACING PRO", 0.5, (0, 0.57, 7.75), (math.pi / 2, 0, math.pi), white, name="title2"))
    # start lights
    p.append(box((3.4, 0.4, 0.7), (0, -0.7, 6.2), black, bev=0.05, name="lightbox"))
    for i in range(5):
        p.append(sphere(0.2, (-1.3 + i * 0.65, -0.92, 6.2), lamp, seg=12, ring=8, name="lamp"))
    t = join(p, "gantry")
    origin_to(t)
    out.append(t)

    # pit building (24m wide, garage doors facing -Y)
    p = [box((24, 10, 5), (0, 5, 2.5), white, bev=0.1, name="building"),
         box((24.6, 10.6, 0.4), (0, 5, 5.2), blue, bev=0.05, name="roofedge")]
    for i in range(5):
        x = -9.6 + i * 4.8
        p.append(box((3.8, 0.1, 3.4), (x, -0.02, 1.7), grey, name="door"))
        for k in range(8):
            p.append(box((3.8, 0.12, 0.05), (x, -0.06, 0.2 + k * 0.42), steel, name="doorline"))
        p.append(box((3.8, 0.12, 0.2), (x, -0.06, 3.6), [red, yellow, blue, red, yellow][i], name="sign"))
    p.append(box((24, 0.1, 0.9), (0, -0.05, 4.4), glass, name="windows"))
    p.append(box((4, 3, 2.4), (6, 5, 6.6), glass, bev=0.1, name="tower"))
    p.append(box((4.4, 3.4, 0.2), (6, 5, 7.9), blue, name="towerroof"))
    t = join(p, "pit_building")
    origin_to(t)
    out.append(t)

    # billboard
    p = [rod((-2.5, 0, 0), (-2.5, 0, 4), 0.12, steel), rod((2.5, 0, 0), (2.5, 0, 4), 0.12, steel),
         box((7, 0.25, 2.6), (0, 0, 4.2), yellow, bev=0.08, name="board"),
         box((6.6, 0.05, 2.2), (0, -0.13, 4.2), blue, name="face"),
         text_mesh("TURBO", 1.1, (0, -0.17, 4.2), (math.pi / 2, 0, 0), yellow, name="adtext")]
    t = join(p, "billboard")
    origin_to(t)
    out.append(t)

    # marquee tent
    p = [box((4, 4, 0.1), (0, 0, 0.05), grey)]
    for sx in (-1, 1):
        for sy in (-1, 1):
            p.append(rod((sx * 1.9, sy * 1.9, 0), (sx * 1.9, sy * 1.9, 2.2), 0.05, steel, verts=6))
    tent = cone(2.9, 0.05, 1.5, (0, 0, 2.95), white, verts=4, name="tentroof")
    tent.rotation_euler.z = math.pi / 4
    activate(tent)
    bpy.ops.object.transform_apply(rotation=True)
    flat(tent)
    p.append(tent)
    for i in range(8):
        a = i * math.pi / 4 + math.pi / 8
        p.append(box((1.3, 0.05, 0.35), (math.cos(a) * 2.02, math.sin(a) * 2.02, 2.1), red if i % 2 else white,
                     rot=(0, 0, a + math.pi / 2), name="flap"))
    t = join(p, "tent")
    origin_to(t)
    out.append(t)

    # cloud
    p = []
    for (x, y, z, r) in ((0, 0, 0, 3), (3, 0.5, -0.5, 2.2), (-3, -0.3, -0.6, 2.3), (1.2, 1, 1.4, 2), (-1.4, -0.5, 1, 1.8)):
        p.append(ico(r, (x, y, z + 3), cloud_m, sub=2, jitter=0.1))
    t = join(p, "cloud")
    origin_to(t)
    out.append(t)

    # hot-air balloon for the sky
    p = [sphere(4.0, (0, 0, 9), red, scale=(1, 1, 1.15), seg=16, ring=12, name="envelope")]
    for i in range(8):
        a = i * math.pi / 4
        s = sphere(4.05, (0, 0, 9), yellow, scale=(0.2, 1, 1.15), seg=16, ring=12, name="gore")
        s.rotation_euler.z = a
        activate(s)
        bpy.ops.object.transform_apply(rotation=True)
        if i % 2 == 0:
            p.append(s)
        else:
            bpy.data.objects.remove(s, do_unlink=True)
    p.append(box((1.6, 1.6, 1.2), (0, 0, 0.6), bark, bev=0.1, name="basket"))
    for sx in (-1, 1):
        for sy in (-1, 1):
            p.append(rod((sx * 0.75, sy * 0.75, 1.2), (sx * 1.6, sy * 1.6, 5.2), 0.03, black, verts=5))
    t = join(p, "balloon")
    origin_to(t)
    out.append(t)

    export(os.path.join(OUT, "scenery.glb"), out)
    if PREVIEW:
        for i, o in enumerate(out):
            o.location.x = (i % 5) * 26 - 52
            o.location.y = (i // 5) * 26
        render_preview("scenery.png", target=(0, 22, 3), dist=150, elev=35, azim=0, ortho=140)


build_car()
build_wheel()
build_scenery()
print("ALL DONE")
