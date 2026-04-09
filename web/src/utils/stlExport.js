import { computeVertexNormals } from '../lib/mesh_utils.js';
import { softclip } from './colormap.js';

/**
 * Compute displaced positions and write a binary STL, returned as a Blob.
 */
export function buildSTLBlob(origPos, normals, indices, v, {
    diag, dispPct, symmetric, reverse, upAxis, flatBottom, flatCutoff,
}) {
    const maxDisp = diag * dispPct / 100;

    let vmin = Infinity, vmax = -Infinity;
    for (let i = 0; i < v.length; i++) {
        if (v[i] < vmin) vmin = v[i];
        if (v[i] > vmax) vmax = v[i];
    }
    const vspan = Math.max(vmax - vmin, 1e-10);

    // Flat-bottom cutoff precomputed inline (cheap for one-shot export)
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
        if (val <= cutVal + blendH) {
            const t = (val - cutVal) / blendH;
            return t * t * (3 - 2 * t);
        }
        return 1;
    }

    const dispPos = new Float64Array(origPos);
    for (let i = 0; i < v.length; i++) {
        const norm  = softclip((v[i] - vmin) / vspan);
        const base  = reverse ? (1 - norm) : norm;
        const scale = (symmetric ? (2 * base - 1) : base) * flatFactor(origPos[3*i + upAxis]);
        dispPos[3*i]   += normals[3*i]   * scale * maxDisp;
        dispPos[3*i+1] += normals[3*i+1] * scale * maxDisp;
        dispPos[3*i+2] += normals[3*i+2] * scale * maxDisp;
    }

    const dispNor = computeVertexNormals(dispPos, indices);
    const nf  = indices.length / 3;
    const buf = new ArrayBuffer(84 + 50 * nf);
    const dv  = new DataView(buf);
    const hdr = 'rd-surface \u2014 Gray-Scott mesh';
    for (let i = 0; i < Math.min(hdr.length, 80); i++) dv.setUint8(i, hdr.charCodeAt(i));
    dv.setUint32(80, nf, true);
    let off = 84;
    for (let f = 0; f < nf; f++) {
        const i0=indices[3*f], i1=indices[3*f+1], i2=indices[3*f+2];
        let nx=(dispNor[3*i0]+dispNor[3*i1]+dispNor[3*i2])/3;
        let ny=(dispNor[3*i0+1]+dispNor[3*i1+1]+dispNor[3*i2+1])/3;
        let nz=(dispNor[3*i0+2]+dispNor[3*i1+2]+dispNor[3*i2+2])/3;
        const nl=Math.sqrt(nx*nx+ny*ny+nz*nz)||1; nx/=nl; ny/=nl; nz/=nl;
        dv.setFloat32(off,nx,true);off+=4; dv.setFloat32(off,ny,true);off+=4; dv.setFloat32(off,nz,true);off+=4;
        for (const i of [i0,i1,i2]) {
            dv.setFloat32(off,dispPos[3*i],  true);off+=4;
            dv.setFloat32(off,dispPos[3*i+1],true);off+=4;
            dv.setFloat32(off,dispPos[3*i+2],true);off+=4;
        }
        dv.setUint16(off,0,true); off+=2;
    }
    return new Blob([buf], { type: 'application/octet-stream' });
}

export function triggerDownload(blob, filename = 'rd_surface.stl') {
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), { href: url, download: filename });
    a.click();
    URL.revokeObjectURL(url);
}
