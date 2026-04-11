#!/usr/bin/env python3
"""
Remesh a 3D model on your own machine for use with rd-surface.

Usage:
    python remesh_local.py input.stl
    python remesh_local.py input.stl output.stl
    python remesh_local.py input.stl --faces 80000

Requires:
    pip install trimesh numpy pymeshlab
"""
import argparse
import sys
from pathlib import Path

import numpy as np
import trimesh


def main():
    parser = argparse.ArgumentParser(
        description='Remesh a 3D model for rd-surface reaction-diffusion simulation.'
    )
    parser.add_argument('input',  help='Input STL or OBJ file')
    parser.add_argument('output', nargs='?', help='Output STL (default: <input>_remeshed.stl)')
    parser.add_argument('--faces', type=int, default=80000,
                        help='Target face count (default: 80000)')
    args = parser.parse_args()

    try:
        import pymeshlab
    except ImportError:
        print('Error: pymeshlab is required.  Run:  pip install pymeshlab', file=sys.stderr)
        sys.exit(1)

    input_path = Path(args.input)
    if not input_path.exists():
        print(f'Error: {input_path} not found', file=sys.stderr)
        sys.exit(1)

    output_path = (
        Path(args.output) if args.output
        else input_path.with_stem(input_path.stem + '_remeshed').with_suffix('.stl')
    )

    print(f'Loading {input_path}...')
    mesh = trimesh.load(str(input_path), force='mesh')
    if not isinstance(mesh, trimesh.Trimesh):
        print('Error: could not load a triangle mesh from that file.', file=sys.stderr)
        sys.exit(1)
    print(f'  Input: {len(mesh.faces):,} faces, {len(mesh.vertices):,} vertices')

    target_edge_length = np.sqrt(4.0 * float(mesh.area) / (np.sqrt(3) * args.faces))
    print(f'Remeshing to ~{args.faces:,} faces (target edge length: {target_edge_length:.5f})...')

    ms = pymeshlab.MeshSet()
    ms.add_mesh(pymeshlab.Mesh(
        vertex_matrix=mesh.vertices.astype(np.float64),
        face_matrix=mesh.faces.astype(np.int32),
    ))
    try:
        tl = pymeshlab.AbsoluteValue(target_edge_length)
    except AttributeError:
        bbox_diag = float(np.linalg.norm(mesh.vertices.max(axis=0) - mesh.vertices.min(axis=0)))
        tl = pymeshlab.PercentageValue((target_edge_length / bbox_diag) * 100.0)

    ms.meshing_isotropic_explicit_remeshing(iterations=10, targetlen=tl)
    ms.meshing_remove_null_faces()

    out = ms.current_mesh()
    result = trimesh.Trimesh(
        vertices=out.vertex_matrix(),
        faces=out.face_matrix(),
        process=False,
    )
    print(f'  Output: {len(result.faces):,} faces, {len(result.vertices):,} vertices')

    print(f'Saving to {output_path}...')
    result.export(str(output_path))
    print('Done! Upload the output file to rd-surface.')


if __name__ == '__main__':
    main()
