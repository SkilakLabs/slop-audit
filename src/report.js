import { writeFile, mkdir, appendFile, readFile } from "node:fs/promises";
import path from "node:path";
import { CATEGORIES } from "./score.js";
import { toHtml } from "./html.js";
import { RULES_VERSION } from "./audit.js";

// Writes report.md, report.html and result.json (facts stripped) into outDir,
// and appends an entry to outDir/history.jsonl. cause "scan" records a fresh
// scan; cause "rules" records a re-score under a newer rule set and is only
// appended when the score or tier actually changed.
export async function writeReports(result, outDir, htmlOpts = {}) {
  await mkdir(outDir, { recursive: true });
  const cause = htmlOpts.cause ?? "scan";
  const slim = { ...result, facts: undefined };
  await appendHistory(outDir, historyEntry(result, cause), cause);
  const history = await readHistory(outDir);
  await writeFile(path.join(outDir, "report.md"), toMarkdown(result));
  await writeFile(path.join(outDir, "report.html"), toHtml(result, { ...htmlOpts, history }));
  await writeFile(path.join(outDir, "result.json"), JSON.stringify(slim, null, 2));
}

function historyEntry(result, cause) {
  return {
    at: cause === "rules" ? new Date().toISOString() : (result.collectedAt || new Date().toISOString()),
    score: result.scored.score,
    tier: result.scored.tier,
    rulesVersion: result.rulesVersion ?? RULES_VERSION,
    cause,
  };
}

async function appendHistory(outDir, entry, cause) {
  if (cause === "rules") {
    const prev = (await readHistory(outDir)).at(-1);
    if (prev && prev.score === entry.score && prev.tier === entry.tier) return;
  }
  await appendFile(path.join(outDir, "history.jsonl"), JSON.stringify(entry) + "\n");
}

// Parsed entries of outDir/history.jsonl, oldest first; [] when the file is missing.
export async function readHistory(outDir) {
  const raw = await readFile(path.join(outDir, "history.jsonl"), "utf8").catch(() => "");
  return raw.split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

export function toMarkdown(result) {
  const { url, finalUrl, scored, health, collectedAt } = result;
  const lines = [];
  lines.push(`# Slop audit: ${hostOf(finalUrl || url)}`, "");
  lines.push(`**Score ${scored.score}/100 · ${scored.tier}.** ${scored.blurb}`, "");
  lines.push(`Scanned ${collectedAt.slice(0, 10)} · ${finalUrl || url}`, "");
  lines.push("| Category | Points | Cap |", "|---|---:|---:|");
  for (const [k, c] of Object.entries(scored.categories)) lines.push(`| ${CATEGORIES[k].label} | ${c.points} | ${c.cap} |`);
  lines.push("");
  for (const [k, c] of Object.entries(scored.categories)) {
    if (!c.findings.length) continue;
    lines.push(`## ${CATEGORIES[k].label}`, "");
    for (const f of c.findings) {
      lines.push(`- **${f.title}** (+${f.weight})`, `  ${f.evidence}`, `  Fix: ${f.fix}`);
    }
    lines.push("");
  }
  if (health.length) {
    lines.push("## Health (not scored)", "");
    for (const h of health) lines.push(`- **${h.title}.** ${h.evidence}`);
    lines.push("");
  }
  return lines.join("\n");
}

export function toTerminal(result) {
  const { scored, health } = result;
  const out = [];
  out.push(`${hostOf(result.finalUrl || result.url)}  ${scored.score}/100  ${scored.tier}`);
  for (const [k, c] of Object.entries(scored.categories)) {
    if (!c.findings.length) continue;
    out.push(`  ${CATEGORIES[k].label} ${c.points}/${c.cap}`);
    for (const f of c.findings) out.push(`    +${String(f.weight).padStart(2)}  ${f.title}: ${f.evidence}`);
  }
  if (health.length) { out.push("  Health (not scored)"); for (const h of health) out.push(`     -  ${h.title}: ${h.evidence}`); }
  return out.join("\n");
}

function hostOf(u) { try { return new URL(u).hostname; } catch { return u; } }
