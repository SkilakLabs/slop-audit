// Pure text measurements used by the copy rules. No DOM, no network.

export const HONESTY_WORDS = [
  /\bhonest(ly)?\b/i, /never fabricated/i, /no black[- ]?box/i, /no vaporware/i, /no fake\b/i,
  /nothing .{0,30}pretends/i, /human[- ]in[- ]the[- ]loop/i, /\bdeterministic\b/i, /zero guesswork/i,
  /you stay in control/i, /on your terms/i, /\btransparent(ly)?\b/i, /no (hidden|surprise) (fees|costs)/i,
  /we('| a)?re not (here )?to/i, /\bno gimmicks\b/i,
];

export const BUZZWORDS = [
  "seamless", "seamlessly", "effortless", "effortlessly", "supercharge", "supercharged", "elevate", "unlock",
  "empower", "empowering", "revolutionize", "revolutionizing", "revolutionary", "next-generation", "next-gen",
  "cutting-edge", "streamline", "streamlined", "game-changer", "game-changing", "leverage", "robust", "scalable",
  "innovative", "holistic", "unleash", "harness", "ai-powered", "ai-driven", "frictionless",
  "autonomous", "all-in-one", "turbocharge", "10x",
];

export const BETA_PILL = [
  /\bfree beta\b/i, /\bno credit card\b/i, /\bnow in beta\b/i, /\bearly access\b/i, /\bbeta live\b/i,
  /\bnow (live|available)\b/i, /\bjust launched\b/i, /\bintroducing\b/i, /\bnew\s*[·•|]/i,
];

export function words(text) { return (text.match(/[A-Za-z][A-Za-z'’-]*/g) || []); }

export function emDashDensity(text) {
  const n = (text.match(/—/g) || []).length;
  const w = Math.max(1, words(text).length);
  return { count: n, per100: +((n * 100) / w).toFixed(2) };
}

const STOP = new Set(["the", "and", "for", "you", "your", "our", "with", "that", "this", "from", "are", "was", "will", "can", "all", "any", "not", "but", "into", "per"]);
export function repeatedPhrases(text, { n = 3, min = 4 } = {}) {
  // Keep original case so product names ("LoRa Basics Station") can be skipped.
  // Count within each text run (the collector joins runs with newlines): a
  // phrase that only exists where one button's label meets the next button's
  // ("Read more" + "Read less" = "more read less") is layout, not writing.
  const counts = new Map();
  for (const line of text.split(/\n+/)) {
    const w = words(line);
    for (let i = 0; i + n <= w.length; i++) {
      const g = w.slice(i, i + n);
      if (g.every((x) => STOP.has(x.toLowerCase()) || x.length < 3)) continue;
      if (g.filter((x) => /^[A-Z]/.test(x)).length >= 2) continue; // a name, not a tic
      const k = g.map((x) => x.toLowerCase()).join(" ");
      counts.set(k, (counts.get(k) || 0) + 1);
    }
  }
  return [...counts.entries()].filter(([, c]) => c >= min).sort((a, b) => b[1] - a[1]).map(([phrase, count]) => ({ phrase, count }));
}

export function honestyHits(text) {
  const hits = [];
  for (const re of HONESTY_WORDS) { const m = text.match(new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g")); if (m) hits.push({ phrase: m[0].toLowerCase(), count: m.length }); }
  return hits.sort((a, b) => b.count - a.count);
}

export function buzzwordHits(text) {
  // Lower-case occurrences only: "Smart Metering" is a product, "smart insights" is a tic.
  const hits = [];
  for (const b of new Set(BUZZWORDS)) { const re = new RegExp(`(?<![A-Za-z-])${b.replace(/[-]/g, "\\-")}(?![A-Za-z-])`, "g"); const m = text.match(re); if (m) hits.push({ word: b, count: m.length }); }
  return hits.sort((a, b) => b.count - a.count);
}

export function notJustHits(text) { return (text.match(/\b(it'?s|this is|we'?re) not just [^.!?\n]{2,60}?[,;—-]\s*(it'?s|but|we'?re)\b/gi) || []).length; }

export function betaPillHits(texts) {
  const out = [];
  for (const t of texts) for (const re of BETA_PILL) if (re.test(t)) { out.push(t); break; }
  return out;
}

// Title Case detection that skips product names: needs at least 4 capitalised
// "real" words and a capitalised small word somewhere (Of, The, Your, With).
export function isTitleCase(heading) {
  const w = words(heading);
  const real = w.filter((x) => x.length > 3);
  if (real.length < 4) return false;
  const capRatio = real.filter((x) => /^[A-Z]/.test(x)).length / real.length;
  const smallCaps = w.some((x) => /^(Of|The|Your|With|And|For|In|On|To|A|An|Into)$/.test(x) && w.indexOf(x) > 0);
  return capRatio >= 0.8 && smallCaps;
}
