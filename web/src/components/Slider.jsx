export default function Slider({ label, min, max, step, value, onChange, format }) {
    const display = format ? format(value) : value.toFixed(3);
    return (
        <div className="row">
            <label>{label}</label>
            <input
                type="range"
                min={min} max={max} step={step}
                value={value}
                onChange={e => onChange(parseFloat(e.target.value))}
            />
            <span className="val">{display}</span>
        </div>
    );
}
