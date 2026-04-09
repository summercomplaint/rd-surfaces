import Slider from './Slider.jsx';

export default function SimulationSection({ maxSteps, onChange }) {
    return (
        <div className="section">
            <h3>Simulation</h3>
            <Slider label="Steps" min={2000} max={30000} step={1000} value={maxSteps}
                onChange={v => onChange({ maxSteps: v })}
                format={v => v >= 1000 ? `${(v/1000).toFixed(0)}k` : String(v)} />
        </div>
    );
}
