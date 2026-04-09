// Colormap LUT — 5 stops read from CSS custom properties
// --colormap-0 … --colormap-4  (hex values defined in App.css :root)
// Default falls back to viridis if the CSS vars are missing.

const FALLBACK = [
    [68/255,  1/255, 84/255],
    [59/255, 82/255,139/255],
    [33/255,145/255,140/255],
    [94/255,201/255, 98/255],
    [253/255,231/255, 37/255],
];

let V = null;

function parseHex(raw) {
    const h = raw.trim().replace('#', '');
    if (h.length !== 6) return null;
    return [
        parseInt(h.slice(0, 2), 16) / 255,
        parseInt(h.slice(2, 4), 16) / 255,
        parseInt(h.slice(4, 6), 16) / 255,
    ];
}

export function rebuildLUT() {
    const style = getComputedStyle(document.documentElement);
    V = [0, 1, 2, 3, 4].map(i => {
        const raw = style.getPropertyValue(`--colormap-${i}`);
        return parseHex(raw) ?? FALLBACK[i];
    });
}

/** Write colormap color for value t∈[0,1] into Float32Array at vertex index i. */
export function viridisRGB(t, out, i) {
    if (!V) rebuildLUT();
    t = Math.max(0, Math.min(1, t));
    const s = t * 4, si = Math.min(s | 0, 3), sf = s - si;
    const a = V[si], b = V[si + 1];
    out[i * 3]     = a[0] + sf * (b[0] - a[0]);
    out[i * 3 + 1] = a[1] + sf * (b[1] - a[1]);
    out[i * 3 + 2] = a[2] + sf * (b[2] - a[2]);
}

const TANH3 = Math.tanh(3);
/** Soft-clip t∈[0,1] through tanh so outlier spikes don't dominate. */
export function softclip(t) { return Math.tanh(t * 3) / TANH3; }
