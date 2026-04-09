import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { loadMeshFromFile, remeshForSimulation, computeCotangentLaplacian, computeVertexNormals } from './mesh_utils.js';
import { GrayScottSim } from './gray_scott.js';

// ---------------------------------------------------------------------------
// Viridis colormap (5-stop LUT)
// ---------------------------------------------------------------------------
const V = [
    [68/255,  1/255, 84/255],
    [59/255, 82/255,139/255],
    [33/255,145/255,140/255],
    [94/255,201/255, 98/255],
    [253/255,231/255, 37/255],
];
function viridisRGB(t, out, i) { // writes directly into Float32Array at index i*3
    t = Math.max(0, Math.min(1, t));
    const s = t * 4, si = Math.min(s|0, 3), sf = s - si;
    const a = V[si], b = V[si+1];
    out[i*3]   = a[0]+sf*(b[0]-a[0]);
    out[i*3+1] = a[1]+sf*(b[1]-a[1]);
    out[i*3+2] = a[2]+sf*(b[2]-a[2]);
}

// ---------------------------------------------------------------------------
// Three.js scene
// ---------------------------------------------------------------------------
const canvas   = document.getElementById('canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(devicePixelRatio);
renderer.setClearColor(0x111111);

const scene  = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, 1, 0.001, 10000);
camera.position.set(0, 0, 3);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;

scene.add(new THREE.AmbientLight(0xffffff, 0.5));
const sun = new THREE.DirectionalLight(0xffffff, 1.2);
sun.position.set(1, 2, 3);
scene.add(sun);

function resizeRenderer() {
    const w = canvas.parentElement.clientWidth, h = canvas.parentElement.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
}
new ResizeObserver(resizeRenderer).observe(canvas.parentElement);
resizeRenderer();

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------
const PRESETS = {
    coral:   { F: 0.055, k: 0.062 },
    spots:   { F: 0.035, k: 0.065 },
    stripes: { F: 0.060, k: 0.062 },
    worms:   { F: 0.078, k: 0.061 },
    maze:    { F: 0.029, k: 0.057 },
    mitosis: { F: 0.028, k: 0.053 },
};

// ---------------------------------------------------------------------------
// App state
// ---------------------------------------------------------------------------
let applyingPreset = false;
let lap        = null;   // Laplacian object
let origPos    = null;   // Float64Array
let normals    = null;   // Float32Array
let indices    = null;   // Uint32Array
let sim        = null;
let meshObj    = null;
let running    = false;
let maxSteps   = 10000;
let showRelief       = false;
let devMode          = false;
let flatBottom       = false;
let flatBottomCut    = -Infinity;  // precomputed from origPos + slider
let flatBottomBlendH = 0;
let upAxis           = 2;          // 0=X, 1=Y, 2=Z (default Z for 3D-print orientation)
let qualityColors     = null;  // Float32Array, computed once per mesh load
let qualityStatsText  = '';
let angleColors       = null;  // Float32Array, computed once per mesh load
let angleStatsText    = '';

// ---------------------------------------------------------------------------
// UI refs
// ---------------------------------------------------------------------------
const $ = id => document.getElementById(id);
const overlay     = $('overlay');
const btnRun      = $('btn-run');
const btnPause    = $('btn-pause');
const btnDownload = $('btn-download');
const progressBar = $('progress-bar');
const statusStep   = $('status-step');
const statusMesh   = $('status-mesh');
const statusRemesh = $('status-remesh');
const statusV      = $('status-v');

// ---------------------------------------------------------------------------
// File upload
// ---------------------------------------------------------------------------
const dropZone  = $('drop-zone');
const fileInput = $('file-input');

dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', e => {
    e.preventDefault(); dropZone.classList.remove('drag-over');
    if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
});
fileInput.addEventListener('change', () => fileInput.files[0] && handleFile(fileInput.files[0]));

const REMESH_SERVER = 'http://localhost:5174/remesh';

async function tryServerRemesh(file, minFaces) {
    // POST the raw file to the local Python remesh server.
    // Returns a {positions, indices} mesh on success, null if server not running.
    try {
        const res = await fetch(`${REMESH_SERVER}?faces=${minFaces}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/octet-stream', 'X-Filename': file.name },
            body: await file.arrayBuffer(),
        });
        if (!res.ok) { console.log('[remesh] server error:', res.status); return null; }

        // Server returns a trimesh binary STL. Do NOT run it through loadMeshFromFile
        // (which re-welds with our JS welder and can corrupt pymeshlab's topology).
        // Instead: load with STLLoader, then weld with a very tight tolerance since
        // pymeshlab vertices that share a position are at identical float32 values.
        const { STLLoader } = await import('three/addons/loaders/STLLoader.js');
        const blob = await res.blob();
        const url  = URL.createObjectURL(blob);
        try {
            const geo = await new STLLoader().loadAsync(url);
            const src = geo.attributes.position.array; // Float32Array, non-indexed
            const nRef = src.length / 3;
            let xmn=Infinity,xmx=-Infinity,ymn=Infinity,ymx=-Infinity,zmn=Infinity,zmx=-Infinity;
            for (let i=0;i<src.length;i+=3){
                if(src[i  ]<xmn)xmn=src[i  ]; if(src[i  ]>xmx)xmx=src[i  ];
                if(src[i+1]<ymn)ymn=src[i+1]; if(src[i+1]>ymx)ymx=src[i+1];
                if(src[i+2]<zmn)zmn=src[i+2]; if(src[i+2]>zmx)zmx=src[i+2];
            }
            const diag = Math.sqrt((xmx-xmn)**2+(ymx-ymn)**2+(zmx-zmn)**2);
            // Tight tolerance: float32 identical values → distance 0, any ε works.
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
            console.log(`[remesh] server STL: ${posOut.length/3} verts, ${nRef/3} faces, diag=${diag.toFixed(3)}`);
            return { positions: new Float64Array(posOut), indices: idxOut };
        } finally { URL.revokeObjectURL(url); }
    } catch (e) { console.log('[remesh] server not available:', e.message); return null; }
}

async function handleFile(file) {
    stopSim();
    btnRun.disabled = btnPause.disabled = btnDownload.disabled = true;

    try {
        setOverlay('Loading mesh…');
        await yield_();
        let mesh = await loadMeshFromFile(file);

        setOverlay(`Remeshing (${(mesh.indices.length/3).toLocaleString()} faces → ~12k)…`);
        await yield_();

        const minFaces = parseInt($('min-faces').value);

        // Try the local Python server first (pymeshlab quality).
        // Falls back to JS remeshing if the server isn't running.
        const serverMesh = await tryServerRemesh(file, minFaces);
        if (serverMesh) {
            console.log('[remesh] used Python server');
            mesh = serverMesh;
            statusRemesh.textContent = 'Python remesh';
        } else {
            console.log('[remesh] server not available, using JS fallback');
            mesh = remeshForSimulation(mesh.positions, mesh.indices, minFaces);
            statusRemesh.textContent = 'JS remesh';
        }

        setOverlay('Building Laplacian…');
        await yield_();
        lap     = computeCotangentLaplacian(mesh.positions, mesh.indices, getLapOpts());
        origPos = mesh.positions;
        indices = mesh.indices;
        normals = computeVertexNormals(origPos, indices);

        buildSceneMesh();
        fitCamera();

        const qd = computeQualityColors(origPos, indices);
        qualityColors = qd.colors; qualityStatsText = qd.statsText;
        const ad = computeAngleColors(origPos, indices);
        angleColors = ad.colors; angleStatsText = ad.statsText;
        updateDevStats();
        if (devMode) applyQualityColors();

        $('drop-zone-label').textContent = file.name;
        statusMesh.textContent = `${(indices.length/3).toLocaleString()} faces · ${lap.n.toLocaleString()} vertices`;
        updateFlatBottomCutoff();
        $('btn-recompute-lap').disabled = false;
        setOverlay(null);
        btnRun.disabled = false;
    } catch (err) {
        setOverlay(`Error: ${err.message}`);
        console.error(err);
    }
}

// ---------------------------------------------------------------------------
// Three.js mesh
// ---------------------------------------------------------------------------
function buildSceneMesh() {
    if (meshObj) { scene.remove(meshObj); meshObj.geometry.dispose(); meshObj.material.dispose(); }

    const geo = new THREE.BufferGeometry();
    const pos32 = new Float32Array(origPos.length);
    for (let i = 0; i < origPos.length; i++) pos32[i] = origPos[i];
    geo.setAttribute('position', new THREE.BufferAttribute(pos32, 3));
    geo.setAttribute('color',    new THREE.BufferAttribute(new Float32Array(lap.n * 3).fill(0.3), 3));
    geo.setIndex(new THREE.BufferAttribute(new Uint32Array(indices), 1));
    geo.computeVertexNormals();

    meshObj = new THREE.Mesh(geo, new THREE.MeshPhongMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    scene.add(meshObj);
}

function fitCamera() {
    const box = new THREE.Box3().setFromObject(meshObj);
    const ctr  = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3()).length();
    controls.target.copy(ctr);
    camera.position.copy(ctr).addScaledVector(new THREE.Vector3(0,0,1), size*1.6);
    camera.near = size*0.001; camera.far = size*100;
    camera.updateProjectionMatrix();
    controls.update();
}

// ---------------------------------------------------------------------------
// Dev mode: mesh quality coloring
// ---------------------------------------------------------------------------
function computeQualityColors(positions, indices) {
    const nv = positions.length / 3;
    const nf = indices.length / 3;
    const vertexAreaSum   = new Float64Array(nv);
    const vertexFaceCnt   = new Uint32Array(nv);
    const faceAreas       = new Float64Array(nf);
    let totalArea = 0;

    for (let f = 0; f < nf; f++) {
        const i0=indices[3*f], i1=indices[3*f+1], i2=indices[3*f+2];
        const ax=positions[3*i1]-positions[3*i0], ay=positions[3*i1+1]-positions[3*i0+1], az=positions[3*i1+2]-positions[3*i0+2];
        const bx=positions[3*i2]-positions[3*i0], by=positions[3*i2+1]-positions[3*i0+1], bz=positions[3*i2+2]-positions[3*i0+2];
        const area = Math.sqrt((ay*bz-az*by)**2+(az*bx-ax*bz)**2+(ax*by-ay*bx)**2)/2;
        faceAreas[f] = area;
        totalArea += area;
        for (const i of [i0,i1,i2]) { vertexAreaSum[i]+=area; vertexFaceCnt[i]++; }
    }

    let minA=Infinity, maxA=-Infinity;
    for (let f=0; f<nf; f++) { if(faceAreas[f]<minA)minA=faceAreas[f]; if(faceAreas[f]>maxA)maxA=faceAreas[f]; }
    const meanA = totalArea / nf;
    const logMean = Math.log(Math.max(meanA, 1e-30));
    // Scale: ±1 decade around the mean (log base 10).
    // Faces at mean → t=0.5 (white). 10× larger → t=1 (red). 10× smaller → t=0 (blue).
    // This keeps the scale meaningful even when there are a handful of
    // zero-area degenerates (they clamp to t=0 and don't distort the range).
    const LOG10 = Math.log(10);

    // Per-vertex colour: blue(small) → white(mean) → red(large)
    const colors = new Float32Array(nv*3);
    for (let i=0; i<nv; i++) {
        const avgArea = vertexFaceCnt[i]>0 ? vertexAreaSum[i]/vertexFaceCnt[i] : meanA;
        const logRatio = Math.log(Math.max(avgArea, 1e-30)) - logMean; // negative=small, 0=mean, positive=large
        const t = Math.max(0, Math.min(1, logRatio / (2*LOG10) + 0.5));
        if (t < 0.5) { const s=t*2; colors[3*i]=s; colors[3*i+1]=s; colors[3*i+2]=1; }
        else          { const s=(t-0.5)*2; colors[3*i]=1; colors[3*i+1]=1-s; colors[3*i+2]=1-s; }
    }

    // Stats: compute min ignoring true zeros (degenerate faces)
    let minANonzero = Infinity;
    for (let f=0; f<nf; f++) if(faceAreas[f]>1e-30 && faceAreas[f]<minANonzero) minANonzero=faceAreas[f];
    const ratio = maxA / Math.max(minANonzero, 1e-30);
    const warn  = ratio > 10 ? ' ⚠ BAD' : ratio > 4 ? ' △ OK' : ' ✓ GOOD';
    const fmt = x => x.toExponential(3);
    const statsText = `faces   ${nf.toLocaleString()}\nvertices ${nv.toLocaleString()}\n\nmean  ${fmt(meanA)}\nmin   ${fmt(minANonzero)}\nmax   ${fmt(maxA)}\nratio ${ratio.toFixed(1)}×${warn}`;

    return { colors, statsText };
}

// ---------------------------------------------------------------------------
// Per-vertex min-angle coloring (dev mode)
// ---------------------------------------------------------------------------
function computeAngleColors(positions, indices) {
    const nv = positions.length / 3;
    const nf = indices.length / 3;
    // Track the minimum angle seen at each vertex across all adjacent faces
    const vertexMinAngle = new Float64Array(nv).fill(Math.PI);

    for (let f = 0; f < nf; f++) {
        const i0=indices[3*f], i1=indices[3*f+1], i2=indices[3*f+2];
        // Edge vectors from each vertex
        const ax=positions[3*i1]-positions[3*i0], ay=positions[3*i1+1]-positions[3*i0+1], az=positions[3*i1+2]-positions[3*i0+2];
        const bx=positions[3*i2]-positions[3*i0], by=positions[3*i2+1]-positions[3*i0+1], bz=positions[3*i2+2]-positions[3*i0+2];
        const cx=positions[3*i2]-positions[3*i1], cy=positions[3*i2+1]-positions[3*i1+1], cz=positions[3*i2+2]-positions[3*i1+2];
        const la=Math.sqrt(ax*ax+ay*ay+az*az)||1e-30;
        const lb=Math.sqrt(bx*bx+by*by+bz*bz)||1e-30;
        const lc=Math.sqrt(cx*cx+cy*cy+cz*cz)||1e-30;
        // Angle at each vertex via dot product
        const angA = Math.acos(Math.max(-1, Math.min(1, (ax*bx+ay*by+az*bz)/(la*lb))));
        const angB = Math.acos(Math.max(-1, Math.min(1, (-ax*cx-ay*cy-az*cz)/(la*lc))));
        const angC = Math.acos(Math.max(-1, Math.min(1, (bx*cx+by*cy+bz*cz)/(lb*lc))));
        vertexMinAngle[i0] = Math.min(vertexMinAngle[i0], angA);
        vertexMinAngle[i1] = Math.min(vertexMinAngle[i1], angB);
        vertexMinAngle[i2] = Math.min(vertexMinAngle[i2], angC);
    }

    // Map to color: 0°=red, 30°=white, 60°=blue (equilateral ideal)
    const DEG60 = Math.PI / 3;
    const colors = new Float32Array(nv * 3);
    let minDeg=180, maxDeg=0, totalDeg=0;
    for (let i = 0; i < nv; i++) {
        const deg = vertexMinAngle[i] * 180 / Math.PI;
        if (deg < minDeg) minDeg = deg;
        if (deg > maxDeg) maxDeg = deg;
        totalDeg += deg;
        const t = Math.max(0, Math.min(1, vertexMinAngle[i] / DEG60));
        if (t < 0.5) { const s=t*2; colors[3*i]=1; colors[3*i+1]=s; colors[3*i+2]=s; }
        else          { const s=(t-0.5)*2; colors[3*i]=1-s; colors[3*i+1]=1; colors[3*i+2]=1; }
    }
    const meanDeg = totalDeg / nv;
    // Count verts with min angle < 10°
    let badVerts = 0;
    for (let i = 0; i < nv; i++) if (vertexMinAngle[i] * 180 / Math.PI < 10) badVerts++;
    const statsText = `min angle  ${minDeg.toFixed(1)}°\nmean angle ${meanDeg.toFixed(1)}°\nmax angle  ${maxDeg.toFixed(1)}°\n\nbad verts (<10°)  ${badVerts}`;
    return { colors, statsText };
}

function applyQualityColors() {
    if (!meshObj) return;
    const mode = $('dev-color-mode').value;
    const src = mode === 'angle' ? angleColors : qualityColors;
    if (!src) return;
    const col = meshObj.geometry.attributes.color;
    col.array.set(src);
    col.needsUpdate = true;
}

function updateDevStats() {
    const mode = $('dev-color-mode').value;
    if (mode === 'angle') {
        $('dev-color-legend').textContent = 'Color: blue = 60° (ideal) · white = 30° · red = 0° (sliver)';
        $('quality-stats').textContent = angleStatsText;
    } else {
        $('dev-color-legend').textContent = 'Color: blue = small face · white = mean · red = large face';
        $('quality-stats').textContent = qualityStatsText;
    }
}

$('dev-mode').addEventListener('change', e => {
    devMode = e.target.checked;
    $('dev-panel').style.display = devMode ? '' : 'none';
    if (devMode && meshObj) applyQualityColors();
});

$('dev-color-mode').addEventListener('change', () => {
    updateDevStats();
    if (devMode && meshObj) applyQualityColors();
});

function getLapOpts() {
    return {
        cotMax:       parseFloat($('cot-max').value),
        areaFloorPct: parseFloat($('area-floor').value),
    };
}

$('btn-recompute-lap').addEventListener('click', () => {
    if (!origPos || !indices) return;
    stopSim();
    btnRun.disabled = btnPause.disabled = btnDownload.disabled = true;
    setOverlay('Recomputing Laplacian…');
    setTimeout(() => {
        try {
            lap = computeCotangentLaplacian(origPos, indices, getLapOpts());
            normals = computeVertexNormals(origPos, indices);
            setOverlay(null);
            btnRun.disabled = false;
        } catch (err) {
            setOverlay(`Error: ${err.message}`);
            console.error(err);
        }
    }, 30);
});

// ---------------------------------------------------------------------------
// Simulation controls
// ---------------------------------------------------------------------------
btnRun.addEventListener('click', () => {
    if (!lap) return;
    // Always restart from scratch so param changes take effect
    sim = new GrayScottSim(lap, { ...getSimParams(), ...getICParams() });
    running = true;
    btnRun.disabled = true; btnPause.disabled = false; btnDownload.disabled = true;
    setOverlay(null);
});

btnPause.addEventListener('click', () => {
    running = !running;
    btnPause.textContent = running ? 'Pause' : 'Resume';
    btnDownload.disabled = running;
    if (!running) btnRun.disabled = false;
});

btnDownload.addEventListener('click', downloadSTL);

function stopSim() { running = false; sim = null; }

// ---------------------------------------------------------------------------
// Params
// ---------------------------------------------------------------------------
function getICParams() {
    return {
        positions:  origPos,
        icMode:     $('ic-mode').value,
        numSeeds:   parseInt($('ic-seeds').value),
        blobRadius: parseInt($('ic-radius').value) / 100,
    };
}

function getSimParams() {
    const duScale = Math.pow(2, parseFloat($('scale').value));
    return {
        Du: 0.08 * duScale,
        Dv: 0.04 * duScale,
        F:  parseFloat($('feed').value),
        k:  parseFloat($('kill').value),
        dt: 1.0,
        seed: 42,
    };
}

function syncSliderLabel(id) {
    const el = $(id), val = $(id+'-val');
    el.addEventListener('input', () => {
        if (id === 'scale') {
            const s = Math.pow(2, parseFloat(el.value));
            val.textContent = s < 1 ? `÷${Math.round(1/s)}` : s === 1 ? '1×' : `${s.toFixed(1)}×`;
        } else if (id === 'max-steps') {
            maxSteps = parseInt(el.value);
            val.textContent = maxSteps >= 1000 ? `${maxSteps/1000}k` : maxSteps;
        } else if (id === 'min-faces') {
            const n = parseInt(el.value);
            val.textContent = n >= 1000 ? `${n/1000}k` : n;
        } else if (id === 'displacement') {
            val.textContent = parseFloat(el.value).toFixed(1) + '%';
        } else if (id === 'area-floor') {
            val.textContent = parseFloat(el.value).toFixed(1) + '%';
        } else if (id === 'cot-max') {
            val.textContent = parseFloat(el.value).toFixed(1);
        } else if (id === 'ic-seeds') {
            val.textContent = el.value;
        } else if (id === 'ic-radius' || id === 'flat-cutoff') {
            val.textContent = el.value + '%';
        } else {
            val.textContent = parseFloat(el.value).toFixed(3);
        }
        if (['feed','kill'].includes(id) && !applyingPreset) $('preset').value = 'custom';
    });
    el.dispatchEvent(new Event('input')); // init label
}
['feed','kill','scale','min-faces','max-steps','displacement','cot-max','area-floor','ic-seeds','ic-radius','flat-cutoff'].forEach(syncSliderLabel);

$('preset').addEventListener('change', e => {
    const p = PRESETS[e.target.value];
    if (!p) return;
    applyingPreset = true;
    $('feed').value = p.F; $('kill').value = p.k;
    $('feed').dispatchEvent(new Event('input'));
    $('kill').dispatchEvent(new Event('input'));
    applyingPreset = false;
});

// ---------------------------------------------------------------------------
// Animation loop
// ---------------------------------------------------------------------------
function animate() {
    requestAnimationFrame(animate);

    if (running && sim) {
        sim.advance(10);
        if (devMode) applyQualityColors(); else updateColors(sim.v);
        if (showRelief) updateRelief();

        const pct = Math.min(1, sim.stepCount / maxSteps);
        progressBar.style.width = `${pct*100}%`;
        statusStep.textContent = `Step ${sim.stepCount.toLocaleString()} / ${maxSteps.toLocaleString()}`;

        let vmin=Infinity, vmax=-Infinity, vtot=0;
        const v = sim.v;
        for (let i=0;i<v.length;i++){
            if(v[i]<vmin)vmin=v[i]; if(v[i]>vmax)vmax=v[i]; vtot+=v[i];
        }
        statusV.textContent = `v [${vmin.toFixed(3)}, ${vmax.toFixed(3)}] mean ${(vtot/v.length).toFixed(3)}`;

        if (sim.stepCount >= maxSteps) {
            running = false;
            btnPause.textContent = 'Resume';
            btnRun.disabled = false; btnPause.disabled = true; btnDownload.disabled = false;
        }
    }

    controls.update();
    renderer.render(scene, camera);
}
animate();

// ---------------------------------------------------------------------------
// Color update (hot path — no allocations)
// ---------------------------------------------------------------------------
function updateColors(v) {
    if (!meshObj) return;
    const col = meshObj.geometry.attributes.color;
    for (let i = 0; i < v.length; i++) viridisRGB(v[i] * 2, col.array, i);
    col.needsUpdate = true;
}

// ---------------------------------------------------------------------------
// Relief displacement preview
// ---------------------------------------------------------------------------
// Soft-clip: maps [0,1] through tanh so outlier spikes don't become huge.
// Values near 0 are nearly linear; values near 1 are compressed.
const TANH3 = Math.tanh(3);
function softclip(t) { return Math.tanh(t * 3) / TANH3; }

function updateRelief() {
    if (!meshObj || !sim || !origPos) return;
    const dispPct = parseFloat($('displacement').value) / 100;
    const symmetric = $('symmetric').checked;
    const box = new THREE.Box3().setFromObject(meshObj);
    const diag = box.getSize(new THREE.Vector3()).length();
    const maxDisp = diag * dispPct;

    const v = sim.v;
    let vmin = Infinity, vmax = -Infinity;
    for (let i = 0; i < v.length; i++) { if (v[i] < vmin) vmin = v[i]; if (v[i] > vmax) vmax = v[i]; }
    const vspan = Math.max(vmax - vmin, 1e-10);

    const pos = meshObj.geometry.attributes.position;
    for (let i = 0; i < v.length; i++) {
        const norm  = softclip((v[i] - vmin) / vspan);
        const scale = (symmetric ? (2 * norm - 1) : norm) * flatBottomFactor(origPos[3*i + upAxis]);
        pos.array[3*i]   = origPos[3*i]   + normals[3*i]   * scale * maxDisp;
        pos.array[3*i+1] = origPos[3*i+1] + normals[3*i+1] * scale * maxDisp;
        pos.array[3*i+2] = origPos[3*i+2] + normals[3*i+2] * scale * maxDisp;
    }
    pos.needsUpdate = true;
    meshObj.geometry.computeVertexNormals();
}

function resetRelief() {
    if (!meshObj || !origPos) return;
    const pos = meshObj.geometry.attributes.position;
    for (let i = 0; i < origPos.length; i++) pos.array[i] = origPos[i];
    pos.needsUpdate = true;
    meshObj.geometry.computeVertexNormals();
}

function updateFlatBottomCutoff() {
    if (!origPos) return;
    let vmin = Infinity, vmax = -Infinity;
    for (let i = 0; i < origPos.length / 3; i++) {
        const v = origPos[3*i + upAxis];
        if (v < vmin) vmin = v;
        if (v > vmax) vmax = v;
    }
    const pct = parseFloat($('flat-cutoff').value) / 100;
    flatBottomCut    = vmin + (vmax - vmin) * pct;
    flatBottomBlendH = (vmax - vmin) * 0.01; // 1% of height blend zone above cutoff
}

// Returns a 0–1 factor: 0 below cutoff (flat), 1 above (full displacement).
function flatBottomFactor(val) {
    if (!flatBottom) return 1;
    if (val <= flatBottomCut) return 0;
    if (val <= flatBottomCut + flatBottomBlendH) {
        const t = (val - flatBottomCut) / flatBottomBlendH;
        return t * t * (3 - 2 * t); // smoothstep
    }
    return 1;
}

$('up-axis').addEventListener('change', e => {
    upAxis = parseInt(e.target.value);
    updateFlatBottomCutoff();
    if (showRelief) updateRelief(); else if (flatBottom) resetRelief();
});

$('flat-bottom').addEventListener('change', e => {
    flatBottom = e.target.checked;
    $('flat-bottom-row').style.display = flatBottom ? '' : 'none';
    if (showRelief) updateRelief(); else resetRelief();
});

$('flat-cutoff').addEventListener('input', () => {
    updateFlatBottomCutoff();
    if (showRelief) updateRelief(); else if (flatBottom) resetRelief();
});

$('show-relief').addEventListener('change', e => {
    showRelief = e.target.checked;
    if (showRelief) updateRelief();
    else resetRelief();
});

// ---------------------------------------------------------------------------
// STL export
// ---------------------------------------------------------------------------
function downloadSTL() {
    if (!sim || !origPos) return;

    const dispPct = parseFloat($('displacement').value) / 100;
    const symmetric = $('symmetric').checked;
    const box = new THREE.Box3().setFromObject(meshObj);
    const diag = box.getSize(new THREE.Vector3()).length();
    const maxDisp = diag * dispPct;

    const v = sim.v;
    let vmin = Infinity, vmax = -Infinity;
    for (let i=0;i<v.length;i++){if(v[i]<vmin)vmin=v[i];if(v[i]>vmax)vmax=v[i];}
    const vspan = Math.max(vmax-vmin, 1e-10);

    const dispPos = new Float64Array(origPos);
    for (let i=0;i<v.length;i++) {
        const norm  = softclip((v[i]-vmin)/vspan);
        const scale = (symmetric ? (2*norm-1) : norm) * flatBottomFactor(origPos[3*i + upAxis]);
        dispPos[3*i]   += normals[3*i]   * scale * maxDisp;
        dispPos[3*i+1] += normals[3*i+1] * scale * maxDisp;
        dispPos[3*i+2] += normals[3*i+2] * scale * maxDisp;
    }
    const dispNor = computeVertexNormals(dispPos, indices);
    const nf = indices.length/3;
    const buf = new ArrayBuffer(84 + 50*nf);
    const dv  = new DataView(buf);
    const hdr = 'rd-surface — Gray-Scott mesh';
    for (let i=0;i<Math.min(hdr.length,80);i++) dv.setUint8(i, hdr.charCodeAt(i));
    dv.setUint32(80, nf, true);
    let off = 84;
    for (let f=0;f<nf;f++) {
        const i0=indices[3*f],i1=indices[3*f+1],i2=indices[3*f+2];
        let nx=(dispNor[3*i0]+dispNor[3*i1]+dispNor[3*i2])/3;
        let ny=(dispNor[3*i0+1]+dispNor[3*i1+1]+dispNor[3*i2+1])/3;
        let nz=(dispNor[3*i0+2]+dispNor[3*i1+2]+dispNor[3*i2+2])/3;
        const nl=Math.sqrt(nx*nx+ny*ny+nz*nz)||1; nx/=nl;ny/=nl;nz/=nl;
        dv.setFloat32(off,nx,true);off+=4; dv.setFloat32(off,ny,true);off+=4; dv.setFloat32(off,nz,true);off+=4;
        for (const i of [i0,i1,i2]) {
            dv.setFloat32(off,dispPos[3*i],true);off+=4;
            dv.setFloat32(off,dispPos[3*i+1],true);off+=4;
            dv.setFloat32(off,dispPos[3*i+2],true);off+=4;
        }
        dv.setUint16(off,0,true); off+=2;
    }
    const a = Object.assign(document.createElement('a'), {
        href: URL.createObjectURL(new Blob([buf], {type:'application/octet-stream'})),
        download: 'rd_surface.stl',
    });
    a.click(); URL.revokeObjectURL(a.href);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function setOverlay(msg) {
    overlay.textContent = msg || '';
    overlay.style.display = msg ? 'flex' : 'none';
}
function yield_() { return new Promise(r => setTimeout(r, 30)); }

// ---------------------------------------------------------------------------
// Default mesh (Utah teapot)
// ---------------------------------------------------------------------------
(async () => {
    try {
        const res = await fetch('utahteapot.stl');
        if (!res.ok) { console.log('[default] fetch failed:', res.status); return; }
        const blob = await res.blob();
        handleFile(new File([blob], 'utahteapot.stl'));
    } catch (e) { /* silently skip if not served from disk */ }
})();
