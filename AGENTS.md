# Repository instructions

slop-audit scores public websites for unedited AI defaults with deterministic
rules. Read [README.md](README.md) for what it measures and
[docs/rules.md](docs/rules.md) for why each rule exists. Keep prose short;
comments explain non-obvious reasons, not the code.

## The contract

- The human eye is the ground truth. `fixtures/corpus.json` holds labelled
  sites; `npm test` must pass before and after any rule change. If a sensible
  rule breaks the ordering, the rule is wrong.
- Rules are deterministic. No model calls, no network inside rules, no
  randomness. Facts come only from `src/collect.js`; rules only read facts.
- Style rules measure density, not presence. A site may use an eyebrow label,
  a tricolon, Title Case on a product name, or a canvas without being slop.
- Health findings (dead links, alt text, console errors) are reported, never
  scored.
- Dependencies: Playwright only, pinned exactly. Do not add a dependency for
  something sixty lines of Node can do.

## Safety

- Scan only public http(s) hosts. `src/safety.js` refuses loopback, private,
  link-local and CGNAT ranges; keep it that way.
- Never store, print or commit credentials, and never scan a URL that carries
  a token or session in its query string.
- Fixture facts are public page content. Do not add fixtures containing
  personal data beyond what the public page shows.
- Be polite to targets: one desktop and one mobile load per scan, a browser
  user agent that names this tool, no crawling beyond the page given.
- Public mode (`serve --public`) must keep its limits: one scan at a time, a
  queue cap, per-address and daily caps, retention, no `facts.json` served.
  Infrastructure lives in `infra/` and is deployed only by `scripts/deploy.sh`
  from a committed `main`; the app ships through `.github/workflows/deploy.yml`.
  Never change either by hand in the console.

## Workflow

- One branch and PR per change; never push to `main`.
- After touching `src/collect.js`, run `npm run calibrate` to refresh fixtures
  and commit the updated `facts.json` files. Screenshots stay untracked.
- Adding a site to the corpus: add the row with a label and a one-line why,
  run `npm run calibrate`, make sure `npm test` passes.
