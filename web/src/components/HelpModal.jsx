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
                <button className="modal-close" onClick={onClose}>X</button>

                <p>
                    I really like <a href="https://en.wikipedia.org/wiki/Reaction%E2%80%93diffusion_system">reaction-diffusion patterns</a>. 
                    This is a little website that lets you input a 3D model and get a new one with a reaction diffusion pattern 
                    embossed on it!
                </p>

                <h3>Guide:</h3>
                <ol>
                    <li>Upload your STL</li>
                    <li>Choose a preset or tune Feed / Kill / Scale.</li>
                    <li>Click <strong>Run</strong></li>
                    <li>Pause the simulation or wait for it to end and download your new 3D model!</li>
                </ol>
                <h3>Tips</h3>
                <ul>
                    <li> You can make the scale smaller than 1 but it tends to kind of break the simulation.
                        Instead, try a finer mesh!
                    </li>
                    <li>
                        You can see what the new 3D model will look like by turning on "preview relief"
                    </li>
                    <li>
                        For some initial conditions and parameters the pattern just dies; try fiddling around with the initial conditions
                        panel and you should be able to get something that lives
                    </li>
                    <li>
                        If you want to print the whole model, turn on "flat bottom" so it adheres properly to the board. The cutoff determines how 
                        far up the model the pattern is flattened 
                    </li>
                    <li>
                        If you run out of steps and your pattern isn't done forming, you can just increase the number of steps and click "resume!"
                    </li>
                    <li>
                        The remesh server can struggle with large or complex models. If that's an issue, you can run <a href="https://github.com/summercomplaint/rd-surfaces/blob/main/remesh_local.py">remesh_local.py</a> from the <a href="https://github.com/summercomplaint/rd-surfaces">GitHub repo</a> on your own machine to pre-remesh the file, then upload the result directly.
                    </li>
                </ul>
                <p>
                    This website uses Rein van der Woerd's <a href="https://rein.computer/project/erosion-font/">Erosion font</a>
                </p>
            </div>
        </div>
    );
}
