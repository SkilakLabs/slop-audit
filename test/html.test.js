import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { auditFacts } from "../src/audit.js";
import { toHtml, esc, VERSION, CSS } from "../src/html.js";
import { createServer, friendly, prune } from "../src/serve.js";

const facts = JSON.parse(await readFile(new URL("../fixtures/slop-demo.fixture/facts.json", import.meta.url), "utf8"));
const result = auditFacts(facts);

test("the HTML report carries the score, tier, every finding and the health list", () => {
  const html = toHtml(result);
  assert.match(html, new RegExp(`<div class="score">${result.scored.score}<small>`));
  assert.match(html, new RegExp(`class="tier hot">${result.scored.tier}</`));
  for (const c of Object.values(result.scored.categories)) for (const f of c.findings) assert.ok(html.includes(esc(f.title)), f.id);
  for (const h of result.health) assert.ok(html.includes(esc(h.title)), h.id);
  assert.match(html, /src="desktop\.png"/);
  assert.ok(html.includes(`Slop Audit<small>v${VERSION}</small>`));
  assert.doesNotMatch(toHtml(result, { screenshotSrc: null }), /<figure/);
});

test("a page that never stopped animating says so, and a missing image renders nothing", () => {
  const partial = toHtml({ ...result, facts: { screenshotPartial: true } });
  assert.match(partial, /<img src="desktop\.png"/);
  assert.ok(partial.includes("Desktop, 1440px wide, top of page (first screen only; the page never stopped animating)"));
  assert.doesNotMatch(toHtml({ ...result, facts: { screenshotPartial: "none" } }), /<figure/);
  assert.doesNotMatch(toHtml({ ...result, screenshot: "none" }), /<figure/, "a served report knows the image is missing");
  assert.ok(toHtml(result).includes("Desktop, 1440px wide, top of page</figcaption>"), "a full-page image keeps the plain caption");
});

test("a served report without a desktop.png renders no broken image", async () => {
  const outRoot = await mkdtemp(path.join(os.tmpdir(), "slop-audit-noshot-"));
  const none = path.join(outRoot, "example.com");
  const withPng = path.join(outRoot, "example.org");
  await mkdir(none, { recursive: true });
  await mkdir(withPng, { recursive: true });
  await writeFile(path.join(none, "result.json"), JSON.stringify({ ...result, screenshot: "none" }));
  await writeFile(path.join(withPng, "result.json"), JSON.stringify(result));
  await writeFile(path.join(withPng, "desktop.png"), "");
  const server = createServer({ outRoot }).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const gone = await (await fetch(`${base}/out/example.com/report.html`)).text();
    assert.doesNotMatch(gone, /<figure/);
    assert.doesNotMatch(gone, /desktop\.png/);
    assert.match(await (await fetch(`${base}/out/example.org/report.html`)).text(), /src="desktop\.png"/);
  } finally { server.close(); }
});

test("navigation and the feedback form appear only in the served version", () => {
  const file = toHtml(result);
  assert.doesNotMatch(file, /class="logo" href/);
  assert.doesNotMatch(file, /action="\/feedback"/);
  const served = toHtml(result, { homeHref: "/", feedback: true });
  assert.match(served, /<a class="logo" href="\/">/);
  assert.match(served, /action="\/feedback"/);
  assert.match(served, /name="findings" value="neon-palette,/);
});

test("the footer renders the scale and points its links at the right place", () => {
  const file = toHtml(result);
  assert.match(file, /How scores work/);
  assert.match(file, /0–5 Clean/);
  assert.match(file, /href="https:\/\/slopaudit\.skilak\.ai\/about"/);
  assert.match(file, /href="https:\/\/slopaudit\.skilak\.ai\/"/);
  const served = toHtml(result, { homeHref: "/", feedback: true });
  assert.match(served, /href="\/about"/);
  assert.match(served, /href="#feedback"/);
  assert.match(served, /id="feedback"/);
  assert.match(served, /Dispute this report/);
});

test("GET /about explains the Slop Scale", async () => {
  const outRoot = await mkdtemp(path.join(os.tmpdir(), "slop-audit-"));
  const server = createServer({ outRoot }).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const about = await fetch(`${base}/about`);
    assert.equal(about.status, 200);
    const text = await about.text();
    assert.match(text, /Slop Scale/);
    assert.match(text, /What a score means/);
    assert.match(text, /Clean/);
    assert.match(text, /id="disputes"/);
    assert.match(text, /href="\/about#disputes"/);
    assert.doesNotMatch(text, /href="#feedback"/);
  } finally { server.close(); }
});

test("the list table CSS adds spacing after a right-aligned column", () => {
  assert.match(CSS, /table\.list td\.n \+ td, table\.list th\.n \+ th \{ padding-left: 24px; \}/);
});

test("page content is escaped, so a site cannot inject markup into its own report", () => {
  const hostile = { ...result, finalUrl: "https://x.test/<script>alert(1)</script>" };
  assert.doesNotMatch(toHtml(hostile), /<script>alert/);
});

test("errors are rewritten into sentences", () => {
  assert.match(friendly("Cannot resolve host: asdf", "asdf"), /Can't find a website/);
  assert.match(friendly("page.goto: Timeout 45000ms exceeded", "x.com"), /longer than 45 seconds/);
  assert.match(friendly("Refusing private address for x: 10.0.0.1", "x"), /private or local/);
});

test("the local server: form, inline errors for bad targets, progress lookup, feedback file", async () => {
  const outRoot = await mkdtemp(path.join(os.tmpdir(), "slop-audit-"));
  const server = createServer({ outRoot }).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const index = await fetch(`${base}/`);
    assert.equal(index.status, 200);
    assert.equal(index.headers.get("cache-control"), "no-store");
    assert.match(await index.text(), /<form id="scan" action="\/scan"/);

    const refused = await fetch(`${base}/scan?url=http://127.0.0.1:8080`, { redirect: "manual" });
    assert.equal(refused.status, 303);
    const home = await fetch(`${base}${refused.headers.get("location")}`);
    assert.match(await home.text(), /class="err">.*private or local/);

    const tokened = await fetch(`${base}/scan?url=https://example.com/?token=abc`, { redirect: "manual" });
    assert.match(decodeURIComponent(tokened.headers.get("location")), /token or session/);

    assert.equal((await fetch(`${base}/progress?job=nope`)).status, 404);
    assert.equal((await fetch(`${base}/out/../package.json`)).status, 404);
    assert.equal((await fetch(`${base}/out/example.com/report.html`)).status, 404);

    const fb = await fetch(`${base}/feedback`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "host=example.com&score=71&tier=Slop&verdict=about-right&findings=neon-palette,orb&notes=the+orb+is+real" });
    assert.equal(fb.status, 200);
    const saved = JSON.parse((await readFile(path.join(outRoot, "feedback.jsonl"), "utf8")).trim());
    assert.deepEqual([saved.host, saved.score, saved.verdict, saved.findings, saved.notes], ["example.com", 71, "about-right", ["neon-palette", "orb"], "the orb is real"]);
    assert.match(await (await fetch(`${base}/feedback`)).text(), /the orb is real/);
    assert.match(await (await fetch(`${base}/`)).text(), /1 feedback note/);
  } finally { server.close(); }
});

// Public mode, with a fake audit so no browser launches.
test("public mode queues one scan at a time, dedupes, caps the queue, rate-limits, serves fresh reports, prunes", async () => {
  const outRoot = await mkdtemp(path.join(os.tmpdir(), "slop-audit-public-"));
  let release;
  const gate = new Promise((r) => (release = r));
  let calls = 0;
  const auditFn = async (url, { onProgress }) => {
    calls += 1;
    onProgress("Loading", 0.3);
    if (calls === 1) await gate; // hold the first scan so others queue behind it
    return { ...result, url, finalUrl: url, collectedAt: new Date().toISOString(), facts: {} };
  };
  const server = createServer({ outRoot, publicMode: true, maxQueue: 2, perIpPerHour: 3, keepReports: 10, auditFn }).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const scan = (h, ip = "1.1.1.1") => fetch(`${base}/scan?url=https://${h}`, { redirect: "manual", headers: { "x-forwarded-for": ip } });
  const err = (r) => decodeURIComponent(r.headers.get("location") || "");
  try {
    const first = await scan("example.com");
    assert.equal(first.status, 200);
    const jobId = (await first.text()).match(/job=([a-f0-9]+)/)[1];
    assert.equal((await scan("example.com")).status, 200, "same host attaches to the running job");
    assert.equal(calls, 1);
    assert.equal((await scan("example.org")).status, 200);
    assert.equal((await scan("example.net")).status, 200);
    assert.match(err(await scan("iana.org")), /already waiting/);
    assert.match(err(await scan("iana.org", "2.2.2.2")), /already waiting/, "queue cap is global");
    const p = await (await fetch(`${base}/progress?job=${jobId}`)).json();
    assert.equal(p.label, "Loading");
    assert.match((await (await fetch(`${base}/healthz`)).json()).running, /example\.com/);
    release();
    for (let i = 0; i < 50 && (await (await fetch(`${base}/healthz`)).json()).running; i++) await new Promise((r) => setTimeout(r, 20));
    assert.equal(calls, 3);
    const again = await scan("example.com", "3.3.3.3");
    assert.equal(again.status, 303);
    assert.match(again.headers.get("location"), /\/out\/example\.com\/report\.html$/, "fresh report is served instead of rescanned");
    assert.equal(await prune(outRoot, 2), 2);
    const kept = (await readdir(outRoot)).filter((d) => d.startsWith("example"));
    assert.equal(kept.length, 2, "oldest report pruned");
    assert.match(err(await scan("iana.org")), /3 scans this hour/, "per-ip limit");
    assert.match(err(await scan("iana.org", "9.9.9.9, 1.1.1.1")), /3 scans this hour/, "a forged first entry does not dodge the limit");
    assert.equal((await fetch(`${base}/out/example.org/facts.json`)).status, 404, "facts are not public");
    assert.equal((await fetch(`${base}/feedback`)).status, 404, "feedback list is private");
  } finally { server.close(); }
});

test("publicMode swaps the feedback note", () => {
  const served = toHtml(result, { homeHref: "/", feedback: true, publicMode: true });
  assert.match(served, /read by a person/);
  assert.doesNotMatch(served, /nothing leaves/);
  const local = toHtml(result, { homeHref: "/", feedback: true });
  assert.match(local, /nothing leaves this machine/);
  assert.doesNotMatch(local, /read by a person/);
});

test("a served report links to Rescan; the standalone file does not", () => {
  const served = toHtml(result, { homeHref: "/", feedback: true });
  assert.match(served, /href="\/scan\?url=/);
  assert.match(served, /force=1/);
  assert.match(served, />Rescan</);
  const file = toHtml(result);
  assert.doesNotMatch(file, />Rescan</);
});

test("force=1 rescans a fresh report instead of serving it", async () => {
  const outRoot = await mkdtemp(path.join(os.tmpdir(), "slop-audit-force-"));
  const host = "example.com";
  const dir = path.join(outRoot, host);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "result.json"), JSON.stringify({ ...result, collectedAt: new Date().toISOString() }));

  let calls = 0;
  const auditFn = async (url) => {
    calls += 1;
    return { ...result, url, finalUrl: url, collectedAt: new Date().toISOString() };
  };
  const server = createServer({ outRoot, publicMode: true, auditFn }).listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const served = await fetch(`${base}/scan?url=https://${host}`, { redirect: "manual" });
    assert.equal(served.status, 303);
    assert.match(served.headers.get("location"), /\/out\/example\.com\/report\.html$/);
    assert.equal(calls, 0, "a fresh report is served without a scan");

    const forced = await fetch(`${base}/scan?url=https://${host}&force=1`, { redirect: "manual" });
    assert.equal(forced.status, 200);
    assert.match(await forced.text(), /job=/);
    const t0 = Date.now();
    while (calls === 0 && Date.now() - t0 < 2000) await new Promise((r) => setTimeout(r, 20));
    assert.equal(calls, 1, "force=1 runs the audit");
  } finally { server.close(); }
});
