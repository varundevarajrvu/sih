// SIH 26171 -- extension/lib/profile-vault.js tests, plus the cross-module
// "vault value never reaches the outgoing payload" proof.
//
// Run with: node --test tests/unit/test_profile_vault.mjs
// (or from tests/: npm test -- runs the whole suite via node --test unit/*.mjs)

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { JSDOM, VirtualConsole } from "jsdom";

import {
  PROFILE_VAULT_STORAGE_KEY,
  PROFILE_FIELDS,
  PROFILE_FIELD_LABELS,
  isValidProfileField,
  sanitizeProfile,
  getProfileFieldValue,
  getProfile,
  setProfile,
  buildProfileVaultSensitiveNodes,
  PROFILE_FIELD_TO_PII_TYPE,
} from "../../extension/lib/profile-vault.js";
import { sanitizeDomSnapshot, redact } from "../../extension/lib/redaction.js";
import { scanForPii } from "../../extension/lib/dom-scanner.js";
import {
  buildFixtureScreenshotBase64,
  makeNodeCanvasAdapters,
  decodePngForSampling,
  SCALE_FACTOR,
} from "../fixtures/redaction/fixture.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ACTION_EXECUTOR_PATH = path.resolve(__dirname, "..", "..", "extension", "lib", "action-executor.js");
const ACTION_EXECUTOR_SRC = readFileSync(ACTION_EXECUTOR_PATH, "utf-8");

// ---------------------------------------------------------------------------
// In-memory fake mirroring chrome.storage.local / browser.storage.local's
// promise-based get(key)/set(items) shape -- exactly what profile-vault.js's
// getProfile()/setProfile() are written to accept (see that file's own doc
// comments), so this fake is a faithful stand-in with zero chrome.* global
// involved, matching every other pure-module test in this repo.
// ---------------------------------------------------------------------------
function makeFakeStorage(initial = {}) {
  const data = { ...initial };
  return {
    async get(key) {
      if (typeof key === "string") return { [key]: data[key] };
      return { ...data };
    },
    async set(items) {
      Object.assign(data, items);
    },
    _raw: data,
  };
}

describe("profile-vault.js: closed field set", () => {
  test("PROFILE_FIELDS is exactly full_name, email, phone", () => {
    assert.deepEqual([...PROFILE_FIELDS].sort(), ["email", "full_name", "phone"]);
  });

  test("isValidProfileField accepts only the three closed fields", () => {
    assert.equal(isValidProfileField("full_name"), true);
    assert.equal(isValidProfileField("email"), true);
    assert.equal(isValidProfileField("phone"), true);
  });

  test("isValidProfileField rejects anything else, including near-misses and non-strings", () => {
    assert.equal(isValidProfileField("fullname"), false);
    assert.equal(isValidProfileField("Full_Name"), false);
    assert.equal(isValidProfileField("password"), false);
    assert.equal(isValidProfileField("__proto__"), false);
    assert.equal(isValidProfileField(""), false);
    assert.equal(isValidProfileField(null), false);
    assert.equal(isValidProfileField(undefined), false);
    assert.equal(isValidProfileField(123), false);
  });

  test("PROFILE_FIELD_LABELS has a human label for every closed field, and nothing extra", () => {
    assert.deepEqual(Object.keys(PROFILE_FIELD_LABELS).sort(), [...PROFILE_FIELDS].sort());
  });
});

describe("profile-vault.js: sanitizeProfile (pure, never throws)", () => {
  test("trims whitespace on every field", () => {
    const result = sanitizeProfile({ full_name: "  Priya Sharma  ", email: " priya@example.com ", phone: " 9876543210 " });
    assert.deepEqual(result, { full_name: "Priya Sharma", email: "priya@example.com", phone: "9876543210" });
  });

  test("drops unknown/extra keys -- the returned object can only ever have the three closed keys", () => {
    const result = sanitizeProfile({ full_name: "X", ssn: "123-45-6789", isAdmin: true, __proto__: { evil: true } });
    assert.deepEqual(Object.keys(result).sort(), ["email", "full_name", "phone"]);
    assert.equal(result.full_name, "X");
  });

  test("non-string values on a known field degrade to empty string, not a crash or a coerced string", () => {
    const result = sanitizeProfile({ full_name: 12345, email: { evil: true }, phone: null });
    assert.deepEqual(result, { full_name: "", email: "", phone: "" });
  });

  test("all-whitespace input normalizes to empty string", () => {
    const result = sanitizeProfile({ full_name: "   " });
    assert.equal(result.full_name, "");
  });

  test("null/undefined/non-object input never throws -- degrades to a fully-shaped empty profile", () => {
    assert.deepEqual(sanitizeProfile(null), { full_name: "", email: "", phone: "" });
    assert.deepEqual(sanitizeProfile(undefined), { full_name: "", email: "", phone: "" });
    assert.deepEqual(sanitizeProfile("not an object"), { full_name: "", email: "", phone: "" });
    assert.deepEqual(sanitizeProfile(42), { full_name: "", email: "", phone: "" });
  });
});

describe("profile-vault.js: getProfileFieldValue (pure lookup)", () => {
  const profile = { full_name: "Priya Sharma", email: "priya@example.com", phone: "" };

  test("returns the saved string for a field that has one", () => {
    assert.equal(getProfileFieldValue(profile, "full_name"), "Priya Sharma");
    assert.equal(getProfileFieldValue(profile, "email"), "priya@example.com");
  });

  test("returns null (never empty string) for a field that's empty in the profile", () => {
    assert.equal(getProfileFieldValue(profile, "phone"), null);
  });

  test("returns null for an invalid/unknown field name -- never guesses, never throws", () => {
    assert.equal(getProfileFieldValue(profile, "ssn"), null);
    assert.equal(getProfileFieldValue(profile, ""), null);
    assert.equal(getProfileFieldValue(profile, null), null);
    assert.equal(getProfileFieldValue(profile, undefined), null);
  });

  test("returns null (not a crash) when profile itself is null/undefined", () => {
    assert.equal(getProfileFieldValue(null, "email"), null);
    assert.equal(getProfileFieldValue(undefined, "email"), null);
  });

  test("trims a stored value with incidental whitespace", () => {
    assert.equal(getProfileFieldValue({ full_name: "  Priya  ", email: "", phone: "" }, "full_name"), "Priya");
  });
});

describe("profile-vault.js: getProfile()/setProfile() (storage-injected)", () => {
  test("getProfile() on empty storage resolves a fully-shaped, all-empty profile (never undefined/partial)", async () => {
    const storage = makeFakeStorage();
    const profile = await getProfile(storage);
    assert.deepEqual(profile, { full_name: "", email: "", phone: "" });
  });

  test("setProfile() then getProfile() round-trips, sanitized, under exactly ONE storage key", async () => {
    const storage = makeFakeStorage();
    const saved = await setProfile(storage, { full_name: " Priya Sharma ", email: "priya@example.com", phone: "9876543210" });
    assert.deepEqual(saved, { full_name: "Priya Sharma", email: "priya@example.com", phone: "9876543210" });

    // Exactly one key in the whole storage backend -- "under one key", per
    // the task contract, not three separate top-level keys.
    assert.deepEqual(Object.keys(storage._raw), [PROFILE_VAULT_STORAGE_KEY]);

    const reread = await getProfile(storage);
    assert.deepEqual(reread, saved);
  });

  test("getProfile()/setProfile() reject a storage object that doesn't look like chrome.storage.local", async () => {
    await assert.rejects(() => getProfile({}), TypeError);
    await assert.rejects(() => setProfile({}, { full_name: "x" }), TypeError);
  });

  test("setProfile() sanitizes before writing -- extra/malformed keys never reach storage", async () => {
    const storage = makeFakeStorage();
    await setProfile(storage, { full_name: "X", creditCard: "4111111111111111" });
    assert.deepEqual(Object.keys(storage._raw[PROFILE_VAULT_STORAGE_KEY]).sort(), ["email", "full_name", "phone"]);
  });
});

// ===========================================================================
// 🔴 THE VAULT MUST NEVER LEAVE THE CLIENT.
//
// Proves the class of risk profile-vault.js's own header calls out: a
// fill_profile write can legitimately land inside a field the client has
// flagged sensitive (that's the whole feature -- see action-executor.js's
// guardSensitive() FILL_PROFILE CARVE-OUT), so this test deliberately
// engineers exactly that case and then checks the value from BOTH directions:
//   1. action-executor.js's own dispatchFillProfile() result never carries it
//      (the RUN-SUMMARY-shaped object content.js would log).
//   2. The full outgoing-payload shape content.js actually builds
//      ({image, domSnapshot, redactedRegions, taskGoal}) -- after the SAME
//      sanitizeDomSnapshot() step content.js runs before every /analyze
//      send -- never contains it either, even serialized to JSON bytes.
//
// This is the same shape of assertion content.js's own assertNoRawPii()
// makes for page-sourced PII (JSON.stringify + .includes(rawValue)),
// applied here to vault-sourced PII -- same class of risk, same proof
// technique.
// ===========================================================================
describe("VAULT CONTAINMENT: a vault value written via fill_profile never reaches the outgoing payload bytes", () => {
  const VAULT_EMAIL = "vault-secret-9f31c@example.test"; // deliberately distinctive -- a substring match anywhere is unambiguous
  const FIXTURE_HTML = `<!doctype html><html><body>
    <input id="emailField" type="email" autocomplete="email" />
  </body></html>`;

  function freshDom() {
    const virtualConsole = new VirtualConsole().sendTo(console, { omitJSDOMErrors: true });
    const dom = new JSDOM(FIXTURE_HTML, { url: "https://fixture.example/", runScripts: "outside-only", virtualConsole });
    dom.window.eval(ACTION_EXECUTOR_SRC);
    return dom;
  }

  let dom, window, document, AE, idMap, emailEl;

  beforeEach(async () => {
    dom = freshDom();
    window = dom.window;
    document = window.document;
    AE = window.ActionExecutor;
    ({ idMap } = AE.buildDomSnapshot(document));
    emailEl = document.getElementById("emailField");
    // Simulates content.js's real Phase-4 merge step: dom-scanner.js flags
    // autocomplete="email" as sensitive, and content.js stamps this
    // attribute onto the live element BEFORE the action guard ever runs --
    // see content.js's step 3 comment ("RULING 4 -- wire the sensitive
    // guard"). Engineered here directly, exactly like test_wiring.mjs's own
    // FIXTURE_HTML does for its sensitive/irreversible fixtures.
    emailEl.setAttribute(AE.SENSITIVE_ATTR, "true");
  });

  test("precondition: this field really is guard-flagged sensitive -- a MODEL-supplied `type` is blocked here (proves the fixture, and proves fill_profile's carve-out is narrow)", () => {
    assert.throws(
      () =>
        AE.executeAction(
          { action: "type", targetId: emailEl.getAttribute(AE.AGENT_ID_ATTR), value: "model-guessed@example.com" },
          idMap
        ),
      (err) => err.code === "SENSITIVE_TARGET_BLOCKED"
    );
  });

  test("fill_profile writes the vault value into the sensitive field (the feature working) -- but the DISPATCH RESULT never carries it", async () => {
    const storage = makeFakeStorage();
    await setProfile(storage, { full_name: "", email: VAULT_EMAIL, phone: "" });
    const profile = await getProfile(storage);
    const getProfileValue = (field) => getProfileFieldValue(profile, field);

    const result = AE.executeAction(
      { action: "fill_profile", targetId: emailEl.getAttribute(AE.AGENT_ID_ATTR), value: null, profileField: "email" },
      idMap,
      { getProfileValue }
    );

    // The feature actually worked: the field really does hold the vault value.
    assert.equal(emailEl.value, VAULT_EMAIL);

    // But the RESULT object -- exactly what content.js pushes into
    // stepResults / the RUN SUMMARY -- must not carry it, in any form.
    assert.equal(result.ok, true);
    assert.equal(result.profileField, "email");
    assert.equal("value" in result, false, "dispatchFillProfile's result must not have a `value` key at all");
    assert.ok(!JSON.stringify(result).includes(VAULT_EMAIL), "the vault value must not appear anywhere in the serialized dispatch result");
  });

  test("the full outgoing /analyze payload -- built the same way content.js builds it -- never contains the vault value, even after the write", async () => {
    const storage = makeFakeStorage();
    await setProfile(storage, { full_name: "", email: VAULT_EMAIL, phone: "" });
    const profile = await getProfile(storage);
    const getProfileValue = (field) => getProfileFieldValue(profile, field);

    AE.executeAction(
      { action: "fill_profile", targetId: emailEl.getAttribute(AE.AGENT_ID_ATTR), value: null, profileField: "email" },
      idMap,
      { getProfileValue }
    );
    assert.equal(emailEl.value, VAULT_EMAIL, "precondition: the write actually happened");

    // Re-scan (mirrors content.js's per-step buildDomSnapshot()) -- the live
    // DOM now genuinely carries the vault value in its raw .value, same as
    // dom-scanner.js's own comment notes for a password field's raw value.
    const { domSnapshot: rawSnapshot } = AE.buildDomSnapshot(document);
    const rawEmailNode = rawSnapshot.find((n) => n.agentId === emailEl.getAttribute(AE.AGENT_ID_ATTR));
    assert.equal(rawEmailNode.text, VAULT_EMAIL, "precondition: the RAW (pre-sanitization) snapshot does carry the raw value -- this is exactly what sanitizeDomSnapshot() exists to strip");

    // Merge step (content.js's real order): mark the node sensitive (it
    // already was, via dom-scanner -- reproduced here explicitly).
    const mergedSnapshot = rawSnapshot.map((n) => (n.agentId === rawEmailNode.agentId ? { ...n, sensitive: true } : n));

    // THE SAME sanitizeDomSnapshot() call content.js makes right before
    // building the outgoing payload (see content.js's runAgentLoop(), step
    // 6/REDACT) -- real module, not a stand-in.
    const sanitizedDomSnapshot = sanitizeDomSnapshot(mergedSnapshot);
    const sanitizedEmailNode = sanitizedDomSnapshot.find((n) => n.agentId === rawEmailNode.agentId);
    assert.equal(sanitizedEmailNode.text, null, "sanitizeDomSnapshot must strip the vault-sourced value exactly like it strips any other sensitive-flagged raw value");

    // The exact payload shape content.js POSTs to /analyze
    // ({image, domSnapshot, redactedRegions, taskGoal} -- see
    // runAgentLoop()'s own `const payload = {...}` right before
    // assertNoRawPii()).
    const outgoingPayload = {
      image: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      domSnapshot: sanitizedDomSnapshot,
      redactedRegions: [],
      taskGoal: "fill in my email",
    };

    const payloadBytes = JSON.stringify(outgoingPayload);
    assert.ok(!payloadBytes.includes(VAULT_EMAIL), "the vault value must never appear in the outgoing payload bytes -- the same class of assertion assertNoRawPii() makes for page-sourced PII");
  });
});

// ===========================================================================
// 🔴 PII-LEAK FIX REGRESSION -- the CONFIRMED leak (see CLAUDE.md): a
// fill_profile "full_name" has NO regex/autocomplete signature, so the
// REAL dom-scanner never flags it on its own, and the vault name survived
// into the outgoing /analyze payload on the step after the fill.
//
// Unlike the "VAULT CONTAINMENT" suite above (which deliberately hardcodes
// `sensitive: true` at its merge step to isolate sanitizeDomSnapshot()'s own
// behavior -- a legitimate thing to test in isolation, but exactly the
// hardcoding that let this bug through undetected: it never exercised the
// REAL classifier's verdict on a name field), every test below runs the
// REAL scanForPii() from dom-scanner.js and the REAL
// buildProfileVaultSensitiveNodes() from profile-vault.js -- the actual
// production code path, not a stand-in for it.
// ===========================================================================
describe("PII-LEAK FIX: a vault-filled full_name node is contained on the NEXT step, using the REAL dom-scanner classifier", () => {
  const VAULT_NAME = "Varun Devaraj";
  // Deliberately NOT type=password/email/tel and NOT a PII-relevant
  // autocomplete token -- autocomplete="name" is one of dom-scanner.js's own
  // documented, deliberate non-flags (CLAUDE.md: "Generic autocomplete
  // tokens (name, street-address, postal-code) are NOT flagged"). This is
  // precisely the shape of field the confirmed leak was found on.
  const FIXTURE_HTML = `<!doctype html><html><body>
    <input id="nameField" type="text" autocomplete="name" />
  </body></html>`;

  function freshDom() {
    const virtualConsole = new VirtualConsole().sendTo(console, { omitJSDOMErrors: true });
    const dom = new JSDOM(FIXTURE_HTML, { url: "https://fixture.example/", runScripts: "outside-only", virtualConsole });
    dom.window.eval(ACTION_EXECUTOR_SRC);
    return dom;
  }

  test("precondition/diagnosis: the REAL dom-scanner does not flag a bare full_name field on its own -- confirms why the leak was invisible to Phase 2a", () => {
    const dom = freshDom();
    const { document } = dom.window;
    const AE = dom.window.ActionExecutor;
    // Real call order per CLAUDE.md's binding ruling: action-executor FIRST
    // (stamps data-agent-id), dom-scanner SECOND (reuses those ids).
    const { idMap } = AE.buildDomSnapshot(document);
    const { sensitiveNodes } = scanForPii(document);
    const nameEl = document.getElementById("nameField");
    const nameAgentId = nameEl.getAttribute(AE.AGENT_ID_ATTR);
    assert.ok(nameAgentId, "precondition: action-executor actually stamped an id on the name field");
    assert.equal(
      sensitiveNodes.some((n) => n.agentId === nameAgentId),
      false,
      "the real scanner has no regex/autocomplete signature for a bare name -- this IS the diagnosis, not an assumption"
    );
  });

  test("THE FIX: buildProfileVaultSensitiveNodes() + sanitizeDomSnapshot() strip the vault name from the outgoing DOM JSON on the step after the fill, even though the REAL scanner still doesn't flag it", async () => {
    const dom = freshDom();
    const { document } = dom.window;
    const AE = dom.window.ActionExecutor;

    const { idMap } = AE.buildDomSnapshot(document);
    const nameEl = document.getElementById("nameField");
    const nameAgentId = nameEl.getAttribute(AE.AGENT_ID_ATTR);

    const storage = makeFakeStorage();
    await setProfile(storage, { full_name: VAULT_NAME, email: "", phone: "" });
    const profile = await getProfile(storage);
    const getProfileValue = (field) => getProfileFieldValue(profile, field);

    // Step N: fill_profile succeeds -- the feature working as designed.
    const fillResult = AE.executeAction(
      { action: "fill_profile", targetId: nameAgentId, value: null, profileField: "full_name" },
      idMap,
      { getProfileValue }
    );
    assert.equal(fillResult.ok, true);
    assert.equal(nameEl.value, VAULT_NAME, "precondition: the vault value really is now in the live DOM");

    // Step N+1 -- mirrors content.js's real per-step sequence: re-scan
    // (action-executor FIRST, dom-scanner SECOND), both REAL modules.
    const { domSnapshot: rawSnapshot, idMap: idMap2 } = AE.buildDomSnapshot(document);
    const { sensitiveNodes } = scanForPii(document);

    const rawNameNode = rawSnapshot.find((n) => n.agentId === nameAgentId);
    assert.equal(
      rawNameNode.text,
      VAULT_NAME,
      "precondition: the raw pre-sanitization snapshot carries the vault value via getAccessibleText()'s .value read -- THIS is the confirmed leak's mechanism"
    );
    assert.equal(
      sensitiveNodes.some((n) => n.agentId === nameAgentId),
      false,
      "precondition: confirmed again on this later step -- the real scanner still does not flag it by itself"
    );

    // THE FIX: content.js's own filledProfileAgentIds Map (agentId ->
    // profileField), as recorded by its "PII-LEAK FIX" block on the
    // successful fill_profile act above.
    const filledProfileAgentIds = new Map([[nameAgentId, "full_name"]]);
    const alreadyFlaggedAgentIds = new Set(sensitiveNodes.map((n) => n.agentId));
    // jsdom has no layout engine (real geometry is UNVERIFIED outside a
    // browser, same caveat as every other module here) -- inject a fixed,
    // real-shaped bbox exactly like dom-scanner.js's own tests do.
    const vaultNodes = buildProfileVaultSensitiveNodes(filledProfileAgentIds, idMap2, alreadyFlaggedAgentIds, {
      getBBox: () => ({ x: 1, y: 2, w: 3, h: 4 }),
    });

    assert.equal(vaultNodes.length, 1, "exactly one synthesized node for the one recorded fill_profile target");
    assert.equal(vaultNodes[0].agentId, nameAgentId);
    assert.equal(
      vaultNodes[0].piiType,
      PROFILE_FIELD_TO_PII_TYPE.full_name,
      'full_name maps to PiiType\'s "other" escape hatch (orchestrator ruling #5) -- there is no dedicated enum member for a name'
    );
    assert.equal(vaultNodes[0].piiType, "other");
    assert.deepEqual(vaultNodes[0].bbox, { x: 1, y: 2, w: 3, h: 4 }, "bbox must be the FRESH value from idMap2, not a cached one");

    const allSensitiveNodes = sensitiveNodes.concat(vaultNodes);

    // THE SAME merge content.js performs: sensitiveByAgentId -> mergedDomSnapshot.
    const sensitiveByAgentId = new Map(allSensitiveNodes.map((n) => [n.agentId, n]));
    const mergedSnapshot = rawSnapshot.map((n) => (sensitiveByAgentId.has(n.agentId) ? { ...n, sensitive: true } : n));

    // THE SAME sanitizeDomSnapshot() call content.js makes right before
    // building the outgoing /analyze payload -- real module, not a stand-in.
    const sanitizedDomSnapshot = sanitizeDomSnapshot(mergedSnapshot);
    const sanitizedNameNode = sanitizedDomSnapshot.find((n) => n.agentId === nameAgentId);
    assert.equal(
      sanitizedNameNode.text,
      null,
      "THE FIX: the vault-sourced full_name is now stripped, exactly like any other sensitive-flagged raw value"
    );
    assert.equal(sanitizedNameNode.sensitive, true);

    // The exact payload shape content.js POSTs to /analyze.
    const outgoingPayload = {
      image: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      domSnapshot: sanitizedDomSnapshot,
      redactedRegions: [],
      taskGoal: "fill in my full name",
    };
    const payloadBytes = JSON.stringify(outgoingPayload);
    assert.ok(
      !payloadBytes.includes(VAULT_NAME),
      "THE FIX: the vault full_name value must never appear in the outgoing payload bytes"
    );
  });

  test("THE FIX, image half: the vault-filled node also produces a redactedRegion via the REAL redact(), not only a stripped text field", async () => {
    const dom = freshDom();
    const { document } = dom.window;
    const AE = dom.window.ActionExecutor;

    const { idMap } = AE.buildDomSnapshot(document);
    const nameEl = document.getElementById("nameField");
    const nameAgentId = nameEl.getAttribute(AE.AGENT_ID_ATTR);

    const storage = makeFakeStorage();
    await setProfile(storage, { full_name: VAULT_NAME, email: "", phone: "" });
    const profile = await getProfile(storage);
    const getProfileValue = (field) => getProfileFieldValue(profile, field);

    AE.executeAction(
      { action: "fill_profile", targetId: nameAgentId, value: null, profileField: "full_name" },
      idMap,
      { getProfileValue }
    );
    assert.equal(nameEl.value, VAULT_NAME, "precondition: the write actually happened");

    const filledProfileAgentIds = new Map([[nameAgentId, "full_name"]]);
    // A deliberate, real-shaped CSS-px bbox in an area of the fixture
    // screenshot untouched by any of its own pre-painted regions (see
    // tests/fixtures/redaction/fixture.mjs's own REGION_A_CORRECT/REGION_B/
    // REGION_P/REGION_Q) -- at the fixture's own SCALE_FACTOR (2), this
    // lands at exactly {x:150,y:100,w:40,h:20} in screenshot-pixel space,
    // safely inside the 220x170 canvas.
    const CSS_BBOX = { x: 75, y: 50, w: 20, h: 10 };
    const EXPECTED_SCREENSHOT_REGION = { x: 150, y: 100, w: 40, h: 20 };
    const vaultNodes = buildProfileVaultSensitiveNodes(filledProfileAgentIds, idMap, new Set(), {
      getBBox: () => CSS_BBOX,
    });
    assert.equal(vaultNodes.length, 1);

    const screenshotBase64 = await buildFixtureScreenshotBase64();
    const { canvasFactory, imageLoader } = makeNodeCanvasAdapters();

    const { redactedImage, redactedRegions } = await redact(screenshotBase64, [], vaultNodes, {
      scaleFactor: SCALE_FACTOR,
      canvasFactory,
      imageLoader,
    });

    const vaultRegion = redactedRegions.find((r) => r.agentId === nameAgentId);
    assert.ok(
      vaultRegion,
      "THE FIX: the vault-filled node produced its own redactedRegion -- the IMAGE half of the fix, not only the stripped DOM-JSON text field"
    );
    assert.equal(vaultRegion.type, "other");
    assert.equal(vaultRegion.source, "dom");
    assert.deepEqual(vaultRegion.bbox, EXPECTED_SCREENSHOT_REGION);

    // Prove it's actually painted onto the image, not merely reported in
    // metadata -- sample a pixel from inside the region.
    const sample = await decodePngForSampling(redactedImage);
    const [r, g, b] = sample.pixelAt(
      EXPECTED_SCREENSHOT_REGION.x + EXPECTED_SCREENSHOT_REGION.w / 2,
      EXPECTED_SCREENSHOT_REGION.y + EXPECTED_SCREENSHOT_REGION.h / 2
    );
    assert.ok(r < 10 && g < 10 && b < 10, `expected the vault region to be blacked out (fill #000000), got rgb(${r},${g},${b})`);
  });

  test("dedupe: an already-scanner-flagged agentId (e.g. autocomplete=\"email\") is never double-added by buildProfileVaultSensitiveNodes()", () => {
    const idMap = new Map([["agent-1", {}]]);
    const filledProfileAgentIds = new Map([["agent-1", "email"]]);
    const alreadyFlaggedAgentIds = new Set(["agent-1"]);
    const vaultNodes = buildProfileVaultSensitiveNodes(filledProfileAgentIds, idMap, alreadyFlaggedAgentIds, {
      getBBox: () => ({ x: 0, y: 0, w: 0, h: 0 }),
    });
    assert.deepEqual(vaultNodes, [], "already-flagged agentIds must be skipped, never double-added as a second entry");
  });

  test("a recorded agentId whose element is no longer resolvable in idMap is skipped, not synthesized with a stale/fabricated bbox", () => {
    const idMap = new Map(); // element removed/replaced since the fill -- agentId no longer resolvable
    const filledProfileAgentIds = new Map([["agent-9", "phone"]]);
    const vaultNodes = buildProfileVaultSensitiveNodes(filledProfileAgentIds, idMap, new Set());
    assert.deepEqual(vaultNodes, []);
  });

  test("profileField -> piiType mapping matches CLAUDE.md's ruling #4 exactly: email->email, phone->tel, full_name->other", () => {
    assert.deepEqual(PROFILE_FIELD_TO_PII_TYPE, { full_name: "other", email: "email", phone: "tel" });
  });
});
