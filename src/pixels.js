// Minimal PNG decoder + palette stats so colour rules see what a human sees:
// canvas particles, glows and low-alpha borders never show up in computed CSS.
// Handles the PNGs Playwright emits (8-bit RGB/RGBA, non-interlaced).
import zlib from "node:zlib";

export function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");
  let pos = 8, width = 0, height = 0, colorType = 0, depth = 0, interlace = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos); const type = buf.toString("ascii", pos + 4, pos + 8); const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") { width = data.readUInt32BE(0); height = data.readUInt32BE(4); depth = data[8]; colorType = data[9]; interlace = data[12]; }
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    pos += 12 + len;
  }
  if (depth !== 8 || interlace !== 0 || ![2, 6].includes(colorType)) throw new Error(`unsupported PNG: depth=${depth} color=${colorType} interlace=${interlace}`);
  const bpp = colorType === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const out = Buffer.alloc(height * stride);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      let v = line[i];
      if (filter === 1) v += a; else if (filter === 2) v += b; else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      cur[i] = v & 255;
    }
    prev = cur;
  }
  return { width, height, bpp, data: out };
}

function hsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min, s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = (max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4) * 60;
  return { h, s, l };
}

// Hue bands a human reads as "AI neon": cyan/teal/mint and radium green.
// Violet is deliberately absent: Stripe, Discord, Twitch and Linear chose it
// before any model did, so it separates nothing.
export const NEON_BANDS = [
  { name: "cyan-teal-mint", from: 150, to: 200 },
  { name: "radium-green", from: 90, to: 150 },
];

export function paletteStats(png, { step = 3, maxRows = 6000 } = {}) {
  const { width, height, bpp, data } = png;
  const rows = Math.min(height, maxRows);
  let total = 0, dark = 0, chromatic = 0;
  const neon = Object.fromEntries(NEON_BANDS.map((b) => [b.name, 0]));
  const hueHist = new Array(36).fill(0);
  for (let y = 0; y < rows; y += step) for (let x = 0; x < width; x += step) {
    const i = (y * width + x) * bpp;
    const { h, s, l } = hsl(data[i], data[i + 1], data[i + 2]);
    total++;
    if (l < 0.18) dark++;
    if (s >= 0.45 && l >= 0.2 && l <= 0.85) {
      chromatic++;
      hueHist[Math.floor(h / 10) % 36]++;
      if (s >= 0.6 && l >= 0.3 && l <= 0.75) for (const b of NEON_BANDS) if (h >= b.from && h < b.to) neon[b.name]++;
    }
  }
  const neonTotal = Object.values(neon).reduce((a, b) => a + b, 0);
  return {
    sampled: total,
    darkShare: +(dark / total).toFixed(3),
    chromaticShare: +(chromatic / total).toFixed(3),
    neonShare: +(neonTotal / total).toFixed(4),
    neonOfChromatic: chromatic ? +(neonTotal / chromatic).toFixed(3) : 0,
    neonBands: Object.fromEntries(Object.entries(neon).map(([k, v]) => [k, +(v / total).toFixed(4)])),
    dominantHues: hueHist.map((c, i) => ({ hue: i * 10, share: +(c / Math.max(1, chromatic)).toFixed(3) })).filter((x) => x.share > 0.02).sort((a, b) => b.share - a.share).slice(0, 5),
  };
}
