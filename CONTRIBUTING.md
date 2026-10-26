# Contributing

## Run it locally

Node 22+.

```
npm ci
npx playwright install chromium-headless-shell
npm test
npm run serve
```

`npm run serve` starts the app at http://127.0.0.1:4100. `npm test` scores the
saved fixture facts offline and checks the tier ordering.

## The contract

- The human eye is the ground truth. `fixtures/corpus.json` holds labelled
  sites; `npm test` must pass before and after any rule change. If a sensible
  rule breaks the ordering, the rule is wrong.
- Rules are deterministic. No model calls, no network inside rules, no
  randomness.
- Style rules measure density, not presence. A site may use an eyebrow label
  or a tricolon without being slop.
- Health findings are reported, never scored.
- Playwright is the only dependency, pinned exactly. Do not add a dependency
  for something sixty lines of Node can do.

## The two most useful contributions

### A site scored wrong

Open a "Wrong score" issue. Include the report link and your human verdict.
The human eye is the ground truth; when the rules disagree with you, the rule
is wrong, not your eye.

### A site added to the corpus

Add a row to `fixtures/corpus.json` with a label and a one-line why, then:

```
npm run calibrate
npm test
```

Make `npm test` pass. A rule change must keep every corpus site's tier.

### Naming sites

The public corpus and docs never attach a negative label to a real site.
Clean sites may be named; sloppy examples are synthetic (see
`fixtures/pages/slop-demo/`) or kept in the git-ignored private corpus
(`fixtures/private/corpus.json`). Maintainers may keep real-world sloppy sites
there as anchors, away from the public repo, so no third-party website is ever
called slop in print.

## Process

- One branch and one pull request per change; never push to `main`.
- Sign off with the Developer Certificate of Origin (`git commit -s`). There
  is no CLA.
- Maintainers decide what merges.
