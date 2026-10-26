#!/usr/bin/env node
// slop-audit <url...> [--out DIR] [--json] [--md] [--no-screenshots]
// slop-audit serve [--port 4100] [--host 127.0.0.1] [--out DIR] [--hidden FILE] [--public]
//   --public: enable rate limits, the queue cap and report retention, and trust
//   X-Forwarded-For. Use it when a TLS proxy (Caddy, nginx) sits in front.
//   --hidden: a file (one host per line) of sites to keep off the list; defaults
//   to hidden.txt next to the report directory.
import path from "node:path";
import { audit, isBlockedError } from "../src/audit.js";
import { toMarkdown, toTerminal, writeReports } from "../src/report.js";
import { normalizeUrl } from "../src/safety.js";

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const val = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const positional = args.filter((a, i) => !a.startsWith("--") && !["--out", "--port", "--host", "--hidden"].includes(args[i - 1]));

if (positional[0] === "serve") {
  const { createServer } = await import("../src/serve.js");
  const port = Number(val("--port") || 4100);
  const host = val("--host") || "127.0.0.1";
  const outRoot = val("--out") || "out";
  const publicMode = flag("--public");
  const hiddenFile = val("--hidden");
  createServer({ outRoot, publicMode, ...(hiddenFile ? { hiddenFile } : {}) }).listen(port, host, () => {
    console.log(`slop-audit is listening on http://${host}:${port}${publicMode ? " (public mode: limits on)" : ""}  (reports in ${path.resolve(outRoot)}; Ctrl-C to stop)`);
  });
} else {
  const urls = positional;
  if (!urls.length) { console.error("usage: slop-audit <url> [more urls] [--out DIR] [--json] [--md] [--no-screenshots]\n       slop-audit serve [--port 4100] [--out DIR]"); process.exit(2); }
  let exit = 0;
  for (const raw of urls) {
    const url = normalizeUrl(raw);
    const host = new URL(url).hostname;
    const outDir = val("--out") ? path.join(val("--out"), host) : null;
    try {
      const result = await audit(url, { outDir, screenshots: !flag("--no-screenshots") });
      if (flag("--json")) console.log(JSON.stringify({ ...result, facts: undefined }, null, 2));
      else console.log(toTerminal(result));
      if (outDir) {
        await writeReports(result, outDir, { screenshotSrc: flag("--no-screenshots") ? null : "desktop.png" });
        if (!flag("--json")) console.log(`  report: ${path.join(outDir, "report.html")}`);
      }
      if (flag("--md")) console.log("\n" + toMarkdown(result));
    } catch (e) {
      exit = 1;
      console.error(isBlockedError(e) ? e.message : `${host}: ${e.message}`);
    }
  }
  process.exit(exit);
}
