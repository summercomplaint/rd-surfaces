import Slider from './Slider.jsx';

export default function ReliefSection({
    dispPct, symmetric, upAxis, flatBottom, flatCutoff, showRelief, onChange,
}) {
    return (
        <div className="section">
            <h3>Relief</h3>

            <Slider label="Depth" min={0.5} max={8} step={0.5} value={dispPct}
                onChange={v => onChange({ dispPct: v })}
                format={v => `${v.toFixed(1)}%`} />

            <div className="check-row" style={{ marginBottom: 5 }}>
                <input type="checkbox" id="symmetric" checked={symmetric}
                    onChange={e => onChange({ symmetric: e.target.checked })} />
                <label htmlFor="symmetric">Symmetric (dark areas recess)</label>
            </div>

            <div className="check-row">
                <input type="checkbox" id="flat-bottom" checked={flatBottom}
                    onChange={e => onChange({ flatBottom: e.target.checked })} />
                <label htmlFor="flat-bottom">Flat bottom</label>
            </div>

            {flatBottom && (
                <div className="nested">
                    <div className="row" style={{ marginBottom: 6 }}>
                        <label>Up axis</label>
                        <select
                            value={upAxis}
                            onChange={e => onChange({ upAxis: parseInt(e.target.value) })}
                            style={{ flex: 1, padding: '4px 6px', fontSize: 12 }}
                        >
                            <option value={0}>X</option>
                            <option value={1}>Y</option>
                            <option value={2}>Z</option>
                        </select>
                        <span className="val" style={{ width: 40 }}></span>
                    </div>
                    <Slider label="Cutoff" min={1} max={30} step={1} value={flatCutoff}
                        onChange={v => onChange({ flatCutoff: v })}
                        format={v => `${Math.round(v)}%`} />
                </div>
            )}

            <div className="check-row" style={{ marginTop: 6 }}>
                <input type="checkbox" id="show-relief" checked={showRelief}
                    onChange={e => onChange({ showRelief: e.target.checked })} />
                <label htmlFor="show-relief">Preview relief (live bumps)</label>
            </div>
        </div>
    );
}
