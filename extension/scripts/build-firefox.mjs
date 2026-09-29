#!/usr/bin/env node
// extension/scripts/build-firefox.mjs
//
// Produces dist/firefox/ -- a Firefox-compatible copy of this MV3
// extension. Reads extension/manifest.json and extension/background.js
// but NEVER writes to them: this script's whole job is to prove the
// Chrome build (extension/*, unpacked as-is) stays byte-for-byte
// unchanged while a second, derived tree serves Firefox.
//
// What changes for Firefox, and why:
//   1. manifest.json -- background.service_worker -> background.scripts
//      (Firefox MV3 has no service worker; background.scripts + type:
//      "module" is its event-page equivalent, and "module" is required
//      because background.js uses static ES `import` -- see that file's
//      own top-of-file comment on why it must load as a module).
//      Drops the "offscreen" permission (Chrome-only API, no Firefox
//      equivalent -- addons-linter flags an unrecognized permission).
//      Adds browser_specific_settings.gecko {id, strict_min_version}.
//      host_permissions and content_security_policy (incl.
//      'wasm-unsafe-eval') carry over untouched -- both are already
//      Firefox-compatible as written.
//   2. background.js -- ONE capability check inside
//      ensureOffscreenDocument(), nothing else. See the long comment
//      above rewriteBackgroundJs() below for exactly why that is the
//      only line that needs to branch.
//   3. offscreen.bundle.js is loaded as an ADDITIONAL background script
//      (manifest background.scripts, listed first) instead of inside a
//      chrome.offscreen document. Firefox event pages have a real DOM
//      and can run WASM/OffscreenCanvas, so the exact same bundle --
//      unmodified, not rebuilt, not forked -- runs in-page and registers
//      its own chrome.runtime.onMessage listener for DETECT_OBJECTS in
//      the same document background.js runs in. No iframe, no second
//      page, no change to offscreen.entry.js's source at all.
//
// Usage: node scripts/build-firefox.mjs   (run from extension/, or from
// anywhere -- paths are resolved from this file's own location).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXT_DIR = path.resolve(__dirname, "..");
const OUT_DIR = path.join(EXT_DIR, "dist", "firefox");

function log(...args) {
  console.log("[build-firefox]", ...args);
}

// Top-level entries that exist in extension/ but have no business in a
// shipped extension tree: dev tooling, the pre-bundle source, and the
// output directory itself (so a re-run doesn't try to copy dist/ into
// dist/firefox/).
const TOP_LEVEL_EXCLUDE = new Set([
  "node_modules",
  "package.json",
  "package-lock.json",
  "scripts",
  "src",
  "dist",
  ".git",
  "README.md",
]);

// Files this script rewrites itself -- excluded from the generic copy
// pass so that pass can never clobber (or be clobbered by) the derived
// version, regardless of pass ordering.
const REWRITTEN_FILES = new Set(["manifest.json", "background.js"]);

function rmrf(p) {
  fs.rmSync(p, { recursive: true, force: true });
}

function copyExtensionTree() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const entries = fs.readdirSync(EXT_DIR, { withFileTypes: true });
  for (const entry of entries) {
    const name = entry.name;
    if (TOP_LEVEL_EXCLUDE.has(name) || REWRITTEN_FILES.has(name)) continue;
    fs.cpSync(path.join(EXT_DIR, name), path.join(OUT_DIR, name), { recursive: true });
  }
  log(`copied extension tree (excluding: ${[...TOP_LEVEL_EXCLUDE].join(", ")}) -> ${OUT_DIR}`);
}

// ---------------------------------------------------------------------
// manifest.json rewrite
// ---------------------------------------------------------------------

// Add-on ID format Firefox requires in browser_specific_settings.gecko.id
// (an email-shaped string, or a {UUID}) -- this is a project-local
// identifier, not a real mailbox.
const GECKO_ID = "dhristi-privacy-agent@sih26171.dev";
// content_scripts[].world:"MAIN" (shadow-detect.js, manifest.json) needs
// Firefox 128+ -- that is the highest floor of anything this manifest
// uses, so it is the strict_min_version.
const GECKO_MIN_VERSION = "128.0";

function buildFirefoxManifest(chromeManifest) {
  // Deep clone -- this function must never mutate the object the caller
  // parsed from the real extension/manifest.json.
  const fx = JSON.parse(JSON.stringify(chromeManifest));

  fx.permissions = (fx.permissions || []).filter((p) => p !== "offscreen");

  fx.background = {
    scripts: ["offscreen.bundle.js", "background.js"],
    type: "module",
  };

  fx.browser_specific_settings = {
    gecko: {
      id: GECKO_ID,
      strict_min_version: GECKO_MIN_VERSION,
    },
  };

  return fx;
}

// ---------------------------------------------------------------------
// background.js patch -- ONE capability check, nothing else.
//
// Why only one branch point is needed:
// hasOffscreenDocument() (background.js) queries
// chrome.runtime.getContexts(), a Chrome-only API. That function doesn't
// exist in Firefox, so the existing `typeof chrome.runtime.getContexts
// === "function"` guard already, unmodified, returns false on Firefox --
// safe, no crash, no patch needed there.
// The ONLY crash site is inside ensureOffscreenDocument(): because
// hasOffscreenDocument() just returned false, execution falls through to
// the unconditional `chrome.offscreen.createDocument(...)` call.
// `chrome.offscreen` is undefined on Firefox, so `.createDocument` throws
// a synchronous TypeError.
// Firefox doesn't need that call to succeed -- offscreen.bundle.js is
// already loaded as a second background script (buildFirefoxManifest
// above), resident in this exact document, with its DETECT_OBJECTS
// listener already registered by the time any caller reaches this
// function. So the Firefox branch is a no-op return, not a
// re-implementation.
// ---------------------------------------------------------------------

const ANCHOR = `async function ensureOffscreenDocument() {
  if (await hasOffscreenDocument()) return;`;

const FIREFOX_CAPABILITY_CHECK = `async function ensureOffscreenDocument() {
  // FIREFOX BUILD (extension/scripts/build-firefox.mjs) -- this branch
  // exists ONLY in dist/firefox/background.js, never in the Chrome
  // source file this was generated from. Firefox has no chrome.offscreen;
  // offscreen.bundle.js already runs in this same event-page document
  // (see manifest.json's background.scripts) and has already registered
  // its own chrome.runtime.onMessage listener for DETECT_OBJECTS by the
  // time anything reaches this function -- nothing to create.
  if (typeof chrome === "undefined" || !chrome.offscreen) {
    return;
  }
  if (await hasOffscreenDocument()) return;`;

function rewriteBackgroundJs(source) {
  const occurrences = source.split(ANCHOR).length - 1;
  if (occurrences !== 1) {
    throw new Error(
      `build-firefox: expected exactly one occurrence of the ensureOffscreenDocument() anchor in ` +
        `background.js, found ${occurrences}. The source changed shape -- update ANCHOR / ` +
        `FIREFOX_CAPABILITY_CHECK in build-firefox.mjs deliberately instead of guessing a new patch point.`,
    );
  }
  return source.replace(ANCHOR, FIREFOX_CAPABILITY_CHECK);
}

// ---------------------------------------------------------------------

function main() {
  rmrf(OUT_DIR);
  copyExtensionTree();

  const manifestSrc = fs.readFileSync(path.join(EXT_DIR, "manifest.json"), "utf8");
  const chromeManifest = JSON.parse(manifestSrc);
  const fxManifest = buildFirefoxManifest(chromeManifest);
  fs.writeFileSync(path.join(OUT_DIR, "manifest.json"), JSON.stringify(fxManifest, null, 2) + "\n");
  log(
    "wrote manifest.json (removed 'offscreen' permission; background.service_worker -> " +
      "background.scripts+type:module; added browser_specific_settings.gecko)",
  );

  const bgSrc = fs.readFileSync(path.join(EXT_DIR, "background.js"), "utf8");
  const bgOut = rewriteBackgroundJs(bgSrc);
  fs.writeFileSync(path.join(OUT_DIR, "background.js"), bgOut);
  log("wrote background.js (added the chrome.offscreen capability check in ensureOffscreenDocument())");

  log(`done. Firefox build at ${OUT_DIR}`);
  log("extension/manifest.json and extension/background.js were only read, never modified.");
}

main();
