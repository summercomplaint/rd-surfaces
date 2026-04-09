export default function Controls({
    canRun, running, canDownload,
    onRun, onTogglePause, onDownload,
    stepCount, maxSteps,
}) {
    const pct = maxSteps > 0 ? Math.min(1, stepCount / maxSteps) * 100 : 0;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div className="progress-track">
                <div className="progress-bar" style={{ width: `${pct}%` }} />
            </div>

            <div className="btn-row">
                <button className="btn btn-run" disabled={!canRun} onClick={onRun}>
                    {stepCount > 0 ? 'Reset' : 'Run'}
                </button>
                <button
                    className="btn btn-neutral"
                    disabled={!running && stepCount === 0}
                    onClick={onTogglePause}
                >
                    {running ? 'Pause' : 'Resume'}
                </button>
            </div>

            <button className="btn btn-download" disabled={!canDownload} onClick={onDownload}>
                Download STL
            </button>
        </div>
    );
}
