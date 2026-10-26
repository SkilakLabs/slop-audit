// The calibration contract. Any rule change that breaks this ordering is wrong,
// no matter how reasonable it sounds. Facts are pre-collected (offline test).
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { auditFacts } from "../src/audit.js";

const corpus = JSON.parse(await readFile(new URL("../fixtures/corpus.json", import.meta.url), "utf8"));
// The private corpus is git-ignored and optional: a maintainer keeps real-world
// sloppy sites there as anchors, away from the public repo. Skip it when absent.
const privateCorpus = JSON.parse(await readFile(new URL("../fixtures/private/corpus.json", import.meta.url), "utf8").catch(() => "[]"));
const sites = [
  ...corpus.map((s) => ({ ...s, factsDir: "../fixtures/" })),
  ...privateCorpus.map((s) => ({ ...s, factsDir: "../fixtures/private/" })),
];
const results = {};
for (const site of sites) {
  const facts = JSON.parse(await readFile(new URL(`${site.factsDir}${site.host}/facts.json`, import.meta.url), "utf8"));
  results[site.host] = auditFacts(facts);
}

test("clean sites stay in the Clean or Edited tiers", () => {
  for (const site of sites.filter((s) => s.label === "clean")) {
    const r = results[site.host];
    assert.ok(r.scored.score <= 12, `${site.host} scored ${r.scored.score}: ${r.scored.categories.visual.findings.concat(r.scored.categories.copy.findings).map((f) => f.id).join(", ")}`);
    assert.ok(["Clean", "Edited"].includes(r.scored.tier), `${site.host} tier is ${r.scored.tier}`);
  }
});

test("slop sites score as Slop", () => {
  for (const site of sites.filter((s) => s.label === "slop")) {
    const r = results[site.host];
    assert.ok(r.scored.score >= 55, `${site.host} scored ${r.scored.score}`);
    assert.equal(r.scored.tier, "Slop");
  }
});

test("slop-demo.fixture fires the human tells it was built to show", () => {
  const ids = new Set(Object.values(results["slop-demo.fixture"].scored.categories).flatMap((c) => c.findings.map((f) => f.id)));
  for (const id of ["neon-palette", "particle-backdrop", "beta-pill", "orb", "eyebrow-everywhere", "em-dash-density", "honesty-protest", "disclaimed-testimonials", "simulated-stats"]) {
    assert.ok(ids.has(id), `expected ${id} to fire`);
  }
});

test("skilak.ai does not trip the style rules it shares grammar with", () => {
  const ids = new Set(Object.values(results["skilak.ai"].scored.categories).flatMap((c) => c.findings.map((f) => f.id)));
  for (const id of ["neon-palette", "beta-pill", "eyebrow-everywhere", "slop-font", "em-dash-density", "honesty-protest", "repeated-phrases", "title-case"]) {
    assert.ok(!ids.has(id), `${id} should not fire on skilak.ai`);
  }
});

test("option.com: a pre-AI site is not penalised for tricolons, product names, or being dated", () => {
  const r = results["option.com"];
  const ids = new Set(Object.values(r.scored.categories).flatMap((c) => c.findings.map((f) => f.id)));
  assert.ok(!ids.has("buzzwords"), "“Smart Metering” is a product, not a buzzword");
  assert.ok(!ids.has("particle-backdrop"), "a loaded particles.js with no visible canvas is not a backdrop");
  assert.ok(r.health.some((h) => h.id === "dead-links"), "dead links are reported as health, not slop");
});

test("slop is at least 50 points above the clean sites", () => {
  const clean = Math.max(...corpus.filter((s) => s.label === "clean").map((s) => results[s.host].scored.score));
  const slop = Math.min(...corpus.filter((s) => s.label === "slop").map((s) => results[s.host].scored.score));
  assert.ok(slop - clean >= 50, `gap is ${slop - clean}`);
});

test("nvidia.com: inline SVG styles are not copy, /favicon.ico counts, four headline-case news titles are not a default", async () => {
  const ids = new Set(Object.values(results["nvidia.com"].scored.categories).flatMap((c) => c.findings.map((f) => f.id)));
  for (const id of ["repeated-phrases", "no-favicon", "title-case"]) assert.ok(!ids.has(id), `${id} should not fire on nvidia.com`);
  const facts = JSON.parse(await readFile(new URL("../fixtures/nvidia.com/facts.json", import.meta.url), "utf8"));
  assert.doesNotMatch(facts.fullText, /stroke-miterlimit/);
  assert.equal(facts.favicon, true);
});

test("microsoft.com: button labels that sit next to each other are not repeated prose", () => {
  const ids = new Set(Object.values(results["microsoft.com"].scored.categories).flatMap((c) => c.findings.map((f) => f.id)));
  assert.ok(!ids.has("repeated-phrases"), "repeated-phrases should not fire on microsoft.com");
});
