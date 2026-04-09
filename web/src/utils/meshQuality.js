/** Compute per-vertex face-size colors and stats for dev mode. */
export function computeSizeQuality(positions, indices) {
    const nv = positions.length / 3;
    const nf = indices.length / 3;
    const vertexAreaSum = new Float64Array(nv);
    const vertexFaceCnt = new Uint32Array(nv);
    const faceAreas     = new Float64Array(nf);
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

    let maxA=-Infinity;
    for (let f=0;f<nf;f++) if(faceAreas[f]>maxA) maxA=faceAreas[f];
    const meanA = totalArea / nf;
    const logMean = Math.log(Math.max(meanA, 1e-30));
    const LOG10 = Math.log(10);

    const colors = new Float32Array(nv*3);
    for (let i=0; i<nv; i++) {
        const avgArea = vertexFaceCnt[i]>0 ? vertexAreaSum[i]/vertexFaceCnt[i] : meanA;
        const logRatio = Math.log(Math.max(avgArea, 1e-30)) - logMean;
        const t = Math.max(0, Math.min(1, logRatio / (2*LOG10) + 0.5));
        if (t < 0.5) { const s=t*2; colors[3*i]=s; colors[3*i+1]=s; colors[3*i+2]=1; }
        else          { const s=(t-0.5)*2; colors[3*i]=1; colors[3*i+1]=1-s; colors[3*i+2]=1-s; }
    }

    let minANonzero = Infinity;
    for (let f=0;f<nf;f++) if(faceAreas[f]>1e-30 && faceAreas[f]<minANonzero) minANonzero=faceAreas[f];
    const ratio = maxA / Math.max(minANonzero, 1e-30);
    const warn  = ratio > 10 ? ' \u26A0 BAD' : ratio > 4 ? ' \u25B3 OK' : ' \u2713 GOOD';
    const fmt = x => x.toExponential(3);
    const statsText = `faces    ${nf.toLocaleString()}\nvertices ${nv.toLocaleString()}\n\nmean  ${fmt(meanA)}\nmin   ${fmt(minANonzero)}\nmax   ${fmt(maxA)}\nratio ${ratio.toFixed(1)}\xd7${warn}`;

    return { colors, statsText };
}

/** Compute per-vertex min-angle colors and stats for dev mode. */
export function computeAngleQuality(positions, indices) {
    const nv = positions.length / 3;
    const nf = indices.length / 3;
    const vertexMinAngle = new Float64Array(nv).fill(Math.PI);

    for (let f = 0; f < nf; f++) {
        const i0=indices[3*f], i1=indices[3*f+1], i2=indices[3*f+2];
        const ax=positions[3*i1]-positions[3*i0], ay=positions[3*i1+1]-positions[3*i0+1], az=positions[3*i1+2]-positions[3*i0+2];
        const bx=positions[3*i2]-positions[3*i0], by=positions[3*i2+1]-positions[3*i0+1], bz=positions[3*i2+2]-positions[3*i0+2];
        const cx=positions[3*i2]-positions[3*i1], cy=positions[3*i2+1]-positions[3*i1+1], cz=positions[3*i2+2]-positions[3*i1+2];
        const la=Math.sqrt(ax*ax+ay*ay+az*az)||1e-30;
        const lb=Math.sqrt(bx*bx+by*by+bz*bz)||1e-30;
        const lc=Math.sqrt(cx*cx+cy*cy+cz*cz)||1e-30;
        const angA = Math.acos(Math.max(-1, Math.min(1, (ax*bx+ay*by+az*bz)/(la*lb))));
        const angB = Math.acos(Math.max(-1, Math.min(1, (-ax*cx-ay*cy-az*cz)/(la*lc))));
        const angC = Math.acos(Math.max(-1, Math.min(1, (bx*cx+by*cy+bz*cz)/(lb*lc))));
        vertexMinAngle[i0] = Math.min(vertexMinAngle[i0], angA);
        vertexMinAngle[i1] = Math.min(vertexMinAngle[i1], angB);
        vertexMinAngle[i2] = Math.min(vertexMinAngle[i2], angC);
    }

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
    let badVerts = 0;
    for (let i = 0; i < nv; i++) if (vertexMinAngle[i] * 180 / Math.PI < 10) badVerts++;
    const statsText = `min angle  ${minDeg.toFixed(1)}\xb0\nmean angle ${meanDeg.toFixed(1)}\xb0\nmax angle  ${maxDeg.toFixed(1)}\xb0\n\nbad verts (<10\xb0)  ${badVerts}`;
    return { colors, statsText };
}
