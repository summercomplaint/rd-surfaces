import numpy as np
import trimesh


def displace_mesh(mesh, pattern, max_displacement, symmetric=False):
    """
    Displace each vertex along its normal by an amount proportional to `pattern`.

    pattern           -- (n,) float array (raw RD output; will be normalized)
    max_displacement  -- maximum displacement in mesh units
    symmetric         -- if False (default): bright=out, dark=flush with surface
                         if True:            bright=out, dark=recessed inward
    """
    pmin, pmax = pattern.min(), pattern.max()
    span = pmax - pmin

    if span < 1e-10:
        print("Warning: pattern has no variation — no displacement applied.")
        normalized = np.zeros_like(pattern)
    else:
        normalized = (pattern - pmin) / span   # [0, 1]

    if symmetric:
        # Map [0, 1] -> [-1, 1]: dark recesses, bright raises
        scale = 2.0 * normalized - 1.0
    else:
        scale = normalized   # [0, 1]: dark is flush, bright raises

    normals = mesh.vertex_normals   # (n, 3), unit vectors

    new_vertices = mesh.vertices + normals * (scale[:, None] * max_displacement)

    displaced = trimesh.Trimesh(
        vertices=new_vertices,
        faces=mesh.faces.copy(),
        process=False,
    )
    # Recompute normals for the displaced geometry
    displaced.vertex_normals  # triggers computation

    return displaced
