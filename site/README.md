# SIH 26171 — showcase site

A single static page presenting the project: the redaction proof, the pipeline,
a live console replay, the safety layers, the four demo scenarios, measured
numbers, architecture, and honest limitations. Plain HTML/CSS/JS — no build
step, no framework, no external CDNs or fonts, no network calls of its own.

Visual language is glassmorphism (dark void/forest palette, frosted glass
panels, bronze/terracotta accents) per the design spec — see the comment
block at the top of `styles.css` for the full token system and the
per-section spec citations throughout. Every number, log line, and status
code on the page is real, from actual browser runs; the redesign changed
only the visual language, never the content.

Files:
```
site/
├── index.html
├── styles.css
├── script.js               (progressive enhancement only — page reads fine without it)
├── fonts/
│   ├── fraunces-italic-latin.woff2    (display face — self-hosted, latin subset, SIL OFL)
│   └── inter-latin.woff2              (body/UI face — self-hosted, latin subset, SIL OFL)
├── assets/
│   ├── id-card-face.jpg               (real fixture photo used on the demo page)
│   └── annotated-webpage-detect.png   (real detection boxes; also the hero's background image)
└── README.md                (this file)
```

**Why fonts are vendored instead of linked from Google Fonts:** this project's
entire pitch is that nothing leaves the client. A page that phones out to
`fonts.googleapis.com`/`fonts.gstatic.com` on every load undercuts that
pitch, so both faces were fetched once (restricted to the `latin`
unicode-range subset), dropped into `fonts/`, and are served via local
`@font-face` in `styles.css`. Zero third-party requests, confirmed — see
below.

## Preview locally

Any static file server works. From inside `site/`:

```bash
python -m http.server 8000
```

Then open `http://localhost:8000/`.

Opening `index.html` directly via `file://` also works (everything is relative
and self-contained), but a local server is closer to how it'll actually be
served and avoids any browser quirks around `file://` origins.

No install step, no dependencies — it's plain HTML/CSS/JS.

## Deploy to GitHub Pages

The repo root has other directories (`extension/`, `server/`, `demo/`, etc.),
so Pages needs to be told to publish `site/` specifically rather than the
whole repo. GitHub's branch-based Pages UI only offers `/` or `/docs` as
publish folders — it can't point at an arbitrary subfolder like `/site` — so
pick one of these:

**Option A — GitHub Actions (recommended, no files move).**
Add `.github/workflows/pages.yml` at the repo root:

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

Then in the repo's **Settings → Pages**, set **Source** to **GitHub Actions**.
Every push that touches `site/` redeploys automatically.

**Option B — publish from a branch, no Actions.**
Rename/copy `site/` to `docs/` at the repo root, commit, then in
**Settings → Pages** choose **Deploy from a branch** → `main` → `/docs`.
Simplest option if you don't want a workflow file, at the cost of the
directory not being called `site/` anymore.

Either way, once published, check the live URL against the same things
verified locally: `styles.css`/`script.js`/both images resolve (no 404s),
and the console has no errors.

## What was verified before shipping this

- HTML tag balance and duplicate-attribute check (a small script parses the
  file and confirms every tag closes correctly and no attribute repeats).
- Loaded in a real headless Chromium (Playwright) at **1280px and 390px**:
  zero console errors, zero failed network requests, both images decode,
  zero page-level horizontal scroll at either width.
- **Zero external network requests, confirmed by listing every request the
  page makes.** All 7 (the HTML, `styles.css`, `script.js`, 2 fonts, 2
  images) resolve to `localhost` — nothing to Google Fonts or any other
  third party, which is the whole point of self-hosting the fonts.
- Checked with JavaScript fully disabled: all content is present and visible
  (the console replay shows every line already revealed instead of animating
  in; the id-card reveal still works, because it's a plain CSS
  checkbox-`:checked` toggle, not a JS handler; the mobile nav is a native
  `<details>`/`<summary>` disclosure, so it opens and closes without any
  script too).
- **Contrast measured after rendering, not assumed** — glassmorphism's
  known failure mode is text over a translucent surface over an image
  quietly dropping below threshold while looking fine to the eye. A script
  temporarily blanks each probed element's text color, screenshots the
  now-text-free pixel, and computes the real WCAG contrast ratio between
  the element's actual `color` and what the browser actually composited
  behind it (image + gradient + backdrop-filter blur + glass fill, all of
  it). 25 probes across every section, plus the 4 hero text elements
  re-measured at 390px separately (the hero photo crops differently at
  that aspect ratio). Every probe clears 4.5:1; most clear 7:1+. First pass
  did NOT pass — the hero headline and eyebrow initially landed in a
  near-transparent part of the overlay gradient (2.76:1 and 1.12:1) and had
  to be fixed by bottom-anchoring the hero text and steepening the gradient
  before they cleared AA. Worth knowing if you move any hero copy.
- `prefers-reduced-transparency: reduce` verified with real Chrome DevTools
  Protocol media emulation (not just eyeballed): `.evidence`'s
  `backdrop-filter` computes to `none` and its background becomes a solid
  `rgba(11,11,12,0.9)`, per the fallback rule in `styles.css`.
- `@supports not (backdrop-filter: blur(1px))` — Chromium supports
  `backdrop-filter`, so that branch can't be triggered live in this browser;
  the fallback rule was instead verified by injecting it directly and
  confirming it produces the same solid, non-blurred result as the
  reduced-transparency case above (same selectors, same declarations).
- Mobile hamburger drawer (`<768px`): opens on tap, closes when a nav link
  is chosen (and the click still navigates), closes on Escape with focus
  returned to the toggle button.

If you change the copy or add content, it's worth re-running that same kind
of check — particularly anything with `white-space: pre` or `nowrap` inside a
grid or flex item (the CSS footgun this page hit twice pre-redesign), and
anything placed in the hero, where contrast depends on exactly where the
text lands over the gradient.
