import test from "node:test";
import assert from "node:assert/strict";
import { RULES, runRules } from "../src/rules/index.js";
import { score, CATEGORIES } from "../src/score.js";
import { emDashDensity, repeatedPhrases, honestyHits, buzzwordHits, isTitleCase, betaPillHits } from "../src/text.js";
import { paletteStats, decodePng } from "../src/pixels.js";
import zlib from "node:zlib";

const rule = (id) => RULES.find((r) => r.id === id);
const empty = { palette: { darkShare: 0, chromaticShare: 0, neonShare: 0, neonOfChromatic: 0, neonBands: {} }, colors: [], glow: { count: 0 }, decor: { canvases: [], networkSvgs: [], animations: [] }, pills: [], eyebrows: [], tags: [], orbs: [], gradients: {}, cards: {}, headings: [], testimonials: [], stats: [], images: {}, links: {}, placeholders: [], builderMarkers: [], description: "x", favicon: true, fullText: "", fullWordCount: 1 };

test("a blank page scores zero", () => {
  const { findings, health } = runRules(empty);
  assert.equal(findings.length, 0);
  assert.equal(score(findings).score, 0);
  assert.ok(health.some((h) => h.id === "no-contact"));
});

test("neon palette fires on pixel evidence even with no CSS colours", () => {
  const r = rule("neon-palette").run({ ...empty, palette: { neonShare: 0.01, neonOfChromatic: 0.7, neonBands: { "cyan-teal-mint": 0.01 } } });
  assert.ok(r && /70%/.test(r.evidence));
  assert.equal(rule("neon-palette").run({ ...empty, palette: { neonShare: 0.0002, neonOfChromatic: 0.05, neonBands: {} } }), null);
});

test("glow needs two saturated halos", () => {
  assert.equal(rule("glow").run({ ...empty, glow: { count: 1, samples: [] } }), null);
  assert.ok(rule("glow").run({ ...empty, glow: { count: 2, samples: [{ shadow: "rgba(0,240,208,0.3) 0 0 40px" }] } }));
});

test("a hero canvas alone is only a note; with neon it is the particle backdrop", () => {
  const canvas = { ...empty, decor: { canvases: [{ w: 1440, h: 900, top: 0, area: 1296000 }], networkSvgs: [], animations: [] } };
  assert.equal(rule("particle-backdrop").run(canvas).weight, 2);
  assert.equal(rule("particle-backdrop").run({ ...canvas, palette: { ...empty.palette, neonShare: 0.005 } }).weight, undefined);
});

test("beta pill matches the phrases, not any pill", () => {
  assert.ok(rule("beta-pill").run({ ...empty, pills: [{ text: "Free beta · No credit card" }] }));
  assert.equal(rule("beta-pill").run({ ...empty, pills: [{ text: "Rented H100-class (80 GB)" }] }), null);
});

test("eyebrow rule counts distinct labels, not occurrences", () => {
  const eb = (n, distinct) => ({ ...empty, eyebrows: Array.from({ length: n }, (_, i) => ({ text: `LABEL ${i % distinct}` })) });
  // 60 occurrences of 5 distinct texts is a carousel, not a template.
  assert.equal(rule("eyebrow-everywhere").run(eb(60, 5)), null);
  // 30 occurrences of 16 distinct texts is the template at full weight.
  assert.equal(rule("eyebrow-everywhere").run(eb(30, 16)).weight, 5);
  // 12 occurrences of 8 distinct texts is the low band.
  assert.equal(rule("eyebrow-everywhere").run(eb(12, 8)).weight, 2);
});

test("honesty-protest counts brand claims, not quoted 'honestly'", () => {
  // Six customer quotes saying "honestly clutch" (carousel clones) are not a protest.
  const quoted = Array(6).fill('"honestly clutch" is what a customer said.').join(" ");
  assert.equal(rule("honesty-protest").run({ ...empty, fullText: quoted, fullWordCount: 42 }), null);
  // Brand claims repeated are: even de-duplicated, they still fire.
  const claims = "We're radically transparent. No black box. Honest pricing. ".repeat(2);
  assert.ok(rule("honesty-protest").run({ ...empty, fullText: claims, fullWordCount: 30 }));
  assert.equal(honestyHits(claims).reduce((a, x) => a + x.count, 0), 3, "carousel clones count once");
});

test("status-tags counts status words, not product nouns", () => {
  const nouns = { ...empty, tags: [["GOOGLE DRIVE", 1], ["WELLNESS", 1], ["KNOWLEDGE", 1], ["TASKS", 1]] };
  assert.equal(rule("status-tags").run(nouns), null);
  const status = { ...empty, tags: [["LIVE", 1], ["BETA", 1], ["PRO", 1], ["NEW", 1]] };
  assert.ok(rule("status-tags").run(status));
});

test("text measures", () => {
  assert.equal(emDashDensity("a — b — c d e f g h i j").per100, 20);
  assert.deepEqual(repeatedPhrases("before anything runs. before anything runs! before anything runs? before anything runs", { min: 4 })[0], { phrase: "before anything runs", count: 4 });
  assert.equal(repeatedPhrases("LoRa Basics Station LoRa Basics Station LoRa Basics Station LoRa Basics Station", { min: 4 }).length, 0, "product names are skipped");
  assert.equal(honestyHits("We are honest. Honestly. No black box. Human-in-the-loop by design.").reduce((a, x) => a + x.count, 0), 3, "bare 'honestly' is a quote word, not a brand claim");
  assert.equal(buzzwordHits("Smart Metering is our product").length, 0, "capitalised product words do not count");
  assert.equal(buzzwordHits("seamlessly unlock robust value").length, 3);
  assert.ok(isTitleCase("Keep Your Stack. Gain A Co-Pilot With Confidence"));
  assert.ok(!isTitleCase("CloudGate IoT Gateway product portfolio"));
  assert.ok(!isTitleCase("LoRa Basics Station"));
  assert.deepEqual(betaPillHits(["Free Beta · Dashboard Live", "Hello"]), ["Free Beta · Dashboard Live"]);
});

test("tricolon is not a tell", () => {
  const { findings } = runRules({ ...empty, fullText: "Reliable. Secure. Flexible, with open source SDK.", fullWordCount: 7 });
  assert.equal(findings.length, 0);
});

test("disclaimed testimonials and simulated stats are the heaviest trust rules", () => {
  const r = runRules({ ...empty, testimonials: [{ quote: "“Great product”", sectionDisclaimer: "will appear here" }], stats: [{ value: "1M+", sectionDisclaimer: "simulated" }, { value: "1M+", sectionDisclaimer: "simulated" }] });
  const trust = r.findings.filter((f) => f.category === "trust");
  assert.deepEqual(trust.map((f) => f.id), ["disclaimed-testimonials", "simulated-stats"]);
  assert.equal(score(r.findings).categories.trust.points, 20);
});

test("category caps hold and score normalises to 100", () => {
  const findings = Object.keys(CATEGORIES).flatMap((category) => Array.from({ length: 20 }, (_, i) => ({ id: `${category}-${i}`, category, weight: 10 })));
  const s = score(findings);
  assert.equal(s.score, 100);
  assert.equal(s.tier, "Slop");
  for (const [k, c] of Object.entries(s.categories)) assert.equal(c.points, CATEGORIES[k].cap);
});

test("png decoder and palette stats on a synthetic neon image", () => {
  const w = 16, h = 16, bpp = 4;
  const raw = Buffer.alloc(h * (w * bpp + 1));
  for (let y = 0; y < h; y++) { raw[y * (w * bpp + 1)] = 0; for (let x = 0; x < w; x++) { const i = y * (w * bpp + 1) + 1 + x * bpp; const neon = x < 8; raw[i] = neon ? 0 : 10; raw[i + 1] = neon ? 240 : 10; raw[i + 2] = neon ? 208 : 10; raw[i + 3] = 255; } }
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
  const stats = paletteStats(decodePng(png), { step: 1 });
  assert.ok(stats.neonShare > 0.45 && stats.neonShare < 0.55, `neonShare ${stats.neonShare}`);
  assert.equal(stats.neonOfChromatic, 1);
  assert.ok(stats.darkShare > 0.45);
});

function crc32(buf) { let c, crc = 0xffffffff; for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xffffffff) >>> 0; }

test("repeated phrases do not cross text runs", () => {
  const runs = Array(8).fill("Read more\nRead less\nShop now").join("\n");
  assert.deepEqual(repeatedPhrases(runs, { n: 3, min: 3 }), []);
  const prose = Array(6).fill("We approve before anything runs.").join(" ");
  assert.ok(repeatedPhrases(prose, { n: 3, min: 5 }).some((r) => r.phrase === "before anything runs"));
});
