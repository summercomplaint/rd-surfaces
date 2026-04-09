"""
inspect_mesh.py  --  visualise a mesh and its geometric properties.

Usage:
    python inspect_mesh.py input.obj [options]

Shows the mesh colored by several diagnostic quantities so you can spot
problems before running the simulation:

  vertex_area       -- should be fairly uniform; huge outliers = bad triangles
  edge_length_mean  -- per-vertex mean of adjacent edge lengths
  cotangent_min     -- minimum cotangent weight around each vertex;
                       negative = obtuse triangle (can destabilise diffusion)
  laplacian_diag    -- diagonal of the cotangent Laplacian; very large
                       negative values = tiny, badly-shaped triangles
"""

import argparse
import sys
import numpy as np

from mesh_utils import load_mesh, auto_subdivide, compute_cotangent_laplacian


def per_vertex_mean_edge_length(vertices, faces):
    """Mean length of edges adjacent to each vertex."""
    n = len(vertices)
    totals = np.zeros(n)
    counts = np.zeros(n, dtype=int)
    for i, j in [(0, 1), (1, 2), (0, 2)]:
        lengths = np.linalg.norm(vertices[faces[:, i]] - vertices[faces[:, j]], axis=1)
        np.add.at(totals, faces[:, i], lengths)
        np.add.at(totals, faces[:, j], lengths)
        np.add.at(counts, faces[:, i], 1)
        np.add.at(counts, faces[:, j], 1)
    counts = np.maximum(counts, 1)
    return totals / counts


def per_vertex_min_cotangent(vertices, faces):
    """
    Minimum cotangent weight on any edge adjacent to each vertex.
    Negative values mean at least one obtuse triangle is present.
    """
    n = len(vertices)
    v0 = vertices[faces[:, 0]]
    v1 = vertices[faces[:, 1]]
    v2 = vertices[faces[:, 2]]
    e01 = v1 - v0
    e02 = v2 - v0
    e12 = v2 - v1
    cross = np.cross(e01, e02)
    area2 = np.maximum(np.linalg.norm(cross, axis=1), 1e-10)
    cot0 = np.einsum("ij,ij->i", e01, e02) / area2
    cot1 = np.einsum("ij,ij->i", -e01, e12) / area2
    cot2 = np.einsum("ij,ij->i", -e02, -e12) / area2

    # Edge (v1,v2) uses cot0 — assign to both v1 and v2
    # Edge (v0,v2) uses cot1 — assign to both v0 and v2
    # Edge (v0,v1) uses cot2 — assign to both v0 and v1
    result = np.full(n, np.inf)
    for vtx, cot in [
        (faces[:, 1], cot0), (faces[:, 2], cot0),
        (faces[:, 0], cot1), (faces[:, 2], cot1),
        (faces[:, 0], cot2), (faces[:, 1], cot2),
    ]:
        np.minimum.at(result, vtx, cot)
    return result


def show_mesh_diagnostics(mesh):
    try:
        import polyscope as ps
        import polyscope.imgui as psim
    except ImportError:
        print("polyscope not installed — run:  pip install polyscope")
        sys.exit(1)

    vertices = mesh.vertices
    faces = mesh.faces
    n_v = len(vertices)
    n_f = len(faces)

    # ---- compute diagnostics -----------------------------------------------
    print("Computing diagnostics …")

    L, vertex_areas = compute_cotangent_laplacian(vertices, faces)
    edge_len = per_vertex_mean_edge_length(vertices, faces)
    cot_min  = per_vertex_min_cotangent(vertices, faces)
    lap_diag = np.array(L.diagonal())   # should all be ≤ 0

    # Per-face area — this is the real uniformity check after isotropic remeshing.
    # Vertex area varies naturally with valence (5-7 neighbours = ~30% spread),
    # so face_area is the meaningful quantity to inspect.
    v0, v1, v2 = vertices[faces[:,0]], vertices[faces[:,1]], vertices[faces[:,2]]
    face_areas = np.linalg.norm(np.cross(v1-v0, v2-v0), axis=1) / 2.0

    bbox    = mesh.bounding_box.extents
    h_mean  = float(edge_len.mean())
    h_std   = float(edge_len.std())

    fa_min, fa_max, fa_mean = face_areas.min(), face_areas.max(), face_areas.mean()
    va_min, va_max          = vertex_areas.min(), vertex_areas.max()

    print(f"\nMesh summary")
    print(f"  Vertices      : {n_v:,}")
    print(f"  Faces         : {n_f:,}")
    print(f"  Watertight    : {mesh.is_watertight}")
    print(f"  Bounding box  : {bbox[0]:.4f} × {bbox[1]:.4f} × {bbox[2]:.4f}")
    print(f"  Edge length   : mean={h_mean:.5f}  std={h_std:.5f}  "
          f"min={edge_len.min():.5f}  max={edge_len.max():.5f}")
    print(f"  Face area     : mean={fa_mean:.2e}  min={fa_min:.2e}  max={fa_max:.2e}  "
          f"max/min ratio={fa_max/max(fa_min,1e-30):.1f}x  ← KEY number")
    print(f"  Vertex area   : mean={vertex_areas.mean():.2e}  "
          f"max/min ratio={va_max/max(va_min,1e-30):.1f}x  "
          f"(~2x is normal due to valence variation)")
    print(f"  Cot min       : {cot_min.min():.4f}  "
          f"(negative = obtuse triangles present)")
    print(f"  Laplacian diag: min={lap_diag.min():.4f}  max={lap_diag.max():.4f}")
    print(f"  h² scaling    : Du×h²={0.16*h_mean**2:.2e}  "
          f"Dv×h²={0.08*h_mean**2:.2e}")
    print()

    # ---- polyscope ---------------------------------------------------------
    ps.init()
    ps.set_up_dir("z_up")
    ps.set_ground_plane_mode("shadow_only")

    ps_mesh = ps.register_surface_mesh(
        "mesh", vertices, faces, smooth_shade=True
    )

    # Face area — PRIMARY check. Should be very uniform after isotropic remeshing.
    # Large variation here means the remeshing didn't work.
    ps_mesh.add_scalar_quantity(
        "face_area", face_areas,
        defined_on="faces", enabled=True, cmap="coolwarm",
    )
    # Vertex area — will always vary ~2x due to valence (5–7 neighbours).
    # NOT the right thing to check for remesh quality.
    ps_mesh.add_scalar_quantity(
        "vertex_area", vertex_areas,
        defined_on="vertices", enabled=False, cmap="coolwarm",
    )
    # Mean adjacent edge length
    ps_mesh.add_scalar_quantity(
        "edge_length_mean", edge_len,
        defined_on="vertices", enabled=False, cmap="coolwarm",
    )
    # Minimum cotangent weight — negatives are obtuse triangles
    ps_mesh.add_scalar_quantity(
        "cotangent_min", cot_min,
        defined_on="vertices", enabled=False, cmap="coolwarm",
        vminmax=(-1.0, 1.0),
    )
    # Laplacian diagonal
    ps_mesh.add_scalar_quantity(
        "laplacian_diag", lap_diag,
        defined_on="vertices", enabled=False, cmap="coolwarm",
    )

    def callback():
        psim.TextUnformatted(f"Vertices : {n_v:,}    Faces : {n_f:,}")
        psim.TextUnformatted(f"Watertight : {mesh.is_watertight}")
        psim.TextUnformatted(
            f"Face area  max/min={fa_max/max(fa_min,1e-30):.1f}x  "
            + ("OK" if fa_max/max(fa_min,1e-30) < 10 else "*** BAD — remeshing failed? ***")
        )
        psim.TextUnformatted(
            f"Vertex area  max/min={va_max/max(va_min,1e-30):.1f}x  "
            f"(~2x is normal)"
        )
        psim.TextUnformatted(
            f"Edge length  mean={h_mean:.5f}  std={h_std:.5f}"
        )
        psim.TextUnformatted(
            f"Cot min={cot_min.min():.4f}  "
            + ("*** obtuse triangles ***" if cot_min.min() < 0 else "(all acute)")
        )
        psim.Separator()
        psim.TextUnformatted("face_area is now the default — check it first")

    ps.set_user_callback(callback)
    print("Opening polyscope window …")
    print("Switch between quantities in the left panel under 'mesh'.\n")
    ps.show()


def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("input", help="Input mesh file")
    parser.add_argument("--no-subdivide", action="store_true",
                        help="Skip auto-subdivision")
    parser.add_argument("--min-faces", type=int, default=20000,
                        help="Minimum faces for auto-subdivision (default: 20000)")
    parser.add_argument("--target-edge-length", type=float, default=None,
                        help="Target edge length for subdivision")
    args = parser.parse_args()

    print(f"Loading {args.input} …")
    mesh = load_mesh(args.input)
    print(f"  Loaded: {len(mesh.faces):,} faces, {len(mesh.vertices):,} vertices")

    if not args.no_subdivide:
        print("Auto-subdividing …")
        mesh = auto_subdivide(mesh, min_faces=args.min_faces,
                              target_edge_length=args.target_edge_length)

    show_mesh_diagnostics(mesh)


if __name__ == "__main__":
    main()
