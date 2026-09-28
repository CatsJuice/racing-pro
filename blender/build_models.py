"""
Procedural cartoon models for Racing Pro.

Run:  pnpm models           (add `-- --preview` for PNG renders in blender/previews/)

Conventions (Blender space, Z up):
  * the car faces -Y (glTF export converts to three.js +Z forward), left = +X
  * ground is z = 0, every scenery object has its origin at its base centre
  * material names are meaningful to the game: "Paint"/"Stripe" are recoloured,
    "Glass"/"LensGlass" are made translucent, "*Light" materials stay emissive.
"""
import os
import random
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
random.seed(7)

from car import build_car  # noqa: E402
from wheel import build_wheel  # noqa: E402
from scenery import build_scenery  # noqa: E402

only = [a for a in sys.argv if a in ("car", "wheel", "scenery")]
if not only or "car" in only:
    build_car()
if not only or "wheel" in only:
    build_wheel()
if not only or "scenery" in only:
    build_scenery()
print("ALL DONE")
