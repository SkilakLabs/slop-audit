# Baseline: the tools that already exist

Measured 2026-10-25 against the calibration corpus. Hosted versions were used
so no third-party package ran on a developer machine.

| Site | Human label | slop-detect | is-this-ai-slop | A.S.S. Score | slop-audit |
|---|---|---:|---:|---:|---:|
| option.com | clean | 7 (Clean) | 9 (Suspiciously Human) | no response | 0 (Clean) |
| skilak.ai | clean | 19 (Mild) | 0 (Suspiciously Human) | no response | 2 (Clean) |
| a sloppy AI-built landing page (private corpus) | slop | 18 (Mild) | 21 (Mostly Handcrafted, "Tasteful") | no response | 79 (Slop) |

## slop-detect (ravidsrk/slop-detect, MIT, active)

The most complete: 45 design rules, 26 copy rules, CLI, MCP server, GitHub
Action, agency report. What it got wrong here:

- Scored skilak.ai above the sloppy AI-built landing page.
- Fired its heaviest rule, "AI-default font stack" (+8), on skilak.ai, which
  uses DM Sans. Did not fire it on the sloppy landing page, which uses Inter,
  because the hero stack lists the system font first.
- Measures sameness (dark mode, nested cards, numbered steps, FAQ accordion),
  which polished sites share. Does not measure copy behaviour, fake trust,
  canvas-drawn colour, or density.
- Its own CALIBRATION.md records flagging Linear as "Heavy" and admits the
  labelled corpus is about seven sites.

## is-this-ai-slop (davidcjw, MIT, last commit July 2026)

Server-side fetch, no rendering, ~20 detectors. Orders the three sites
correctly but with a 21-point spread, and labels the sloppy landing page
"Tasteful". Cannot see anything a client-rendered app draws.

## A.S.S. Score (BurnettInc/ASS-SCORE, no licence)

Deterministic text rules (filler, boilerplate, vocabulary density,
cross-page similarity, stock-image hosts), no rendering. Ships white-label
agency reports and a per-scan Stripe price. The hosted API returned nothing
for all three URLs during this test.

## What slop-audit does differently

- Colour from screenshot pixels, not CSS: canvas particles and glows count.
- Copy inside closed tabs and accordions counts.
- Testimonials and stats are checked against the disclaimer in their own
  section.
- Density thresholds, calibrated so a human-directed AI-era site scores clean.
- Health is reported, never scored, so a dated site is not called slop.
