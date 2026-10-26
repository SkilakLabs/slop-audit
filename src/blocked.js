// Detects bot-protection block, challenge and error interstitials from the
// facts the collector measured, so the scanner refuses to score a stub page as
// if it were the real site. Pure: facts in, a verdict out, no network. Every
// signal also needs the page to read as a stub, so a real tiny landing page
// (200, no markers, no challenge HTML) is never flagged.

const BLOCK_STATUSES = new Set([401, 403, 406, 429, 503]);

// Markers that name a block page in its title, h1 or opening copy. Matched
// case-insensitively against normalised text.
const TEXT_MARKERS = [
  /access\s+denied/,
  /just\s+a\s+moment/,
  /attention\s+required/,
  /verify\s+you\s+are\s+human/,
  /are\s+you\s+a\s+robot/,
  /checking\s+your\s+browser/,
  /enable\s+javascript\s+and\s+cookies/,
  /pardon\s+our\s+interruption/,
  /request\s+unsuccessful/,
  /incident\s+id/,
  /press\s*(?:&|and)\s*hold/,
  /reference\s*#\s*\d/,
  /request\s+blocked/,
  /the\s+request\s+could\s+not\s+be\s+satisfied/,
  /bot\s+detection/,
  /ddos\s+protection/,
  /403\s+forbidden/,
  /404\s+not\s+found/,
  /site\s+not\s+found/,
  /this\s+site\s+can['\u2019]?t\s+be\s+reached/,
  /error\s+1020/,
];

// Challenge-platform markers that only appear in raw HTML, never in prose.
// The current collector keeps `facts.html` as a `{ lang }` object, so this is
// defensive: it fires only when some collector stores the raw markup as a
// string.
const HTML_MARKERS = ["cf-chl", "challenge-platform", "_incapsula_resource", "datadome", "px-captcha", "ddos-guard", "hcaptcha", "recaptcha/api2/anchor"];

function normalize(s) {
  return String(s || "")
    .replace(/[\u2018\u2019\u02bc]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .toLowerCase();
}

export function detectBlock(facts) {
  const status = facts.status ?? null;
  const title = facts.title || null;
  const headings = facts.headings || [];
  const h1 = facts.h1 || headings.find((h) => h.level === "h1")?.text || null;
  const text = facts.text || facts.fullText || "";
  const wordCount = facts.wordCount ?? facts.fullWordCount ?? 0;
  const linksTotal = facts.links?.total ?? 0;
  const html = typeof facts.html === "string" ? facts.html.toLowerCase() : "";

  // A stub is too little copy and too few links to be a real site.
  const stub = wordCount < 250 && linksTotal < 5;
  const head = normalize([title, h1, text.slice(0, 600)].filter(Boolean).join("\n"));

  if (stub) {
    // B: known interstitial markers. The title/h1/opening copy names the page.
    const marker =
      (head.includes("technical difficulties") && head.includes("incident number")) ||
      TEXT_MARKERS.some((re) => re.test(head));
    if (marker) {
      const label = title || h1 || "a block page";
      const statusPart = status != null ? ` (HTTP ${status})` : "";
      return { reason: `the site answered with “${label}”${statusPart} instead of its real page`, status, title };
    }
    // C: challenge-platform markers in the raw HTML.
    if (HTML_MARKERS.some((m) => html.includes(m))) {
      return { reason: "the site served a challenge page instead of its real page", status, title };
    }
    // A: a block or error status on a stub page. A 403 with a full page is a
    // soft error some sites serve with real content, so it is not blocked.
    if (status != null && BLOCK_STATUSES.has(status)) {
      return { reason: `HTTP ${status} and a ${wordCount}-word page instead of the site`, status, title };
    }
  }

  // D: a page that only renders with JavaScript the scanner cannot run.
  const jsText = normalize(text.slice(0, 600) + " " + html);
  if (wordCount < 100 && (jsText.includes("enable javascript") || jsText.includes("requires javascript"))) {
    return { reason: "the page only renders with JavaScript the scanner could not run", status, title };
  }

  return null;
}
