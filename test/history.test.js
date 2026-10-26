import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { auditFacts, RULES_VERSION } from "../src/audit.js";
import { writeReports, readHistory } from "../src/report.js";
import { toHtml } from "../src/html.js";
import { createServer, rescoreAll } from "../src/serve.js";

const facts = JSON.parse(await readFile(new URL("../fixtures/slop-demo.fixture/facts.json", import.meta.url), "utf8"));
const result = auditFacts(facts);

test("a scan appends a scan line and the served report shows score history after two", async () => {
  const outRoot = await mkdtemp(path.join(os.tmpdir(), "slop-audit-history-"));
  const dir = path.join(outRoot, "example.com");

  await writeReports({ ...result, collectedAt: "2026-10-20T00:00:00.000Z" }, dir, { screenshotSrc: "desktop.png" });
  let history = await readHistory(dir);
  assert.equal(history.length, 1);
  assert.equal(history[0].cause, "scan");
  assert.equal(history[0].rulesVersion, RULES_VERSION);
  assert.doesNotMatch(toHtml(result, { history }), /Score history/, "one entry is not yet a history");

  await writeReports({ ...result, collectedAt: "2026-10-21T00:00:00.000Z" }, dir, { screenshotSrc: "desktop.png" });
  history = await readHistory(dir);
  assert.equal(history.length, 2);
  assert.deepEqual(history.map((h) => h.cause), ["scan", "scan"]);

  const server = createServer({ outRoot }).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/out/example.com/report.html`);
    const text = await res.text();
    assert.match(text, /Score history/);
    assert.match(text, /Rescan/);
    assert.match(text, /newest first/);
  } finally { server.close(); }
});

test("rescoreAll re-scores an old-rules report and records a rules line", async () => {
  const outRoot = await mkdtemp(path.join(os.tmpdir(), "slop-audit-rescore-"));
  const dir = path.join(outRoot, "example.com");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "facts.json"), JSON.stringify(facts));
  await writeFile(path.join(dir, "result.json"), JSON.stringify({
    url: facts.url, finalUrl: facts.finalUrl, collectedAt: facts.collectedAt, rulesVersion: "old",
    scored: { score: 1, tier: "Clean", blurb: "", categories: {} }, health: [],
  }));

  const n = await rescoreAll(outRoot);
  assert.equal(n, 1);
  const saved = JSON.parse(await readFile(path.join(dir, "result.json"), "utf8"));
  assert.equal(saved.rulesVersion, RULES_VERSION);
  const history = await readHistory(dir);
  assert.ok(history.some((h) => h.cause === "rules"), "a rules line is recorded");
  assert.equal(history.at(-1).rulesVersion, RULES_VERSION);
});

test("public mode automatically rescans the oldest stale report without a request", async () => {
  const outRoot = await mkdtemp(path.join(os.tmpdir(), "slop-audit-auto-"));
  const dir = path.join(outRoot, "example.com");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "result.json"), JSON.stringify({
    url: "https://example.com", finalUrl: "https://example.com/",
    collectedAt: new Date(Date.now() - 24 * 3600 * 1000).toISOString(), rulesVersion: RULES_VERSION,
    scored: { score: 10, tier: "Edited", blurb: "x", categories: {} }, health: [],
  }));

  let calls = 0;
  const auditFn = async (url) => {
    calls += 1;
    return { ...result, url, finalUrl: url, collectedAt: new Date().toISOString() };
  };
  const server = createServer({ outRoot, publicMode: true, rescanTickMs: 50, rescanAfterMs: 1, auditFn }).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  try {
    const t0 = Date.now();
    while (calls === 0 && Date.now() - t0 < 1000) await new Promise((r) => setTimeout(r, 25));
    assert.equal(calls, 1, "the fake audit runs once without any HTTP request");
  } finally { server.close(); }
});
