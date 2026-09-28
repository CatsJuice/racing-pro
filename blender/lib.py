"""Shared modelling helpers for the Racing Pro Blender scripts."""
import bpy
import bmesh
import math
import os
import sys
from mathutils import Vector, Quaternion
from mathutils.bvhtree import BVHTree

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, "..", "public", "models"))
PREVIEW_DIR = os.path.join(HERE, "previews")
PREVIEW = "--preview" in sys.argv
os.makedirs(OUT, exist_ok=True)

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


def apply_tf(o):
    activate(o)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)


def smooth(o, angle=40):
    activate(o)
    try:
        bpy.ops.object.shade_smooth_by_angle(angle=math.radians(angle))
    except Exception:
        bpy.ops.object.shade_smooth()


def flat(o):
    activate(o)
    bpy.ops.object.shade_flat()


def bevel(o, w, seg=2, angle=40):
    md = o.modifiers.new("bevel", "BEVEL")
    md.width = w
    md.segments = seg
    md.limit_method = "ANGLE"
    md.angle_limit = math.radians(angle)
    apply_mods(o)


def subsurf(o, lv=2):
    md = o.modifiers.new("sub", "SUBSURF")
    md.levels = lv
    md.render_levels = lv
    apply_mods(o)


def solidify(o, t, offset=-1):
    md = o.modifiers.new("solid", "SOLIDIFY")
    md.thickness = t
    md.offset = offset
    apply_mods(o)


def finish(o, name, m, rot=None, apply_loc=False):
    o.name = name
    if rot is not None:
        o.rotation_euler = rot
    activate(o)
    bpy.ops.object.transform_apply(location=apply_loc, rotation=True, scale=True)
    if m is not None:
        set_mat(o, m)
    return o


def box(size, loc, m, bev=0.0, rot=(0, 0, 0), name="box", seg=2):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    o = bpy.context.active_object
    o.scale = size
    finish(o, name, m, rot)
    if bev:
        bevel(o, bev, seg)
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


def ico(r, loc, m, sub=1, scale=(1, 1, 1), jitter=0.0, name="ico", rng=None):
    import random
    R = rng or random
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=sub, radius=r, location=loc)
    o = bpy.context.active_object
    o.scale = scale
    if jitter:
        for v in o.data.vertices:
            v.co += Vector((R.uniform(-1, 1), R.uniform(-1, 1), R.uniform(-1, 1))) * jitter
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


def tube(points, r, m, name="tube", res=3, caps=True):
    """Smooth bezier tube through points."""
    cu = bpy.data.curves.new(name, "CURVE")
    cu.dimensions = "3D"
    cu.bevel_depth = r
    cu.bevel_resolution = res
    cu.use_fill_caps = caps
    cu.resolution_u = 12
    sp = cu.splines.new("BEZIER")
    sp.bezier_points.add(len(points) - 1)
    for bp, p in zip(sp.bezier_points, points):
        bp.co = p
        bp.handle_left_type = bp.handle_right_type = "AUTO"
    o = bpy.data.objects.new(name, cu)
    bpy.context.collection.objects.link(o)
    activate(o)
    bpy.ops.object.convert(target="MESH")
    o = bpy.context.active_object
    set_mat(o, m)
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


def loft(sections, m, name="loft", cap=True, closed=True):
    """sections: list of rings (list of 3D points) with identical counts."""
    bm = bmesh.new()
    rings = [[bm.verts.new(p) for p in s] for s in sections]
    n = len(sections[0])
    for a, b in zip(rings, rings[1:]):
        for i in range(n if closed else n - 1):
            j = (i + 1) % n
            bm.faces.new((a[i], a[j], b[j], b[i]))
    if cap:
        bm.faces.new(rings[0])
        bm.faces.new(rings[-1][::-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return mesh_obj(name, bm, m)


def revolve(profile, m, segs=32, name="rev", a0=0.0, a1=2 * math.pi, closed_profile=True):
    """profile: loop of (radius, x) points revolved around the X axis (angle from +Z toward +Y)."""
    full = abs(a1 - a0 - 2 * math.pi) < 1e-6
    bm = bmesh.new()
    rings = []
    count = segs if full else segs + 1
    for i in range(count):
        a = a0 + (a1 - a0) * i / segs
        rings.append([bm.verts.new((x, math.sin(a) * r, math.cos(a) * r)) for r, x in profile])
    n = len(profile)
    for i in range(segs):
        A, B = rings[i], rings[(i + 1) % count]
        for j in range(n if closed_profile else n - 1):
            k = (j + 1) % n
            bm.faces.new((A[j], A[k], B[k], B[j]))
    if not full and closed_profile:
        bm.faces.new(rings[0])
        bm.faces.new(rings[-1][::-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    o = mesh_obj(name, bm, m)
    smooth(o, 50)
    return o


def extrude_poly(pts2d, thickness, m, plane="yz", name="poly"):
    """Flat polygon (2D points) extruded along the plane's normal."""
    bm = bmesh.new()
    def v3(a, b, t):
        if plane == "yz":
            return (t, a, b)
        if plane == "xz":
            return (a, t, b)
        return (a, b, t)
    front = [bm.verts.new(v3(a, b, -thickness / 2)) for a, b in pts2d]
    back = [bm.verts.new(v3(a, b, thickness / 2)) for a, b in pts2d]
    bm.faces.new(front)
    bm.faces.new(back[::-1])
    n = len(pts2d)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((front[i], front[j], back[j], back[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return mesh_obj(name, bm, m)


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


def cut(target, cutter, cutter_mat=None):
    """Boolean difference. Faces created by the cutter get `cutter_mat`."""
    if cutter_mat is not None:
        set_mat(cutter, cutter_mat)
    before = len(target.data.vertices)
    backup = target.data.copy()
    for solver in ("EXACT", "MANIFOLD", "FLOAT"):
        md = target.modifiers.new("bool", "BOOLEAN")
        md.operation = "DIFFERENCE"
        md.object = cutter
        try:
            md.solver = solver
        except Exception:
            pass
        if hasattr(md, "use_hole_tolerant"):
            md.use_hole_tolerant = True
        try:
            apply_mods(target)
        except Exception as e:
            print("boolean", solver, "failed:", e)
            target.modifiers.clear()
        if len(target.data.vertices) > before * 0.7:
            break
        print("boolean", solver, "collapsed the mesh, retrying")
        old = target.data
        target.data = backup.copy()
        bpy.data.meshes.remove(old)
    bpy.data.meshes.remove(backup)
    bpy.data.objects.remove(cutter, do_unlink=True)


def text_mesh(s, size, loc, rot, m, extrude=0.004, name="text", align="CENTER"):
    bpy.ops.object.text_add(location=loc, rotation=rot)
    t = bpy.context.active_object
    t.data.body = s
    t.data.size = size
    t.data.extrude = extrude
    t.data.align_x = align
    t.data.align_y = "CENTER"
    activate(t)
    bpy.ops.object.convert(target="MESH")
    o = bpy.context.active_object
    o.name = name
    set_mat(o, m)
    return o


# ---------------------------------------------------------------- surface placement
def bvh(o):
    # built from the raw mesh (objects here always have identity transforms)
    bm = bmesh.new()
    bm.from_mesh(o.data)
    t = BVHTree.FromBMesh(bm)
    bm.free()
    return t


def hit(tree, origin, direction):
    loc, nor, _, _ = tree.ray_cast(Vector(origin), Vector(direction).normalized())
    if loc is None:
        raise RuntimeError(f"ray missed from {origin} dir {direction}")
    if nor.dot(Vector(direction)) > 0:
        nor = -nor
    return loc, nor


def stick(o, face, loc, nor, off=0.004):
    """Object `o` (built at the origin facing `face`) is rotated so `face` matches `nor` and moved to loc."""
    activate(o)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
    q = Vector(face).normalized().rotation_difference(nor)
    o.rotation_mode = "QUATERNION"
    o.rotation_quaternion = q
    o.location = Vector(loc) + Vector(nor) * off
    apply_tf(o)
    return o


def at_origin(objs, name):
    """Join parts built around the origin into one detail object."""
    o = join(objs, name)
    origin_to(o)
    return o


def decal(target, grid, m, axis="z", negative=True, offset=0.006, thick=0.004):
    """grid: rows of 3D points (same length). Shrink-wrapped onto target by projecting along axis."""
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
    try:
        md.wrap_mode = "ABOVE_SURFACE"  # offset along the surface normal, avoids poke-through at grazing angles
    except Exception:
        pass
    if thick:
        so = o.modifiers.new("solid", "SOLIDIFY")
        so.thickness = thick
        so.offset = 0
    apply_mods(o)
    # drop anything the projection missed (still sitting on the far plane)
    bm = bmesh.new()
    bm.from_mesh(o.data)
    far = [v for v in bm.verts if max(abs(v.co.x), abs(v.co.y), abs(v.co.z)) > 2.8]
    if far:
        bmesh.ops.delete(bm, geom=far, context="VERTS")
        bm.to_mesh(o.data)
    bm.free()
    smooth(o, 60)
    return o


def line_decal(target, pts, width, m, axis="x", negative=True, offset=0.005, far=4.0, sign=1):
    """A thin strip following 2D path `pts` on a projection plane, shrink-wrapped onto target.
    For axis x: pts are (y, z) and the strip starts at x = sign*far. For axis z: pts are (x, y)."""
    rows = []
    n = len(pts)
    for i, p in enumerate(pts):
        a = Vector(pts[max(0, i - 1)])
        b = Vector(pts[min(n - 1, i + 1)])
        d = (b - a).normalized()
        perp = Vector((-d.y, d.x)) * width / 2
        pa, pb = Vector(p) - perp, Vector(p) + perp
        if axis == "x":
            rows.append([Vector((sign * far, pa.x, pa.y)), Vector((sign * far, pb.x, pb.y))])
        elif axis == "y":
            rows.append([Vector((pa.x, sign * far, pa.y)), Vector((pb.x, sign * far, pb.y))])
        else:
            rows.append([Vector((pa.x, pa.y, far)), Vector((pb.x, pb.y, far))])
    return decal(target, rows, m, axis=axis, negative=negative, offset=offset, thick=0.002)


def export(path, objs):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    kw = dict(filepath=path, export_format="GLB", use_selection=True, export_apply=True, export_yup=True,
              export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=7)
    try:
        bpy.ops.export_scene.gltf(**kw, export_vertex_color="ACTIVE")
    except TypeError:
        bpy.ops.export_scene.gltf(**kw)
    print("exported", path)


def render_preview(fname, target=(0, 0, 0.6), dist=7.0, elev=22, azim=-40, ortho=None, res=(1100, 700)):
    if not PREVIEW:
        return
    os.makedirs(PREVIEW_DIR, exist_ok=True)
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_WORKBENCH"
    sc.display.shading.light = "STUDIO"
    sc.display.shading.color_type = "MATERIAL"
    sc.display.shading.show_cavity = True
    sc.display.shading.show_object_outline = True
    sc.render.resolution_x, sc.render.resolution_y = res
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
