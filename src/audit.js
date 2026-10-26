import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { collect } from "./collect.js";
import { detectBlock } from "./blocked.js";
import { runRules } from "./rules/index.js";
import { score } from "./score.js";

// Fingerprints the rule set so saved reports can be re-scored when the rules
// change. Anything that changes a score must be listed here.
export const RULES_VERSION = (() => {
  const hash = createHash("sha1");
  for (const f of ["./rules/index.js", "./text.js", "./score.js", "./pixels.js", "./blocked.js"]) {
    hash.update(readFileSync(fileURLToPath(new URL(f, import.meta.url)), "utf8"));
  }
  return hash.digest("hex").slice(0, 8);
})();

export function auditFacts(facts) {
  const { findings, health } = runRules(facts);
  const scored = score(findings);
  return { url: facts.url, finalUrl: facts.finalUrl, collectedAt: facts.collectedAt, rulesVersion: RULES_VERSION, scored, health };
}

export function isBlockedError(e) {
  return !!(e && e.code === "BLOCKED");
}

export async function audit(url, opts = {}) {
  const outDir = opts.outDir || null;
  // collect() writes facts.json and the screenshots as it goes. Stage them in a
  // hidden sibling folder (no result.json, so listings and pruning ignore it)
  // and move them in only once the page has passed the block check, so a site
  // that starts serving a block page never overwrites its earlier good report.
  const staging = outDir ? path.join(path.dirname(outDir), `.scan-${path.basename(outDir)}-${randomBytes(3).toString("hex")}`) : null;
  try {
    const facts = await collect(url, { ...opts, outDir: staging });
    const blocked = detectBlock(facts);
    if (blocked) {
      const err = new Error(`${hostOf(facts.finalUrl || url)} blocked the scanner: ${blocked.reason}. There is nothing to score, so no report was saved.`);
      err.code = "BLOCKED";
      err.blocked = blocked;
      throw err;
    }
    if (staging) {
      await mkdir(outDir, { recursive: true });
      for (const f of await readdir(staging).catch(() => [])) await rename(path.join(staging, f), path.join(outDir, f));
    }
    return { ...auditFacts(facts), facts };
  } finally {
    if (staging) await rm(staging, { recursive: true, force: true });
  }
}

function hostOf(u) { try { return new URL(u).hostname; } catch { return u; } }
