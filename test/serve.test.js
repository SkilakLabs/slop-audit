import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readdir, writeFile, utimes } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createServer } from "../src/serve.js";

// A saved report has just enough for the homepage and report page to render.
const result = (url) => ({
  url,
  finalUrl: `${url}/`,
  collectedAt: "2026-10-20T00:00:00.000Z",
  scored: { score: 42, tier: "Sloppy", blurb: "x", categories: {} },
  health: [],
});

const listen = (server) => new Promise((r) => server.once("listening", () => r(`http://127.0.0.1:${server.address().port}`)));

async function writeReport(outRoot, host) {
  const dir = path.join(outRoot, host);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "result.json"), JSON.stringify(result(`https://${host}`)));
}

// A fresh temp dir with out/ and hidden.txt next to it, mirroring the default.
async function setup() {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "slop-audit-hide-"));
  const outRoot = path.join(tmp, "out");
  const hiddenFile = path.join(tmp, "hidden.txt");
  await mkdir(outRoot, { recursive: true });
  return { tmp, outRoot, hiddenFile };
}

// The startup purge is fire-and-forget, so wait briefly for the rm to land.
async function waitRemoved(outRoot, host, ms = 1000) {
  const t0 = Date.now();
  while ((await readdir(outRoot)).includes(host) && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 10));
  return !(await readdir(outRoot)).includes(host);
}

test("hidden hosts are omitted, 404, refused, and their folder is removed", async () => {
  const { outRoot, hiddenFile } = await setup();
  await writeReport(outRoot, "example.com");
  await writeReport(outRoot, "example.org");
  await writeFile(hiddenFile, "example.com\n");

  const server = createServer({ outRoot, hiddenFile }).listen(0, "127.0.0.1");
  const base = await listen(server);
  try {
    const home = await (await fetch(`${base}/`)).text();
    assert.doesNotMatch(home, /\/out\/example\.com\/report\.html/, "hidden host is not listed");
    assert.match(home, /\/out\/example\.org\/report\.html/, "other hosts still list");
    assert.ok(await waitRemoved(outRoot, "example.com"), "hidden folder is removed at startup");

    assert.equal((await fetch(`${base}/out/example.com/report.html`)).status, 404, "hidden report is 404");
    assert.equal((await fetch(`${base}/out/example.org/report.html`)).status, 200, "other report serves");

    const scan = await fetch(`${base}/scan?url=https://example.com`, { redirect: "manual" });
    assert.equal(scan.status, 303);
    assert.match(decodeURIComponent(scan.headers.get("location")), /This site is not listed here\./, "scan is refused");
  } finally { server.close(); }
});

test("a hidden entry without www hides a www report folder", async () => {
  const { outRoot, hiddenFile } = await setup();
  await writeReport(outRoot, "www.example.com");
  await writeFile(hiddenFile, "example.com\n");

  const server = createServer({ outRoot, hiddenFile }).listen(0, "127.0.0.1");
  const base = await listen(server);
  try {
    const home = await (await fetch(`${base}/`)).text();
    assert.doesNotMatch(home, /\/out\/www\.example\.com\/report\.html/, "www folder is hidden by the bare entry");
    assert.equal((await fetch(`${base}/out/www.example.com/report.html`)).status, 404);
    assert.ok(await waitRemoved(outRoot, "www.example.com"), "www folder removed");
  } finally { server.close(); }
});

test("editing hidden.txt after startup takes effect without a restart", async () => {
  const { outRoot, hiddenFile } = await setup();
  await writeReport(outRoot, "example.org");
  await writeReport(outRoot, "example.com");
  await writeFile(hiddenFile, "# nothing hidden yet\n");

  const server = createServer({ outRoot, hiddenFile }).listen(0, "127.0.0.1");
  const base = await listen(server);
  try {
    let home = await (await fetch(`${base}/`)).text();
    assert.match(home, /\/out\/example\.org\/report\.html/);
    assert.match(home, /\/out\/example\.com\/report\.html/);

    await writeFile(hiddenFile, "# nothing hidden yet\nexample.org\n");
    await utimes(hiddenFile, new Date(), new Date(Date.now() + 2000));

    home = await (await fetch(`${base}/`)).text();
    assert.doesNotMatch(home, /\/out\/example\.org\/report\.html/, "newly hidden host disappears");
    assert.match(home, /\/out\/example\.com\/report\.html/, "the other host stays");
    assert.ok(await waitRemoved(outRoot, "example.org"), "newly hidden folder removed");
  } finally { server.close(); }
});

test("removing an entry lets the host be scanned again", async () => {
  const { outRoot, hiddenFile } = await setup();
  await writeFile(hiddenFile, "example.org\n");

  let calls = 0;
  const auditFn = async (url) => { calls += 1; return { ...result(url), collectedAt: new Date().toISOString() }; };
  const server = createServer({ outRoot, hiddenFile, auditFn }).listen(0, "127.0.0.1");
  const base = await listen(server);
  try {
    const refused = await fetch(`${base}/scan?url=https://example.org`, { redirect: "manual" });
    assert.equal(refused.status, 303);
    assert.match(decodeURIComponent(refused.headers.get("location")), /This site is not listed here\./);

    await writeFile(hiddenFile, "");
    await utimes(hiddenFile, new Date(), new Date(Date.now() + 2000));

    const scan = await fetch(`${base}/scan?url=https://example.org`, { redirect: "manual" });
    assert.equal(scan.status, 200, "scan accepted once the entry is removed");
    assert.match(await scan.text(), /job=/);
    const t0 = Date.now();
    while (calls === 0 && Date.now() - t0 < 2000) await new Promise((r) => setTimeout(r, 20));
    assert.equal(calls, 1, "the audit runs");
  } finally { server.close(); }
});
