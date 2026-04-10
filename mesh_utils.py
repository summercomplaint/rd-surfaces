import numpy as np
import scipy.sparse
import trimesh


def load_mesh(path):
    mesh = trimesh.load(path, force="mesh")
    if not isinstance(mesh, trimesh.Trimesh):
        raise ValueError(f"Could not load a triangle mesh from {path}")
    return mesh


def auto_subdivide(mesh, min_faces=20000, target_edge_length=None, max_iterations=6):
    """
    Remesh to a uniform target edge length using isotropic remeshing (pymeshlab)
    or adaptive subdivision (trimesh fallback).

    Isotropic remeshing splits long edges, collapses short ones, flips edges
    to improve triangle quality, and smooths vertex positions — producing a
    mesh with consistent face sizes across the whole surface, which is required
    for stable reaction-diffusion simulation.

    The target edge length is chosen so that the resulting mesh has at least
    min_faces faces (unless you supply target_edge_length explicitly).
    """
    if target_edge_length is None:
        # Choose h so that ~min_faces equilateral triangles cover the surface.
        # Area of equilateral triangle with side h: sqrt(3)/4 * h²
        # => h = sqrt(4 * surface_area / (sqrt(3) * min_faces))
        surface_area = float(mesh.area)
        if surface_area > 0:
            target_edge_length = np.sqrt(4.0 * surface_area / (np.sqrt(3) * min_faces))
        else:
            bbox_diag = np.linalg.norm(mesh.bounding_box.extents)
            target_edge_length = bbox_diag / 100.0

    print(f"  Target edge length: {target_edge_length:.5f}")

    result = _remesh_isotropic(mesh, target_edge_length)

    n_faces = len(result.faces)
    n_verts = len(result.vertices)
    edges = result.edges_unique
    avg_edge = float(np.mean(
        np.linalg.norm(
            result.vertices[edges[:, 0]] - result.vertices[edges[:, 1]], axis=1
        )
    ))
    print(f"  Final mesh: {n_faces:,} faces, {n_verts:,} vertices, "
          f"avg edge {avg_edge:.5f}")

    if not result.is_watertight:
        print("  Warning: mesh is not watertight — output may need repair before slicing.")

    return result


def _remesh_isotropic(mesh, target_edge_length, iterations=10):
    """
    Isotropic remeshing via pymeshlab (preferred) or trimesh fallback.
    """
    try:
        import pymeshlab
        ms = pymeshlab.MeshSet()
        ms.add_mesh(pymeshlab.Mesh(
            vertex_matrix=mesh.vertices.astype(np.float64),
            face_matrix=mesh.faces.astype(np.int32),
        ))
        # AbsoluteValue was removed in pymeshlab 2022.2+; fall back to
        # PercentageValue (percentage of bounding-box diagonal).
        try:
            tl = pymeshlab.AbsoluteValue(target_edge_length)
        except AttributeError:
            bbox_diag = float(np.linalg.norm(
                mesh.vertices.max(axis=0) - mesh.vertices.min(axis=0)
            ))
            tl = pymeshlab.PercentageValue(
                (target_edge_length / bbox_diag) * 100.0
            )
        ms.meshing_isotropic_explicit_remeshing(
            iterations=iterations,
            targetlen=tl,
        )
        # Merge vertices that ended up closer than half the target edge length —
        # this collapses the tiny leftover triangles near sharp features.
        ms.meshing_merge_close_vertices(
            threshold=pymeshlab.AbsoluteValue(target_edge_length * 0.5)
            if hasattr(pymeshlab, "AbsoluteValue")
            else pymeshlab.PercentageValue(
                (target_edge_length * 0.5 / float(np.linalg.norm(
                    mesh.vertices.max(axis=0) - mesh.vertices.min(axis=0)
                ))) * 100.0
            )
        )
        ms.meshing_remove_null_faces()
        out = ms.current_mesh()
        return trimesh.Trimesh(
            vertices=out.vertex_matrix(),
            faces=out.face_matrix(),
            process=False,
        )
    except ImportError:
        print("  pymeshlab not installed — falling back to trimesh adaptive subdivision.")
        vertices, faces = trimesh.remesh.subdivide_to_size(
            mesh.vertices, mesh.faces,
            max_edge=target_edge_length,
            max_iter=10,
        )
        return trimesh.Trimesh(vertices=vertices, faces=faces, process=False)


def compute_cotangent_laplacian(vertices, faces):
    """
    Compute the cotangent Laplacian L and per-vertex areas A.

    Returns (L, vertex_areas) where:
      L             -- scipy sparse (n, n); satisfies (Lu)_i = sum_j w_ij (u_j - u_i)
      vertex_areas  -- (n,) array, 1/3 of adjacent face areas (Voronoi approximation)

    The discrete Laplace-Beltrami operator is then  A^{-1} L.
    """
    n = len(vertices)
    v0 = vertices[faces[:, 0]]
    v1 = vertices[faces[:, 1]]
    v2 = vertices[faces[:, 2]]

    # Edge vectors within each face
    e01 = v1 - v0   # q - p
    e02 = v2 - v0   # r - p
    e12 = v2 - v1   # r - q

    # |cross(e01, e02)| = 2 * face area
    cross = np.cross(e01, e02)
    area2 = np.linalg.norm(cross, axis=1)
    area2 = np.maximum(area2, 1e-10)

    # Cotangent of interior angle at each vertex of each face:
    #   angle at v0 (p): between e01 and e02
    #   angle at v1 (q): between -e01 and e12
    #   angle at v2 (r): between -e02 and -e12
    cot0 = np.einsum("ij,ij->i", e01, e02) / area2
    cot1 = np.einsum("ij,ij->i", -e01, e12) / area2
    cot2 = np.einsum("ij,ij->i", -e02, -e12) / area2

    # For each face the cotangent weight on each edge is:
    #   edge (v1, v2) <- cot at v0 (opposite vertex)
    #   edge (v0, v2) <- cot at v1
    #   edge (v0, v1) <- cot at v2
    # Build symmetric (both directions) COO entries.
    i_idx = np.concatenate(
        [faces[:, 1], faces[:, 2], faces[:, 0], faces[:, 2], faces[:, 0], faces[:, 1]]
    )
    j_idx = np.concatenate(
        [faces[:, 2], faces[:, 1], faces[:, 2], faces[:, 0], faces[:, 1], faces[:, 0]]
    )
    data = np.concatenate(
        [cot0, cot0, cot1, cot1, cot2, cot2]
    ) / 2.0

    W = scipy.sparse.coo_matrix((data, (i_idx, j_idx)), shape=(n, n)).tocsr()

    # L_ii = -sum_j w_ij,  L_ij = w_ij
    row_sums = np.array(W.sum(axis=1)).flatten()
    L = W - scipy.sparse.diags(row_sums)

    # Vertex areas: 1/3 of each adjacent face's area
    face_areas = area2 / 2.0
    vertex_areas = np.zeros(n)
    for k in range(3):
        np.add.at(vertex_areas, faces[:, k], face_areas / 3.0)
    vertex_areas = np.maximum(vertex_areas, 1e-10)

    return L, vertex_areas
