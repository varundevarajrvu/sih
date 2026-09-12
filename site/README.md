# SIH 26171 — showcase site

A single static page presenting the project: the redaction proof, the pipeline,
a live console replay, the safety layers, the four demo scenarios, measured
numbers, architecture, and honest limitations. Plain HTML/CSS/JS — no build
step, no framework, no external CDNs or fonts, no network calls of its own.

Files:
```
site/
├── index.html
├── styles.css
├── script.js               (progressive enhancement only — page reads fine without it)
├── assets/
│   ├── id-card-face.jpg               (real fixture photo used on the demo page)
│   └── annotated-webpage-detect.png   (real detection boxes, UI-detector spike)
└── README.md                (this file)
```

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
- Loaded in a real headless Chromium (Playwright): zero console errors, zero
  failed network requests, both images decode.
- Checked with JavaScript fully disabled: all content is present and visible
  (the console replay shows every line already revealed instead of animating
  in; the id-card reveal still works, because it's a plain CSS
  checkbox-`:checked` toggle, not a JS handler).
- Checked at a 390px mobile viewport: no page-level horizontal scroll.
  (Two real bugs were caught and fixed this way — a CSS Grid min-content
  blowout from an unbreakable JSON string, and a `white-space: nowrap` stat
  chip that couldn't wrap a long line — both are the kind of thing that only
  shows up once you actually measure `document.documentElement.scrollWidth`,
  not from eyeballing a desktop screenshot.)

If you change the copy or add content, it's worth re-running that same kind
of check — particularly anything with `white-space: pre` or `nowrap` inside a
grid or flex item, which is the one CSS footgun this page hit twice.
