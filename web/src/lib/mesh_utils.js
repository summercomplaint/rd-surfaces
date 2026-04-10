import * as THREE from 'three';
import { OBJLoader }       from 'three/addons/loaders/OBJLoader.js';
import { STLLoader }       from 'three/addons/loaders/STLLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// ---------------------------------------------------------------------------
// File loading
// ---------------------------------------------------------------------------

export async function loadMeshFromFile(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    const url = URL.createObjectURL(file);
    let geometry;
    try {
        if (ext === 'obj') {
            const obj = await new OBJLoader().loadAsync(url);
            const geos = [];
            obj.traverse(child => {
                if (!child.isMesh) return;
                child.updateWorldMatrix(true, false);
                const g = child.geometry.clone();
                g.applyMatrix4(child.matrixWorld);
                geos.push(g);
            });
            if (!geos.length) throw new Error('No meshes found in OBJ file.');
            geometry = geos.length === 1 ? geos[0] : mergeGeometries(geos);
        } else if (ext === 'stl') {
            geometry = await new STLLoader().loadAsync(url);
        } else {
            throw new Error(`Unsupported format ".${ext}". Use OBJ or STL.`);
        }
    } finally {
        URL.revokeObjectURL(url);
    }

    const posAttr  = geometry.attributes.position;
    const srcPos   = posAttr.array;
    const srcIdx   = geometry.index ? geometry.index.array : null;
    const nRef     = srcIdx ? srcIdx.length : srcPos.length / 3;

    let xmin=Infinity,xmax=-Infinity,ymin=Infinity,ymax=-Infinity,zmin=Infinity,zmax=-Infinity;
    for (let i=0; i<srcPos.length; i+=3) {
        if(srcPos[i  ]<xmin)xmin=srcPos[i  ]; if(srcPos[i  ]>xmax)xmax=srcPos[i  ];
        if(srcPos[i+1]<ymin)ymin=srcPos[i+1]; if(srcPos[i+1]>ymax)ymax=srcPos[i+1];
        if(srcPos[i+2]<zmin)zmin=srcPos[i+2]; if(srcPos[i+2]>zmax)zmax=srcPos[i+2];
    }
    const diag = Math.sqrt((xmax-xmin)**2+(ymax-ymin)**2+(zmax-zmin)**2);
    const tol  = Math.max(diag * 1e-5, 1e-10);
    const inv  = 1 / tol;

    const keyMap  = new Map();
    const newPosArr = [];
    const rawIdx = new Uint32Array(nRef);

    for (let i = 0; i < nRef; i++) {
        const vi = srcIdx ? srcIdx[i] : i;
        const x = srcPos[vi*3], y = srcPos[vi*3+1], z = srcPos[vi*3+2];
        const key = `${Math.round(x*inv)},${Math.round(y*inv)},${Math.round(z*inv)}`;
        let ni = keyMap.get(key);
        if (ni === undefined) { ni = newPosArr.length/3; keyMap.set(key, ni); newPosArr.push(x, y, z); }
        rawIdx[i] = ni;
    }

    let nGood = 0;
    for (let f = 0; f < nRef/3; f++) {
        const i0=rawIdx[3*f], i1=rawIdx[3*f+1], i2=rawIdx[3*f+2];
        if (i0 !== i1 && i1 !== i2 && i0 !== i2) {
            rawIdx[3*nGood]=i0; rawIdx[3*nGood+1]=i1; rawIdx[3*nGood+2]=i2;
            nGood++;
        }
    }
    const newIdxArr = rawIdx.subarray(0, nGood*3);

    console.log(`[mesh] welded: ${newPosArr.length/3} verts, ${nGood} faces `
              + `(removed ${nRef/3-nGood} degenerate, diag=${diag.toFixed(3)}, tol=${tol.toExponential(2)})`);

    return { positions: new Float64Array(newPosArr), indices: new Uint32Array(newIdxArr) };
}

// ---------------------------------------------------------------------------
// Adaptive subdivision
// ---------------------------------------------------------------------------

function edgeKey(a, b) { return a < b ? `${a}_${b}` : `${b}_${a}`; }

function surfaceArea(pos, faces) {
    let total = 0;
    for (const [i0, i1, i2] of faces) {
        const ax = pos[3*i1]-pos[3*i0], ay = pos[3*i1+1]-pos[3*i0+1], az = pos[3*i1+2]-pos[3*i0+2];
        const bx = pos[3*i2]-pos[3*i0], by = pos[3*i2+1]-pos[3*i0+1], bz = pos[3*i2+2]-pos[3*i0+2];
        total += Math.sqrt((ay*bz-az*by)**2 + (az*bx-ax*bz)**2 + (ax*by-ay*bx)**2) / 2;
    }
    return total;
}

function collapseShortEdges(pos, faces, minLen) {
    const n      = pos.length / 3;
    const par    = new Int32Array(n);
    for (let i = 0; i < n; i++) par[i] = i;
    function find(x) { while (par[x]!==x){par[x]=par[par[x]];x=par[x];}return x; }

    const minLen2 = minLen * minLen;
    // Collect unique edges and union-find merge short ones.
    // Crucially: measure the edge using ORIGINAL vertex positions, not root positions.
    const seen = new Set();
    for (const [i0, i1, i2] of faces) {
        for (const [a, b] of [[i0,i1],[i1,i2],[i0,i2]]) {
            const key = a<b ? a*100003+b : b*100003+a;
            if (seen.has(key)) continue;
            seen.add(key);
            const dx=pos[3*a]-pos[3*b], dy=pos[3*a+1]-pos[3*b+1], dz=pos[3*a+2]-pos[3*b+2];
            if (dx*dx+dy*dy+dz*dz < minLen2) {
                const ra=find(a), rb=find(b);
                if (ra !== rb) par[rb] = ra;
            }
        }
    }

    // New position for each root = centroid of all original vertices merged into it.
    const sum  = new Float64Array(n * 3);
    const cnt  = new Float64Array(n);
    for (let i = 0; i < n; i++) {
        const r = find(i);
        sum[3*r]+=pos[3*i]; sum[3*r+1]+=pos[3*i+1]; sum[3*r+2]+=pos[3*i+2];
        cnt[r]++;
    }

    const newFaces = [];
    for (const [i0, i1, i2] of faces) {
        const r0=find(i0), r1=find(i1), r2=find(i2);
        if (r0!==r1 && r1!==r2 && r0!==r2) newFaces.push([r0,r1,r2]);
    }

    const used = new Uint8Array(n);
    for (const [a,b,c] of newFaces) { used[a]=1; used[b]=1; used[c]=1; }
    const renum = new Int32Array(n).fill(-1);
    const newPos = [];
    for (let i = 0; i < n; i++) {
        if (!used[i]) continue;
        renum[i] = newPos.length / 3;
        newPos.push(sum[3*i]/cnt[i], sum[3*i+1]/cnt[i], sum[3*i+2]/cnt[i]);
    }
    return { pos: newPos, faces: newFaces.map(([a,b,c]) => [renum[a],renum[b],renum[c]]) };
}

function subdividePass(pos, faces, threshold) {
    const splitMap = new Map();
    const newPos = pos.slice();

    for (const [i0, i1, i2] of faces) {
        for (const [a, b] of [[i0,i1],[i1,i2],[i0,i2]]) {
            const key = edgeKey(a, b);
            if (splitMap.has(key)) continue;
            const dx=pos[3*a]-pos[3*b], dy=pos[3*a+1]-pos[3*b+1], dz=pos[3*a+2]-pos[3*b+2];
            if (dx*dx + dy*dy + dz*dz > threshold*threshold) {
                splitMap.set(key, newPos.length / 3);
                newPos.push((pos[3*a]+pos[3*b])/2, (pos[3*a+1]+pos[3*b+1])/2, (pos[3*a+2]+pos[3*b+2])/2);
            }
        }
    }
    if (splitMap.size === 0) return null;

    const newFaces = [];
    for (const [i0, i1, i2] of faces) {
        const m01 = splitMap.get(edgeKey(i0,i1)) ?? -1;
        const m12 = splitMap.get(edgeKey(i1,i2)) ?? -1;
        const m02 = splitMap.get(edgeKey(i0,i2)) ?? -1;
        const n = (m01>=0) + (m12>=0) + (m02>=0);
        if (n === 0) {
            newFaces.push([i0,i1,i2]);
        } else if (n === 3) {
            newFaces.push([i0,m01,m02],[m01,i1,m12],[m02,m12,i2],[m01,m12,m02]);
        } else if (n === 1) {
            if      (m01>=0) newFaces.push([i0,m01,i2],[m01,i1,i2]);
            else if (m12>=0) newFaces.push([i0,i1,m12],[i0,m12,i2]);
            else             newFaces.push([i0,i1,m02],[i1,i2,m02]);
        } else {
            if      (m01<0) newFaces.push([i0,i1,m12],[i0,m12,m02],[m12,i2,m02]);
            else if (m12<0) newFaces.push([i0,m01,m02],[m01,i1,m02],[i1,i2,m02]);
            else            newFaces.push([i0,m01,i2],[m01,i1,m12],[m01,m12,i2]);
        }
    }
    return { pos: newPos, faces: newFaces };
}

// Tangential Laplacian smoothing — moves vertices toward their neighbor centroid
// but only in the tangent plane direction, so vertices stay on the surface instead
// of drifting inward and shrinking the mesh (the flaw in unconstrained smoothing).
function tangentialSmooth(pos, faces, iterations = 5, factor = 0.5) {
    const n = pos.length / 3;
    let cur = pos.slice();

    for (let iter = 0; iter < iterations; iter++) {
        // Build adjacency and vertex normals in one pass
        const adj = Array.from({ length: n }, () => []);
        const nor = new Float64Array(n * 3);

        for (const [i0, i1, i2] of faces) {
            adj[i0].push(i1, i2);
            adj[i1].push(i0, i2);
            adj[i2].push(i0, i1);
            const ax=cur[3*i1]-cur[3*i0], ay=cur[3*i1+1]-cur[3*i0+1], az=cur[3*i1+2]-cur[3*i0+2];
            const bx=cur[3*i2]-cur[3*i0], by=cur[3*i2+1]-cur[3*i0+1], bz=cur[3*i2+2]-cur[3*i0+2];
            const nx=ay*bz-az*by, ny=az*bx-ax*bz, nz=ax*by-ay*bx;
            for (const i of [i0, i1, i2]) { nor[3*i]+=nx; nor[3*i+1]+=ny; nor[3*i+2]+=nz; }
        }
        for (let i = 0; i < n; i++) {
            const x=nor[3*i], y=nor[3*i+1], z=nor[3*i+2];
            const len = Math.sqrt(x*x+y*y+z*z) || 1;
            nor[3*i]/=len; nor[3*i+1]/=len; nor[3*i+2]/=len;
        }

        const nxt = cur.slice();
        for (let i = 0; i < n; i++) {
            // Deduplicate neighbors
            const seen = new Set(); const nb = [];
            for (const j of adj[i]) { if (!seen.has(j)) { seen.add(j); nb.push(j); } }
            if (!nb.length) continue;

            let cx=0, cy=0, cz=0;
            for (const j of nb) { cx+=cur[3*j]; cy+=cur[3*j+1]; cz+=cur[3*j+2]; }
            cx/=nb.length; cy/=nb.length; cz/=nb.length;

            // Displacement toward centroid
            let dx=cx-cur[3*i], dy=cy-cur[3*i+1], dz=cz-cur[3*i+2];
            // Remove normal component — only move along the tangent plane
            const nx=nor[3*i], ny=nor[3*i+1], nz=nor[3*i+2];
            const dot = dx*nx+dy*ny+dz*nz;
            dx-=dot*nx; dy-=dot*ny; dz-=dot*nz;

            nxt[3*i]   = cur[3*i]   + factor*dx;
            nxt[3*i+1] = cur[3*i+1] + factor*dy;
            nxt[3*i+2] = cur[3*i+2] + factor*dz;
        }
        cur = nxt;
    }
    return cur;
}

// Edge flipping — for each interior edge shared by two triangles, flip it if
// doing so reduces the total deviation of vertex valences from the ideal (6).
// Uses integer edge keys (fast) and runs up to maxPasses per call. Within each
// pass, faces already flipped this pass are skipped to prevent stale-entry
// corruption (an earlier flip changes the face, but the edgeMap still has the
// old opposite-vertex recorded for that face's other edges).
function flipEdges(pos, faces, maxPasses = 3) {
    const n = pos.length / 3;

    for (let pass = 0; pass < maxPasses; pass++) {
        // Rebuild valence and edge map fresh each pass.
        // Integer keys (u < v ? u*n+v : v*n+u) are ~10× faster than string keys.
        const valence = new Int32Array(n);
        for (const [a, b, c] of faces) { valence[a]++; valence[b]++; valence[c]++; }

        const edgeMap = new Map();
        for (let fi = 0; fi < faces.length; fi++) {
            const f = faces[fi];
            for (let i = 0; i < 3; i++) {
                const u=f[i], v=f[(i+1)%3], w=f[(i+2)%3];
                const key = u < v ? u * n + v : v * n + u;
                if (!edgeMap.has(key)) edgeMap.set(key, []);
                edgeMap.get(key).push({ fi, u, v, opp: w });
            }
        }

        let nFlipped = 0;
        const touchedFaces = new Set();  // faces flipped this pass — edgeMap entries are now stale
        const newEdgeKeys  = new Set();  // integer keys of edges created this pass
        for (const [, entries] of edgeMap) {
            if (entries.length !== 2) continue;
            const { fi: f0, u, v, opp: a } = entries[0];
            const { fi: f1, opp: b }        = entries[1];
            if (a === b) continue;

            // Skip if either face was already flipped this pass — its edgeMap entries are stale.
            if (touchedFaces.has(f0) || touchedFaces.has(f1)) continue;

            // Skip if the new edge already exists or was just created this pass.
            const newKey = a < b ? a * n + b : b * n + a;
            if (edgeMap.has(newKey) || newEdgeKeys.has(newKey)) continue;

            // Flip only if it strictly improves total valence deviation from ideal 6.
            const dev = x => Math.abs(x - 6);
            const before = dev(valence[u])+dev(valence[v])+dev(valence[a])+dev(valence[b]);
            const after  = dev(valence[u]-1)+dev(valence[v]-1)+dev(valence[a]+1)+dev(valence[b]+1);
            if (after >= before) continue;

            // Verify new triangles are not degenerate and don't flip surface orientation.
            if (!normalsConsistent(pos, u,v,a, u,a,b)) continue;
            if (!normalsConsistent(pos, v,u,b, v,b,a)) continue;

            faces[f0] = [u, a, b];
            faces[f1] = [v, b, a];
            valence[u]--; valence[v]--;
            valence[a]++; valence[b]++;
            touchedFaces.add(f0);
            touchedFaces.add(f1);
            newEdgeKeys.add(newKey);
            nFlipped++;
        }

        if (nFlipped === 0) break;
    }
    return faces;
}

function triNormal(pos, a, b, c) {
    const ax=pos[3*b]-pos[3*a], ay=pos[3*b+1]-pos[3*a+1], az=pos[3*b+2]-pos[3*a+2];
    const bx=pos[3*c]-pos[3*a], by=pos[3*c+1]-pos[3*a+1], bz=pos[3*c+2]-pos[3*a+2];
    const nx=ay*bz-az*by, ny=az*bx-ax*bz, nz=ax*by-ay*bx;
    const len = Math.sqrt(nx*nx+ny*ny+nz*nz);
    return len > 1e-20 ? [nx/len, ny/len, nz/len] : null;
}

function normalsConsistent(pos, a0,b0,c0, a1,b1,c1) {
    const n0 = triNormal(pos, a0, b0, c0);
    const n1 = triNormal(pos, a1, b1, c1);
    return n0 && n1 && n0[0]*n1[0]+n0[1]*n1[1]+n0[2]*n1[2] > 0;
}

export function remeshForSimulation(positions, indices, minFaces = 12000) {
    let pos = Array.from(positions);
    let faces = [];
    for (let f = 0; f < indices.length / 3; f++)
        faces.push([indices[3*f], indices[3*f+1], indices[3*f+2]]);

    const area    = surfaceArea(pos, faces);
    const targetH = Math.sqrt(4 * area / (Math.sqrt(3) * minFaces));
    // Split threshold: edges longer than this get subdivided.
    // Collapse threshold: MUST be < splitThr/2 (= 2/3·targetH) to avoid
    // newly-created subdivision edges being immediately collapsed (oscillation).
    const splitThr = targetH * 4/3;       // 1.33·targetH
    const collThr  = targetH * 3/8;       // 0.375·targetH  (< 0.667·targetH ✓)

    console.log(`[remesh] input: ${faces.length} faces, targetH=${targetH.toFixed(4)}`);

    // Phase 1: subdivide-only until all edges are below splitThr.
    // No interleaved collapse here — interleaving causes split→collapse oscillation
    // because subdivision produces edges at ~2/3·targetH which exceed collThr.
    for (let iter = 0; iter < 10; iter++) {
        const sr = subdividePass(pos, faces, splitThr);
        if (!sr) break;
        pos = sr.pos; faces = sr.faces;
        console.log(`[remesh] split ${iter+1}: ${faces.length} faces`);
    }

    // Phase 2: collapse very-short slivers, flip for valence, smooth.
    // collThr is conservative (3/8·targetH) so phase-1 edges (~2/3·targetH) are safe.
    for (let iter = 0; iter < 5; iter++) {
        const nBefore = faces.length;
        const cr = collapseShortEdges(pos, faces, collThr);
        pos = cr.pos; faces = cr.faces;
        faces = flipEdges(pos, faces);
        pos = tangentialSmooth(pos, faces, 2, 0.5);
        console.log(`[remesh] refine ${iter+1}: ${faces.length} faces`);
        if (Math.abs(faces.length - nBefore) < 10) break;
    }

    // Final smoothing pass
    pos = tangentialSmooth(pos, faces, 5, 0.5);

    const outPos = new Float64Array(pos);
    const outIdx = new Uint32Array(faces.length * 3);
    for (let f = 0; f < faces.length; f++) {
        outIdx[3*f] = faces[f][0]; outIdx[3*f+1] = faces[f][1]; outIdx[3*f+2] = faces[f][2];
    }
    return { positions: outPos, indices: outIdx };
}

// ---------------------------------------------------------------------------
// Cotangent Laplacian
// ---------------------------------------------------------------------------

export function computeCotangentLaplacian(positions, indices, opts = {}) {
    const { cotMax = 1, areaFloorPct = 10 } = opts;
    const n   = positions.length / 3;
    const nf  = indices.length / 3;

    const edgeW = new Map();
    const vertexAreas = new Float64Array(n);

    for (let f = 0; f < nf; f++) {
        const i0=indices[3*f], i1=indices[3*f+1], i2=indices[3*f+2];
        const x0=positions[3*i0], y0=positions[3*i0+1], z0=positions[3*i0+2];
        const x1=positions[3*i1], y1=positions[3*i1+1], z1=positions[3*i1+2];
        const x2=positions[3*i2], y2=positions[3*i2+1], z2=positions[3*i2+2];
        const e01x=x1-x0,e01y=y1-y0,e01z=z1-z0;
        const e02x=x2-x0,e02y=y2-y0,e02z=z2-z0;
        const e12x=x2-x1,e12y=y2-y1,e12z=z2-z1;
        const cx=e01y*e02z-e01z*e02y, cy=e01z*e02x-e01x*e02z, cz=e01x*e02y-e01y*e02x;
        const area2 = Math.max(Math.sqrt(cx*cx+cy*cy+cz*cz), 1e-10);
        const cot0 = Math.max(-cotMax, Math.min(cotMax, (e01x*e02x+e01y*e02y+e01z*e02z)/area2));
        const cot1 = Math.max(-cotMax, Math.min(cotMax, (-e01x*e12x-e01y*e12y-e01z*e12z)/area2));
        const cot2 = Math.max(-cotMax, Math.min(cotMax, (e02x*e12x+e02y*e12y+e02z*e12z)/area2));

        const k12=edgeKey(i1,i2), k02=edgeKey(i0,i2), k01=edgeKey(i0,i1);
        edgeW.set(k12,(edgeW.get(k12)||0)+cot0/2);
        edgeW.set(k02,(edgeW.get(k02)||0)+cot1/2);
        edgeW.set(k01,(edgeW.get(k01)||0)+cot2/2);

        const fa = area2/2;
        vertexAreas[i0]+=fa/3; vertexAreas[i1]+=fa/3; vertexAreas[i2]+=fa/3;
    }
    let totalVA = 0;
    for (let i=0;i<n;i++) totalVA += vertexAreas[i];
    const minVA = (totalVA / n) * (areaFloorPct / 100);
    for (let i=0;i<n;i++) vertexAreas[i]=Math.max(vertexAreas[i], minVA);

    const edges = [];
    let totalLen = 0;
    for (const [key, w] of edgeW) {
        const under = key.indexOf('_');
        const i = parseInt(key.slice(0, under)), j = parseInt(key.slice(under+1));
        edges.push([i, j, w]);
        const dx=positions[3*i]-positions[3*j], dy=positions[3*i+1]-positions[3*j+1], dz=positions[3*i+2]-positions[3*j+2];
        totalLen += Math.sqrt(dx*dx+dy*dy+dz*dz);
    }
    const hMean = edges.length ? totalLen/edges.length : 1;

    const degree = new Int32Array(n);
    for (const [i,j] of edges) { degree[i]++; degree[j]++; }

    const rowPtr = new Int32Array(n+1);
    for (let i=0;i<n;i++) rowPtr[i+1]=rowPtr[i]+degree[i]+1;
    const nnz = rowPtr[n];
    const colIdx = new Int32Array(nnz);
    const values = new Float64Array(nnz);
    const fill   = new Int32Array(n);

    for (let i=0;i<n;i++) { colIdx[rowPtr[i]]=i; fill[i]=1; }

    for (const [i,j,w] of edges) {
        const pi = rowPtr[i]+fill[i]++; colIdx[pi]=j; values[pi]=w; values[rowPtr[i]]-=w;
        const pj = rowPtr[j]+fill[j]++; colIdx[pj]=i; values[pj]=w; values[rowPtr[j]]-=w;
    }

    return { rowPtr, colIdx, values, n, vertexAreas, hMean };
}

// ---------------------------------------------------------------------------
// Vertex normals
// ---------------------------------------------------------------------------

export function computeVertexNormals(positions, indices) {
    const n = positions.length/3;
    const nor = new Float32Array(n*3);
    for (let f=0; f<indices.length/3; f++) {
        const i0=indices[3*f],i1=indices[3*f+1],i2=indices[3*f+2];
        const ax=positions[3*i1]-positions[3*i0],ay=positions[3*i1+1]-positions[3*i0+1],az=positions[3*i1+2]-positions[3*i0+2];
        const bx=positions[3*i2]-positions[3*i0],by=positions[3*i2+1]-positions[3*i0+1],bz=positions[3*i2+2]-positions[3*i0+2];
        const nx=ay*bz-az*by, ny=az*bx-ax*bz, nz=ax*by-ay*bx;
        for (const i of [i0,i1,i2]) { nor[3*i]+=nx; nor[3*i+1]+=ny; nor[3*i+2]+=nz; }
    }
    for (let i=0;i<n;i++) {
        const x=nor[3*i],y=nor[3*i+1],z=nor[3*i+2];
        const len=Math.sqrt(x*x+y*y+z*z)||1;
        nor[3*i]/=len; nor[3*i+1]/=len; nor[3*i+2]/=len;
    }
    return nor;
}
