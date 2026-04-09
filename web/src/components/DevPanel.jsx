import Slider from './Slider.jsx';

export default function DevPanel({
    colorMode, cotMax, areaFloor, sizeStats, angleStats,
    canRecompute, onChange, onRecompute,
}) {
    const stats = colorMode === 'angle' ? angleStats : sizeStats;
    const legend = colorMode === 'angle'
        ? 'blue = 60\xb0 (ideal) \u00b7 white = 30\xb0 \u00b7 red = 0\xb0 (sliver)'
        : 'blue = small face \u00b7 white = mean \u00b7 red = large face';

    return (
        <div className="dev-panel">
            <div className="section">
                <h3>Mesh quality</h3>
                <select
                    value={colorMode}
                    onChange={e => onChange({ devColorMode: e.target.value })}
                    style={{ marginBottom: 8 }}
                >
                    <option value="size">Face size</option>
                    <option value="angle">Min angle</option>
                </select>
                <div className="dev-legend">{legend}</div>
                {stats && <pre className="dev-stats">{stats}</pre>}
            </div>

            <div className="section" style={{ borderTop: '1px solid #1e1e1e', paddingTop: 10 }}>
                <h3>Laplacian limits</h3>
                <Slider label="Cot max" min={0.5} max={20} step={0.5} value={cotMax}
                    onChange={v => onChange({ cotMax: v })}
                    format={v => v.toFixed(1)} />
                <Slider label="Area floor" min={0.1} max={10} step={0.1} value={areaFloor}
                    onChange={v => onChange({ areaFloor: v })}
                    format={v => `${v.toFixed(1)}%`} />
                <button
                    className="btn btn-recompute"
                    disabled={!canRecompute}
                    onClick={onRecompute}
                >
                    Recompute Laplacian
                </button>
            </div>
        </div>
    );
}
