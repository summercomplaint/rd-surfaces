import numpy as np
from tqdm import tqdm


class GrayScottSim:
    """
    Steppable Gray-Scott simulation on a mesh surface.

    Equations:
        du/dt = Du * Δu  -  u·v²  +  F·(1-u)
        dv/dt = Dv * Δv  +  u·v²  -  (F+k)·v

    where Δ = A⁻¹L is the discrete Laplace-Beltrami operator.

    Du and Dv are multiplied by h_mean² internally so that the parameters are
    mesh-scale-independent (same pattern character regardless of mesh units).

    Common parameter presets (F, k):
        Coral / default : 0.055 / 0.062
        Spots           : 0.035 / 0.065
        Stripes         : 0.060 / 0.062
        Worms           : 0.078 / 0.061
        Maze            : 0.029 / 0.057
        Mitosis         : 0.028 / 0.053
    """

    def __init__(self, L, vertex_areas, h_mean,
                 Du=0.16, Dv=0.08, F=0.055, k=0.062, dt=1.0, seed=42):
        self.L = L
        self.inv_area = 1.0 / vertex_areas
        self.Du_eff = Du * h_mean ** 2
        self.Dv_eff = Dv * h_mean ** 2
        self.F = F
        self.k = k
        self.dt = dt
        self.step_count = 0

        # Stability hint
        dt_max = 1.0 / (4.0 * (Du + Dv))
        if dt > dt_max * 1.05:
            print(f"  Warning: dt={dt:.3f} may be unstable. "
                  f"Suggested max for these Du/Dv: {dt_max:.3f}")

        # Initialise entire mesh in the active regime (u≈0.5, v≈0.25) + noise.
        # This is critical: many GS parameter sets have a *stationary* active
        # state, meaning the pattern does not propagate outward from point seeds.
        # Starting globally in the active regime lets Turing instability organise
        # the whole surface simultaneously.
        n = len(vertex_areas)
        rng = np.random.default_rng(seed)
        self.u = np.clip(0.5 + rng.uniform(-0.1, 0.1, n), 0.0, 1.0)
        self.v = np.clip(0.25 + rng.uniform(-0.1, 0.1, n), 0.0, 1.0)

    def advance(self, n_steps=1):
        """Run n_steps of explicit-Euler Gray-Scott."""
        u, v = self.u, self.v
        L, inv_area = self.L, self.inv_area
        Du_eff, Dv_eff = self.Du_eff, self.Dv_eff
        F, k, dt = self.F, self.k, self.dt

        for _ in range(n_steps):
            Lu = L.dot(u) * inv_area
            Lv = L.dot(v) * inv_area
            uvv = u * v * v
            u += dt * (Du_eff * Lu - uvv + F * (1.0 - u))
            v += dt * (Dv_eff * Lv + uvv - (F + k) * v)
            np.clip(u, 0.0, 1.0, out=u)
            np.clip(v, 0.0, 1.0, out=v)

        self.step_count += n_steps


def run_gray_scott(L, vertex_areas, h_mean,
                   Du=0.16, Dv=0.08, F=0.055, k=0.062,
                   steps=10000, dt=1.0, seed=42, progress=True):
    """Run to completion and return (u, v)."""
    sim = GrayScottSim(L, vertex_areas, h_mean,
                       Du=Du, Dv=Dv, F=F, k=k, dt=dt, seed=seed)

    iterator = (
        tqdm(range(steps), desc="Gray-Scott", unit="step") if progress else range(steps)
    )
    for _ in iterator:
        sim.advance(1)

    u, v = sim.u, sim.v
    print(f"  u ∈ [{u.min():.4f}, {u.max():.4f}]  "
          f"v ∈ [{v.min():.4f}, {v.max():.4f}]")
    return u, v
