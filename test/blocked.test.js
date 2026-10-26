import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { detectBlock } from "../src/blocked.js";
import { isBlockedError } from "../src/audit.js";
import { createServer, rescoreAll, friendly } from "../src/serve.js";

// A minimal facts object; every field the detector reads, overridable.
const facts = (over = {}) => ({
  url: "https://example.com",
  finalUrl: "https://example.com/",
  title: null,
  h1: null,
  headings: [],
  text: "",
  fullText: "",
  wordCount: 0,
  fullWordCount: 0,
  links: { total: 0 },
  status: null,
  server: null,
  ...over,
});

test("Oracle-like 403 stub is blocked", () => {
  const r = detectBlock(facts({
    status: 403,
    title: "Technical Difficulties",
    h1: "Technical Difficulties",
    headings: [{ level: "h1", text: "Technical Difficulties" }],
    wordCount: 69,
    text: "Site Accessed: https://example.com/ ... Incident Number: 0.cd163e17. Please try again later.",
  }));
  assert.ok(r, "a 403 stub with an incident number must be blocked");
  assert.match(r.reason, /Technical Difficulties/);
  assert.match(r.reason, /HTTP 403/);
  assert.equal(r.status, 403);
  assert.equal(r.title, "Technical Difficulties");
});

test("Cloudflare \"Just a moment\" 503 stub is blocked", () => {
  const r = detectBlock(facts({
    status: 503,
    title: "Just a moment...",
    wordCount: 30,
    text: "Just a moment... Checking your browser before accessing.",
  }));
  assert.ok(r);
  assert.match(r.reason, /Just a moment/);
});

test("Akamai \"Reference #18.abc\" 200 stub is blocked", () => {
  const r = detectBlock(facts({
    status: 200,
    title: "Access Denied",
    wordCount: 40,
    text: "Access Denied. Reference #18.abc123. Your request was blocked.",
  }));
  assert.ok(r);
});

test("a 403 with a 900-word page and 40 links is not blocked", () => {
  const r = detectBlock(facts({ status: 403, wordCount: 900, links: { total: 40 }, text: "word ".repeat(900) }));
  assert.equal(r, null);
});

test("a 200 tiny real page with 60 words and 3 links and no markers is not blocked", () => {
  const r = detectBlock(facts({ status: 200, title: "Acme", wordCount: 60, links: { total: 3 }, text: "Welcome to Acme. We make widgets for everyone." }));
  assert.equal(r, null);
});

test("status 429 with 30 words is blocked", () => {
  const r = detectBlock(facts({ status: 429, wordCount: 30 }));
  assert.ok(r);
  assert.match(r.reason, /HTTP 429/);
});

test("challenge-platform HTML markers are blocked", () => {
  const r = detectBlock(facts({ status: 200, wordCount: 30, html: '<script src="/cdn-cgi/challenge-platform/h/b/orchestrate/chl_page.js"></script>' }));
  assert.ok(r);
  assert.match(r.reason, /challenge page/);
});

test("the blocked fixture page reads as a block page", async () => {
  const html = await readFile(new URL("../fixtures/pages/blocked/index.html", import.meta.url), "utf8");
  assert.match(html, /Technical Difficulties/i);
  assert.match(html, /Incident Number/i);
  assert.ok(detectBlock(facts({
    status: 200,
    title: "Technical Difficulties",
    h1: "Technical Difficulties",
    wordCount: 25,
    text: "Technical Difficulties. The page you asked for is temporarily unavailable. Incident Number: 0.a1b2c3d4e5.",
  })));
});

test("friendly leaves a blocked message unchanged and isBlockedError matches it", () => {
  const msg = "example.com blocked the scanner: HTTP 403 and a 69-word page instead of the site. There is nothing to score, so no report was saved.";
  assert.equal(friendly(msg, "example.com"), msg);
  const err = new Error(msg); err.code = "BLOCKED";
  assert.equal(isBlockedError(err), true);
  assert.equal(isBlockedError(new Error("page.goto: Timeout")), false);
});

test("a blocked scan is reported as an error and writes no report folder", async () => {
  const outRoot = await mkdtemp(path.join(os.tmpdir(), "slop-audit-blocked-"));
  const auditFn = async (url) => {
    const err = new Error(`${new URL(url).hostname} blocked the scanner: HTTP 403 and a 69-word page instead of the site. There is nothing to score, so no report was saved.`);
    err.code = "BLOCKED";
    throw err;
  };
  const server = createServer({ outRoot, auditFn }).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const res = await fetch(`${base}/scan?url=https://example.com`, { redirect: "manual" });
    assert.equal(res.status, 200);
    const jobId = (await res.text()).match(/job=([a-f0-9]+)/)[1];
    let p;
    const t0 = Date.now();
    while (Date.now() - t0 < 2000) {
      p = await (await fetch(`${base}/progress?job=${jobId}`)).json();
      if (p.done) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.ok(p.done, "the scan finished");
    assert.match(p.error, /blocked the scanner/);
    assert.equal(p.href, null, "no report to link to");
    assert.equal((await readdir(outRoot).catch(() => [])).length, 0, "no report folder written");
  } finally { server.close(); }
});

test("rescoreAll removes a saved block stub", async () => {
  const outRoot = await mkdtemp(path.join(os.tmpdir(), "slop-audit-rescore-blocked-"));
  const dir = path.join(outRoot, "example.com");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "facts.json"), JSON.stringify(facts({
    status: 403,
    title: "Technical Difficulties",
    wordCount: 69,
    text: "Incident Number: 0.cd163e17",
  })));
  await writeFile(path.join(dir, "result.json"), JSON.stringify({
    url: "https://example.com", finalUrl: "https://example.com/", collectedAt: "2026-10-20T00:00:00.000Z", rulesVersion: "old",
    scored: { score: 4, tier: "Clean", blurb: "", categories: {} }, health: [],
  }));
  const n = await rescoreAll(outRoot);
  assert.equal(n, 0, "nothing rescored, only the stub removed");
  assert.equal((await readdir(outRoot).catch(() => [])).length, 0, "the block stub folder is removed");
});
