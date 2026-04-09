import Slider from './Slider.jsx';
import CustomSelect from './CustomSelect.jsx';

const PRESETS = {
    coral:   { F: 0.055, k: 0.062 },
    spots:   { F: 0.035, k: 0.065 },
    stripes: { F: 0.060, k: 0.062 },
    worms:   { F: 0.078, k: 0.061 },
    maze:    { F: 0.029, k: 0.057 },
};

function scaleLabel(s) {
    const v = Math.pow(2, s);
    if (v < 1)    return `\xf7${Math.round(1/v)}`;
    if (v === 1)  return '1\xd7';
    return `${v.toFixed(1)}\xd7`;
}

export default function ParametersSection({ preset, feed, kill, scale, onChange }) {
    function applyPreset(name) {
        const p = PRESETS[name];
        if (p) onChange({ preset: name, feed: p.F, kill: p.k });
        else   onChange({ preset: name });
    }

    function handleFeed(v) { onChange({ feed: v, preset: 'custom' }); }
    function handleKill(v) { onChange({ kill: v, preset: 'custom' }); }

    return (
        <div className="section">
            <h3>Parameters</h3>
            <CustomSelect
                value={preset}
                onChange={v => applyPreset(v)}
                options={[
                    { value: 'coral',   label: 'Coral (default)' },
                    { value: 'spots',   label: 'Spots' },
                    { value: 'stripes', label: 'Stripes' },
                    { value: 'worms',   label: 'Worms' },
                    { value: 'maze',    label: 'Maze' },
                    { value: 'mitosis', label: 'Mitosis' },
                    { value: 'custom',  label: 'Custom' },
                ]}
                style={{ marginBottom: 8 }}
            />
            <Slider label="Feed" min={0.010} max={0.120} step={0.001} value={feed} onChange={handleFeed} />
            <Slider label="Kill" min={0.040} max={0.075} step={0.001} value={kill} onChange={handleKill} />
            <Slider label="Scale" min={-3} max={2} step={0.25} value={scale}
                onChange={v => onChange({ scale: v })} format={scaleLabel} />
        </div>
    );
}
