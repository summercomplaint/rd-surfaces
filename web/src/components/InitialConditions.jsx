import Slider from './Slider.jsx';
import CustomSelect from './CustomSelect.jsx';

export default function InitialConditions({ icMode, numSeeds, blobRadius, onChange }) {
    return (
        <details className="section">
            <summary>Initial conditions</summary>
            <CustomSelect
                value={icMode}
                onChange={v => onChange({ icMode: v })}
                options={[
                    { value: 'blobs', label: 'Gaussian blobs' },
                    { value: 'noise', label: 'Uniform noise' },
                ]}
                style={{ marginBottom: 8 }}
            />
            <Slider label="Seeds" min={1} max={20} step={1} value={numSeeds}
                onChange={v => onChange({ numSeeds: v })}
                format={v => String(Math.round(v))} />
            <Slider label="Radius" min={0.5} max={10} step={0.5} value={blobRadius}
                onChange={v => onChange({ blobRadius: v })}
                format={v => `${Math.round(v)}%`} />
        </details>
    );
}
