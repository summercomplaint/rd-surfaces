export default function StatusBar({ stepCount, maxSteps, meshInfo, vStats }) {
    return (
        <div className="statusbar">
            <span>
                {stepCount > 0
                    ? `Step ${stepCount.toLocaleString()} / ${maxSteps.toLocaleString()}`
                    : '\u2014'}
            </span>
            <span>
                {meshInfo
                    ? `${meshInfo.faceCount.toLocaleString()} faces \u00b7 ${meshInfo.vertexCount.toLocaleString()} verts`
                    : '\u2014'}
            </span>
            {meshInfo?.remeshSource && <span>{meshInfo.remeshSource}</span>}
            <span>
                {vStats
                    ? `v [${vStats.min.toFixed(3)}, ${vStats.max.toFixed(3)}] mean ${vStats.mean.toFixed(3)}`
                    : ''}
            </span>
        </div>
    );
}
