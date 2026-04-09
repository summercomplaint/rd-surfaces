import { useRef, useState } from 'react';
import Slider from './Slider.jsx';

export default function FileUpload({ onFile, minFaces, onMinFacesChange, onRemesh, canRemesh }) {
    const inputRef  = useRef(null);
    const [dragOver, setDragOver] = useState(false);
    const [filename, setFilename] = useState('');

    function handle(file) {
        if (!file) return;
        setFilename(file.name);
        onFile(file);
    }

    return (
        <div className="section">
            <div
                className={`drop-zone${dragOver ? ' drag-over' : ''}`}
                onClick={() => inputRef.current.click()}
                onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={e => { e.preventDefault(); setDragOver(false); handle(e.dataTransfer.files[0]); }}
            >
                <input
                    ref={inputRef} type="file" accept=".obj,.stl" style={{ display: 'none' }}
                    onChange={e => handle(e.target.files[0])}
                />
                Drop OBJ / STL here
                <small>or click to browse</small>
                {filename && <div className="drop-zone-label">{filename}</div>}
            </div>
            <Slider
                label="Faces"
                min={5000} max={80000} step={1000}
                value={minFaces}
                onChange={onMinFacesChange}
                format={v => v >= 1000 ? `${(v/1000).toFixed(0)}k` : String(v)}
            />
            <button
                className="btn btn-neutral"
                style={{ marginTop: 2 }}
                disabled={!canRemesh}
                onClick={onRemesh}
            >
                Remesh
            </button>
        </div>
    );
}
