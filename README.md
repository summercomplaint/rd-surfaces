# rd-surface

Runs Gray-Scott reaction-diffusion on the surface of a 3D mesh and displaces vertices along their normals to produce a printable relief pattern.

## Install

```bash
pip install -r requirements.txt
```

## Quick start

```bash
python main.py my_model.obj output.stl --preview
```

The `--preview` flag opens a live window so you can watch the pattern evolve and press **Finish** when you're happy with it.

## How it works

1. **Isotropic remesh** — the input mesh is remeshed to uniform triangle sizes (via pymeshlab). This is essential: non-uniform triangles cause the diffusion to behave differently in different regions, ruining the pattern.
2. **Cotangent Laplacian** — computes the discrete Laplace-Beltrami operator on the surface, which makes diffusion respect the actual geometry rather than treating the mesh as a flat grid.
3. **Gray-Scott simulation** — runs the two-chemical reaction-diffusion system on the surface. The `v` concentration forms the visible pattern.
4. **Vertex displacement** — each vertex is pushed outward along its normal by an amount proportional to `v`. High-`v` areas (the pattern) stick out; low-`v` areas stay flush (or recess with `--symmetric`).

## Tuning the pattern

### Scale (coarse ↔ fine)

Control pattern size by scaling `--Du` and `--Dv` together, keeping their 2:1 ratio:

| Effect | `--Du` | `--Dv` |
|--------|--------|--------|
| Coarser (larger features) | 0.32 | 0.16 |
| Default | 0.16 | 0.08 |
| Finer (smaller features) | 0.08 | 0.04 |
| Very fine | 0.04 | 0.02 |

Pattern wavelength scales with `sqrt(Du)`, so halving both Du and Dv makes features ~30% smaller.

### Pattern type (spots, stripes, mazes…)

The `--feed` and `--kill` parameters select the pattern character. The defaults produce a coral/fingerprint pattern.

| Pattern  | `--feed` | `--kill` |
|----------|----------|----------|
| Coral *(default)* | 0.055 | 0.062 |
| Spots    | 0.035 | 0.065 |
| Stripes  | 0.060 | 0.062 |
| Worms    | 0.078 | 0.061 |
| Maze     | 0.029 | 0.057 |
| Mitosis  | 0.028 | 0.053 |

### Relief depth

`--displacement` sets how far the pattern sticks out, in the same units as your mesh (mm if your model is in mm). Defaults to 2% of the bounding-box diagonal.

`--symmetric` makes dark areas recess *inward* instead of sitting flush — gives a deeper, more tactile result.

## All options

```
python main.py INPUT OUTPUT [options]

Gray-Scott parameters:
  --Du N          Diffusion rate of U   (default: 0.16)  ← scale up/down for coarser/finer
  --Dv N          Diffusion rate of V   (default: 0.08)  ← keep at Du/2
  --feed N        Feed rate F           (default: 0.055) ← controls pattern type
  --kill N        Kill rate k           (default: 0.062) ← controls pattern type
  --steps N       Simulation steps      (default: 10000)
  --dt N          Time step             (default: 1.0)
  --seed N        Random seed for reproducibility (default: 42)

Displacement:
  --displacement N   Max raise in mesh units (default: 2% of bbox diagonal)
  --symmetric        Dark areas recess inward instead of staying flush

Mesh processing:
  --min-faces N            Target face count after remeshing (default: 20000)
  --target-edge-length N   Override the target edge length directly
  --no-subdivide           Skip remeshing entirely

Misc:
  --preview          Open live 3D preview during simulation
  --no-progress      Suppress progress bar
```

## Inspecting the mesh

If something looks wrong, run the mesh inspector first:

```bash
python inspect_mesh.py my_model.obj
```

This opens a polyscope window with the remeshed mesh coloured by diagnostic quantities. Check **`face_area`** first — it should be nearly uniform (max/min ratio < 5×). Large variation means the remeshing didn't work and the simulation will produce artifacts.

## Tips for 3D printing

- Output is watertight if the input is watertight. Check with `inspect_mesh.py`.
- `--symmetric` gives more depth contrast and usually prints better than the default one-sided displacement.
- A `--displacement` of 1–3% of the bounding-box diagonal is a good starting range. Too large and the surface becomes spiky; too small and the texture disappears after post-processing.
- After slicing, most slicers (PrusaSlicer, Bambu Studio) will auto-repair minor mesh issues.
- More steps (`--steps 20000`) or a different `--seed` gives a different pattern on the same model.
