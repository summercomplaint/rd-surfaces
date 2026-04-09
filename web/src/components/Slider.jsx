import { useState, useRef } from 'react';

export default function Slider({ label, min, max, step, value, onChange, format }) {
    const [editing, setEditing] = useState(false);
    const [editVal, setEditVal] = useState('');
    const inputRef = useRef(null);

    function startEdit() {
        setEditVal(String(value));
        setEditing(true);
        // focus after render
        setTimeout(() => { inputRef.current?.select(); }, 0);
    }

    function commit() {
        const n = parseFloat(editVal);
        if (!isNaN(n)) onChange(n);
        setEditing(false);
    }

    function handleKey(e) {
        if (e.key === 'Enter') { e.preventDefault(); commit(); }
        if (e.key === 'Escape') setEditing(false);
    }

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
            {editing ? (
                <input
                    ref={inputRef}
                    type="text"
                    className="val val-edit"
                    value={editVal}
                    onChange={e => setEditVal(e.target.value)}
                    onBlur={commit}
                    onKeyDown={handleKey}
                />
            ) : (
                <span className="val val-clickable" onClick={startEdit} title="Click to type a value">
                    {display}
                </span>
            )}
        </div>
    );
}
