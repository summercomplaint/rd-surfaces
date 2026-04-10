import { useRef, useState, useEffect, useCallback } from 'react';
import './App.css';

import { useScene }      from './hooks/useScene.js';
import { useSimulation } from './hooks/useSimulation.js';

import FileUpload         from './components/FileUpload.jsx';
import ParametersSection  from './components/ParametersSection.jsx';
import InitialConditions  from './components/InitialConditions.jsx';
import ReliefSection      from './components/ReliefSection.jsx';
import SimulationSection  from './components/SimulationSection.jsx';
import Controls           from './components/Controls.jsx';
import DevPanel           from './components/DevPanel.jsx';
import HelpModal          from './components/HelpModal.jsx';


// ---------------------------------------------------------------------------
// Default settings
// ---------------------------------------------------------------------------
const DEFAULTS = {
    // Upload
    minFaces: 80000,
    // Pattern
    preset:   'coral',
    feed:     0.055,
    kill:     0.062,
    scale:    0,
    // IC
    icMode:     'blobs',
    numSeeds:   10,
    blobRadius: 0.5,   // pct of bbox diag / 100
    // Relief
    dispPct:    2,
    symmetric:  false,
    reverse:    false,
    upAxis:     2,   // Z
    flatBottom: false,
    flatCutoff: 5,
    showRelief: false,
    // Simulation
    maxSteps: 10000,
    // Dev
    cotMax:       1,
    areaFloor:    10,
    devColorMode: 'size',
};

export default function App() {
    const canvasRef = useRef(null);

    // -----------------------------------------------------------------------
    // Settings state (flat object for simple diffing)
    // -----------------------------------------------------------------------
    const [s, setS] = useState(DEFAULTS);
    const set = useCallback(patch => setS(prev => ({ ...prev, ...patch })), []);

    // -----------------------------------------------------------------------
    // UI state
    // -----------------------------------------------------------------------
    const [helpOpen,    setHelpOpen]    = useState(false);
    const [devMode,     setDevMode]     = useState(false);
    const [meshInfo,    setMeshInfo]    = useState(null);   // { faceCount, vertexCount, remeshSource, sizeStats, angleStats }
    const [overlayMsg,  setOverlayMsg]  = useState('Upload a mesh to begin');

    // -----------------------------------------------------------------------
    // settingsRef: always points to latest settings — animation loop reads this
    // (Set synchronously in render so the loop never sees a stale value.)
    // -----------------------------------------------------------------------
    const settingsRef = useRef(s);
    settingsRef.current = {
        ...s,
        devMode,
        dispPct:    s.dispPct,
    };

    // -----------------------------------------------------------------------
    // Hooks
    // -----------------------------------------------------------------------
    const scene = useScene(canvasRef);
    const sim   = useSimulation(scene, settingsRef);

    // -----------------------------------------------------------------------
    // Init Three.js + start RAF loop once the canvas mounts.
    // Also ping the remesh server immediately so Render wakes up before the
    // user uploads a mesh (cold-start takes ~30s on the free tier).
    // -----------------------------------------------------------------------
    useEffect(() => {
        scene.init();
        sim.startLoop();
        const url = import.meta.env.VITE_REMESH_URL;
        if (url) fetch(url, { method: 'OPTIONS' }).catch(() => {});
        return () => {
            sim.stopLoop();
            scene.dispose();
        };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // -----------------------------------------------------------------------
    // Apply quality colors when devMode or colorMode changes
    // -----------------------------------------------------------------------
    useEffect(() => {
        if (devMode && meshInfo) {
            scene.applyQualityColors(s.devColorMode);
        }
    }, [devMode, s.devColorMode, meshInfo]); // eslint-disable-line react-hooks/exhaustive-deps

    // -----------------------------------------------------------------------
    // showRelief toggle: reset geometry when turned off
    // -----------------------------------------------------------------------
    useEffect(() => {
        if (!s.showRelief) scene.resetRelief();
    }, [s.showRelief]); // eslint-disable-line react-hooks/exhaustive-deps

    // -----------------------------------------------------------------------
    // Dev mode keyboard shortcut: Ctrl+Shift+D
    // -----------------------------------------------------------------------
    useEffect(() => {
        const handler = e => {
            if (e.ctrlKey && e.shiftKey && e.key === 'D') {
                e.preventDefault();
                setDevMode(prev => !prev);
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, []);

    // -----------------------------------------------------------------------
    // File handling
    // -----------------------------------------------------------------------
    const handleFile = useCallback(async (file, { skipRemesh = false } = {}) => {
        sim.stop();
        setMeshInfo(null);
        setOverlayMsg('Loading mesh\u2026');

        try {
            const lapOpts = { cotMax: s.cotMax, areaFloorPct: s.areaFloor };
            const info = await scene.loadMesh(
                file, s.minFaces, lapOpts,
                msg => setOverlayMsg(msg),
                skipRemesh ? undefined : (skipToJS, skipToOriginal) => setOverlayMsg(
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
                        <span>Server remeshing&hellip;</span>
                        <div style={{ display: 'flex', gap: 8 }}>
                            <button className="btn btn-neutral" style={{ width: 'auto', padding: '6px 12px' }}
                                onClick={skipToJS}>Remesh in browser</button>
                            <button className="btn btn-neutral" style={{ width: 'auto', padding: '6px 12px' }}
                                onClick={skipToOriginal}>Use original model</button>
                        </div>
                    </div>
                ),
                skipRemesh,
            );
            setMeshInfo(info);
            setOverlayMsg(null);

            if (devMode) scene.applyQualityColors(s.devColorMode);
        } catch (err) {
            setOverlayMsg(`Error: ${err.message}`);
            console.error(err);
        }
    }, [s.minFaces, s.cotMax, s.areaFloor, s.devColorMode, devMode, scene, sim]); // eslint-disable-line react-hooks/exhaustive-deps

    // Keep a ref so the auto-load effect always calls the current version
    const handleFileRef = useRef(handleFile);
    handleFileRef.current = handleFile;

    // Auto-load teapot on first mount (works when served via dev server or dist/)
    useEffect(() => {
        const t = setTimeout(async () => {
            try {
                const res = await fetch('./utahteapot.stl');
                if (!res.ok) return;
                const blob = await res.blob();
                handleFileRef.current(new File([blob], 'utahteapot.stl'), { skipRemesh: true });
            } catch (e) { /* silently skip if file not served */ }
        }, 200);
        return () => clearTimeout(t);
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // -----------------------------------------------------------------------
    // Re-remesh current mesh
    // -----------------------------------------------------------------------
    const handleRemesh = useCallback(async () => {
        if (!meshInfo) return;
        sim.stop();
        setMeshInfo(null);
        try {
            const lapOpts = { cotMax: s.cotMax, areaFloorPct: s.areaFloor };
            const info = await scene.remeshCurrent(
                s.minFaces, lapOpts,
                msg => setOverlayMsg(msg),
            );
            setMeshInfo(info);
            setOverlayMsg(null);
            if (devMode) scene.applyQualityColors(s.devColorMode);
        } catch (err) {
            setOverlayMsg(`Error: ${err.message}`);
            console.error(err);
        }
    }, [meshInfo, s.minFaces, s.cotMax, s.areaFloor, s.devColorMode, devMode, scene, sim]); // eslint-disable-line react-hooks/exhaustive-deps

    // -----------------------------------------------------------------------
    // Run simulation
    // -----------------------------------------------------------------------
    const handleRun = useCallback(() => {
        if (!scene.lapRef.current) return;
        const duScale   = Math.pow(2, s.scale);
        const simParams = { Du: 0.08 * duScale, Dv: 0.04 * duScale, F: s.feed, k: s.kill, dt: 1.0, seed: 42 };
        const icParams  = {
            positions:  scene.origPosRef.current,
            icMode:     s.icMode,
            numSeeds:   s.numSeeds,
            blobRadius: s.blobRadius / 100,
        };
        sim.start(scene.lapRef.current, simParams, icParams);
    }, [s, scene, sim]);

    // -----------------------------------------------------------------------
    // Download STL
    // -----------------------------------------------------------------------
    const handleDownload = useCallback(() => {
        scene.downloadSTL(sim.simRef.current?.v, {
            dispPct:    s.dispPct,
            symmetric:  s.symmetric,
            reverse:    s.reverse,
            upAxis:     s.upAxis,
            flatBottom: s.flatBottom,
            flatCutoff: s.flatCutoff,
        });
    }, [s, scene, sim]);

    // -----------------------------------------------------------------------
    // Dev panel: recompute Laplacian
    // -----------------------------------------------------------------------
    const handleRecomputeLap = useCallback(() => {
        if (!meshInfo) return;
        sim.stop();
        scene.recomputeLaplacian({ cotMax: s.cotMax, areaFloorPct: s.areaFloor });
    }, [meshInfo, s.cotMax, s.areaFloor, scene, sim]);

    // -----------------------------------------------------------------------
    // Derived UI booleans
    // -----------------------------------------------------------------------
    const hasMesh      = !!meshInfo;
    const canRun       = hasMesh && !sim.running;
    const canPause     = sim.running || sim.stepCount > 0;
    const canDownload  = hasMesh && !sim.running && sim.stepCount > 0;

    return (
        <div className="app">
            <div className="layout">
                <button className="help-btn-float" onClick={() => setHelpOpen(true)} title="Help">?</button>

                <div className="sidebar">
                    <div className="sidebar-inner">

                        <FileUpload
                            onFile={handleFile}
                            minFaces={s.minFaces}
                            onMinFacesChange={v => set({ minFaces: v })}
                            onRemesh={handleRemesh}
                            canRemesh={hasMesh && !sim.running}
                        />

                        <hr className="section-divider" />

                        <ParametersSection
                            preset={s.preset} feed={s.feed} kill={s.kill} scale={s.scale}
                            onChange={set}
                        />

                        <InitialConditions
                            icMode={s.icMode} numSeeds={s.numSeeds} blobRadius={s.blobRadius}
                            onChange={set}
                        />

                        <hr className="section-divider" />

                        <SimulationSection maxSteps={s.maxSteps} onChange={set} />

                        <Controls
                            canRun={canRun}
                            running={sim.running}
                            canDownload={canDownload}
                            onRun={handleRun}
                            onTogglePause={sim.togglePause}
                            onDownload={handleDownload}
                            stepCount={sim.stepCount}
                            maxSteps={s.maxSteps}
                        />

                        {devMode && (
                            <DevPanel
                                colorMode={s.devColorMode}
                                cotMax={s.cotMax}
                                areaFloor={s.areaFloor}
                                sizeStats={meshInfo?.sizeStats}
                                angleStats={meshInfo?.angleStats}
                                canRecompute={hasMesh}
                                onChange={set}
                                onRecompute={handleRecomputeLap}
                            />
                        )}

                    </div>
                </div>

                <div className="right-panel">
                    <div className="sidebar-inner">
                        <ReliefSection
                            dispPct={s.dispPct} symmetric={s.symmetric} reverse={s.reverse}
                            upAxis={s.upAxis} flatBottom={s.flatBottom} flatCutoff={s.flatCutoff}
                            showRelief={s.showRelief}
                            onChange={set}
                        />
                    </div>
                </div>

                <div className="canvas-wrap">
                    <canvas ref={canvasRef} />
                    {overlayMsg && <div className="overlay">{overlayMsg}</div>}
                </div>
            </div>


            {helpOpen && <HelpModal onClose={() => setHelpOpen(false)} />}
        </div>
    );
}
