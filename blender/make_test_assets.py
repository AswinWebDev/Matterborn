# Builds synthetic stand-ins shaped like Lux3D outputs, to test pipeline/process.mjs and the
# game's RiggedHero / Colossus loaders before real generations exist. Never shipped.
#
#   Blender -b -P blender/make_test_assets.py -- <out_dir>
#
# Writes: prop.glb (textured static mesh, 2048 px maps), rig.glb (skinned humanoid, no clip),
# Idle_Loop.glb / Jog_Fwd_Loop.glb (full rig + mesh + one clip each, like retarget "separate"
# output), slam.glb (two-part node animation, like an articulation result).

import math
import os
import sys

import bpy
from mathutils import Vector

out = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else "/tmp/matterborn-test"
os.makedirs(out, exist_ok=True)


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def image(name, size, color_a, color_b, kind="checker"):
    img = bpy.data.images.new(name, size, size, alpha=False)
    px = [0.0] * (size * size * 4)
    for y in range(size):
        for x in range(size):
            if kind == "checker":
                c = color_a if ((x // 128) + (y // 128)) % 2 == 0 else color_b
            else:  # flat normal map
                c = (0.5, 0.5, 1.0)
            i = (y * size + x) * 4
            px[i:i + 4] = (c[0], c[1], c[2], 1.0)
    img.pixels.foreach_set(px)
    img.pack()
    return img


def textured_material(name, size=2048):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = image(name + "_base", size, (0.75, 0.45, 0.3), (0.35, 0.22, 0.15))
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    ntex = nt.nodes.new("ShaderNodeTexImage")
    ntex.image = image(name + "_normal", size // 2, None, None, kind="normal")
    ntex.image.colorspace_settings.name = "Non-Color"
    nmap = nt.nodes.new("ShaderNodeNormalMap")
    nt.links.new(ntex.outputs["Color"], nmap.inputs["Color"])
    nt.links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])
    bsdf.inputs["Roughness"].default_value = 0.8
    return mat


def export(path, animations=False):
    kw = dict(filepath=path, export_format="GLB", use_selection=False, export_yup=True, export_skins=True, export_apply=False)
    if animations:
        kw.update(export_animations=True, export_animation_mode="ACTIVE_ACTIONS", export_force_sampling=True)
    else:
        kw.update(export_animations=False)
    bpy.ops.export_scene.gltf(**kw)
    print("wrote", path, os.path.getsize(path), "bytes")


# ---------------------------------------------------------------- static prop
reset()
bpy.ops.mesh.primitive_cube_add(size=1.0)
cube = bpy.context.active_object
cube.name = "Block"
bevel = cube.modifiers.new("bevel", "BEVEL")
bevel.width = 0.06
bevel.segments = 3
sub = cube.modifiers.new("sub", "SUBSURF")
sub.levels = 2
bpy.ops.object.modifier_apply(modifier="bevel")
bpy.ops.object.modifier_apply(modifier="sub")
bpy.ops.object.shade_smooth()
cube.data.materials.append(textured_material("Stone"))
export(os.path.join(out, "prop.glb"))

# ---------------------------------------------------------------- humanoid rig
BONES = [
    # name, head, tail, parent
    ("Hips", (0, 0, 0.9), (0, 0, 1.0), None),
    ("Spine", (0, 0, 1.0), (0, 0, 1.15), "Hips"),
    ("Spine1", (0, 0, 1.15), (0, 0, 1.3), "Spine"),
    ("Neck", (0, 0, 1.3), (0, 0, 1.4), "Spine1"),
    ("Head", (0, 0, 1.4), (0, 0, 1.7), "Neck"),
    ("LeftArm", (0.18, 0, 1.28), (0.45, 0, 1.05), "Spine1"),
    ("LeftForeArm", (0.45, 0, 1.05), (0.65, 0, 0.85), "LeftArm"),
    ("RightArm", (-0.18, 0, 1.28), (-0.45, 0, 1.05), "Spine1"),
    ("RightForeArm", (-0.45, 0, 1.05), (-0.65, 0, 0.85), "RightArm"),
    ("LeftUpLeg", (0.1, 0, 0.9), (0.1, 0, 0.5), "Hips"),
    ("LeftLeg", (0.1, 0, 0.5), (0.1, 0, 0.08), "LeftUpLeg"),
    ("RightUpLeg", (-0.1, 0, 0.9), (-0.1, 0, 0.5), "Hips"),
    ("RightLeg", (-0.1, 0, 0.5), (-0.1, 0, 0.08), "RightUpLeg"),
]


def build_character():
    arm_data = bpy.data.armatures.new("Armature")
    arm = bpy.data.objects.new("Armature", arm_data)
    bpy.context.scene.collection.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    for name, head, tail, parent in BONES:
        b = arm_data.edit_bones.new(name)
        b.head = head
        b.tail = tail
        if parent:
            b.parent = arm_data.edit_bones[parent]
    bpy.ops.object.mode_set(mode="OBJECT")
    parts = []
    mat = textured_material("Clay", 1024)
    for name, head, tail, _ in BONES:
        h, t = Vector(head), Vector(tail)
        mid = (h + t) / 2
        length = (t - h).length
        r = 0.16 if name in ("Head", "Hips", "Spine", "Spine1") else 0.07
        bpy.ops.mesh.primitive_cylinder_add(vertices=12, radius=r, depth=length * 1.05, location=mid)
        part = bpy.context.active_object
        direction = (t - h).normalized()
        part.rotation_mode = "QUATERNION"
        part.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(direction)
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        vg = part.vertex_groups.new(name=name)
        vg.add(list(range(len(part.data.vertices))), 1.0, "REPLACE")
        part.data.materials.append(mat)
        parts.append(part)
    bpy.ops.object.select_all(action="DESELECT")
    for p in parts:
        p.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    body = bpy.context.active_object
    body.name = "Body"
    body.parent = arm
    mod = body.modifiers.new("Armature", "ARMATURE")
    mod.object = arm
    return arm, body


def add_action(arm, name, kind):
    act = bpy.data.actions.new(name)
    arm.animation_data_create()
    arm.animation_data.action = act
    pb = arm.pose.bones
    for b in pb:
        b.rotation_mode = "QUATERNION"
    frames = 24
    for f in range(0, frames + 1, 4):
        t = f / frames * 2 * math.pi
        bob = 0.03 * math.sin(2 * t) if kind == "jog" else 0.01 * math.sin(t)
        pb["Hips"].location = (0, bob, 0)
        pb["Hips"].keyframe_insert("location", frame=f)
        swing = (0.6 if kind == "jog" else 0.08) * math.sin(t)
        for side, sgn in (("Left", 1), ("Right", -1)):
            from mathutils import Euler

            pb[side + "Arm"].rotation_quaternion = Euler((swing * sgn, 0, 0)).to_quaternion()
            pb[side + "Arm"].keyframe_insert("rotation_quaternion", frame=f)
            pb[side + "UpLeg"].rotation_quaternion = Euler((-swing * sgn, 0, 0)).to_quaternion()
            pb[side + "UpLeg"].keyframe_insert("rotation_quaternion", frame=f)
    bpy.context.scene.frame_start = 0
    bpy.context.scene.frame_end = frames
    return act


reset()
arm, body = build_character()
export(os.path.join(out, "rig.glb"))

for clip, kind in (("Idle_Loop", "idle"), ("Jog_Fwd_Loop", "jog")):
    reset()
    arm, body = build_character()
    add_action(arm, "Armature|" + clip, kind)
    export(os.path.join(out, clip + ".glb"), animations=True)

# ---------------------------------------------------------------- articulated two-part model
reset()
bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0, 0, 1.0))
torso = bpy.context.active_object
torso.name = "Torso"
torso.scale = (1.0, 0.6, 1.6)
bpy.ops.object.transform_apply(scale=True)
torso.data.materials.append(textured_material("ClayGiant", 512))
bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0, 0, -0.6))
arm_mesh = bpy.context.active_object
arm_mesh.scale = (0.3, 0.3, 1.2)
bpy.ops.object.transform_apply(scale=True)
pivot = bpy.data.objects.new("ArmR", None)
bpy.context.scene.collection.objects.link(pivot)
pivot.location = (0.75, 0, 1.6)
arm_mesh.parent = pivot
arm_mesh.data.materials.append(torso.data.materials[0])
pivot.animation_data_create()
act = bpy.data.actions.new("slam")
pivot.animation_data.action = act
pivot.rotation_mode = "XYZ"
for f, ang in ((0, 0.0), (12, -2.4), (16, 0.6), (30, 0.0)):
    pivot.rotation_euler = (ang, 0, 0)
    pivot.keyframe_insert("rotation_euler", frame=f)
bpy.context.scene.frame_end = 30
export(os.path.join(out, "slam.glb"), animations=True)
