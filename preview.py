import numpy as np


def show_evolution(mesh, sim, max_steps, steps_per_frame=50):
    """
    Run Gray-Scott live inside a polyscope window.

    mesh           -- trimesh.Trimesh (subdivided mesh)
    sim            -- GrayScottSim instance (pre-initialised, step_count == 0)
    max_steps      -- stop advancing after this many steps (can continue manually)
    steps_per_frame -- default steps to advance each display frame

    Returns the final (u, v) arrays when the window is closed.
    """
    try:
        import polyscope as ps
        import polyscope.imgui as psim
    except ImportError:
        print("polyscope is not installed. Run:  pip install polyscope")
        sim.advance(max_steps)
        return sim.u, sim.v

    ps.init()
    ps.set_up_dir("z_up")
    ps.set_ground_plane_mode("shadow_only")

    ps_mesh = ps.register_surface_mesh(
        "mesh", mesh.vertices, mesh.faces, smooth_shade=True
    )
    ps_mesh.add_scalar_quantity(
        "v", sim.v, defined_on="vertices", enabled=True,
        cmap="viridis", vminmax=(0.0, 0.5),
    )
    ps_mesh.add_scalar_quantity(
        "u", sim.u, defined_on="vertices", enabled=False,
        cmap="viridis", vminmax=(0.0, 1.0),
    )

    # Mutable state shared with the callback (use lists so closure can write)
    state = {
        "running": True,
        "spf": steps_per_frame,   # steps per frame
        "finished": False,
    }

    def callback():
        # ---------- run simulation ----------
        if state["running"] and sim.step_count < max_steps:
            sim.advance(state["spf"])
            ps_mesh.add_scalar_quantity(
                "v", sim.v, defined_on="vertices", enabled=True,
                cmap="viridis", vminmax=(0.0, 0.5),
            )
            ps_mesh.add_scalar_quantity(
                "u", sim.u, defined_on="vertices", enabled=False,
                cmap="viridis", vminmax=(0.0, 1.0),
            )
            if sim.step_count >= max_steps:
                state["running"] = False
                print(f"\nReached {max_steps} steps — paused.")

        # ---------- ImGui panel ----------
        psim.PushItemWidth(200)

        psim.TextUnformatted(f"Step : {sim.step_count:,} / {max_steps:,}")
        psim.TextUnformatted(
            f"v    : [{sim.v.min():.4f}, {sim.v.max():.4f}]   "
            f"mean {sim.v.mean():.4f}"
        )
        psim.TextUnformatted(
            f"u    : [{sim.u.min():.4f}, {sim.u.max():.4f}]   "
            f"mean {sim.u.mean():.4f}"
        )

        psim.Separator()

        label = "Pause" if state["running"] else "Resume"
        if psim.Button(label):
            state["running"] = not state["running"]

        psim.SameLine()
        if psim.Button("Step x1"):
            sim.advance(1)

        psim.SameLine()
        if psim.Button("Finish"):
            state["running"] = False
            state["finished"] = True
            ps.unshow()   # close window

        psim.Separator()

        changed, new_spf = psim.SliderInt(
            "Steps / frame", state["spf"], v_min=1, v_max=500
        )
        if changed:
            state["spf"] = new_spf

        psim.PopItemWidth()

    ps.set_user_callback(callback)
    print("\n--- Live preview controls ---")
    print("  Left panel > 'v' scalar: the RD pattern")
    print("  ImGui panel: Pause / Resume / Step x1 / Finish")
    print("  Close or press Finish to continue to displacement + save\n")
    ps.show()

    return sim.u, sim.v


def show_preview(mesh, pattern, displaced_mesh=None):
    """Static post-hoc preview of the finished pattern and displaced mesh."""
    try:
        import polyscope as ps
    except ImportError:
        print("polyscope is not installed. Run:  pip install polyscope")
        return

    ps.init()
    ps.set_up_dir("z_up")
    ps.set_ground_plane_mode("shadow_only")

    ps_original = ps.register_surface_mesh(
        "RD Pattern (original)", mesh.vertices, mesh.faces, smooth_shade=True
    )
    ps_original.add_scalar_quantity(
        "v concentration", pattern, defined_on="vertices",
        enabled=True, cmap="viridis",
        vminmax=(pattern.min(), pattern.max()),
    )

    if displaced_mesh is not None:
        ps_displaced = ps.register_surface_mesh(
            "Displaced Output", displaced_mesh.vertices, displaced_mesh.faces,
            smooth_shade=True, enabled=False,
        )
        ps_displaced.add_scalar_quantity(
            "v concentration", pattern, defined_on="vertices",
            enabled=True, cmap="viridis",
            vminmax=(pattern.min(), pattern.max()),
        )

    print("\n--- Preview controls ---")
    print("  Left panel: toggle 'Displaced Output' visibility")
    print("  Close window to exit\n")
    ps.show()
