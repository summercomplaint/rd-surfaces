"""
rd-surface: Gray-Scott reaction-diffusion on 3D mesh surfaces.

Usage:
    python main.py input.obj output.stl [options]

Common Gray-Scott presets (--feed / --kill):
    Coral / default : 0.055 / 0.062
    Spots           : 0.035 / 0.065
    Stripes         : 0.060 / 0.062
    Worms           : 0.078 / 0.061
    Maze            : 0.029 / 0.057
    Mitosis         : 0.028 / 0.053
"""

import argparse
import sys
import numpy as np

from mesh_utils import load_mesh, auto_subdivide, compute_cotangent_laplacian
from gray_scott import GrayScottSim, run_gray_scott
from displace import displace_mesh
from preview import show_evolution, show_preview


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def build_parser():
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )

    parser.add_argument("input",  help="Input mesh (OBJ, STL, PLY, GLTF, …)")
    parser.add_argument("output", help="Output mesh file")

    # -- Gray-Scott parameters ----------------------------------------------
    rd = parser.add_argument_group("Gray-Scott parameters")
    rd.add_argument("--Du",    type=float, default=0.16,  metavar="N",
                    help="Diffusion rate of U  (default: 0.16)")
    rd.add_argument("--Dv",    type=float, default=0.08,  metavar="N",
                    help="Diffusion rate of V  (default: 0.08)")
    rd.add_argument("--feed",  type=float, default=0.055, metavar="N",
                    help="Feed rate F           (default: 0.055)")
    rd.add_argument("--kill",  type=float, default=0.062, metavar="N",
                    help="Kill rate k           (default: 0.062)")
    rd.add_argument("--steps", type=int,   default=10000, metavar="N",
                    help="Simulation steps      (default: 10000)")
    rd.add_argument("--dt",    type=float, default=1.0,   metavar="N",
                    help="Time step             (default: 1.0 — reduce if unstable)")
    rd.add_argument("--seed",  type=int,   default=42,    metavar="N",
                    help="Random seed           (default: 42)")

    # -- Displacement -------------------------------------------------------
    disp = parser.add_argument_group("Displacement")
    disp.add_argument(
        "--displacement", type=float, default=None, metavar="N",
        help=(
            "Maximum displacement in mesh units. "
            "Default: 2%% of bounding-box diagonal. "
            "Bright (high-v) areas always stick out."
        ),
    )
    disp.add_argument(
        "--symmetric", action="store_true",
        help=(
            "Symmetric displacement: bright areas raised, dark areas recessed. "
            "Default (off): bright areas raised, dark areas flush with surface."
        ),
    )

    # -- Mesh processing ----------------------------------------------------
    mesh_grp = parser.add_argument_group("Mesh processing")
    mesh_grp.add_argument(
        "--min-faces", type=int, default=20000, metavar="N",
        help="Auto-subdivide until mesh has at least this many faces (default: 20000)",
    )
    mesh_grp.add_argument(
        "--target-edge-length", type=float, default=None, metavar="N",
        help="Target edge length for auto-subdivision (default: bbox_diagonal / 100)",
    )
    mesh_grp.add_argument(
        "--no-subdivide", action="store_true",
        help="Skip auto-subdivision entirely",
    )

    # -- Misc ---------------------------------------------------------------
    parser.add_argument("--preview",     action="store_true",
                        help="Open interactive 3D preview after simulation")
    parser.add_argument("--no-progress", action="store_true",
                        help="Disable progress bar")

    return parser


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    parser = build_parser()
    args = parser.parse_args()

    # 1. Load ----------------------------------------------------------------
    print(f"\n[1/5] Loading  {args.input}")
    mesh = load_mesh(args.input)
    print(f"      {len(mesh.faces):,} faces, {len(mesh.vertices):,} vertices")
    if not mesh.is_watertight:
        print("      Warning: input mesh is not watertight.")

    # 2. Subdivide -----------------------------------------------------------
    if args.no_subdivide:
        print("\n[2/5] Skipping auto-subdivision (--no-subdivide)")
    else:
        print("\n[2/5] Auto-subdividing …")
        mesh = auto_subdivide(
            mesh,
            min_faces=args.min_faces,
            target_edge_length=args.target_edge_length,
        )

    # 3. Laplacian -----------------------------------------------------------
    print("\n[3/5] Computing cotangent Laplacian …")
    L, vertex_areas = compute_cotangent_laplacian(mesh.vertices, mesh.faces)
    print(f"      Matrix: {L.shape[0]:,} × {L.shape[1]:,},  {L.nnz:,} non-zeros")

    edges = mesh.edges_unique
    h_mean = float(np.mean(
        np.linalg.norm(mesh.vertices[edges[:, 0]] - mesh.vertices[edges[:, 1]], axis=1)
    ))
    print(f"      Mean edge length: {h_mean:.5f}  (Du/Dv will be scaled by h²={h_mean**2:.2e})")

    # 4. Reaction-diffusion --------------------------------------------------
    print(f"\n[4/5] Gray-Scott  (F={args.feed}, k={args.kill}, "
          f"Du={args.Du}, Dv={args.Dv}, steps={args.steps}, dt={args.dt})")

    sim = GrayScottSim(
        L, vertex_areas, h_mean,
        Du=args.Du, Dv=args.Dv,
        F=args.feed, k=args.kill,
        dt=args.dt, seed=args.seed,
    )

    if args.preview:
        # Live evolution viewer — user watches and presses Finish when happy
        print("      Opening live preview window …")
        u, v = show_evolution(mesh, sim, max_steps=args.steps)
    else:
        u, v = run_gray_scott(
            L, vertex_areas, h_mean,
            Du=args.Du, Dv=args.Dv,
            F=args.feed, k=args.kill,
            steps=args.steps, dt=args.dt,
            seed=args.seed,
            progress=not args.no_progress,
        )

    # 'v' is the activator concentration → forms the visible pattern
    pattern = v

    # 5. Displace & save -----------------------------------------------------
    if args.displacement is None:
        bbox_diag = float(np.linalg.norm(mesh.bounding_box.extents))
        max_disp = bbox_diag * 0.02
        print(f"\n[5/5] Displacing  (auto: {max_disp:.4f}  =  2% of bbox diagonal {bbox_diag:.4f})")
    else:
        max_disp = args.displacement
        print(f"\n[5/5] Displacing  (max displacement: {max_disp})")

    displaced = displace_mesh(mesh, pattern, max_disp, symmetric=args.symmetric)

    displaced.export(args.output)
    print(f"      Saved → {args.output}")

    if not displaced.is_watertight:
        print("      Warning: output mesh is not watertight — "
              "you may need to repair it before slicing.")

    print("\nDone.")


if __name__ == "__main__":
    main()
