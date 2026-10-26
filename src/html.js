// One-page branded HTML report, built from the audit result. Deliberately not
// slop: paper background, one accent, no pills, no glow, no gradients.
import pkg from "../package.json" with { type: "json" };
import { CATEGORIES, SCALE } from "./score.js";

export const VERSION = pkg.version;
const BRAND = { ink: "#1E2A4A", paper: "#FAF8F5", coral: "#F0603F", mute: "#6B7280" };

export const CSS = `
  :root { --ink: ${BRAND.ink}; --paper: ${BRAND.paper}; --coral: ${BRAND.coral}; --mute: ${BRAND.mute}; --line: #E5E1DA; }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--paper); color: var(--ink); font: 400 15px/1.5 "DM Sans", -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; }
  main { max-width: 880px; margin: 0 auto; padding: 40px 28px 56px; }
  header { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--line); padding-bottom: 14px; margin-bottom: 28px; }
  .logo { display: inline-flex; align-items: center; gap: 9px; color: inherit; text-decoration: none; }
  .logo svg { display: block; }
  .wordmark { font-weight: 700; font-size: 19px; letter-spacing: -0.01em; }
  .wordmark small { font-weight: 400; color: var(--mute); font-size: 13px; margin-left: 6px; }
  .meta { color: var(--mute); font-size: 13px; }
  header .meta a { color: inherit; }
  h1 { font-size: 30px; line-height: 1.15; margin: 0 0 6px; font-weight: 700; }
  h1 a { color: inherit; text-decoration: none; }
  h2 { font-size: 17px; margin: 32px 0 10px; font-weight: 700; }
  .verdict { display: grid; grid-template-columns: 1fr 1fr; gap: 28px; align-items: start; }
  .score { font-size: 72px; font-weight: 700; line-height: 1; letter-spacing: -0.03em; }
  .score small { font-size: 22px; color: var(--mute); font-weight: 400; letter-spacing: 0; }
  .tier { font-size: 20px; font-weight: 700; margin-top: 4px; }
  .tier.hot { color: var(--coral); }
  .blurb { color: var(--mute); margin: 4px 0 18px; }
  table.cats { width: 100%; border-collapse: collapse; font-size: 14px; }
  table.cats td { padding: 5px 0; vertical-align: middle; }
  table.cats td.n { text-align: right; width: 64px; white-space: nowrap; padding-left: 16px; }
  a { color: var(--ink); }
  table.list { width: 100%; border-collapse: collapse; font-size: 14px; }
  table.list th { text-align: left; font-weight: 400; color: var(--mute); font-size: 13px; padding: 0 0 6px; border-bottom: 1px solid var(--line); }
  table.list td { padding: 9px 0; border-bottom: 1px solid var(--line); vertical-align: middle; }
  table.list th.n, table.list td.n { text-align: right; padding-left: 24px; white-space: nowrap; }
  table.list td.n + td, table.list th.n + th { padding-left: 24px; }
  table.list td.hot { color: var(--coral); font-weight: 700; }
  table.list .bar { width: 72px; margin: 4px 0 0 auto; }
  table.list b { font-size: 16px; font-variant-numeric: tabular-nums; }
  .bar { height: 6px; background: #ECE8E1; border-radius: 2px; overflow: hidden; }
  .bar i { display: block; height: 100%; background: var(--ink); transition: width 0.4s; }
  figure { margin: 0; border: 1px solid var(--line); background: #fff; height: 300px; overflow: hidden; }
  figure img { width: 100%; display: block; }
  figcaption { font-size: 12px; color: var(--mute); margin-top: 6px; }
  ol.findings { list-style: none; padding: 0; margin: 0; }
  ol.findings li { display: grid; grid-template-columns: 44px 1fr; gap: 10px; padding: 10px 0; border-top: 1px solid var(--line); }
  ol.findings li:first-child { border-top: 0; }
  .w { font-weight: 700; color: var(--mute); font-variant-numeric: tabular-nums; }
  .t { font-weight: 700; }
  .e { color: var(--ink); }
  .f { color: var(--mute); }
  .f b { color: var(--ink); font-weight: 700; }
  ul.health { padding-left: 18px; margin: 0; }
  ul.health li { margin: 4px 0; }
  .err { border-left: 3px solid var(--coral); background: #fff; padding: 10px 14px; margin: 0 0 18px; }
  input[type=text], textarea { font: inherit; padding: 10px 12px; border: 1px solid #CFC9BF; border-radius: 4px; background: #fff; width: 100%; color: inherit; }
  button { font: inherit; font-weight: 700; padding: 10px 18px; border: 0; border-radius: 4px; background: var(--ink); color: #fff; cursor: pointer; }
  button[disabled] { opacity: 0.5; cursor: default; }
  label.opt { display: inline-flex; align-items: center; gap: 6px; margin-right: 18px; }
  .feedback { margin-top: 40px; border-top: 1px solid var(--line); padding-top: 8px; }
  footer { margin-top: 40px; border-top: 1px solid var(--line); padding-top: 14px; font-size: 13px; color: var(--mute); display: flex; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
  footer a { color: inherit; }
  @media (max-width: 640px) { .verdict { grid-template-columns: 1fr; } figure { height: 220px; } }
  @media print { body { background: #fff; } main { padding: 0; } .feedback { display: none; } @page { margin: 16mm; } }
`;

// A square with a stroke through it: the human saying no to the default.
export const MARK = `<svg width="22" height="22" viewBox="0 0 22 22" aria-hidden="true"><rect x="1" y="1" width="20" height="20" rx="4" fill="${BRAND.ink}"/><path d="M6.5 15.5 L15.5 6.5" stroke="${BRAND.coral}" stroke-width="3" stroke-linecap="round"/></svg>`;

// The mark again as the tab icon. A data URI works for the served pages and
// for a report.html opened from disk alike.
export const ICON = `<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,${encodeURIComponent(MARK.replace(/ width="22" height="22"/, ""))}">`;
export const DESCRIPTION = "Slop Audit scores a website for unedited AI defaults: neon palettes, glow, pill badges, model vocabulary, placeholder trust signals and unfinished edges. Deterministic rules, every point shown with its evidence.";

// homeHref: in the local app the logo links back to the scan list; the
// standalone file has nowhere to go, so it stays plain. rescanHref, when set,
// adds a Rescan link to the served nav.
export function header(homeHref, right = "", rescanHref = null) {
  const logo = `${MARK}<span class="wordmark">Slop Audit<small>v${esc(VERSION)}</small></span>`;
  const left = homeHref ? `<a class="logo" href="${esc(homeHref)}">${logo}</a>` : `<span class="logo">${logo}</span>`;
  const nav = homeHref ? `<a href="${esc(homeHref)}">All reports</a> · <a href="${esc(homeHref)}#scan">New scan</a>${rescanHref ? ` · <a href="${esc(rescanHref)}">Rescan</a>` : ""} · <a href="/about">About</a>${right ? ` · ${esc(right)}` : ""}` : esc(right);
  return `<header>${left}<div class="meta">${nav}</div></header>`;
}

export function toHtml(result, { screenshotSrc = "desktop.png", screenshotPartial = result.facts?.screenshotPartial ?? result.screenshot, homeHref = null, feedback = false, history = [], publicMode = false } = {}) {
  const { url, finalUrl, scored, health, collectedAt } = result;
  const shown = finalUrl || url;
  const host = hostOf(shown);
  const hot = scored.score > 30;
  const cats = Object.entries(scored.categories);
  const rows = cats.map(([k, c]) => `<tr><td>${esc(CATEGORIES[k].label)}</td><td style="width:45%"><div class="bar"><i style="width:${Math.round((c.points / c.cap) * 100)}%"></i></div></td><td class="n">${c.points} / ${c.cap}</td></tr>`).join("");
  const sections = cats.filter(([, c]) => c.findings.length).map(([k, c]) => `
    <h2>${esc(CATEGORIES[k].label)} <span class="meta">${c.points} of ${c.cap}</span></h2>
    <ol class="findings">${c.findings.map((f) => `
      <li><span class="w">+${f.weight}</span><div><div class="t">${esc(f.title)}</div><div class="e">${esc(f.evidence)}</div><div class="f"><b>Fix.</b> ${esc(f.fix)}</div></div></li>`).join("")}
    </ol>`).join("");
  const healthList = health.length ? `
    <h2>Also worth fixing <span class="meta">not part of the score</span></h2>
    <ul class="health">${health.map((h) => `<li><b>${esc(h.title)}.</b> ${esc(h.evidence)}</li>`).join("")}</ul>` : "";
  // A page that never stopped animating may have only its first screen, or no
  // image at all; never point <img> at a file that was not written.
  const caption = `Desktop, 1440px wide, top of page${screenshotPartial === true ? " (first screen only; the page never stopped animating)" : ""}`;
  const shot = screenshotSrc && screenshotPartial !== "none" ? `<figure><img src="${esc(screenshotSrc)}" alt="Top of ${esc(host)} on desktop"><figcaption>${caption}</figcaption></figure>` : "";
  const historySection = history.length >= 2 ? `
    <h2>Score history <span class="meta">newest first</span></h2>
    <table class="list">
      <thead><tr><th>Date</th><th class="n">Score</th><th>Verdict</th><th>Cause</th></tr></thead>
      <tbody>${[...history].reverse().map((h) => `<tr><td>${esc(h.at?.slice(0, 10))}</td><td class="n"><b>${h.score}</b></td><td class="${h.score > 30 ? "hot" : ""}">${esc(h.tier)}</td><td class="meta">${h.cause === "rules" ? "Rules updated" : "Rescan"}</td></tr>`).join("")}</tbody>
    </table>` : "";
  const ids = cats.flatMap(([, c]) => c.findings.map((f) => f.id)).join(",");
  const feedbackNote = publicMode ? "Stored with this report and read by a person. Notes are not published." : "Saved locally; nothing leaves this machine.";
  const rescanHref = homeHref ? `/scan?url=${encodeURIComponent(finalUrl || url)}&force=1` : null;
  const feedbackForm = feedback ? `
    <section class="feedback" id="feedback">
      <h2>Does this match your eye?</h2>
      <form method="post" action="/feedback">
        <input type="hidden" name="host" value="${esc(host)}"><input type="hidden" name="score" value="${scored.score}"><input type="hidden" name="tier" value="${esc(scored.tier)}"><input type="hidden" name="findings" value="${esc(ids)}">
        <p>
          <label class="opt"><input type="radio" name="verdict" value="too-high" required> Score is too high</label>
          <label class="opt"><input type="radio" name="verdict" value="about-right" required> About right</label>
          <label class="opt"><input type="radio" name="verdict" value="too-low" required> Too low, this is sloppier</label>
        </p>
        <p><textarea name="notes" rows="3" maxlength="2000" placeholder="What did we get wrong or miss? Name the finding if one is wrong, or describe the tell we did not catch."></textarea></p>
        <p><button type="submit">Send feedback</button> <span class="meta">${feedbackNote}</span></p>
      </form>
    </section>` : "";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Slop audit: ${esc(host)} scores ${scored.score}/100</title>
<meta name="description" content="${esc(host)} scores ${scored.score}/100, ${esc(scored.tier)}, on the Slop Scale: how much unedited AI default is showing, with every point and its evidence.">${ICON}
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700&display=swap" rel="stylesheet">
<style>${CSS}</style></head>
<body><main>
${header(homeHref, `Scanned ${collectedAt.slice(0, 10)}`, rescanHref)}
<h1><a href="${esc(shown)}">${esc(host)}</a></h1>
<div class="meta" style="margin-bottom:22px">${esc(shown)}</div>
<section class="verdict">
  <div>
    <div class="score">${scored.score}<small> / 100</small></div>
    <div class="tier${hot ? " hot" : ""}">${esc(scored.tier)}</div>
    <div class="blurb">${esc(scored.blurb)}</div>
    <table class="cats">${rows}</table>
  </div>
  ${shot}
</section>
${historySection}
${sections}
${healthList}
${feedbackForm}
${footer(homeHref, feedback ? "#feedback" : "/about#disputes")}
</main></body></html>
`;
}

export function footer(homeHref = null, disputeHref = null) {
  const scale = SCALE.map((t) => `${t.range[0]}–${t.range[1]} ${t.name}`).join(", ");
  const about = homeHref ? "/about" : "https://slopaudit.skilak.ai/about";
  const dispute = homeHref ? (disputeHref ?? "#feedback") : "https://slopaudit.skilak.ai/";
  const label = !homeHref || dispute.startsWith("#") ? "Dispute this report" : "Disputes";
  return `<footer><span>Slop Audit v${esc(VERSION)}: deterministic rules, no model in the loop. Lower is better; ${esc(scale)}.</span><span>Made by Skilak LLC · <a href="https://skilak.ai">skilak.ai</a> · <a href="${esc(about)}">How scores work</a> · <a href="${esc(dispute)}">${label}</a></span></footer>`;
}

export function esc(s) { return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function hostOf(u) { try { return new URL(u).hostname; } catch { return u; } }
