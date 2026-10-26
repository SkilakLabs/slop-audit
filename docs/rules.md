# Rules and why they exist

The point of view: slop is capable AI output that no human pushed back on.
Every rule below is a default the model reaches for and a person with taste
says no to. Weights are capped per category (visual 35, copy 30, trust 25,
unfinished 15) and the total is normalised to 100.

## Visual defaults

| Rule | Weight | Fires when | Why it is a tell |
|---|---:|---|---|
| neon-palette | 10 / 5 | ≥40% of chromatic screenshot pixels fall in cyan/teal/mint or radium green bands (10); or ≥40 styled elements use such a colour and ≥15% of chromatic pixels are neon (5) | Nobody picked neon teal before 2023. It is the model's house colour. Measured from pixels so canvas art counts. |
| dark-neon | 4 | Page is ≥60% near-black and neon dominates | The combination, not dark mode alone. |
| glow | 5 | ≥2 box-shadows that are saturated (s≥0.5), visible (alpha≥0.12) and blurred ≥16px | Soft grey drop shadows are not glows. |
| particle-backdrop | 8 (2) | A canvas ≥400k px² near the top, or an SVG with ≥8 circles and ≥8 lines. Only 2 points without neon or glow evidence | The glowing dots-and-lines background. A canvas drawing grey dots is a note, not a finding. |
| decor-animations | 4 | ≥2 animation names matching orb/pulse/ping/breathe/glow/float/orbit/shimmer/marquee | Motion while reading. |
| orb | 5 | A tiny saturated animated or glowing circle, or a ≤48px canvas | The glowing dot before an "Ask …" button on an AI-built landing page. |
| beta-pill | 6 | A pill reads "free beta", "no credit card", "now in beta", "early access"… | The model's reassurance reflex. |
| chip-row | 4 | ≥4 pill-shaped labels in the first 1000px; chips in product mockups further down are the product | Chips are for filters. |
| eyebrow-everywhere | 5 / 2 | ≥12 labels with ≥8 distinct texts (5 when ≥15 distinct) | Density of distinct labels, not occurrences. One eyebrow is a choice; forty different ones is a template — forty repeats of three tags is just a carousel. |
| status-tags | 4 | ≥3 distinct status words (LIVE, BETA, PRO, NEW…), not product nouns | Status words are decoration; category chips inside a product mockup are the product. |
| gradient-text | 5 / 2 | ≥3 / ≥1 headlines use background-clip:text | One gradient headline is a choice; a page of them is the light-theme builder default. |
| gradient-heavy | 3 | ≥6 gradient elements covering ≥30% of the first screens | A single soft wash does not fire. |
| glass | 3 | ≥3 backdrop-filter blur panels | |
| blur-blobs | 4 | Any large element with filter blur ≥20px | Aurora blobs. |
| nested-cards | 2 | ≥3 cards inside cards | |
| card-density | 2 | ≥2.5 bordered rounded cards per screen | |
| slop-font | 3 | First non-system font in the hero stack is Inter, Geist, Space Grotesk or Instrument Serif | Low weight on purpose: fonts are the weakest tell and the one competitors over-weight. |

## Copy defaults

Measured on all authored text, including closed tabs and accordions.

| Rule | Weight | Fires when | Why |
|---|---:|---|---|
| em-dash-density | 8 / 4 | ≥1.5 / ≥0.7 em dashes per 100 words | Humans use about one per page. |
| repeated-phrases | 6 / 3 | ≥3 / ≥1 three-word phrases repeated ≥5 times, or ≥2.5 per thousand words on long pages, excluding link/button text and capitalised names | "before anything runs" ×8 on an AI-built landing page. "for more information" ×8 in 7000 words of nvidia.com is boilerplate, not a tic. |
| honesty-protest | 8 / 4 | ≥6 / ≥3 brand honesty claims ("radically honest", "we're transparent", "honest pricing", "no hidden fees", "never fabricated", "no black box") on de-duplicated copy | The brand insisting on its own honesty is a tell; a customer saying "honestly clutch" is not. |
| buzzwords | 5 / 2 | ≥1 / ≥0.5 per 100 words, lower-case occurrences only | "Smart Metering" is a product; "smart insights" is a tic. |
| not-just | 3 | "it's not just X, it's Y" | |
| beta-reassurance | 4 | "free beta / no credit card" ≥2 times in copy | |
| title-case | 4 / 2 | ≥3 / ≥2 headings in Title Case, and at least a quarter of all headings with ≥4 words | Product names ("CloudGate IoT Gateway") do not count. Four headline-case news titles among 80 headings (nvidia.com) is editorial style. |
| waitlist-everywhere | 4 | "waitlist" appears ≥3 times in copy | One sign-up is a step; the word on every pill, nav item, CTA and FAQ answer is the waitlist template left in. |
| ai-powered-headline | 3 | "AI-powered / AI-driven" in the hero headline | A real company might say it once in a press release; leading the hero with it is the model's default opener. |
| builder-defaults | 6 / 4 | ≥2 of builder badge, waitlist/beta pill, "AI-powered" headline left in together | A human-directed site may keep any one; leaving two or three is the template unedited. |

Not a tell, by evidence: the three-word tricolon ("Reliable. Secure.
Flexible.") appears on option.com, a pre-AI site. The model learned it from
us.

## Unsupported trust signals

| Rule | Weight | Fires when |
|---|---:|---|
| disclaimed-testimonials | 12 | Quotes in a section whose text says "will appear here", "placeholder", "illustrative", "simulated", "as users submit"… |
| stock-avatars | 8 | Images from pravatar, randomuser, ui-avatars, dicebear… |
| simulated-stats | 8 | Large numbers in a section with such a disclaimer |
| social-roots | 4 | Social links to the network's homepage |

## Unfinished

placeholders (6), builder-residue (6), stale-copyright (3), no-description
(2), no-favicon (2; a reachable `/favicon.ico` counts even without a link tag).

## Health (reported, never scored)

dead-links, missing-alt, console-errors, failed-requests, mobile-overflow,
form-no-submit, no-contact. These sell the engagement; they do not define slop.
