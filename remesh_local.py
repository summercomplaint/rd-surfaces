#!/usr/bin/env python3
"""
Remesh a 3D model on your own machine for use with rd-surface.

Usage:
    python remesh_local.py input.stl
    python remesh_local.py input.stl output.stl
    python remesh_local.py input.stl --faces 80000

Requires:
    pip install trimesh numpy scipy pymeshlab
"""
import argparse
import sys
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(
        description='Remesh a 3D model for rd-surface reaction-diffusion simulation.'
    )
    parser.add_argument('input',  help='Input STL or OBJ file')
    parser.add_argument('output', nargs='?', help='Output STL (default: <input>_remeshed.stl)')
    parser.add_argument('--faces', type=int, default=80000,
                        help='Target face count (default: 80000)')
    args = parser.parse_args()

    input_path = Path(args.input)
    if not input_path.exists():
        print(f'Error: {input_path} not found', file=sys.stderr)
        sys.exit(1)

    output_path = (
        Path(args.output) if args.output
        else input_path.with_stem(input_path.stem + '_remeshed').with_suffix('.stl')
    )

    from mesh_utils import load_mesh, auto_subdivide

    print(f'Loading {input_path}...')
    mesh = load_mesh(str(input_path))
    print(f'  Input: {len(mesh.faces):,} faces, {len(mesh.vertices):,} vertices')

    print(f'Remeshing to ~{args.faces:,} faces...')
    mesh = auto_subdivide(mesh, min_faces=args.faces)

    print(f'Saving to {output_path}...')
    mesh.export(str(output_path))
    print('Done! Upload the output file to rd-surface.')


if __name__ == '__main__':
    main()
