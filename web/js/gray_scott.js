function mulberry32(seed) {
    let s = seed >>> 0;
    return () => {
        s += 0x6D2B79F5;
        let t = Math.imul(s ^ s >>> 15, 1 | s);
        t ^= t + Math.imul(t ^ t >>> 7, 61 | t);
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

export class GrayScottSim {
    constructor(lap, opts = {}) {
        const {
            Du = 0.08, Dv = 0.04, F = 0.055, k = 0.062, dt = 1.0, seed = 42,
            positions = null, icMode = 'blobs', numSeeds = 5, blobRadius = 0.05,
        } = opts;
        const { rowPtr, colIdx, values, n, vertexAreas, hMean } = lap;

        this.rowPtr = rowPtr;
        this.colIdx = colIdx;
        this.Lval   = values;
        this.n      = n;

        this.invArea = new Float64Array(n);
        for (let i = 0; i < n; i++) this.invArea[i] = 1.0 / vertexAreas[i];

        this.DuEff = Du * hMean * hMean;
        this.DvEff = Dv * hMean * hMean;
        this.F  = F;
        this.k  = k;
        this.dt = dt;

        this.u   = new Float64Array(n);
        this.v   = new Float64Array(n);
        this._Lu = new Float64Array(n);
        this._Lv = new Float64Array(n);
        this.stepCount = 0;

        this._init(seed, positions, icMode, numSeeds, blobRadius);
    }

    _init(seed, positions, icMode, numSeeds, blobRadius) {
        const rand = mulberry32(seed);
        const n = this.n;

        if (icMode === 'noise' || !positions) {
            // Original uniform noise — can die out for some parameter combos
            for (let i = 0; i < n; i++) {
                this.u[i] = Math.min(1, Math.max(0, 0.5 + (rand() - 0.5) * 0.2));
                this.v[i] = Math.min(1, Math.max(0, 0.25 + (rand() - 0.5) * 0.2));
            }
            return;
        }

        // Gaussian blobs: start from u=1, v=0 and seed a few concentrated patches.
        // Works for presets that need a localised trigger (spots, dots, etc.).
        for (let i = 0; i < n; i++) { this.u[i] = 1; this.v[i] = 0; }

        // Bbox diagonal → physical sigma
        let xmn=Infinity,xmx=-Infinity,ymn=Infinity,ymx=-Infinity,zmn=Infinity,zmx=-Infinity;
        for (let i = 0; i < n; i++) {
            const x=positions[3*i], y=positions[3*i+1], z=positions[3*i+2];
            if(x<xmn)xmn=x; if(x>xmx)xmx=x;
            if(y<ymn)ymn=y; if(y>ymx)ymx=y;
            if(z<zmn)zmn=z; if(z>zmx)zmx=z;
        }
        const diag  = Math.sqrt((xmx-xmn)**2+(ymx-ymn)**2+(zmx-zmn)**2);
        const sigma  = diag * blobRadius;
        const inv2s2 = 1 / (2 * sigma * sigma);

        for (let s = 0; s < numSeeds; s++) {
            const si = Math.floor(rand() * n);
            const sx = positions[3*si], sy = positions[3*si+1], sz = positions[3*si+2];
            for (let i = 0; i < n; i++) {
                const dx=positions[3*i]-sx, dy=positions[3*i+1]-sy, dz=positions[3*i+2]-sz;
                const g = Math.exp(-(dx*dx+dy*dy+dz*dz)*inv2s2);
                this.v[i] = Math.min(0.5, this.v[i] + g * 0.25);
            }
        }
        // Leave u=1 throughout — suppressing u at blob centres kills the reaction
        // (uvv→0 there) and creates hollow rings. Let the dynamics sort it out.
        for (let i = 0; i < n; i++) {
            this.u[i] = Math.min(1, Math.max(0, this.u[i] + (rand()-0.5)*0.01));
            this.v[i] = Math.min(1, Math.max(0, this.v[i] + (rand()-0.5)*0.01));
        }
    }

    _spMV(x, out) {
        const { rowPtr, colIdx, Lval, invArea, n } = this;
        for (let i = 0; i < n; i++) {
            let s = 0;
            const end = rowPtr[i + 1];
            for (let p = rowPtr[i]; p < end; p++) s += Lval[p] * x[colIdx[p]];
            out[i] = s * invArea[i];
        }
    }

    advance(steps = 1) {
        const { n, _Lu, _Lv, DuEff, DvEff, F, k, dt } = this;
        const Fk = F + k;
        const u = this.u, v = this.v;
        for (let s = 0; s < steps; s++) {
            this._spMV(u, _Lu);
            this._spMV(v, _Lv);
            for (let i = 0; i < n; i++) {
                const uvv = u[i] * v[i] * v[i];
                u[i] = Math.min(1, Math.max(0, u[i] + dt * (DuEff * _Lu[i] - uvv + F * (1 - u[i]))));
                v[i] = Math.min(1, Math.max(0, v[i] + dt * (DvEff * _Lv[i] + uvv - Fk * v[i])));
            }
        }
        this.stepCount += steps;
    }
}
