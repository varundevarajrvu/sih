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
} from "../../extension/lib/profile-vault.js";
import { sanitizeDomSnapshot } from "../../extension/lib/redaction.js";

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
