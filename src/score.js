// Category caps encode the point of view: unedited visuals and copy are the
// slop; unsupported trust signals are the part a client cannot argue with;
// unfinished residue is a smaller tell. Health issues are reported but never
// scored.
export const CATEGORIES = {
  visual: { label: "Visual defaults", cap: 35 },
  copy: { label: "Copy defaults", cap: 30 },
  trust: { label: "Unsupported trust signals", cap: 25 },
  unfinished: { label: "Unfinished", cap: 15 },
};
const MAX = Object.values(CATEGORIES).reduce((a, c) => a + c.cap, 0);

// The Slop Scale: five steps from Clean to Slop. Score is 0-100, lower is
// better. The report renders these verbatim.
export const SCALE = [
  { name: "Clean", range: [0, 5], blurb: "Nothing the defaults left behind." },
  { name: "Edited", range: [6, 12], blurb: "Someone with taste said no to the defaults." },
  { name: "Defaults showing", range: [13, 30], blurb: "Mostly edited; a few model habits slipped through." },
  { name: "Sloppy", range: [31, 55], blurb: "The model's choices were accepted more often than questioned." },
  { name: "Slop", range: [56, 100], blurb: "Capable AI output that no human pushed back on." },
];

export function score(findings) {
  const byCat = {};
  for (const k of Object.keys(CATEGORIES)) byCat[k] = { ...CATEGORIES[k], raw: 0, points: 0, findings: [] };
  for (const f of findings) { if (!byCat[f.category]) continue; byCat[f.category].raw += f.weight; byCat[f.category].findings.push(f); }
  let total = 0;
  for (const c of Object.values(byCat)) { c.points = Math.min(c.cap, c.raw); total += c.points; c.findings.sort((a, b) => b.weight - a.weight); }
  const normalized = Math.round((total / MAX) * 100);
  const tier = SCALE.find((t) => normalized <= t.range[1]) || SCALE.at(-1);
  return { score: normalized, tier: tier.name, blurb: tier.blurb, categories: byCat };
}
