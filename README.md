# slop-audit

Scores a website for **unedited AI defaults**. Not "was this made by AI" (good
sites are), but "did a human push back on what the model reached for". Every
rule is deterministic: no model calls, same URL in, same score out.

```
$ npm run calibrate

slop-demo.fixture  71/100  Slop
  Visual defaults 35/35
    +10  Neon accent palette: 75% of the page's coloured pixels sit in a neon band
    + 8  Decorative canvas or node-network backdrop: the glowing-dots-and-lines background
    + 6  “Free beta · No credit card” pill
    + 5  Glowing orb beside a call to action: next to “Ask Pulsora”
    + 5  Tracked uppercase eyebrow labels: 33 of them
    ...
  Copy defaults 20/30
    + 8  Em-dash density: 29 em dashes in 1516 words
    + 8  Copy keeps insisting it is honest: “deterministic” ×8, “honest” ×6, “human-in-the-loop” ×5
    ...
  Unsupported trust signals 20/25
    +12  Testimonials next to a disclaimer that they are placeholders
    + 8  Big numbers beside “simulated”: “1M+”, “10x”
```

`slop-demo.fixture` is our own page (see `fixtures/pages/slop-demo/`), built to
show every default the rules measure. The real sites we score are listed in
`fixtures/corpus.json`.

## Why another one

The existing scanners measure *sameness*: Inter, a gradient, a centred hero.
On our calibration set they get the order wrong or barely separate the sites:

| Site | Human label | slop-detect | is-this-ai-slop | **slop-audit** |
|---|---|---:|---:|---:|
| option.com (pre-AI WordPress) | clean | 7 | 9 | **0** |
| skilak.ai (human-directed, AI-era) | clean | 19 | 0 | **2** |
| slop-demo (our own fixture) | slop | n/a | n/a | **71** |

slop-detect also flagged skilak.ai for "AI-default fonts" (it uses DM Sans)
and missed the sloppy site's Inter. See [docs/baseline.md](docs/baseline.md).

Sites outside the calibration set, scanned once as a check against
overfitting: linear.app 7, stripe.com 8 (both Edited).

## What it measures

Four scored categories, capped so one cannot dominate, plus an unscored health
list. [docs/rules.md](docs/rules.md) has every rule and its reason.

- **Visual defaults (35).** Neon palette measured from screenshot pixels, so
  canvas particles and glows count. Dark-plus-neon, glow shadows, particle
  backdrops, ambient animations, the orb, beta pills, chip rows, tracked
  eyebrow labels, status tags, gradient text, glass, blobs, nested cards,
  card density, default fonts.
- **Copy defaults (30).** Em-dash density, phrases repeated four or more
  times (CTA text and product names excluded), copy that keeps insisting it is
  honest, model vocabulary, "not just X, it's Y", beta reassurance, Title Case.
  Copy inside closed tabs and accordions counts too.
- **Unsupported trust signals (25).** Testimonials in a section that admits they are
  placeholders, stats beside "simulated" or "will appear here", avatar
  generators, social links that point at the network homepage.
- **Unfinished (15).** Lorem ipsum, John Doe, builder badges and scripts,
  stale copyright, missing description or favicon.
- **Health (not scored).** Dead links, missing alt text, console errors,
  failed requests, mobile overflow, forms without submit, no contact details.
  An old site can be imperfect without being slop.

Slop Scale: 0–5 Clean · 6–12 Edited · 13–30 Defaults showing · 31–55 Sloppy · 56–100 Slop.

## Run it

### In a browser (the easiest way)

Needs Node 22+ and Git. One-time setup, in a terminal:

```
git clone https://github.com/SkilakLabs/slop-audit.git
cd slop-audit
npm ci
npx playwright install chromium-headless-shell
```

Then, every time:

```
npm run serve
```

Open http://127.0.0.1:4100, paste a URL, press **Scan**. A progress bar shows
each stage and the one-page report appears when it finishes, usually within a
minute. Every scan is saved under `out/<host>/` as `report.html`, `report.md`,
`result.json`, `facts.json` and desktop and mobile screenshots, and the front
page lists every report. A page that never stops animating may save only its
first screen, or no screenshot at all; the report still appears. The server only
listens on your own machine. Ctrl-C stops it.

Each report ends with a short form: is the score too high, about right, or too
low, and why. Answers are appended to `out/feedback.jsonl` and nowhere else.
They are the raw material for new corpus entries: a host, a human verdict, the
findings that fired, and a note on what the rules missed.

On the hosted site the same form stores the note with the report on the server,
where a maintainer reads it. Each served report page has a Rescan link that
re-scans the site immediately, within the usual queue and rate limits.

### From the terminal

```
node bin/slop-audit.js https://example.com --out out
open out/example.com/report.html
```

Several URLs in one go are fine. `--json` prints the result as JSON,
`--no-screenshots` skips the PNGs.

### On GitHub, nothing installed

Actions → **scan** → paste URLs → download the `slop-audit-report` artifact.
It holds the same files as a local scan.

### Hosted for the public

`slop-audit serve --public` adds rate limits, a scan queue, report retention
and proxy awareness. [docs/hosting.md](docs/hosting.md) describes the AWS
setup: one Fargate task behind a load balancer, reports on EFS, and a GitHub
workflow that ships every merge to main.

Only public http(s) hosts are scanned; private and loopback addresses are
refused.

Some sites serve a bot-protection challenge or a block page to headless
browsers instead of their real content. When that happens the scanner detects
the stub and says so instead of scoring it: no score, no report, and nothing is
saved. A site behind a challenge cannot be scanned until it lets the browser
through.

### Hiding a site

A site can be kept off the list and its report removed. Put one host per line
in `hidden.txt` (next to `out/`, git-ignored): lowercase, `#` comments and
blank lines are ignored, and `example.com` also matches `www.example.com`. The
running server picks up edits on the next request and deletes the matching
report, no restart needed.

On a hosted instance the same file lives on the data volume, next to the
report directory (`/data/hidden.txt` in the provided container). Edit it with
any one-off task or shell that mounts that volume; the running server picks up
the change on its next request and deletes the matching report.

The list is never committed.

## The report

`report.html` is a self-contained one-pager in Skilak's brand (DM Sans, paper,
ink, one coral accent): score and tier, a bar per category, the top of the
desktop screenshot, every finding with its evidence and the fix, and the
unscored health list last. It prints cleanly to PDF from the browser.

## Calibration

`fixtures/corpus.json` lists sites with a human label. `npm test` scores the
saved facts offline and fails if a clean site leaves the Edited tier, a slop
site drops below Slop, or the gap between them shrinks under 50 points.
`npm run calibrate` rescans the corpus live and rewrites the saved facts.

Add a site you have an opinion about, label it, rescan, and see whether the
rules agree with you. When they do not, the rule is wrong, not your eye.

Scores move over time: when the rules improve, or when a site changes. On each
deploy the app re-scores every saved report under the current rules, and in
public mode it re-scans listed sites about weekly. A report with more than one
saved score shows its history, newest first.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to run locally and what helps.
Think a site was scored wrong? Open a
[Wrong score issue](https://github.com/SkilakLabs/slop-audit/issues/new?template=wrong-score.yml).
How the project is run is in [GOVERNANCE.md](GOVERNANCE.md).
