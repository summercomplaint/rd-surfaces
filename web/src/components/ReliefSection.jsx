import Slider from './Slider.jsx';
import CustomSelect from './CustomSelect.jsx';

export default function ReliefSection({
    dispPct, symmetric, reverse, upAxis, flatBottom, flatCutoff, showRelief, onChange,
}) {
    return (
        <div className="section">
            <h3>Relief</h3>

            <Slider label="Depth" min={0.5} max={3} step={0.1} value={dispPct}
                onChange={v => onChange({ dispPct: v })}
                format={v => `${v.toFixed(1)}%`} />
            <div className="check-row" style={{ marginBottom:5 }}>
                <input type="checkbox" id="show-relief" checked={showRelief}
                    onChange={e => onChange({ showRelief: e.target.checked })} />
                <label htmlFor="show-relief">Preview relief</label>
            </div>
 
            

            <div className="check-row" style={{ marginBottom:5 }}>
                <input type="checkbox" id="flat-bottom" checked={flatBottom}
                    onChange={e => onChange({ flatBottom: e.target.checked })} />
                <label htmlFor="flat-bottom">Flat bottom</label>
            </div>

            {flatBottom && (
                <div className="nested">
                    <div className="row" style={{ marginBottom: 6 }}>
                        <label>Up axis</label>
                        <CustomSelect
                            value={upAxis}
                            onChange={v => onChange({ upAxis: v })}
                            options={[
                                { value: 0, label: 'X' },
                                { value: 1, label: 'Y' },
                                { value: 2, label: 'Z' },
                            ]}
                            style={{ flex: 1 }}
                        />
                        <span className="val" style={{ width: 40 }}></span>
                    </div>
                    <Slider label="Cutoff" min={0.5} max={10} step={0.5} value={flatCutoff}
                        onChange={v => onChange({ flatCutoff: v })}
                        format={v => `${Math.round(v)}%`} />
                </div>
            )}

            <div className="check-row" style={{ marginBottom: 5 }}>
                <input type="checkbox" id="reverse" checked={reverse}
                    onChange={e => onChange({ reverse: e.target.checked })} />
                <label htmlFor="reverse">Invert</label>
            </div>

            <div className="check-row" >
                <input type="checkbox" id="symmetric" checked={symmetric}
                    onChange={e => onChange({ symmetric: e.target.checked })} />
                <label htmlFor="symmetric">Recess dark areas</label>
            </div>

        </div>
    );
}
