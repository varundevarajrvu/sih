# Dhristi — showcase site

Showcase page for **Dhristi, A Privacy-Preserving Browser Tool** (SIH 26171).

A single static page presenting the project: the redaction proof, the pipeline,
a live console replay, the safety layers, the five demo scenarios, measured
numbers, architecture, and honest limitations. Plain HTML/CSS/JS — no build
step, no framework, no external CDNs or fonts, no network calls of its own.

## Visual language

**Monochrome warm-neutral editorial** — flat sections, sharp rectangles, thin
rules, oversized type, generous whitespace. Hierarchy comes from scale,
contrast and spacing rather than colour, shadow or decoration. Default border
radius is `0`.

This replaces the earlier glassmorphism treatment (dark void, frosted panels,
bronze accents). The content is unchanged in substance — every number, log line
and status code still comes from a real browser run — but it has been brought
current, see below.

Only two signal colours survive, and only where they carry meaning: a green for
`PASS` lines and a muted terracotta for `BLOCKED` ones, inside code blocks and
the console replay. Everything else is neutral. The §2 pipeline's **assert**
stage is distinguished by inverting the cell to light-on-dark rather than by
tinting it — the gate is categorically different from the six steps around it,
and that reads without spending a colour on it.

## Content brought current

The previous version of this page predated three passes of work:

- **480 → 666 tests** (466 Node + 200 pytest). The old figure appeared in the
  hero, the console replay and the results chips.
- **A fifth scenario** — profile autofill (`fill_profile`). The model names a
  category, never a value; the extension fills from a local vault and the field
  is treated as sensitive for the rest of the run.
- **Three added limitations** — names in page content are not redacted, capture
  returned a stale frame once, and the system has never been run against a real
  website. All three are genuine findings and are stated rather than omitted.

## Files

```
site/
├── index.html
├── styles.css
├── script.js               (progressive enhancement only — page reads fine without it)
├── fonts/
│   └── inter-latin.woff2   (self-hosted, latin subset, SIL OFL)
├── assets/
│   ├── id-card-face.jpg               (real fixture photo used on the demo page)
│   └── annotated-webpage-detect.png   (real detection boxes from the UI-detector spike)
└── README.md               (this file)
```

`fonts/fraunces-italic-latin.woff2` is now unreferenced — the monochrome system
uses a single grotesk and no display serif. Left in place rather than deleted;
remove it if the old treatment is definitively retired.

**Why fonts are vendored instead of linked from Google Fonts:** this project's
entire pitch is that nothing leaves the client. A page that phones out to
`fonts.googleapis.com` on every load undercuts that pitch.

## Preview locally

```bash
python -m http.server 5502
```

Then open `http://localhost:5502/`. Opening `index.html` over `file://` also
works — everything is relative and self-contained.

## Deploy to GitHub Pages

The repo root has other directories (`extension/`, `server/`, `demo/`), so Pages
must publish `site/` specifically. Add `.github/workflows/pages.yml`:

```yaml
name: Deploy site to Pages
on:
  push:
    branches: [main]
    paths: ["site/**"]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/upload-pages-artifact@v3
        with:
          path: site
      - id: deployment
        uses: actions/deploy-pages@v4
```

Then set **Settings → Pages → Source** to **GitHub Actions**.

## What was verified before shipping this

Checked in headless Chromium at 1440, 900 and 390px wide:

- Zero console errors, zero failed requests, at every breakpoint.
- Zero horizontal page overflow at every breakpoint — the usual failure mode
  for a wordmark set at `12.5vw`.
- **Contrast measured, not assumed.** 55 probes across every text role,
  each against the background actually composited behind it, checked to WCAG AA
  with the large-text threshold applied by computed size and weight. All 55
  pass. This includes every role on the three dark sections (pipeline, console,
  limitations) and the footer, which is where an inverted palette usually
  fails quietly.
- JavaScript disabled: all content renders. The reveal animation starts from
  `opacity: 0`, so it is gated on a `.js` class set inline in `<head>` —
  without that gate a scriptless visitor gets an invisible page.
- Scroll reveal: 30/30 elements reach full opacity on a natural scroll.
- Console replay: all 20 lines are present and readable *before* the control is
  pressed (the replay re-hides and re-reveals them, so nothing depends on
  pressing it); mid-replay is partial; Skip restores all 20 and resets the
  button.
- Mobile menu: opens, sets `aria-expanded`, locks body scroll, closes on
  Escape, closes when a link is chosen, auto-closes if resized past the
  breakpoint.
- `prefers-reduced-motion: reduce`: content renders opaque, animation off.
- Skip link is the first tab stop.

### Known deviation from the source design brief

The brief this visual language came from specifies `#777672` for muted text.
Measured against the grounds it is actually used on, that yields 3.4:1 at
10–13px — below the 4.5:1 AA floor. It is darkened one step within the same
warm neutral hue (`#5C5B58`), which measures 5.1:1 and 6.2:1 while still
reading as clearly recessive. Where the brief's palette and its own
accessibility requirement conflict, legibility wins.

If you change copy or add content, re-run the same checks — particularly
anything placed in the hero, where the oversized wordmark and the `<h1>` share
a narrow vertical budget and will collide if either grows.
