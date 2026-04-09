import Slider from './Slider.jsx';

export default function InitialConditions({ icMode, numSeeds, blobRadius, onChange }) {
    return (
        <details className="section">
            <summary>Initial conditions</summary>
            <select
                value={icMode}
                onChange={e => onChange({ icMode: e.target.value })}
                style={{ marginBottom: 8 }}
            >
                <option value="blobs">Gaussian blobs</option>
                <option value="noise">Uniform noise</option>
            </select>
            <Slider label="Seeds" min={1} max={20} step={1} value={numSeeds}
                onChange={v => onChange({ numSeeds: v })}
                format={v => String(Math.round(v))} />
            <Slider label="Radius" min={2} max={40} step={1} value={blobRadius}
                onChange={v => onChange({ blobRadius: v })}
                format={v => `${Math.round(v)}%`} />
        </details>
    );
}
