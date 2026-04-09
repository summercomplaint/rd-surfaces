import { useEffect } from 'react';

export default function HelpModal({ onClose }) {
    useEffect(() => {
        const handler = e => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [onClose]);

    return (
        <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
            <div className="modal">
                <button className="modal-close" onClick={onClose}>\u00d7</button>

                <h2>rd-surface</h2>
                <p>
                    Runs Gray-Scott reaction-diffusion on the surface of a 3D mesh, then
                    displaces vertices along their normals to produce a printable relief texture.
                </p>

                <h3>Quick start</h3>
                <ol>
                    <li>Drop an OBJ or STL file onto the upload area.</li>
                    <li>Choose a preset or tune Feed / Kill / Scale.</li>
                    <li>Click <strong>Run</strong> and watch the pattern form.</li>
                    <li>Enable <em>Preview relief</em> to see the bumps live.</li>
                    <li>Click <strong>Download STL</strong> when happy.</li>
                </ol>

                <h3>Pattern presets</h3>
                <table>
                    <thead>
                        <tr><th>Preset</th><th>Feed</th><th>Kill</th></tr>
                    </thead>
                    <tbody>
                        <tr><td>Coral (default)</td><td>0.055</td><td>0.062</td></tr>
                        <tr><td>Spots</td><td>0.035</td><td>0.065</td></tr>
                        <tr><td>Stripes</td><td>0.060</td><td>0.062</td></tr>
                        <tr><td>Worms</td><td>0.078</td><td>0.061</td></tr>
                        <tr><td>Maze</td><td>0.029</td><td>0.057</td></tr>
                        <tr><td>Mitosis</td><td>0.028</td><td>0.053</td></tr>
                    </tbody>
                </table>

                <h3>Parameters</h3>
                <p>
                    <strong>Scale</strong> — multiplies the diffusion coefficients.
                    Smaller values make finer features; larger values make coarser ones.
                </p>
                <p>
                    <strong>Feed &amp; Kill</strong> — control the character of the
                    pattern. Moving outside a preset&apos;s neighborhood often kills
                    the reaction; small tweaks give interesting variations.
                </p>

                <h3>Relief</h3>
                <p>
                    <strong>Depth</strong> — displacement as a percentage of the mesh&apos;s
                    bounding-box diagonal. 1–3% is a good range for 3D printing.
                </p>
                <p>
                    <strong>Symmetric</strong> — dark areas recess inward instead of
                    staying flush, giving more depth contrast.
                </p>
                <p>
                    <strong>Flat bottom</strong> — suppresses displacement near the base
                    of the model so it prints flat. Set <em>Up axis</em> to match how
                    your mesh is oriented (Z is the default for most print-ready files).
                </p>

                <h3>3D printing tips</h3>
                <ul>
                    <li>Output is watertight if the input is watertight.</li>
                    <li>Symmetric mode usually gives better depth for printing.</li>
                    <li>Enable Flat bottom if your model needs a flat base.</li>
                    <li>More Steps or a different seed gives a different pattern.</li>
                </ul>

                <h3>Dev mode</h3>
                <p>
                    Press <kbd>Ctrl+Shift+D</kbd> to toggle developer mode, which
                    colours the mesh by face size or minimum angle — useful for checking
                    remesh quality before running the simulation.
                </p>
            </div>
        </div>
    );
}
