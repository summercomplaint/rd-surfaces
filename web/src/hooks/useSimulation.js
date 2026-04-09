import { useRef, useState, useCallback } from 'react';
import { GrayScottSim } from '../lib/gray_scott.js';

/**
 * Manages the Gray-Scott simulation and the RAF animation loop.
 *
 * scene:       object returned by useScene (stable callback refs)
 * settingsRef: ref always pointing to the latest settings object from App
 */
export function useSimulation(scene, settingsRef) {
    const simRef      = useRef(null);
    const runningRef  = useRef(false);
    const rafRef      = useRef(null);
    const frameRef    = useRef(0);

    const [running,   setRunning]   = useState(false);
    const [stepCount, setStepCount] = useState(0);
    const [vStats,    setVStats]    = useState(null);
    const [finished,  setFinished]  = useState(false);

    // ------------------------------------------------------------------
    // Core animation loop — reads settings from settingsRef (always fresh)
    // ------------------------------------------------------------------
    const loop = useCallback(() => {
        const sim = simRef.current;
        const s   = settingsRef.current;

        // Advance simulation when running
        if (sim && runningRef.current) {
            sim.advance(10);

            frameRef.current++;
            if (frameRef.current % 6 === 0) {
                setStepCount(sim.stepCount);
                const v = sim.v;
                let mn = Infinity, mx = -Infinity, tot = 0;
                for (let i = 0; i < v.length; i++) {
                    if (v[i] < mn) mn = v[i];
                    if (v[i] > mx) mx = v[i];
                    tot += v[i];
                }
                setVStats({ min: mn, max: mx, mean: tot / v.length });
            }

            if (sim.stepCount >= s.maxSteps) {
                runningRef.current = false;
                setRunning(false);
                setStepCount(sim.stepCount);
                setFinished(true);
            }
        }

        // Always update display when sim has data — this is what lets settings
        // changes (showRelief, flatCutoff, upAxis, etc.) take effect immediately
        // even when the sim is paused or finished.
        if (sim) {
            if (s.devMode) {
                scene.applyQualityColors(s.devColorMode);
            } else {
                scene.updateColors(sim.v);
            }

            if (s.showRelief) {
                scene.updateRelief(sim.v, {
                    dispPct:    s.dispPct,
                    symmetric:  s.symmetric,
                    upAxis:     s.upAxis,
                    flatBottom: s.flatBottom,
                    flatCutoff: s.flatCutoff,
                });
            }
        }

        scene.renderFrame();
        rafRef.current = requestAnimationFrame(loop);
    }, [scene, settingsRef]); // scene callbacks are stable; settingsRef is a ref

    // ------------------------------------------------------------------
    // Start the RAF loop (once, after init)
    // ------------------------------------------------------------------
    const startLoop = useCallback(() => {
        if (rafRef.current) return;
        loop();
    }, [loop]);

    const stopLoop = useCallback(() => {
        if (rafRef.current) {
            cancelAnimationFrame(rafRef.current);
            rafRef.current = null;
        }
    }, []);

    // ------------------------------------------------------------------
    // Simulation controls
    // ------------------------------------------------------------------
    const start = useCallback((lap, simParams, icParams) => {
        simRef.current  = new GrayScottSim(lap, { ...simParams, ...icParams });
        runningRef.current = true;
        frameRef.current   = 0;
        setRunning(true);
        setStepCount(0);
        setVStats(null);
        setFinished(false);
    }, []);

    const togglePause = useCallback(() => {
        runningRef.current = !runningRef.current;
        setRunning(runningRef.current);
    }, []);

    const stop = useCallback(() => {
        simRef.current     = null;
        runningRef.current = false;
        setRunning(false);
        setStepCount(0);
        setVStats(null);
        setFinished(false);
    }, []);

    return {
        start,
        stop,
        startLoop,
        stopLoop,
        togglePause,
        running,
        stepCount,
        vStats,
        finished,
        simRef,
    };
}
