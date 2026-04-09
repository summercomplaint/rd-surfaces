import { useState, useRef, useEffect } from 'react';

export default function CustomSelect({ value, onChange, options, style }) {
    const [open, setOpen] = useState(false);
    const ref = useRef(null);

    // loose equality so integer values match string-typed props and vice-versa
    const selected = options.find(o => o.value == value);

    useEffect(() => {
        if (!open) return;
        const handler = e => { if (!ref.current?.contains(e.target)) setOpen(false); };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [open]);

    return (
        <div ref={ref} className="custom-select" style={style}>
            <div className="custom-select-trigger" onClick={() => setOpen(o => !o)}>
                <span>{selected?.label ?? value}</span>
                <span className="custom-select-arrow">{open ? '▴' : '▾'}</span>
            </div>
            {open && (
                <div className="custom-select-menu">
                    {options.map(o => (
                        <div
                            key={o.value}
                            className={'custom-select-option' + (o.value == value ? ' selected' : '')}
                            onMouseDown={e => { e.preventDefault(); onChange(o.value); setOpen(false); }}
                        >
                            {o.label}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
