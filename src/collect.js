// Loads a page in headless Chromium and extracts the facts the rules need.
// Everything subjective lives in src/rules; this file only measures.
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { assertPublicUrl } from "./safety.js";
import { decodePng, paletteStats } from "./pixels.js";

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36 slop-audit/0.1";

// onProgress(label, fraction) is optional; the local app shows it as a bar.
export async function collect(url, { outDir, screenshots = true, timeoutMs = 45000, onProgress = () => {}, allowLocal = false } = {}) {
  // allowLocal skips the loopback refusal and exists only for in-repo fixture
  // pages (see scripts/calibrate.js). The web app must keep refusing it, so
  // src/serve.js never sets allowLocal.
  if (!allowLocal) await assertPublicUrl(url);
  onProgress("Starting the browser", 0.05);
  const browser = await chromium.launch({ channel: "chromium-headless-shell" });
  try {
    onProgress("Loading the page at desktop size", 0.15);
    const desktop = await collectViewport(browser, url, DESKTOP, { timeoutMs, onLoaded: () => onProgress("Scrolling and measuring the desktop page", 0.35) });
    onProgress("Loading the page at phone size", 0.55);
    const mobile = await collectViewport(browser, url, MOBILE, { timeoutMs, light: true, onLoaded: () => onProgress("Measuring the phone layout", 0.7) });
    onProgress("Reading colours from the screenshot", 0.82);
    let palette = null;
    if (desktop.screenshot) {
      try { palette = paletteStats(decodePng(desktop.screenshot)); } catch (e) { palette = { error: String(e.message) }; }
    }
    const facts = {
      url,
      palette,
      finalUrl: desktop.finalUrl,
      collectedAt: new Date().toISOString(),
      viewport: DESKTOP,
      ...desktop.facts,
      mobile: mobile.facts.mobile,
      consoleErrors: desktop.consoleErrors,
      failedRequests: desktop.failedRequests,
    };
    if (outDir) {
      await mkdir(outDir, { recursive: true });
      if (screenshots) {
        if (desktop.screenshot) await writeFile(path.join(outDir, "desktop.png"), desktop.screenshot);
        if (mobile.screenshot) await writeFile(path.join(outDir, "mobile.png"), mobile.screenshot);
      }
      await writeFile(path.join(outDir, "facts.json"), JSON.stringify(facts, null, 2));
    }
    return facts;
  } finally {
    await browser.close();
  }
}

async function collectViewport(browser, url, viewport, { timeoutMs, light = false, onLoaded = () => {} }) {
  const context = await browser.newContext({ viewport, userAgent: UA, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const consoleErrors = [];
  const failedRequests = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200)); });
  page.on("requestfailed", (r) => failedRequests.push(r.url().slice(0, 200)));
  const response = await page.goto(url, { waitUntil: "load", timeout: timeoutMs });
  onLoaded();
  await page.waitForTimeout(2500); // let client-rendered apps and entrance animations settle
  // Scroll the whole page so lazy content and fade-ups render before we measure.
  await page.evaluate(async () => {
    const step = Math.max(400, window.innerHeight);
    for (let y = 0; y < document.body.scrollHeight; y += step) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)); }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(500);
  const facts = await page.evaluate(PAGE_SCRIPT, { light });
  if (!light) {
    // The main document response: a block page often answers 403 or 503 while
    // still rendering a stub, so record the status and server for src/blocked.js.
    facts.status = response?.status() ?? null;
    facts.server = response?.headers()?.["server"]?.toLowerCase() ?? null;
  }
  if (!light && !facts.favicon) {
    // No <link rel=icon>: browsers fall back to /favicon.ico, and so do we.
    const r = await page.request.get(new URL("/favicon.ico", page.url()).href, { timeout: 8000 }).catch(() => null);
    facts.favicon = !!(r && r.ok() && /image|icon/i.test(r.headers()["content-type"] || ""));
  }
  const shot = await capture(page);
  if (!light) facts.screenshotPartial = shot.partial;
  const finalUrl = page.url();
  await context.close();
  return { facts, screenshot: shot.buffer, finalUrl, consoleErrors, failedRequests };
}

// A canvas or CSS animation that never stops leaves Playwright without a stable
// frame, so a full-page capture waits until it times out and the whole scan would
// fail after every fact was already measured. Try the whole page with animations
// frozen, then the first screen, then give up: a missing picture is a health note,
// never a failed scan.
async function capture(page) {
  try {
    return { buffer: await page.screenshot({ fullPage: true, type: "png", animations: "disabled", timeout: 30000 }), partial: false };
  } catch {}
  try {
    return { buffer: await page.screenshot({ type: "png", animations: "disabled", timeout: 15000 }), partial: true };
  } catch {}
  return { buffer: null, partial: "none" };
}

// Runs inside the page. Keep it dependency-free and defensive: every site is hostile to assumptions.
const PAGE_SCRIPT = ({ light }) => {
  const vw = window.innerWidth, vh = window.innerHeight;
  const docH = document.documentElement.scrollHeight;
  const text = document.body.innerText || "";
  const result = {};

  const isVisible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== "hidden" && cs.display !== "none" && parseFloat(cs.opacity) > 0.05;
  };
  const parseRgb = (s) => {
    const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(s || "");
    if (!m) return null;
    return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] };
  };
  const toHsl = ({ r, g, b }) => {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return { h: 0, s: 0, l };
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return { h: h * 60, s, l };
  };
  const hex = ({ r, g, b }) => "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");

  if (light) {
    // Mobile pass: only layout facts.
    result.mobile = {
      viewportWidth: vw,
      scrollWidth: document.documentElement.scrollWidth,
      horizontalOverflow: document.documentElement.scrollWidth > vw + 2,
      pageHeight: docH,
    };
    return result;
  }

  const all = Array.from(document.querySelectorAll("body *")).filter((el) => !["SCRIPT", "STYLE", "NOSCRIPT", "SVG", "PATH"].includes(el.tagName));
  const visible = all.filter(isVisible);
  const styled = visible.slice(0, 6000).map((el) => ({ el, cs: getComputedStyle(el), r: el.getBoundingClientRect() }));

  // ---- meta / unfinished ----
  const meta = (n) => document.querySelector(`meta[name="${n}"], meta[property="${n}"]`)?.getAttribute("content") || null;
  result.title = document.title || null;
  result.generator = meta("generator");
  result.description = meta("description");
  result.favicon = !!document.querySelector('link[rel~="icon"]');
  result.html = { lang: document.documentElement.lang || null };
  // Builder residue must come from the build, not the prose: scripts, asset
  // hosts, generator meta and badges. Mentioning a builder in body text is not a tell.
  result.builderMarkers = [];
  const srcs = Array.from(document.querySelectorAll("script[src], link[href], img[src], iframe[src]")).map((el) => (el.getAttribute("src") || el.getAttribute("href") || "").toLowerCase()).join("\n");
  const badges = Array.from(document.querySelectorAll('[class*="lovable-badge"], [id*="lovable-badge"], a[href*="lovable.dev/?utm"], a[href*="bolt.new/?utm"], img[alt*="Made with" i], a[href*="v0.dev/?utm"]')).length;
  const gen = (result.generator || "").toLowerCase();
  for (const [name, re] of [
    ["lovable", /gptengineer\.js|lovable-uploads|cdn\.gpteng\.co/],
    ["v0", /vusercontent\.net|v0\.dev\/chat/],
    ["bolt", /bolt\.new\/static|bolt-badge/],
    ["framer", /framerusercontent\.com\/sites/],
  ]) if (re.test(srcs) || gen.includes(name)) result.builderMarkers.push(name);
  if (badges) result.builderMarkers.push("made-with-badge");
  if (/create next app|vite \+ react/i.test(document.title)) result.builderMarkers.push("default-title");

  // ---- text / copy ----
  result.text = text.slice(0, 60000);
  result.wordCount = (text.match(/\S+/g) || []).length;
  // Authored copy also lives in closed tabs and accordions; measure it too.
  const fullParts = [];
  // closest() is case-insensitive and crosses into SVG, where tag names are
  // lowercase; a <style> inside an inline icon used to leak CSS into the copy.
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.parentElement && n.parentElement.closest("script,style,noscript,template,svg")) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) { const t = n.textContent.trim(); if (t) fullParts.push(t); }
  const fullText = fullParts.join("\n");
  result.fullText = fullText.slice(0, 80000);
  result.fullWordCount = (fullText.match(/\S+/g) || []).length;
  result.headings = ["h1", "h2", "h3"].flatMap((t) => Array.from(document.querySelectorAll(t)).filter(isVisible).map((h) => ({ level: t, text: (h.innerText || "").trim().slice(0, 160) })));
  result.h1 = result.headings.find((h) => h.level === "h1")?.text || null;

  // ---- fonts ----
  const fontCounts = {};
  for (const { el, cs } of styled) {
    if (!el.childNodes.length || !Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
    const fam = cs.fontFamily.split(",")[0].replace(/["']/g, "").trim().toLowerCase();
    fontCounts[fam] = (fontCounts[fam] || 0) + 1;
  }
  const h1el = document.querySelector("h1");
  result.fonts = {
    hero: h1el ? getComputedStyle(h1el).fontFamily : null,
    histogram: Object.entries(fontCounts).sort((a, b) => b[1] - a[1]).slice(0, 8),
  };

  // ---- colors: accents, neon ----
  const colorCounts = {};
  const bump = (c, weight, where) => {
    const rgb = parseRgb(c); if (!rgb || rgb.a < 0.15) return;
    const hsl = toHsl(rgb); if (hsl.s < 0.35 || hsl.l < 0.12 || hsl.l > 0.92) return; // only chromatic colors
    const k = hex(rgb);
    colorCounts[k] = colorCounts[k] || { hex: k, h: Math.round(hsl.h), s: +hsl.s.toFixed(2), l: +hsl.l.toFixed(2), count: 0, where: {} };
    colorCounts[k].count += weight;
    colorCounts[k].where[where] = (colorCounts[k].where[where] || 0) + 1;
  };
  for (const { el, cs, r } of styled) {
    const area = r.width * r.height;
    bump(cs.color, 1, "text");
    bump(cs.backgroundColor, area > 2000 ? 2 : 1, "bg");
    bump(cs.borderTopColor, 1, "border");
    if (/^(A|BUTTON)$/.test(el.tagName) || cs.cursor === "pointer") { bump(cs.backgroundColor, 2, "cta"); bump(cs.color, 1, "cta"); }
  }
  result.colors = Object.values(colorCounts).sort((a, b) => b.count - a.count).slice(0, 25);
  const bodyBg = parseRgb(getComputedStyle(document.body).backgroundColor);
  const bodyL = bodyBg ? toHsl(bodyBg).l : 1;
  // Fallback: a transparent body over a dark html, or a dark hero wrapper.
  const htmlBg = parseRgb(getComputedStyle(document.documentElement).backgroundColor);
  const firstBig = styled.find(({ r }) => r.width > vw * 0.9 && r.height > vh * 0.6);
  const heroBg = firstBig ? parseRgb(firstBig.cs.backgroundColor) : null;
  result.darkMode = (bodyBg && bodyBg.a > 0.5 ? bodyL : htmlBg && htmlBg.a > 0.5 ? toHsl(htmlBg).l : heroBg ? toHsl(heroBg).l : 1) < 0.25;

  // ---- gradients, glow, glass, blobs ----
  let gradientEls = 0, gradientArea = 0, gradientText = 0, glow = 0, glowSamples = [], glass = 0, blobs = 0;
  for (const { el, cs, r } of styled) {
    if (/gradient\(/.test(cs.backgroundImage)) {
      gradientEls++; gradientArea += Math.min(r.width * r.height, vw * vh);
      if ((cs.webkitBackgroundClip || cs.backgroundClip) === "text") gradientText++;
    }
    const sh = cs.boxShadow;
    if (sh && sh !== "none") {
      // "rgba(0,240,208,0.5) 0px 0px 40px 0px" — blur is the third length
      for (const part of sh.split(/,(?![^(]*\))/)) {
        const m = /(rgba?\([^)]*\))\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s+([\d.]+)px/.exec(part);
        if (!m) continue;
        const rgb = parseRgb(m[1]); const blur = +m[4];
        if (!rgb || blur < 16) continue;
        const { s: sat, l: lig } = toHsl(rgb);
        // A glow is a bright, saturated, visible halo; grey or navy drop shadows are just shadows.
        if (sat >= 0.5 && lig >= 0.3 && rgb.a >= 0.12) { glow++; if (glowSamples.length < 8) glowSamples.push({ tag: el.tagName, sat: +sat.toFixed(2), alpha: rgb.a, blur, y: +m[3], shadow: part.trim().slice(0, 80) }); }
      }
    }
    const bf = cs.backdropFilter || cs.webkitBackdropFilter;
    if (bf && /blur\(/.test(bf)) glass++;
    const f = cs.filter;
    const bm = /blur\(([\d.]+)px\)/.exec(f || "");
    if (bm && +bm[1] >= 20 && r.width > 80) blobs++;
  }
  result.gradients = { elements: gradientEls, areaRatio: +(gradientArea / (vw * Math.min(docH, vh * 6))).toFixed(3), textClip: gradientText };
  result.glow = { count: glow, samples: glowSamples };
  result.glass = glass;
  result.blurBlobs = blobs;

  // ---- decorative canvases / network svgs / animations ----
  const canvases = Array.from(document.querySelectorAll("canvas")).filter(isVisible).map((c) => { const r = c.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top + window.scrollY), area: Math.round(r.width * r.height) }; });
  const networkSvgs = Array.from(document.querySelectorAll("svg")).filter((s) => { const r = s.getBoundingClientRect(); return r.width > 200 && r.height > 120 && isVisible(s); }).map((s) => ({ circles: s.querySelectorAll("circle").length, lines: s.querySelectorAll("line, path[stroke-dasharray], polyline").length, top: Math.round(s.getBoundingClientRect().top + window.scrollY) })).filter((s) => s.circles >= 8 && s.lines >= 8); // a network has nodes and edges; a dot grid is just dots
  const animNames = {};
  for (const { cs } of styled) {
    const n = cs.animationName; if (!n || n === "none") continue;
    for (const a of n.split(",")) { const k = a.trim(); animNames[k] = (animNames[k] || 0) + 1; }
  }
  result.decor = { canvases, networkSvgs, animations: Object.entries(animNames).sort((a, b) => b[1] - a[1]).slice(0, 15) };

  // ---- pills, eyebrows, orbs, badges ----
  const pills = [], eyebrows = [], orbs = [], tags = [];
  for (const { el, cs, r } of styled) {
    const t = (el.innerText || "").trim();
    const radius = parseFloat(cs.borderTopLeftRadius) || 0;
    const roundedFull = radius >= Math.min(r.height, r.width) / 2 - 1 && radius >= 8;
    const hasBorderOrBg = (parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== "none") || (parseRgb(cs.backgroundColor)?.a || 0) > 0.05;
    if (roundedFull && hasBorderOrBg && r.height >= 18 && r.height <= 44 && r.width > r.height && t && t.length <= 70 && el.children.length <= 4 && !/^(A|BUTTON)$/.test(el.tagName) && !el.closest("a,button")) {
      pills.push({ text: t.slice(0, 70), top: Math.round(r.top + window.scrollY), fontSize: parseFloat(cs.fontSize) });
    }
    const ls = parseFloat(cs.letterSpacing) || 0; const fs = parseFloat(cs.fontSize) || 16;
    if (cs.textTransform === "uppercase" && fs <= 14 && t && t.length <= 60 && t.length >= 3 && el.children.length === 0 && !el.closest("a,button,nav,footer")) {
      eyebrows.push({ text: t.slice(0, 60), tracking: +(ls / fs).toFixed(2) });
    }
    if (r.width <= 28 && r.height <= 28 && Math.abs(r.width - r.height) < 3 && roundedFull && !t && el.children.length === 0) {
      const bg = parseRgb(cs.backgroundColor);
      const sat = bg && bg.a > 0.3 ? toHsl(bg).s : 0;
      const animated = cs.animationName && cs.animationName !== "none";
      const glows = /px/.test(cs.boxShadow) && cs.boxShadow !== "none";
      if (sat > 0.5 && (animated || glows)) orbs.push({ tag: el.tagName, animated: !!animated, glows, near: (el.parentElement?.innerText || "").trim().slice(0, 40) });
    }
    if (cs.textTransform === "uppercase" && fs <= 12 && t && t.length <= 16 && el.children.length === 0 && (hasBorderOrBg) && r.height <= 28) tags.push(t);
  }
  result.pills = pills.slice(0, 40);
  result.eyebrows = eyebrows.slice(0, 80);
  for (const c of Array.from(document.querySelectorAll("canvas")).filter(isVisible)) {
    const r = c.getBoundingClientRect();
    if (r.width <= 48 && r.height <= 48 && r.width > 8) orbs.push({ tag: "CANVAS", animated: true, glows: false, near: (c.parentElement?.innerText || "").trim().slice(0, 40) });
  }
  result.orbs = orbs.slice(0, 10);
  result.tags = Object.entries(tags.reduce((m, t) => ((m[t] = (m[t] || 0) + 1), m), {})).sort((a, b) => b[1] - a[1]).slice(0, 20);

  // ---- cards / density ----
  const cards = styled.filter(({ cs, r }) => (parseFloat(cs.borderTopLeftRadius) || 0) >= 8 && r.width >= 160 && r.height >= 80 && ((parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== "none") || (cs.boxShadow && cs.boxShadow !== "none") || ((parseRgb(cs.backgroundColor)?.a || 0) > 0.05)));
  let nested = 0;
  for (const c of cards) { let p = c.el.parentElement; while (p && p !== document.body) { if (cards.some((k) => k.el === p)) { nested++; break; } p = p.parentElement; } }
  result.cards = { count: cards.length, nested, perScreen: +(cards.length / Math.max(1, docH / vh)).toFixed(1) };
  result.sections = Array.from(document.querySelectorAll("main > *, body > * > section, section")).filter(isVisible).length;
  result.pageHeight = docH;
  result.screens = +(docH / vh).toFixed(1);

  // ---- links / dead ends ----
  const anchors = Array.from(document.querySelectorAll("a")).filter(isVisible);
  const hrefs = anchors.map((a) => a.getAttribute("href") || "");
  result.links = {
    total: anchors.length,
    dead: hrefs.filter((h) => h === "#" || h === "" || /^javascript:/.test(h)).length,
    deadTexts: anchors.filter((a) => ["#", ""].includes(a.getAttribute("href") || "")).map((a) => (a.innerText || "").trim().slice(0, 40)).filter(Boolean).slice(0, 10),
    socialRoots: hrefs.filter((h) => /^https?:\/\/(www\.)?(x|twitter|linkedin|github|instagram|facebook|youtube)\.com\/?$/.test(h)).length,
    external: hrefs.filter((h) => /^https?:/.test(h) && !h.includes(location.hostname)).length,
  };
  result.buttons = Array.from(document.querySelectorAll("button")).filter(isVisible).length;
  result.ctaTexts = Array.from(new Set(Array.from(document.querySelectorAll("a, button")).map((el) => (el.textContent || "").trim().toLowerCase().replace(/\s+/g, " ")).filter((t) => t && t.length <= 40)));
  result.forms = Array.from(document.querySelectorAll("form")).map((f) => ({ action: f.getAttribute("action") || "", method: f.method, hasSubmit: !!f.querySelector('[type="submit"],button:not([type="button"])') }));

  // ---- images / avatars ----
  const imgs = Array.from(document.querySelectorAll("img")).filter(isVisible);
  result.images = {
    total: imgs.length,
    missingAlt: imgs.filter((i) => !i.getAttribute("alt")).length,
    avatarHosts: imgs.map((i) => i.currentSrc || i.src).filter((s) => /pravatar|randomuser\.me|ui-avatars|dicebear|i\.pravatar|xsgames\.co\/randomusers|thispersondoesnotexist/.test(s)).length,
    stockHosts: imgs.map((i) => i.currentSrc || i.src).filter((s) => /unsplash|pexels|pixabay|placehold|placeholder\.com|picsum|dummyimage|via\.placeholder/.test(s)).length,
  };

  // ---- testimonials / stats with their nearby disclaimers ----
  const ownText = (el) => (el.textContent || "").trim();
  const quoteEls = Array.from(document.querySelectorAll("blockquote, q, figure, p, div, span")).filter((el) => el.children.length <= 3).filter((el) => { const t = ownText(el); return t.length > 50 && t.length < 600 && /^[“"']/.test(t) && /[”"']/.test(t.slice(-80)); }).filter((el, i, arr) => !arr.some((o) => o !== el && o.contains(el)));
  // Nearest ancestor that still reads as one section: stop before the text grows past ~2500 chars.
  const sectionOf = (el) => { let cur = el, best = el; while (cur && cur !== document.body) { if ((cur.textContent || "").length > 2500) break; best = cur; cur = cur.parentElement; } return best; };
  const disclaimRe = /(will appear here|placeholder|illustrative|simulated|sample (quotes?|data)|example (quotes?|data)|not (real|actual)|as (beta )?(users|growers|customers) submit|pretends? to be|coming soon|\bSIM\b|mock(ed|up)? data)/i;
  result.testimonials = quoteEls.slice(0, 12).map((el) => {
    const sec = sectionOf(el);
    const secText = (sec.textContent || "").slice(0, 6000);
    const nameEl = el.nextElementSibling || el.parentElement?.nextElementSibling;
    return { quote: ownText(el).slice(0, 140), attribution: (nameEl?.textContent || "").trim().slice(0, 80), hidden: !isVisible(el), sectionDisclaimer: (disclaimRe.exec(secText) || [null])[0] };
  });
  const statEls = all.filter((el) => { const t = ownText(el); return el.children.length <= 1 && t.length <= 24 && /^[$€£]?\d[\d,.]*\s?(k|K|M|m|B|\+|%|x|×|million|billion)\b/.test(t) && parseFloat(getComputedStyle(el).fontSize) >= 22; });
  result.stats = statEls.slice(0, 12).map((el) => { const sec = sectionOf(el); return { value: ownText(el), label: (el.parentElement?.textContent || "").replace(ownText(el), "").trim().slice(0, 60), hidden: !isVisible(el), sectionDisclaimer: (disclaimRe.exec((sec.textContent || "").slice(0, 6000)) || [null])[0] }; });
  result.logoBars = Array.from(document.querySelectorAll("section, div")).filter((s) => isVisible(s) && /trusted by|used by|backed by|as seen (in|on)|featured in|integrations?|works with|powered by/i.test((s.innerText || "").slice(0, 200)) && s.querySelectorAll("img, svg").length >= 4 && s.getBoundingClientRect().height < 400).length;

  // ---- copyright / placeholders ----
  const yearM = /(?:©|&copy;|\(c\)|copyright)\s*(?:\d{4}\s*[-–]\s*)?(\d{4})/i.exec(text);
  result.copyrightYear = yearM ? +yearM[1] : null;
  result.placeholders = [];
  for (const [name, re] of [
    ["lorem-ipsum", /lorem ipsum/i], ["john-doe", /\bjohn doe\b|\bjane doe\b/i],
    ["acme", /\bacme (inc|corp|co)\b/i], ["todo", /\bTODO\b|\bFIXME\b|\[insert /],
  ]) { if (re.test(text)) result.placeholders.push(name); }
  // Demo UIs legitimately show example.com; a mailto to it is the real leftover.
  if (document.querySelector('a[href^="mailto:"][href*="@example.com"]')) result.placeholders.push("example-email");
  if (/^(create next app|vite \+ react|my app|react app|document|untitled|home)$/i.test(document.title)) result.placeholders.push("default-title");
  result.phone = /\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}/.test(text);
  result.address = /\b\d{1,5}\s+[A-Z][a-z]+(\s[A-Z][a-z]+)*\s(St|Street|Ave|Avenue|Rd|Road|Blvd|Dr|Drive|Ln|Lane|Way|Suite)\b/.test(text) || /\b[A-Z][a-z]+,\s[A-Z]{2}\b/.test(text);
  return result;
};
