// Re-collect every fixture site live, overwrite fixtures/<host>/facts.json, and
// print scores next to the human label. Run after changing the collector.
// `node scripts/calibrate.js --check` only rescans and exits 1 if the order breaks.
import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { collect } from "../src/collect.js";
import { auditFacts } from "../src/audit.js";
import { toTerminal } from "../src/report.js";

// Serves fixtures/pages/ on a random local port. The collector refuses loopback
// on purpose; fixture pages are the one thing we scan locally, and calibrate is
// the only place that does it (allowLocal below).
function servePages() {
  const pagesDir = fileURLToPath(new URL("../fixtures/pages/", import.meta.url));
  const server = createServer(async (req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname).replace(/^\/+/, "");
    let file = path.join(pagesDir, pathname);
    try {
      if ((await stat(file)).isDirectory()) file = path.join(file, "index.html");
      await stat(file);
      res.writeHead(200, { "content-type": file.endsWith(".html") ? "text/html; charset=utf-8" : "application/octet-stream" });
      createReadStream(file).pipe(res);
    } catch {
      res.writeHead(404);
      res.end("not found");
    }
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ server, origin: `http://127.0.0.1:${server.address().port}` }));
  });
}

const corpus = JSON.parse(await readFile(new URL("../fixtures/corpus.json", import.meta.url), "utf8"));
// Maintainers may keep real-world sloppy sites here; the directory is git-ignored
// and never ships, so the public corpus only ever names sites with a clean label.
const privateCorpus = JSON.parse(await readFile(new URL("../fixtures/private/corpus.json", import.meta.url), "utf8").catch(() => "[]"));

const { server, origin } = await servePages();
const rows = [];
const targets = [
  ...corpus.map((s) => ({ ...s, outDir: new URL(`../fixtures/${s.host}/`, import.meta.url).pathname })),
  ...privateCorpus.map((s) => ({ ...s, outDir: new URL(`../fixtures/private/${s.host}/`, import.meta.url).pathname })),
];
for (const site of targets) {
  // A "fixture:" URL names a page we own under fixtures/pages/, served locally.
  const isFixture = site.url.startsWith("fixture:");
  const url = isFixture ? `${origin}/${site.url.slice("fixture:".length)}/` : site.url;
  const facts = await collect(url, { outDir: site.outDir, screenshots: true, allowLocal: isFixture });
  const result = auditFacts(facts);
  rows.push({ ...site, score: result.scored.score, tier: result.scored.tier, result });
  console.log(toTerminal(result), "\n");
}
await new Promise((resolve) => server.close(resolve));

console.log("host".padEnd(18), "label".padEnd(10), "score", "tier");
for (const r of rows) console.log(r.host.padEnd(18), r.label.padEnd(10), String(r.score).padStart(5), r.tier);
const bad = rows.filter((r) => (r.label === "clean" && r.score > 12) || (r.label === "slop" && r.score < 55));
if (bad.length) { console.error("\nOut of band:", bad.map((r) => `${r.host}=${r.score}`).join(", ")); process.exit(1); }
