import { useRef, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import {
    loadMeshFromFile,
    remeshForSimulation,
    computeCotangentLaplacian,
    computeVertexNormals,
} from '../lib/mesh_utils.js';
import { viridisRGB, softclip } from '../utils/colormap.js';
import { computeSizeQuality, computeAngleQuality } from '../utils/meshQuality.js';
import { buildSTLBlob, triggerDownload } from '../utils/stlExport.js';

const REMESH_SERVER = import.meta.env.VITE_REMESH_URL ?? 'http://localhost:5174/remesh';

async function tryServerRemesh(file, minFaces, signal) {
    try {
        const res = await fetch(`${REMESH_SERVER}?faces=${minFaces}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/octet-stream', 'X-Filename': file.name },
            body: await file.arrayBuffer(),
            signal,
        });
        if (!res.ok) { console.log('[remesh] server error:', res.status); return null; }

        const blob = await res.blob();
        const url  = URL.createObjectURL(blob);
        try {
            const geo = await new STLLoader().loadAsync(url);
            const src = geo.attributes.position.array;
            const nRef = src.length / 3;
            let xmn=Infinity,xmx=-Infinity,ymn=Infinity,ymx=-Infinity,zmn=Infinity,zmx=-Infinity;
            for (let i=0;i<src.length;i+=3){
                if(src[i]<xmn)xmn=src[i]; if(src[i]>xmx)xmx=src[i];
                if(src[i+1]<ymn)ymn=src[i+1]; if(src[i+1]>ymx)ymx=src[i+1];
                if(src[i+2]<zmn)zmn=src[i+2]; if(src[i+2]>zmx)zmx=src[i+2];
            }
            const diag = Math.sqrt((xmx-xmn)**2+(ymx-ymn)**2+(zmx-zmn)**2);
            const tol = Math.max(diag * 1e-6, 1e-12), inv = 1 / tol;
            const posOut = [], idxOut = new Uint32Array(nRef);
            const map = new Map();
            for (let i=0;i<nRef;i++){
                const x=src[3*i],y=src[3*i+1],z=src[3*i+2];
                const key=`${Math.round(x*inv)},${Math.round(y*inv)},${Math.round(z*inv)}`;
                let ni=map.get(key);
                if(ni===undefined){ni=posOut.length/3;map.set(key,ni);posOut.push(x,y,z);}
                idxOut[i]=ni;
            }
            return { positions: new Float64Array(posOut), indices: idxOut, source: 'Python remesh' };
        } finally { URL.revokeObjectURL(url); }
    } catch (e) { console.log('[remesh] server not available:', e.message); return null; }
}

/**
 * Manages the Three.js scene lifecycle. Returns stable callback refs safe to
 * call from animation loops without stale-closure concerns.
 */
export function useScene(canvasRef, onInit) {
    // Three.js objects
    const rendererRef = useRef(null);
    const sceneRef    = useRef(null);
    const cameraRef   = useRef(null);
    const controlsRef = useRef(null);
    const meshObjRef  = useRef(null);

    // Mesh data
    const rawMeshRef = useRef(null);   // pre-remesh { positions, indices } for re-remeshing
    const origPosRef = useRef(null);
    const normalsRef = useRef(null);
    const indicesRef = useRef(null);
    const lapRef     = useRef(null);
    const diagRef    = useRef(1);

    // Dev quality data
    const sizeQualityRef  = useRef(null);   // { colors, statsText }
    const angleQualityRef = useRef(null);   // { colors, statsText }

    // -----------------------------------------------------------------------
    // Init (called once from App on first render via ref callback)
    // -----------------------------------------------------------------------
    const init = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas || rendererRef.current) return;

        const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
        renderer.setPixelRatio(devicePixelRatio);
        renderer.setClearColor(0x111111);
        rendererRef.current = renderer;

        const scene = new THREE.Scene();
        sceneRef.current = scene;

        const camera = new THREE.PerspectiveCamera(45, 1, 0.001, 10000);
        camera.position.set(0, 0, 3);
        cameraRef.current = camera;

        const controls = new OrbitControls(camera, canvas);
        controls.enableDamping = true;
        controlsRef.current = controls;

        scene.add(new THREE.AmbientLight(0xffffff, 0.5));
        const sun = new THREE.DirectionalLight(0xffffff, 1.2);
        sun.position.set(1, 2, 3);
        scene.add(sun);

        const resize = () => {
            const parent = canvas.parentElement;
            if (!parent) return;
            const w = parent.clientWidth, h = parent.clientHeight;
            renderer.setSize(w, h, false);
            camera.aspect = w / h;
            camera.updateProjectionMatrix();
        };
        const ro = new ResizeObserver(resize);
        ro.observe(canvas.parentElement);
        resize();

        // Store cleanup fn on renderer so we can call it on unmount
        renderer._cleanup = () => { ro.disconnect(); renderer.dispose(); };

        onInit?.();
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const dispose = useCallback(() => {
        rendererRef.current?._cleanup?.();
        rendererRef.current = null;
    }, []);

    // -----------------------------------------------------------------------
    // Load mesh
    // -----------------------------------------------------------------------
    const loadMesh = useCallback(async (file, minFaces, lapOpts = {}, onProgress, onServerSlow, skipRemesh = false) => {
        // 1. Raw load
        const raw = await loadMeshFromFile(file);
        rawMeshRef.current = raw;  // store for re-remeshing without re-uploading

        // 2. Remesh
        let mesh, remeshSource;
        const rawFaces = raw.indices.length / 3;

        // skipRemesh: used for pre-meshed assets (e.g. the bundled teapot) that
        // are already at the right density and don't need server or JS remeshing.
        if (skipRemesh) {
            mesh = raw;
            remeshSource = 'pre-meshed';
            onProgress?.('Loading pre-meshed model\u2026');
            await new Promise(r => setTimeout(r, 30));
        } else {
        onProgress?.(`Remeshing (${rawFaces.toLocaleString()} \u2192 ~${(minFaces/1000).toFixed(0)}k faces)\u2026`);
        await new Promise(r => setTimeout(r, 30));

        // Try the Python server. If it doesn't respond in 6 s (e.g. Render cold-start),
        // notify the caller so they can offer a "keep waiting / skip" choice.
        const controller  = new AbortController();
        const useRawRef   = { current: false };
        const slowTimer   = setTimeout(() => onServerSlow?.(
            () => controller.abort(),                                    // skipToJS
            () => { controller.abort(); useRawRef.current = true; },    // skipToOriginal
        ), 6000);
        const server = await tryServerRemesh(file, minFaces, controller.signal);
        clearTimeout(slowTimer);

        if (server) {
            mesh = server;
            remeshSource = 'Python remesh';
        } else if (useRawRef.current) {
            mesh = raw;
            remeshSource = 'original (unremeshed)';
        } else {
            onProgress?.('Server unavailable \u2014 using JS fallback (quality may be lower)\u2026');
            await new Promise(r => setTimeout(r, 30));
            mesh = remeshForSimulation(raw.positions, raw.indices, minFaces);
            remeshSource = 'JS remesh';
        }
        } // end skipRemesh else

        // 3. Laplacian
        const lap = computeCotangentLaplacian(mesh.positions, mesh.indices, lapOpts);
        lapRef.current     = lap;
        origPosRef.current = mesh.positions;
        indicesRef.current = mesh.indices;
        normalsRef.current = computeVertexNormals(mesh.positions, mesh.indices);

        // 4. Build Three.js mesh
        _buildSceneMesh(mesh.positions, mesh.indices);
        const diag = _fitCamera();
        diagRef.current = diag;

        // 5. Quality data for dev mode
        sizeQualityRef.current  = computeSizeQuality(mesh.positions, mesh.indices);
        angleQualityRef.current = computeAngleQuality(mesh.positions, mesh.indices);

        return {
            faceCount:    mesh.indices.length / 3,
            vertexCount:  lap.n,
            remeshSource,
            sizeStats:    sizeQualityRef.current.statsText,
            angleStats:   angleQualityRef.current.statsText,
        };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // -----------------------------------------------------------------------
    // Re-remesh current mesh with a new face count (no re-upload needed)
    // -----------------------------------------------------------------------
    const remeshCurrent = useCallback(async (minFaces, lapOpts = {}, onProgress) => {
        if (!rawMeshRef.current) return null;
        const raw = rawMeshRef.current;

        onProgress?.(`Remeshing \u2192 ~${(minFaces/1000).toFixed(0)}k faces\u2026`);
        await new Promise(r => setTimeout(r, 30));

        const mesh = remeshForSimulation(raw.positions, raw.indices, minFaces);

        onProgress?.('Building Laplacian\u2026');
        await new Promise(r => setTimeout(r, 30));

        const lap = computeCotangentLaplacian(mesh.positions, mesh.indices, lapOpts);
        lapRef.current     = lap;
        origPosRef.current = mesh.positions;
        indicesRef.current = mesh.indices;
        normalsRef.current = computeVertexNormals(mesh.positions, mesh.indices);

        _buildSceneMesh(mesh.positions, mesh.indices);
        const diag = _fitCamera();
        diagRef.current = diag;

        sizeQualityRef.current  = computeSizeQuality(mesh.positions, mesh.indices);
        angleQualityRef.current = computeAngleQuality(mesh.positions, mesh.indices);

        return {
            faceCount:    mesh.indices.length / 3,
            vertexCount:  lap.n,
            remeshSource: 'JS remesh',
            sizeStats:    sizeQualityRef.current.statsText,
            angleStats:   angleQualityRef.current.statsText,
        };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // -----------------------------------------------------------------------
    // Recompute Laplacian only (dev panel)
    // -----------------------------------------------------------------------
    const recomputeLaplacian = useCallback((lapOpts) => {
        if (!origPosRef.current || !indicesRef.current) return;
        lapRef.current = computeCotangentLaplacian(origPosRef.current, indicesRef.current, lapOpts);
    }, []);

    // -----------------------------------------------------------------------
    // Color update (hot path — no allocations)
    // -----------------------------------------------------------------------
    const updateColors = useCallback((v) => {
        const mesh = meshObjRef.current;
        if (!mesh) return;
        const col = mesh.geometry.attributes.color;
        for (let i = 0; i < v.length; i++) viridisRGB(v[i] * 2, col.array, i);
        col.needsUpdate = true;
    }, []);

    const applyQualityColors = useCallback((mode) => {
        const mesh = meshObjRef.current;
        if (!mesh) return;
        const src = mode === 'angle'
            ? angleQualityRef.current?.colors
            : sizeQualityRef.current?.colors;
        if (!src) return;
        const col = mesh.geometry.attributes.color;
        col.array.set(src);
        col.needsUpdate = true;
    }, []);

    // -----------------------------------------------------------------------
    // Relief displacement
    // -----------------------------------------------------------------------
    const updateRelief = useCallback((v, { dispPct, symmetric, reverse, upAxis, flatBottom, flatCutoff }) => {
        const mesh = meshObjRef.current;
        const origPos = origPosRef.current;
        const nrm = normalsRef.current;
        if (!mesh || !origPos || !nrm) return;

        const maxDisp = diagRef.current * dispPct / 100;

        let vmin = Infinity, vmax = -Infinity;
        for (let i = 0; i < v.length; i++) {
            if (v[i] < vmin) vmin = v[i];
            if (v[i] > vmax) vmax = v[i];
        }
        const vspan = Math.max(vmax - vmin, 1e-10);

        // Flat-bottom cutoff
        let cutVal = -Infinity, blendH = 0;
        if (flatBottom) {
            let fmin = Infinity, fmax = -Infinity;
            for (let i = 0; i < origPos.length / 3; i++) {
                const val = origPos[3*i + upAxis];
                if (val < fmin) fmin = val;
                if (val > fmax) fmax = val;
            }
            cutVal = fmin + (fmax - fmin) * flatCutoff / 100;
            blendH = (fmax - fmin) * 0.01;
        }
        function flatFactor(val) {
            if (!flatBottom) return 1;
            if (val <= cutVal) return 0;
            if (val <= cutVal + blendH) { const t=(val-cutVal)/blendH; return t*t*(3-2*t); }
            return 1;
        }

        const pos = mesh.geometry.attributes.position;
        for (let i = 0; i < v.length; i++) {
            const norm  = softclip((v[i] - vmin) / vspan);
            const base  = reverse ? (1 - norm) : norm;
            const scale = (symmetric ? (2 * base - 1) : base) * flatFactor(origPos[3*i + upAxis]);
            pos.array[3*i]   = origPos[3*i]   + nrm[3*i]   * scale * maxDisp;
            pos.array[3*i+1] = origPos[3*i+1] + nrm[3*i+1] * scale * maxDisp;
            pos.array[3*i+2] = origPos[3*i+2] + nrm[3*i+2] * scale * maxDisp;
        }
        pos.needsUpdate = true;
        mesh.geometry.computeVertexNormals();
    }, []);

    const resetRelief = useCallback(() => {
        const mesh = meshObjRef.current;
        const origPos = origPosRef.current;
        if (!mesh || !origPos) return;
        const pos = mesh.geometry.attributes.position;
        for (let i = 0; i < origPos.length; i++) pos.array[i] = origPos[i];
        pos.needsUpdate = true;
        mesh.geometry.computeVertexNormals();
    }, []);

    // -----------------------------------------------------------------------
    // STL export
    // -----------------------------------------------------------------------
    const downloadSTL = useCallback((v, reliefParams) => {
        if (!v || !origPosRef.current) return;
        const blob = buildSTLBlob(
            origPosRef.current, normalsRef.current, indicesRef.current,
            v, { diag: diagRef.current, ...reliefParams }
        );
        triggerDownload(blob);
    }, []);

    // -----------------------------------------------------------------------
    // Render one frame (called from animation loop)
    // -----------------------------------------------------------------------
    const renderFrame = useCallback(() => {
        controlsRef.current?.update();
        const renderer = rendererRef.current;
        const scene    = sceneRef.current;
        const camera   = cameraRef.current;
        if (renderer && scene && camera) renderer.render(scene, camera);
    }, []);

    // -----------------------------------------------------------------------
    // Internal helpers
    // -----------------------------------------------------------------------
    function _buildSceneMesh(positions, indices) {
        const scene = sceneRef.current;
        if (meshObjRef.current) {
            scene.remove(meshObjRef.current);
            meshObjRef.current.geometry.dispose();
            meshObjRef.current.material.dispose();
        }
        const geo = new THREE.BufferGeometry();
        const pos32 = new Float32Array(positions.length);
        for (let i = 0; i < positions.length; i++) pos32[i] = positions[i];
        geo.setAttribute('position', new THREE.BufferAttribute(pos32, 3));
        geo.setAttribute('color',    new THREE.BufferAttribute(new Float32Array(positions.length).fill(0.3), 3));
        geo.setIndex(new THREE.BufferAttribute(new Uint32Array(indices), 1));
        geo.computeVertexNormals();
        const mesh = new THREE.Mesh(geo, new THREE.MeshPhongMaterial({ vertexColors: true, side: THREE.DoubleSide }));
        scene.add(mesh);
        meshObjRef.current = mesh;
    }

    function _fitCamera() {
        const mesh = meshObjRef.current;
        const camera = cameraRef.current;
        const controls = controlsRef.current;
        const box  = new THREE.Box3().setFromObject(mesh);
        const ctr  = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3()).length();
        controls.target.copy(ctr);
        camera.position.copy(ctr).addScaledVector(new THREE.Vector3(0, 0, 1), size * 1.6);
        camera.near = size * 0.001; camera.far = size * 100;
        camera.updateProjectionMatrix();
        controls.update();
        return size;
    }

    return {
        init,
        dispose,
        loadMesh,
        remeshCurrent,
        recomputeLaplacian,
        updateColors,
        applyQualityColors,
        updateRelief,
        resetRelief,
        downloadSTL,
        renderFrame,
        // Expose refs for App.jsx
        lapRef,
        origPosRef,
        sizeQualityRef,
        angleQualityRef,
    };
}
