// Dhristi popup localization (EN/HI) -- structural checks.
//
// This suite does NOT import extension/popup.js (it touches `document` at
// module scope and is loaded as a real <script type="module"> in the
// extension, not something node --test can execute). What it DOES check,
// per this pass's brief:
//   1. every message key exists in BOTH _locales/en and _locales/hi.
//   2. no key has an empty message in either locale.
//   3. the set of $1/$2/... placeholders matches between en and hi for
//      every key (a Hindi sentence may reorder them, but never drop or add one).
//   4. extension/popup.html has no user-visible literal English text left
//      outside a data-i18n/data-i18n-html/data-i18n-placeholder/
//      data-i18n-aria-label attribute (which marks "popup.js overwrites
//      this at runtime"), aside from a small allowlist (brand name, the
//      language-toggle's own language labels).
//
// Run with: node --test tests/unit/test_i18n.mjs

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const EN_PATH = path.join(REPO_ROOT, "extension", "_locales", "en", "messages.json");
const HI_PATH = path.join(REPO_ROOT, "extension", "_locales", "hi", "messages.json");
const POPUP_HTML_PATH = path.join(REPO_ROOT, "extension", "popup.html");

const en = JSON.parse(fs.readFileSync(EN_PATH, "utf8"));
const hi = JSON.parse(fs.readFileSync(HI_PATH, "utf8"));
const popupHtml = fs.readFileSync(POPUP_HTML_PATH, "utf8");

function placeholdersOf(message) {
  return new Set((message.match(/\$[0-9]+/g)) || []);
}

describe("messages.json key parity (en <-> hi)", () => {
  test("every en key exists in hi", () => {
    const missing = Object.keys(en).filter((k) => !(k in hi));
    assert.deepEqual(missing, [], `keys present in en/messages.json but missing from hi/messages.json: ${missing.join(", ")}`);
  });

  test("every hi key exists in en", () => {
    const extra = Object.keys(hi).filter((k) => !(k in en));
    assert.deepEqual(extra, [], `keys present in hi/messages.json but missing from en/messages.json: ${extra.join(", ")}`);
  });

  test("at least the keys this pass introduced are present (sanity floor, not a full enumeration)", () => {
    const mustExist = [
      "appName",
      "appDescription",
      "brandSub",
      "taskGoalLabel",
      "runAgentLoopBtn",
      "stopBtn",
      "consentApproveBtn",
      "consentDenyBtn",
      "goalPrivacyKeepPrivateBtn",
      "goalPrivacyNotPrivateBtn",
      "outcome_done",
      "pending_click",
      "policyReason_generic",
      "tokenPhrase_profileEmail",
    ];
    for (const key of mustExist) {
      assert.ok(key in en, `expected "${key}" in en/messages.json`);
      assert.ok(key in hi, `expected "${key}" in hi/messages.json`);
    }
  });
});

describe("no empty messages", () => {
  test("every en message is a non-empty string", () => {
    const empty = Object.entries(en).filter(([, v]) => !v || typeof v.message !== "string" || !v.message.trim());
    assert.deepEqual(empty.map(([k]) => k), [], "en keys with an empty/missing message");
  });

  test("every hi message is a non-empty string", () => {
    const empty = Object.entries(hi).filter(([, v]) => !v || typeof v.message !== "string" || !v.message.trim());
    assert.deepEqual(empty.map(([k]) => k), [], "hi keys with an empty/missing message");
  });
});

describe("placeholder ($1/$2/...) parity between en and hi", () => {
  for (const key of Object.keys(en)) {
    if (!(key in hi)) continue; // already reported by the key-parity suite above
    test(`"${key}" uses the same placeholder set in both locales`, () => {
      const enSet = placeholdersOf(en[key].message);
      const hiSet = placeholdersOf(hi[key].message);
      const enSorted = [...enSet].sort().join(",");
      const hiSorted = [...hiSet].sort().join(",");
      assert.equal(
        hiSorted,
        enSorted,
        `en "${key}" uses {${enSorted}} but hi uses {${hiSorted}} -- a Hindi sentence may REORDER placeholders, never drop or add one`
      );
    });
  }
});

describe("safety-critical pairs stay unambiguous in hi (spot check, not exhaustive)", () => {
  test("Approve/Deny render as two distinct, non-empty hi strings", () => {
    assert.notEqual(hi.consentApproveBtn.message, hi.consentDenyBtn.message);
    assert.ok(hi.consentApproveBtn.message.trim().length > 0);
    assert.ok(hi.consentDenyBtn.message.trim().length > 0);
  });

  test("Keep private/Not private render as two distinct, non-empty hi strings", () => {
    assert.notEqual(hi.goalPrivacyKeepPrivateBtn.message, hi.goalPrivacyNotPrivateBtn.message);
    assert.ok(hi.goalPrivacyKeepPrivateBtn.message.trim().length > 0);
    assert.ok(hi.goalPrivacyNotPrivateBtn.message.trim().length > 0);
  });

  test("the goal-privacy reason sentence references BOTH of its own button labels, so the two choices stay traceable to the prose above them", () => {
    const reason = hi.goalPrivacyReasonText.message;
    assert.ok(reason.includes(hi.goalPrivacyKeepPrivateBtn.message), "hi goalPrivacyReasonText should quote the hi 'Keep private' label verbatim");
    assert.ok(reason.includes(hi.goalPrivacyNotPrivateBtn.message), "hi goalPrivacyReasonText should quote the hi 'Not private' label verbatim");
  });
});

describe("popup.html has no un-covered literal English text (allowlist for brand/language labels)", () => {
  // Language-code labels on the toggle itself are deliberately literal in
  // EVERY language (see popup.html's own comment on .lang-toggle) -- a
  // user who reads no English yet still needs to find "EN" to switch, and
  // conventionally a language switcher names languages in their own
  // script/label rather than translating "English"/"Hindi" into the
  // currently-active language.
  const ALLOWLIST_WORDS = new Set(["Dhristi", "EN"]);
  const I18N_ATTR_RE = /\bdata-i18n(?:-html|-placeholder|-aria-label)?\s*=/;

  function stripEntities(text) {
    return text.replace(/&[a-zA-Z]+;/g, " ");
  }

  function isAllowlistedRun(text) {
    const words = (text.match(/[A-Za-z][A-Za-z'-]*/g) || []).filter((w) => w.length >= 2);
    return words.every((w) => ALLOWLIST_WORDS.has(w));
  }

  function scan(html) {
    const stripped = html
      .replace(/<!doctype[^>]*>/gi, "")
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "");
    const tokenRe = /<!--[\s\S]*?-->|<\/?([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^<>]*?)?)\/?>|([^<]+)/g;
    const stack = []; // each frame: whether this element (or an ancestor) carries a data-i18n* marker
    const findings = [];
    let m;
    while ((m = tokenRe.exec(stripped))) {
      const whole = m[0];
      if (whole.startsWith("<!--")) continue;
      if (m[1]) {
        const tagName = m[1];
        const isClose = whole.startsWith("</");
        const selfClosing = /\/>\s*$/.test(whole) || /^(img|input|br|hr|meta|link)$/i.test(tagName);
        if (isClose) {
          if (stack.length) stack.pop();
          continue;
        }
        const attrs = m[2] || "";
        const ownI18n = I18N_ATTR_RE.test(attrs);
        const inheritedI18n = stack.length ? stack[stack.length - 1].covered : false;
        const covered = ownI18n || inheritedI18n;

        // Attributes that are themselves user-visible text: placeholder/
        // aria-label/title. Each is fine if EITHER its own element carries
        // the matching data-i18n-placeholder/data-i18n-aria-label marker,
        // OR its content is allowlisted (e.g. a literal URL example).
        for (const [attrName, i18nAttrName] of [
          ["placeholder", "data-i18n-placeholder"],
          ["aria-label", "data-i18n-aria-label"],
          ["title", "data-i18n-title"],
        ]) {
          const valMatch = new RegExp(`${attrName}="([^"]*)"`).exec(attrs);
          if (!valMatch) continue;
          const val = valMatch[1];
          if (!/[A-Za-z]{2,}/.test(val)) continue; // no english-letter content to worry about
          const hasOwnCover = new RegExp(`${i18nAttrName}\\s*=`).test(attrs);
          if (!hasOwnCover && !isAllowlistedRun(val) && !/^[a-zA-Z]+:\/\//.test(val)) {
            findings.push(`<${tagName}> ${attrName}="${val}" has English text but no ${i18nAttrName}`);
          }
        }

        if (!selfClosing) stack.push({ covered });
      } else if (m[3]) {
        const text = stripEntities(m[3]);
        if (!/[A-Za-z]{2,}/.test(text)) continue;
        const covered = stack.length ? stack[stack.length - 1].covered : false;
        if (!covered && !isAllowlistedRun(text)) {
          findings.push(`text run not covered by data-i18n: "${text.trim().slice(0, 80)}"`);
        }
      }
    }
    return findings;
  }

  test("no literal English text/attribute is left uncovered in popup.html", () => {
    const findings = scan(popupHtml);
    assert.deepEqual(findings, [], `uncovered literal English found:\n${findings.join("\n")}`);
  });

  test("the scanner itself actually catches an uncovered string (negative control, so a scanner bug can't silently pass everything)", () => {
    const bad = `<body><p>Hello world, this is not covered.</p></body>`;
    const findings = scan(bad);
    assert.ok(findings.length > 0, "the scanner failed to flag an obviously-uncovered English sentence");
  });

  test("the scanner does not flag brand/language-code allowlisted text", () => {
    const ok = `<body><h1 data-text="Dhristi">Dhristi</h1><button data-lang="en">EN</button></body>`;
    assert.deepEqual(scan(ok), []);
  });
});
