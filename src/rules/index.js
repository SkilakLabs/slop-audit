// Every rule is deterministic: facts in, finding out. No model calls.
// A rule returns null when it does not fire, otherwise { evidence, fix }.
// Weights are capped per category in score.js; see docs/rules.md for the why.
import { emDashDensity, repeatedPhrases, honestyHits, buzzwordHits, notJustHits, betaPillHits, isTitleCase, words } from "../text.js";
import { NEON_BANDS } from "../pixels.js";

const DECOR_ANIM = /orb|pulse|ping|breathe|glow|float|orbit|shimmer|marquee|twinkle|aurora|blob|gradient|wave/i;
const SLOP_FONTS = ["inter", "geist", "geist sans", "space grotesk", "instrument serif"];
const GENERIC = /^(-apple-system|blinkmacsystemfont|system-ui|ui-sans-serif|ui-monospace|ui-serif|segoe ui|roboto|helvetica neue|helvetica|arial|sans-serif|serif|monospace)$/;

const copyOf = (f) => f.fullText || f.text || "";
const wordsOf = (f) => Math.max(1, f.fullWordCount || f.wordCount || words(copyOf(f)).length);

export const RULES = [
  // ---------------- VISUAL DEFAULTS ----------------
  {
    id: "neon-palette", category: "visual", weight: 10, title: "Neon accent palette (cyan / radium green)",
    run(f) {
      const p = f.palette; if (!p || p.error) return null;
      const bands = Object.entries(p.neonBands || {}).filter(([, v]) => v > 0).map(([k, v]) => `${k} ${(v * 100).toFixed(2)}% of pixels`);
      const strong = p.neonOfChromatic >= 0.4 && p.neonShare >= 0.003;
      // CSS alone is weak evidence (a green "success" colour is not a palette); it needs pixel corroboration.
      const cssNeon = (f.colors || []).filter((c) => c.s >= 0.75 && c.l >= 0.35 && c.l <= 0.7 && NEON_BANDS.some((b) => c.h >= b.from && c.h < b.to)).reduce((a, c) => a + c.count, 0);
      const moderate = !strong && cssNeon >= 40 && p.neonOfChromatic >= 0.15;
      if (!strong && !moderate) return null;
      return { weight: strong ? 10 : 5, evidence: strong ? `${Math.round(p.neonOfChromatic * 100)}% of the page's coloured pixels sit in a neon band (${bands.join(", ")})` : `${cssNeon} styled elements use a neon accent colour and ${Math.round(p.neonOfChromatic * 100)}% of coloured pixels are neon`, fix: "Pick one accent from a real palette: a muted brand colour that exists in print. Neon teal is what the model reaches for when nobody chooses." };
    },
  },
  {
    id: "dark-neon", category: "visual", weight: 4, title: "Permanent dark mode with neon accents",
    run(f) { const p = f.palette || {}; if (!(f.darkMode || p.darkShare >= 0.6)) return null; if ((p.neonOfChromatic || 0) < 0.3) return null; return { evidence: `${Math.round((p.darkShare || 0) * 100)}% of the page is near-black with neon highlights`, fix: "Dark mode is a choice, not a default. If the audience reads in daylight, start light." }; },
  },
  {
    id: "glow", category: "visual", weight: 5, title: "Coloured glow shadows",
    run(f) { const g = f.glow || {}; if ((g.count || 0) < 2) return null; return { evidence: `${g.count} elements carry a saturated halo shadow, e.g. ${g.samples?.[0]?.shadow || ""}`, fix: "Remove box-shadow glows on buttons and cards. Use a 1px border or a flat shadow." }; },
  },
  {
    id: "particle-backdrop", category: "visual", weight: 8, title: "Decorative canvas or node-network backdrop",
    run(f) {
      const d = f.decor || {}; const big = (d.canvases || []).filter((c) => c.area >= 400000 && c.top < 1200); const svgs = d.networkSvgs || [];
      if (!big.length && !svgs.length) return null;
      const neon = (f.palette?.neonShare || 0) >= 0.002 || (f.glow?.count || 0) >= 2;
      if (!neon && !svgs.length) return { weight: 2, evidence: `A ${big[0].w}×${big[0].h} canvas sits behind the hero; check what it draws`, fix: "If this is dots or lines for decoration, delete it." };
      return { evidence: big.length ? `A ${big[0].w}×${big[0].h} canvas backdrop plus neon or glow styling: the glowing-dots-and-lines background` : `An SVG with ${svgs[0].circles} circles and ${svgs[0].lines} lines in the hero`, fix: "Delete the animated particle background. A plain background and one strong image say more." };
    },
  },
  {
    id: "decor-animations", category: "visual", weight: 4, title: "Ambient pulse / orbit / shimmer animations",
    run(f) { const a = (f.decor?.animations || []).filter(([n]) => DECOR_ANIM.test(n)); if (a.length < 2) return null; return { evidence: `Animations named ${a.map(([n]) => n).slice(0, 4).join(", ")}`, fix: "Keep motion for feedback only. Nothing should pulse while the reader is reading." }; },
  },
  {
    id: "orb", category: "visual", weight: 5, title: "Glowing orb or pulsing dot beside a call to action",
    run(f) { const o = f.orbs || []; if (!o.length) return null; return { evidence: `A ${o[0].tag.toLowerCase()} orb next to “${o[0].near}”`, fix: "Replace the orb with the product's real icon or nothing." }; },
  },
  {
    id: "beta-pill", category: "visual", weight: 6, title: "“Free beta · No credit card” pill",
    run(f) { const hits = betaPillHits((f.pills || []).map((p) => p.text)); if (!hits.length) return null; return { evidence: `Pill reads “${hits[0]}”`, fix: "Delete the pill. If the product is free, the price page says so." }; },
  },
  {
    id: "chip-row", category: "visual", weight: 4, title: "Rows of chips and pills",
    // Only the hero counts: chips inside product mockups further down are the product, not the pitch.
    run(f) { const hero = (f.pills || []).filter((p) => p.top < 1000); if (hero.length < 4) return null; return { evidence: `${hero.length} pill-shaped labels in the hero: ${hero.slice(0, 4).map((p) => `“${p.text.replace(/\n/g, " ")}”`).join(", ")}`, fix: "Chips are for filters. Turn benefit chips into one sentence." }; },
  },
  {
    id: "eyebrow-everywhere", category: "visual", weight: 5, title: "Tracked uppercase eyebrow labels on everything",
    run(f) { const n = (f.eyebrows || []).length; if (n < 12) return null; return { weight: n >= 25 ? 5 : 2, evidence: `${n} small uppercase tracked labels`, fix: "One eyebrow per section at most. Most sections need none." }; },
  },
  {
    id: "status-tags", category: "visual", weight: 4, title: "Status tags (LIVE · SIM · PRO · BETA) as decoration",
    run(f) { const t = (f.tags || []); if (t.length < 4) return null; return { evidence: `${t.length} distinct tags: ${t.slice(0, 6).map(([x]) => x).join(", ")}`, fix: "Tags belong in the product, not the marketing page." }; },
  },
  {
    id: "gradient-text", category: "visual", weight: 5, title: "Gradient-filled headline text",
    run(f) { if (!(f.gradients?.textClip > 0)) return null; return { evidence: `${f.gradients.textClip} headline(s) use background-clip:text`, fix: "Solid ink. If a word needs emphasis, use weight or the brand colour." }; },
  },
  {
    id: "gradient-heavy", category: "visual", weight: 3, title: "Gradient backgrounds across the page",
    run(f) { const g = f.gradients || {}; if (!(g.elements >= 6 && g.areaRatio >= 0.3)) return null; return { evidence: `${g.elements} gradient elements covering ~${Math.round(g.areaRatio * 100)}% of the first screens`, fix: "One subtle gradient maximum, or none." }; },
  },
  { id: "glass", category: "visual", weight: 3, title: "Glassmorphism panels", run(f) { if ((f.glass || 0) < 3) return null; return { evidence: `${f.glass} elements use backdrop-filter blur`, fix: "Opaque panels. Glass only reads on a photo background." }; } },
  { id: "blur-blobs", category: "visual", weight: 4, title: "Blurred colour blobs behind content", run(f) { if ((f.blurBlobs || 0) < 1) return null; return { evidence: `${f.blurBlobs} large blurred element(s)`, fix: "Delete the aurora blobs." }; } },
  { id: "nested-cards", category: "visual", weight: 2, title: "Cards inside cards", run(f) { if ((f.cards?.nested || 0) < 3) return null; return { evidence: `${f.cards.nested} cards are nested inside other cards`, fix: "Flatten. A section can hold content without a box around it." }; } },
  { id: "card-density", category: "visual", weight: 2, title: "Everything is a card", run(f) { if ((f.cards?.perScreen || 0) < 2.5) return null; return { evidence: `${f.cards.count} rounded, bordered cards (${f.cards.perScreen} per screen)`, fix: "Remove borders and backgrounds from anything that is just text." }; } },
  {
    id: "slop-font", category: "visual", weight: 3, title: "Default model font (Inter / Geist / Space Grotesk / Instrument Serif)",
    run(f) {
      const stack = (f.fonts?.hero || "").split(",").map((x) => x.replace(/["']/g, "").trim().toLowerCase()).filter(Boolean);
      const firstWeb = stack.find((x) => !GENERIC.test(x));
      if (!firstWeb || !SLOP_FONTS.includes(firstWeb)) return null;
      return { evidence: `Hero font stack resolves to “${firstWeb}”`, fix: "Choose a typeface on purpose. Even a system font chosen deliberately beats Inter chosen by default." };
    },
  },

  // ---------------- COPY DEFAULTS ----------------
  {
    id: "em-dash-density", category: "copy", weight: 8, title: "Em-dash density",
    run(f) { const d = emDashDensity(copyOf(f)); if (d.per100 < 0.7) return null; return { weight: d.per100 >= 1.5 ? 8 : 4, evidence: `${d.count} em dashes in ${wordsOf(f)} words (${d.per100} per 100)`, fix: "Replace most em dashes with full stops. Humans use about one per page." }; },
  },
  {
    id: "repeated-phrases", category: "copy", weight: 6, title: "The same phrase, five times or more",
    run(f) {
      const cta = new Set(f.ctaTexts || []);
      // Five repeats on a short page is a tic; on a 7000-word corporate page it is
      // normal boilerplate. Scale the bar with length: 2.5 per thousand words.
      const min = Math.max(5, Math.round((f.fullWordCount || 0) * 2.5 / 1000));
      const reps = repeatedPhrases(copyOf(f), { n: 3, min }).filter((r) => ![...cta].some((c) => c.includes(r.phrase))).filter((r) => !/opens in|new tab|new window|read more|learn more/.test(r.phrase));
      if (!reps.length) return null;
      return { weight: reps.length >= 3 ? 6 : 3, evidence: reps.slice(0, 4).map((r) => `“${r.phrase}” ×${r.count}`).join(", "), fix: "Say it once, in the place it matters." };
    },
  },
  {
    id: "honesty-protest", category: "copy", weight: 8, title: "Copy keeps insisting it is honest",
    run(f) { const h = honestyHits(copyOf(f)); const n = h.reduce((a, x) => a + x.count, 0); if (n < 3) return null; return { weight: n >= 6 ? 8 : 4, evidence: `${n} hits: ${h.slice(0, 5).map((x) => `“${x.phrase}” ×${x.count}`).join(", ")}`, fix: "Delete every sentence that says the product is honest, transparent, or not a black box. Show the receipt instead." }; },
  },
  {
    id: "buzzwords", category: "copy", weight: 5, title: "Model vocabulary",
    run(f) { const b = buzzwordHits(copyOf(f)); const n = b.reduce((a, x) => a + x.count, 0); const per100 = n * 100 / wordsOf(f); if (per100 < 0.5) return null; return { weight: per100 >= 1 ? 5 : 2, evidence: `${n} buzzwords (${per100.toFixed(2)} per 100 words): ${b.slice(0, 5).map((x) => `${x.word} ×${x.count}`).join(", ")}`, fix: "Replace each with the specific thing the product does." }; },
  },
  { id: "not-just", category: "copy", weight: 3, title: "“It's not just X, it's Y”", run(f) { const n = notJustHits(copyOf(f)); if (!n) return null; return { evidence: `${n} occurrence(s)`, fix: "Say what it is." }; } },
  {
    id: "beta-reassurance", category: "copy", weight: 4, title: "Beta reassurance repeated in copy",
    run(f) { const t = copyOf(f); const n = (t.match(/free beta|no credit card|free during beta/gi) || []).length; if (n < 2) return null; return { evidence: `“free beta / no credit card” appears ${n} times`, fix: "Once, on the pricing page." }; },
  },
  {
    id: "title-case", category: "copy", weight: 4, title: "Title Case Headlines",
    // Density, not presence: a news section with headline-case article titles
    // among dozens of sentence-case headings is editorial style, not a default.
    run(f) { const all = (f.headings || []).filter((h) => h.level !== "h1" && words(h.text).length >= 4); const hs = all.filter((h) => isTitleCase(h.text)); if (hs.length < 2 || hs.length < all.length * 0.25) return null; return { weight: hs.length >= 3 ? 4 : 2, evidence: `${hs.length} of ${all.length} headings: ` + hs.slice(0, 3).map((h) => `“${h.text}”`).join(", "), fix: "Sentence case. Capitalise names, not verbs." }; },
  },

  // ---------------- FAKE TRUST ----------------
  {
    id: "disclaimed-testimonials", category: "trust", weight: 12, title: "Testimonials next to a disclaimer that they are placeholders",
    run(f) { const t = (f.testimonials || []).filter((x) => x.sectionDisclaimer); if (!t.length) return null; return { evidence: `${t.length} quote(s) in a section that says “${t[0].sectionDisclaimer}”, e.g. ${t[0].quote.slice(0, 80)}…`, fix: "Remove invented quotes entirely. An empty testimonial section is honest; a disclaimed one is worse than none." }; },
  },
  { id: "stock-avatars", category: "trust", weight: 8, title: "Generated or stock avatars", run(f) { const n = f.images?.avatarHosts || 0; if (!n) return null; return { evidence: `${n} image(s) from avatar-generator hosts`, fix: "Real photos or no photos." }; } },
  {
    id: "simulated-stats", category: "trust", weight: 8, title: "Big numbers beside “simulated / illustrative / will appear here”",
    run(f) { const seen = new Set(); const s = (f.stats || []).filter((x) => x.sectionDisclaimer && !seen.has(x.value) && seen.add(x.value)); if (!s.length) return null; return { evidence: s.slice(0, 3).map((x) => `“${x.value}” (${x.sectionDisclaimer})`).join(", "), fix: "Only publish a number you can date and source." }; },
  },
  { id: "social-roots", category: "trust", weight: 4, title: "Social links that go to the network's homepage", run(f) { const n = f.links?.socialRoots || 0; if (!n) return null; return { evidence: `${n} social link(s) point at the network root`, fix: "Link the real profile or remove the icon." }; } },

  // ---------------- UNFINISHED ----------------
  { id: "placeholders", category: "unfinished", weight: 6, title: "Placeholder text left in", run(f) { const p = f.placeholders || []; if (!p.length) return null; return { evidence: p.join(", "), fix: "Search the repo for each and replace with real content." }; } },
  { id: "builder-residue", category: "unfinished", weight: 6, title: "AI builder badge or script left in", run(f) { const b = f.builderMarkers || []; if (!b.length) return null; return { evidence: b.join(", "), fix: "Remove the builder badge, script tag, and default metadata." }; } },
  { id: "stale-copyright", category: "unfinished", weight: 3, title: "Stale copyright year", run(f) { const y = f.copyrightYear; const now = new Date().getFullYear(); if (!y || y >= now - 1) return null; return { evidence: `© ${y}`, fix: "Compute the year or remove it." }; } },
  { id: "no-description", category: "unfinished", weight: 2, title: "Missing meta description", run(f) { if (f.description) return null; return { evidence: "No <meta name=description>", fix: "Write one sentence that says what this is." }; } },
  { id: "no-favicon", category: "unfinished", weight: 2, title: "Missing favicon", run(f) { if (f.favicon) return null; return { evidence: "No icon link", fix: "Add one." }; } },
];

// Reported, never scored: an old site can be imperfect without being slop.
export const HEALTH = [
  { id: "dead-links", title: "Links that go nowhere", run(f) { const n = f.links?.dead || 0; return n ? `${n} link(s) with href="#" or empty${f.links.deadTexts?.length ? `: ${f.links.deadTexts.slice(0, 4).map((t) => `“${t}”`).join(", ")}` : ""}` : null; } },
  { id: "missing-alt", title: "Images without alt text", run(f) { const n = f.images?.missingAlt || 0; return n ? `${n} of ${f.images.total} images` : null; } },
  { id: "console-errors", title: "Console errors on load", run(f) { const n = (f.consoleErrors || []).length; return n ? `${n}: ${f.consoleErrors[0]}` : null; } },
  { id: "failed-requests", title: "Failed network requests", run(f) { const n = (f.failedRequests || []).length; return n ? `${n}, e.g. ${f.failedRequests[0]}` : null; } },
  { id: "mobile-overflow", title: "Horizontal overflow on a phone", run(f) { return f.mobile?.horizontalOverflow ? `scrollWidth ${f.mobile.scrollWidth} > viewport ${f.mobile.viewportWidth}` : null; } },
  { id: "form-no-submit", title: "Form without a submit control", run(f) { const n = (f.forms || []).filter((x) => !x.hasSubmit).length; return n ? `${n} form(s)` : null; } },
  { id: "no-contact", title: "No phone or postal address anywhere", run(f) { return f.phone || f.address ? null : "No phone number or address found on the home page"; } },
];

export function runRules(facts) {
  const findings = [];
  for (const rule of RULES) {
    let r = null;
    try { r = rule.run(facts); } catch (e) { findings.push({ id: rule.id, category: rule.category, weight: 0, title: rule.title, error: String(e.message) }); continue; }
    if (!r) continue;
    findings.push({ id: rule.id, category: rule.category, weight: r.weight ?? rule.weight, title: rule.title, evidence: r.evidence, fix: r.fix });
  }
  const health = [];
  for (const h of HEALTH) { let r = null; try { r = h.run(facts); } catch { r = null; } if (r) health.push({ id: h.id, title: h.title, evidence: r }); }
  return { findings, health };
}
