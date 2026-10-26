// The web app: paste a URL, watch the progress bar, read the report, say
// whether the score matches your eye. Locally it binds to loopback with no
// limits. With publicMode it expects to sit behind a TLS proxy and protects
// itself: one scan at a time, a short queue, per-IP and daily caps, a cache
// for repeat requests, and a cap on how many reports stay on disk.
import http from "node:http";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { appendFile, mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import { audit, auditFacts, RULES_VERSION, isBlockedError } from "./audit.js";
import { detectBlock } from "./blocked.js";
import { writeReports, readHistory } from "./report.js";
import { toHtml, esc, CSS, ICON, DESCRIPTION, header, footer } from "./html.js";
import { assertPublicUrl, normalizeUrl } from "./safety.js";
import { SCALE } from "./score.js";

const STATIC = { ".png": "image/png", ".json": "application/json", ".md": "text/markdown; charset=utf-8" };
const HOST_RE = /^[a-z0-9.-]+$/i;
// A host's identity ignores case and any leading "www.", so "example.com" and
// "www.example.com" name the same report folder.
const hostKey = (host) => String(host).toLowerCase().replace(/^www\./, "");
const ISSUES = "https://github.com/SkilakLabs/slop-audit/issues/new";
const HOUR = 3600 * 1000;

export function createServer({
  outRoot = "out",
  hiddenFile = path.join(path.resolve(outRoot), "..", "hidden.txt"), // hosts never listed, served or rescanned
  publicMode = false,     // enable the limits below and trust X-Forwarded-For
  maxQueue = 5,           // scans waiting behind the running one
  perIpPerHour = 5,       // scans one address may start per hour
  perDay = 300,           // scans the whole server runs per day
  keepReports = 1000,     // oldest reports are deleted beyond this
  freshMs = 10 * 60 * 1000, // a report younger than this is served instead of rescanned
  rescanAfterMs = 7 * 24 * 3600 * 1000, // a report this old is rescanned automatically
  rescanTickMs = 30 * 60 * 1000,        // how often to look for a rescan to run
  rescanPerDay = 48,                    // automatic rescans the server runs per day
  auditFn = audit,        // injectable for tests
} = {}) {
  const jobs = new Map();   // id -> job
  const queue = [];         // jobs waiting
  let running = null;
  const hits = new Map();   // "scan:ip" | "fb:ip" -> [timestamps]
  let day = { date: "", n: 0 };
  let rescanDay = { date: "", n: 0 };

  // Hidden hosts: one host per line, lowercase, `#` comments and blank lines
  // ignored. Re-read only when the file's size or mtime changes, so a one-off
  // task can edit the list without a server restart. A missing file means an
  // empty list. On a change (including startup) matching report folders are
  // removed, so they cannot be served from disk.
  const hiddenState = { key: "", hosts: new Set() };
  async function readHidden() {
    const st = await stat(hiddenFile).catch(() => null);
    const key = st ? `${st.size}:${st.mtimeMs}` : "missing";
    if (key === hiddenState.key) return hiddenState.hosts;
    const hosts = new Set();
    if (st) {
      for (const line of (await readFile(hiddenFile, "utf8")).split("\n")) {
        const h = line.trim();
        if (!h || h.startsWith("#")) continue;
        hosts.add(hostKey(h));
      }
    }
    hiddenState.key = key;
    hiddenState.hosts = hosts;
    for (const h of await readdir(outRoot).catch(() => [])) {
      if (hosts.has(hostKey(h))) {
        await rm(path.join(outRoot, h), { recursive: true, force: true });
        console.log(`hidden: removed ${h}`);
      }
    }
    return hosts;
  }

  const limited = (key, max) => {
    if (!publicMode) return false;
    const now = Date.now();
    const list = (hits.get(key) || []).filter((t) => now - t < HOUR);
    if (list.length >= max) { hits.set(key, list); return true; }
    list.push(now); hits.set(key, list);
    return false;
  };
  const dayFull = () => {
    if (!publicMode) return false;
    const today = new Date().toISOString().slice(0, 10);
    if (day.date !== today) day = { date: today, n: 0 };
    if (day.n >= perDay) return true;
    day.n += 1;
    return false;
  };
  // The ALB appends the connecting address to X-Forwarded-For, so the last
  // entry is the one a caller cannot forge. Earlier entries are whatever the
  // caller sent.
  const clientIp = (req) => (publicMode && req.headers["x-forwarded-for"] ? String(req.headers["x-forwarded-for"]).split(",").at(-1).trim() : req.socket.remoteAddress) || "?";

  async function pump() {
    if (running || !queue.length) return;
    const job = (running = queue.shift());
    job.label = "Starting"; job.started = Date.now();
    // The list may have gained this host while it waited in the queue.
    if ((await readHidden()).has(hostKey(job.host))) {
      Object.assign(job, { done: true, error: "This site is not listed here." });
      running = null;
      setTimeout(() => jobs.delete(job.id), HOUR).unref();
      pump();
      return;
    }
    try {
      const result = await auditFn(job.url, { outDir: path.join(outRoot, job.host), onProgress: (label, pct) => Object.assign(job, { label, pct }) });
      Object.assign(job, { label: "Scoring", pct: 0.95 });
      await writeReports(result, path.join(outRoot, job.host), { screenshotSrc: "desktop.png", publicMode });
      Object.assign(job, { label: "Done", pct: 1, done: true, href: `/out/${job.host}/report.html` });
      await prune(outRoot, keepReports).catch(() => {});
    } catch (e) {
      Object.assign(job, { done: true, error: friendly(e.message, job.host) });
      // An automatic rescan that hits a block page keeps its existing report;
      // log it once so the operator knows the site stopped being scannable.
      if (isBlockedError(e) && job.automatic) console.log(`blocked: kept ${job.host}`);
    } finally {
      running = null;
      setTimeout(() => jobs.delete(job.id), HOUR).unref();
      pump();
    }
  }

  // The host whose saved scan is oldest and stale enough for an automatic rescan.
  async function oldestStaleHost(hidden) {
    let best = null;
    for (const h of await readdir(outRoot).catch(() => [])) {
      if (hidden.has(hostKey(h))) continue;
      const raw = await readFile(path.join(outRoot, h, "result.json"), "utf8").catch(() => null);
      if (!raw) continue;
      let r; try { r = JSON.parse(raw); } catch { continue; }
      const t = Date.parse(r.collectedAt);
      if (t && (!best || t < best.t)) best = { h, t };
    }
    return best && Date.now() - best.t >= rescanAfterMs ? best.h : null;
  }

  // Automatic rescan (public mode): reuse the scan queue without touching the
  // per-IP or per-day user limits, so listed sites stay fresh on their own.
  async function rescanTick() {
    const today = new Date().toISOString().slice(0, 10);
    if (rescanDay.date !== today) rescanDay = { date: today, n: 0 };
    if (running || queue.length || rescanDay.n >= rescanPerDay) return;
    const host = await oldestStaleHost(await readHidden());
    if (!host) return;
    const saved = JSON.parse(await readFile(path.join(outRoot, host, "result.json"), "utf8"));
    const job = { id: randomBytes(6).toString("hex"), url: saved.url, host, label: "Waiting", pct: 0, done: false, automatic: true };
    jobs.set(job.id, job);
    queue.push(job);
    rescanDay.n += 1;
    pump();
  }

  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, "http://localhost");
    try {
      if (u.pathname === "/") return page(res, 200, await indexPage(outRoot, u.searchParams.get("error"), u.searchParams.get("url"), publicMode, await readHidden()));
      if (u.pathname === "/about") return page(res, 200, aboutPage());
      if (u.pathname === "/healthz") return json(res, 200, { ok: true, running: running ? running.host : null, queued: queue.length });

      if (u.pathname === "/scan") {
        const raw = (u.searchParams.get("url") || "").trim();
        const url = normalizeUrl(raw);
        const bounce = (msg) => redirect(res, `/?error=${encodeURIComponent(msg)}&url=${encodeURIComponent(raw)}`);
        if (/[?&](token|key|session|auth|sig)=/i.test(url)) return bounce("That address carries a token or session; paste the plain page address.");
        let target;
        try { target = await assertPublicUrl(url); } catch (e) { return bounce(friendly(e.message, raw)); }
        const host = target.hostname;
        if ((await readHidden()).has(hostKey(host))) return bounce("This site is not listed here.");
        // Scanning this server's own /scan or /progress would start scans from inside a scan.
        // The homepage and the about page are ordinary pages and may be scored like any other.
        if (publicMode && String(req.headers.host || "").split(":")[0] === host && !["/", "/about"].includes(target.pathname.replace(/\/+$/, "") || "/")) return bounce("Only this site's homepage can be scanned; its working pages would scan themselves.");

        const force = u.searchParams.get("force") === "1";
        const fresh = !force && await freshReport(outRoot, host, freshMs);
        if (publicMode && fresh) return redirect(res, `/out/${host}/report.html`);
        const existing = [running, ...queue].find((j) => j && j.host === host);
        if (existing) return page(res, 200, progressPage(existing));

        // Queue cap first, so a refused scan does not use up the caller's allowance.
        if (queue.length >= maxQueue) return bounce(`${queue.length} scans are already waiting. Try again in a few minutes.`);
        if (limited(`scan:${clientIp(req)}`, perIpPerHour)) return bounce(`You have started ${perIpPerHour} scans this hour. Read those first; the limit resets within the hour.`);
        if (dayFull()) return bounce("The server has hit its daily scan limit. Try again tomorrow.");

        const job = { id: randomBytes(6).toString("hex"), url, host, label: "Waiting", pct: 0, done: false };
        jobs.set(job.id, job);
        queue.push(job);
        pump();
        return page(res, 200, progressPage(job));
      }

      if (u.pathname === "/progress") {
        const job = jobs.get(u.searchParams.get("job") || "");
        if (!job) return json(res, 404, { error: "No such scan" });
        const ahead = queue.indexOf(job);
        return json(res, 200, { label: ahead >= 0 ? `Waiting, ${ahead + (running ? 1 : 0)} ahead` : job.label, pct: job.pct, done: job.done, error: job.error || null, href: job.href || null });
      }

      if (u.pathname === "/feedback" && req.method === "POST") {
        if (limited(`fb:${clientIp(req)}`, 10)) return page(res, 429, shell("Slow down", `<p>That is plenty of feedback for one hour. Thank you.</p>${back()}`));
        const form = new URLSearchParams(await body(req));
        const host = (form.get("host") || "").slice(0, 200);
        if ((await readHidden()).has(hostKey(host))) return page(res, 404, shell("Not found", back()));
        const entry = {
          at: new Date().toISOString(),
          host,
          score: Number(form.get("score")),
          tier: (form.get("tier") || "").slice(0, 40),
          verdict: (form.get("verdict") || "").slice(0, 20),
          findings: (form.get("findings") || "").split(",").filter(Boolean).slice(0, 60),
          notes: (form.get("notes") || "").slice(0, 2000),
        };
        await mkdir(outRoot, { recursive: true });
        await appendFile(path.join(outRoot, "feedback.jsonl"), JSON.stringify(entry) + "\n");
        const issue = `${ISSUES}?title=${encodeURIComponent(`${entry.host}: score ${entry.score} is ${entry.verdict.replace("-", " ")}`)}&body=${encodeURIComponent(`Host: ${entry.host}\nScore: ${entry.score} (${entry.tier})\nVerdict: ${entry.verdict}\nFindings: ${entry.findings.join(", ")}\n\n${entry.notes}`)}`;
        const where = publicMode ? "Saved. Every note is read by a person and becomes a labelled site in the calibration set." : `Saved to <code>${esc(path.join(outRoot, "feedback.jsonl"))}</code>. Each note becomes a labelled site in the calibration corpus.`;
        return page(res, 200, shell("Thanks", `<p>${where}</p><p>Want it tracked in the open? <a href="${esc(issue)}">Open it as a GitHub issue</a> (prefilled).</p><p><a href="/out/${esc(entry.host)}/report.html">Back to the report</a> · <a href="/">All reports</a></p>`));
      }

      if (u.pathname === "/feedback" && !publicMode) return page(res, 200, await feedbackPage(outRoot));

      const m = u.pathname.match(/^\/out\/([^/]+)\/([^/]+)$/);
      if (m && HOST_RE.test(m[1]) && !m[2].includes("..")) {
        if ((await readHidden()).has(hostKey(m[1]))) return page(res, 404, shell("Not found", back()));
        const dir = path.join(outRoot, m[1]);
        if (m[2] === "report.html") {
          // Render from the saved result so old scans get the current layout and navigation.
          const saved = await readFile(path.join(dir, "result.json"), "utf8").catch(() => null);
          if (!saved) return page(res, 404, shell("Not found", back()));
          const r = JSON.parse(saved);
          const history = await readHistory(dir);
          // A page that never stopped animating may have no desktop.png at all;
          // point the report at the file only when it exists.
          const shot = await stat(path.join(dir, "desktop.png")).then(() => "desktop.png", () => null);
          return page(res, 200, toHtml({ ...r, health: r.health || [] }, { screenshotSrc: shot, screenshotPartial: r.screenshot, homeHref: "/", feedback: true, history, publicMode }));
        }
        if (publicMode && m[2] === "facts.json") return page(res, 404, shell("Not found", back()));
        const type = STATIC[path.extname(m[2])];
        const data = type ? await readFile(path.join(dir, m[2])).catch(() => null) : null;
        if (!data) return page(res, 404, shell("Not found", back()));
        res.writeHead(200, { "content-type": type, "cache-control": "public, max-age=300" });
        return res.end(data);
      }
      return page(res, 404, shell("Not found", back()));
    } catch (e) {
      return page(res, 500, shell("Error", `<p class="err">${esc(e.message)}</p>${back()}`));
    }
  });

  // Apply rule improvements to every saved report on startup; do not wait for it.
  readHidden()
    .then((hidden) => rescoreAll(outRoot, publicMode, hidden))
    .then((n) => console.log(`rescored ${n} report(s) to the current rules`))
    .catch((e) => console.error(`rescore failed: ${e.message}`));
  if (publicMode) {
    const timer = setInterval(() => { rescanTick().catch(() => {}); }, rescanTickMs);
    timer.unref();
    server.on("close", () => clearInterval(timer));
  }
  return server;
}

// Re-score every saved report whose rulesVersion is behind the current rule
// set, using its saved facts (no browser). Hidden hosts are skipped. Returns
// the number of hosts rescored.
export async function rescoreAll(outRoot, publicMode = false, hidden = new Set()) {
  let n = 0;
  for (const host of await readdir(outRoot).catch(() => [])) {
    if (hidden.has(hostKey(host))) continue;
    const dir = path.join(outRoot, host);
    const [factsRaw, resultRaw] = await Promise.all([
      readFile(path.join(dir, "facts.json"), "utf8").catch(() => null),
      readFile(path.join(dir, "result.json"), "utf8").catch(() => null),
    ]);
    if (!factsRaw || !resultRaw) continue;
    let result; try { result = JSON.parse(resultRaw); } catch { continue; }
    let facts; try { facts = JSON.parse(factsRaw); } catch { continue; }
    // A block stub saved by an older deploy is removed, not re-scored.
    if (detectBlock(facts)) {
      await rm(dir, { recursive: true, force: true });
      console.log(`blocked: removed ${host}`);
      continue;
    }
    if (result.rulesVersion === RULES_VERSION) continue;
    // Keep the saved screenshot state so a re-scored report does not point at an
    // image this scan never wrote.
    await writeReports({ ...auditFacts(facts), screenshot: result.screenshot }, dir, { screenshotSrc: "desktop.png", cause: "rules", publicMode });
    n += 1;
  }
  return n;
}

// Turn Playwright and DNS errors into a sentence a person can act on.
export function friendly(msg, host) {
  if (/blocked the scanner/.test(msg)) return msg;
  if (/Not a URL|Invalid URL/i.test(msg)) return `“${host}” is not a web address.`;
  if (/Cannot resolve host|ERR_NAME_NOT_RESOLVED/i.test(msg)) return `Can't find a website at “${host}”. Check the spelling.`;
  if (/Refusing private/i.test(msg)) return `“${host}” is a private or local address. Only public websites are scanned.`;
  if (/Only http/i.test(msg)) return `Only http and https addresses are scanned.`;
  if (/Timeout|timed out/i.test(msg)) return `${host} took longer than 45 seconds to load. Try again, or scan a lighter page on the same site.`;
  if (/ERR_CONNECTION_REFUSED|ERR_CONNECTION_RESET/i.test(msg)) return `${host} refused the connection.`;
  if (/ERR_CERT|SSL/i.test(msg)) return `${host} has a broken certificate, so the browser would not load it.`;
  return `${host}: ${msg.split("\n")[0].slice(0, 200)}`;
}

async function freshReport(outRoot, host, freshMs) {
  const saved = await readFile(path.join(outRoot, host, "result.json"), "utf8").catch(() => null);
  if (!saved) return false;
  try { return Date.now() - Date.parse(JSON.parse(saved).collectedAt) < freshMs; } catch { return false; }
}

// Keep the newest `keep` report folders; remove the rest.
export async function prune(outRoot, keep) {
  const dirs = [];
  for (const h of await readdir(outRoot).catch(() => [])) {
    const s = await stat(path.join(outRoot, h, "result.json")).catch(() => null);
    if (s) dirs.push({ h, t: s.mtimeMs });
  }
  dirs.sort((a, b) => b.t - a.t);
  for (const d of dirs.slice(keep)) await rm(path.join(outRoot, d.h), { recursive: true, force: true });
  return dirs.length - Math.max(0, dirs.length - keep);
}

async function indexPage(outRoot, error, url, publicMode, hidden = new Set()) {
  const hosts = await readdir(outRoot).catch(() => []);
  const rows = [];
  for (const h of hosts) {
    if (hidden.has(hostKey(h))) continue;
    const file = path.join(outRoot, h, "result.json");
    if (!(await stat(file).catch(() => null))) continue;
    const r = JSON.parse(await readFile(file, "utf8"));
    rows.push({ h, score: r.scored.score, tier: r.scored.tier, when: r.collectedAt.slice(0, 10) });
  }
  rows.sort((a, b) => b.score - a.score);
  const notes = publicMode ? 0 : (await readFile(path.join(outRoot, "feedback.jsonl"), "utf8").catch(() => "")).split("\n").filter(Boolean).length;
  const notesLink = notes ? `<a href="/feedback">${notes} feedback note${notes === 1 ? "" : "s"}</a>` : "";
  const list = rows.length || notes ? `
    <h2>Reports <span class="meta">${rows.length}${notes ? ` · ${notesLink}` : ""} · lower is better</span></h2>
    <table class="list">
      <thead><tr><th>Site</th><th>Verdict</th><th class="n">Score</th><th class="n">Scanned</th></tr></thead>
      <tbody>${rows.map((r) => `<tr><td><a href="/out/${esc(r.h)}/report.html">${esc(r.h)}</a></td><td class="${r.score > 30 ? "hot" : ""}">${esc(r.tier)}</td><td class="n"><b>${r.score}</b><span class="meta"> / 100</span><div class="bar"><i style="width:${r.score}%"></i></div></td><td class="n meta">${esc(r.when)}</td></tr>`).join("")}</tbody>
    </table>` : "";
  const intro = publicMode
    ? `<p>Scores a public website for unedited AI defaults: neon palettes, glowing orbs, beta pills, em-dash copy, placeholder testimonials. Deterministic rules, no model in the loop. Reports are public and listed below.</p>`
    : "";
  return shell("Score a website", `
    ${intro}
    ${error ? `<p class="err">${esc(error)}</p>` : ""}
    <form id="scan" action="/scan" method="get" onsubmit="document.getElementById('go').disabled=true">
      <script>addEventListener("pageshow", () => { document.getElementById("go").disabled = false; });</script>
      <label for="url" style="display:block;font-weight:700;margin-bottom:6px">Website address</label>
      <div style="display:flex;gap:8px"><input id="url" name="url" type="text" required placeholder="example.com" value="${esc(url || "")}" autofocus>
      <button id="go" type="submit">Scan</button></div>
      <p class="meta">Loads the page in a headless browser at desktop and phone size, then scores it. Usually 10 to 60 seconds${publicMode ? ", longer if others are ahead of you" : ""}.</p>
    </form>
    ${list}`);
}

function progressPage(job) {
  return shell(`Scanning ${job.host}`, `
    <p class="meta" id="label">Waiting</p>
    <div class="bar" style="height:10px"><i id="fill" style="width:0%"></i></div>
    <p class="meta"><span id="elapsed">0</span>s elapsed</p>
    <p id="fail" class="err" hidden></p>
    <p id="links" hidden><a href="/">Back</a></p>
    <script>
      const t0 = Date.now();
      const tick = async () => {
        document.getElementById("elapsed").textContent = Math.round((Date.now() - t0) / 1000);
        let j; try { j = await (await fetch("/progress?job=${esc(job.id)}", { cache: "no-store" })).json(); } catch { return setTimeout(tick, 1500); }
        document.getElementById("label").textContent = j.label;
        document.getElementById("fill").style.width = Math.round(j.pct * 100) + "%";
        if (j.error) { const f = document.getElementById("fail"); f.textContent = j.error; f.hidden = false; document.getElementById("links").hidden = false; return; }
        if (j.done && j.href) return location.replace(j.href);
        setTimeout(tick, 700);
      };
      tick();
    </script>`);
}

async function feedbackPage(outRoot) {
  const lines = (await readFile(path.join(outRoot, "feedback.jsonl"), "utf8").catch(() => "")).split("\n").filter(Boolean).map((l) => JSON.parse(l)).reverse();
  const rows = lines.map((e) => `<li><b><a href="/out/${esc(e.host)}/report.html">${esc(e.host)}</a></b> scored ${e.score} (${esc(e.tier)}): <b>${esc(e.verdict.replace("-", " "))}</b> <span class="meta">${esc(e.at.slice(0, 16).replace("T", " "))}</span>${e.notes ? `<br>${esc(e.notes)}` : ""}</li>`).join("");
  return shell("Feedback", rows ? `<ul class="health">${rows}</ul>` : `<p>No feedback yet. Every report ends with a form.</p>`);
}

function shell(title, content, description = DESCRIPTION) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · Slop Audit</title><meta name="description" content="${esc(description)}">${ICON}<style>${CSS}</style></head><body><main>${header("/")}<h1>${esc(title)}</h1>${content}${footer("/", "/about#disputes")}</main></body></html>`;
}
function aboutPage() {
  const rows = SCALE.map((t) => `<tr><td class="n"><b>${t.range[0]}–${t.range[1]}</b></td><td>${esc(t.name)}</td><td class="meta">${esc(t.blurb)}</td></tr>`).join("");
  return shell("About", `
    <h2>What it measures</h2>
    <p>The public home page at scan time, at desktop and phone size, with deterministic rules and no AI model in the loop. The same page scores the same twice.</p>
    <h2>What a score means</h2>
    <p>The tool's assessment of design and copy defaults. It says nothing about the company, its product, its people, or whether AI was used to build the site. Many excellent sites are built with AI.</p>
    <p>Every finding shows its evidence and a suggested fix. Scores change when the rules improve or the site changes.</p>
    <h2>The Slop Scale</h2>
    <table class="list"><thead><tr><th class="n">Score</th><th>Verdict</th><th>What it means</th></tr></thead><tbody>${rows}</tbody></table>
    <h2>What is not scored</h2>
    <p>The health list (dead links, alt text, console errors) is informational.</p>
    <h2 id="disputes">Disputes</h2>
    <p>Use the form at the end of any report; a person reads every note. Site owners can ask for a report to be taken down through the same form and it will be.</p>
  `);
}
const back = () => `<p><a href="/">Back</a></p>`;
function page(res, status, html) { res.writeHead(status, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }); res.end(html); }
function json(res, status, obj) { res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(obj)); }
function redirect(res, to) { res.writeHead(303, { location: to, "cache-control": "no-store" }); res.end(); }
function body(req, limit = 65536) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => { data += c; if (data.length > limit) { reject(new Error("Form too large")); req.destroy(); } });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}
