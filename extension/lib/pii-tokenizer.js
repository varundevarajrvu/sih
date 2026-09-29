// SIH 26171 v2 -- V1a pii-tokenizer, contract C2
// (docs/v2/ARCHITECTURE.md "Contracts (V1+)" -> C2, `extension/lib/pii-tokenizer.js`).
//
//   mergeSpans(regexSpans, nerSpans) -> PiiSpan[]     regex wins overlaps; no partial overlaps survive
//   classifyBand(span) -> "strip" | "ask" | "ignore"  thresholds below
//   tokenize(text, spans, tokenMap) -> { text, tokenMap, asked }
//   rehydrate(value, tokenMap) -> string               throws on unknown token
//   createTokenMap() -> TokenMap
//   seedVault(tokenMap, profile) -> { full_name, email, phone }  (token|null each)
//
// This module is PURE: no `document`/`window`, no chrome.* global, no
// import of pii-regex.js or any NER module (it consumes their PiiSpan[]
// output, it does not produce it). Runs unmodified under plain Node
// (`node --test`) and inside the extension.
//
// ---------------------------------------------------------------------------
// Confidence bands (docs/v2/ARCHITECTURE.md, "Take from Project B" item 3,
// restated verbatim by C2's own text):
//   score >= 0.60            -> strip silently
//   floor <= score < 0.60    -> ask the user
//   score <  floor           -> ignore
//   regex spans (source === "regex") ALWAYS strip, regardless of score
//     (their score is always 1.0 anyway -- this rule is stated explicitly
//     per the brief rather than left to fall out of the threshold, so it
//     reads correctly even if a future regex pass ever mints a
//     score < 1.0 for a lower-confidence heuristic match).
// Per-label floor: PERSONNAME 0.12, every other label 0.35. A missed name
// is a privacy breach; a spurious prompt costs one click -- see
// warden/README.md's "Confidence bands" table, ported here as policy, not
// as code (this file has no dependency on the Python Warden).
// ---------------------------------------------------------------------------

const PERSONNAME_FLOOR = 0.12;
const DEFAULT_FLOOR = 0.35;
const STRIP_THRESHOLD = 0.6;

/**
 * @param {{label:string, score:number, source:"regex"|"ner"|"vault"}} span
 * @returns {"strip"|"ask"|"ignore"}
 */
export function classifyBand(span) {
  if (!span || typeof span !== "object") {
    throw new TypeError("classifyBand(span): span must be a PiiSpan object");
  }
  // Regex spans are a deterministic, certain match -- always strip. Vault
  // spans (source "vault") are a known real value the user themselves
  // stored, not a probabilistic detection at all -- also always strip.
  // Neither is subject to the score-band logic below, which exists only
  // to arbitrate an NER model's *uncertainty*.
  if (span.source === "regex" || span.source === "vault") return "strip";

  const score = typeof span.score === "number" ? span.score : -Infinity;
  if (score >= STRIP_THRESHOLD) return "strip";
  const floor = span.label === "PERSONNAME" ? PERSONNAME_FLOOR : DEFAULT_FLOOR;
  if (score >= floor) return "ask";
  return "ignore";
}

// ---------------------------------------------------------------------------
// mergeSpans -- regex wins overlaps; no partial overlaps survive.
//
// Rule (from the brief, expanding C2's one-line contract): when a regex
// span and an NER span overlap -- fully or partially -- the merged span
// takes the UNION extent (so no raw character of either original span
// survives untokenized) and keeps the REGEX span's label/score/source.
// This is NOT "the regex span wins and the NER span is discarded" -- a
// discard would leave the NER span's non-overlapping tail unlabeled,
// which is exactly the "no raw character of either span survives" case
// this rule forbids. Take the union, keep the regex identity.
//
// Two cases the two-line contract doesn't spell out, handled defensively
// so the GLOBAL output invariant ("no partial overlaps survive" across
// the whole returned array, not just per-pair) actually holds:
//   - An incoming NER span overlapping MULTIPLE already-merged spans (a
//     bridge) unions across all of them, not just the first one found.
//   - Two NER spans overlapping each other (no regex involved at all --
//     C2 is silent on this because a well-behaved NER call shouldn't
//     produce overlapping spans for one text, but "shouldn't" is not
//     "can't"): union extent, keep the HIGHER-SCORE span's label/score
//     (ties broken by earliest start, then input order) -- the same
//     "more confident signal wins, weaker one is absorbed rather than
//     dropped" spirit as the regex-wins rule, generalized to a case the
//     contract didn't anticipate.
// ---------------------------------------------------------------------------

function spansOverlap(a, b) {
  return a.start < b.end && b.start < a.end;
}

/**
 * @param {Array<object>} regexSpans
 * @param {Array<object>} nerSpans
 * @returns {Array<object>} PiiSpan[], sorted by start, non-overlapping
 */
export function mergeSpans(regexSpans, nerSpans) {
  const regex = Array.isArray(regexSpans) ? regexSpans.slice() : [];
  const ner = Array.isArray(nerSpans) ? nerSpans.slice() : [];

  regex.sort((a, b) => a.start - b.start);

  // Regex spans always win and are already guaranteed non-overlapping
  // among themselves by pii-regex.js's own contract -- seed `merged` with
  // plain shallow copies.
  let merged = regex.map((s) => ({ ...s }));

  for (const nerSpan of ner) {
    const overlapping = merged.filter((m) => spansOverlap(m, nerSpan));

    if (overlapping.length === 0) {
      merged.push({ ...nerSpan });
      continue;
    }

    const regexInvolved = overlapping.filter((m) => m.source === "regex");
    const unionStart = Math.min(nerSpan.start, ...overlapping.map((m) => m.start));
    const unionEnd = Math.max(nerSpan.end, ...overlapping.map((m) => m.end));

    let winner;
    if (regexInvolved.length > 0) {
      // Regex wins overlaps. Deterministic tie-break: earliest-starting
      // regex span among those involved (overlapping was derived from
      // `merged`, which is kept sorted below, so this is stable).
      winner = regexInvolved[0];
    } else {
      // NER-vs-NER overlap: higher score wins; ties by earliest start,
      // then by original input order (Array.prototype.reduce visits in
      // order, so the first-seen candidate wins ties naturally since we
      // use a strict `>` comparison).
      const candidates = [...overlapping, nerSpan];
      winner = candidates.reduce((best, cur) => (cur.score > best.score ? cur : best));
    }

    merged = merged.filter((m) => !overlapping.includes(m));
    merged.push({ start: unionStart, end: unionEnd, label: winner.label, score: winner.score, source: winner.source });
    merged.sort((a, b) => a.start - b.start);
  }

  merged.sort((a, b) => a.start - b.start || a.end - b.end);
  return merged;
}

// ---------------------------------------------------------------------------
// TokenMap
//
// Deliberately NOT a plain object: private fields (#) mean the default
// enumeration `JSON.stringify` would perform sees zero own-enumerable
// properties even before `toJSON` is considered -- and `toJSON` is
// provided anyway, on purpose, as the loud, unmissable guard: any
// `JSON.stringify(payload)` where `payload` contains a TokenMap ANYWHERE
// in its object graph throws instead of silently serializing (or
// silently serializing to `{}`, which would be just as dangerous a
// silent-pass for a test that only checks "did it throw" incorrectly).
// This is the structural enforcement of C2's "TokenMap lives only in the
// extension's run state... never serialized into any request body, log
// line, or storage outside the run."
// ---------------------------------------------------------------------------

export class TokenMapNotSerializableError extends Error {
  constructor() {
    super(
      "TokenMap must never be JSON-serialized: it holds raw PII values keyed by token. " +
        "If you hit this, a payload that includes the TokenMap (directly or nested) was " +
        "about to be sent over the wire or written to a log/storage location."
    );
    this.name = "TokenMapNotSerializableError";
  }
}

export class UnknownTokenError extends Error {
  constructor(token) {
    super(`rehydrate: unknown token "${token}" -- not present in this TokenMap`);
    this.name = "UnknownTokenError";
    this.token = token;
  }
}

// Token grammar (C2): /[A-Z][A-Z0-9]*#[0-9]+/, no underscores. Project
// B's F-finding (warden/minter.py's own header comment, cited there):
// "PERSON_NAME#1" matches the consumer's anchor-free regex only as its
// suffix "NAME#1", which is not a key the vault holds, so rehydrate then
// throws on a token that was never actually wrong -- it was just spelled
// with an underscore. Every label this repo mints from (pii-regex.js's
// ORDERED_PATTERNS, and PROFILE_FIELD_TOKEN_LABEL below) is already a
// single unbroken run of [A-Z0-9], so this is enforced by construction,
// not just validated here -- but it IS validated here too, defensively,
// since a label arriving from an external NER caller is not otherwise
// checked before this point.
const LABEL_RE = /^[A-Z][A-Z0-9]*$/;

function normalizeForDedup(label, rawValue) {
  if (label === "EMAIL") return rawValue.trim().toLowerCase();
  if (label === "PHONE") return rawValue.trim().toLowerCase().replace(/\s+/g, " ");
  return rawValue;
}

export class TokenMap {
  #counts = new Map(); // label -> next ordinal
  #tokenToValue = new Map(); // token -> raw value
  #dedupeKeyToToken = new Map(); // "LABEL::normalizedValue" -> token

  /**
   * Return the existing token for (label, rawValue) if one was already
   * minted for the SAME raw value under the SAME label (per C2: "same
   * raw value within one run -> same token"; email/phone compare
   * case/whitespace-normalized, everything else compares exactly), else
   * mint and register a fresh "LABEL#n" token.
   *
   * @param {string} label
   * @param {string} rawValue
   * @returns {string} token
   */
  getOrCreateToken(label, rawValue) {
    if (typeof label !== "string" || !LABEL_RE.test(label)) {
      throw new TypeError(`TokenMap.getOrCreateToken: invalid label "${label}" (must match ${LABEL_RE})`);
    }
    if (typeof rawValue !== "string") {
      throw new TypeError("TokenMap.getOrCreateToken: rawValue must be a string");
    }
    const dedupeKey = `${label}::${normalizeForDedup(label, rawValue)}`;
    const existing = this.#dedupeKeyToToken.get(dedupeKey);
    if (existing !== undefined) return existing;

    const n = (this.#counts.get(label) || 0) + 1;
    this.#counts.set(label, n);
    const token = `${label}#${n}`;
    this.#tokenToValue.set(token, rawValue);
    this.#dedupeKeyToToken.set(dedupeKey, token);
    return token;
  }

  /** @returns {string|undefined} */
  get(token) {
    return this.#tokenToValue.get(token);
  }

  /** @returns {boolean} */
  has(token) {
    return this.#tokenToValue.has(token);
  }

  /** Number of distinct tokens minted so far. */
  get size() {
    return this.#tokenToValue.size;
  }

  // See the class doc comment above -- this is load-bearing, not
  // incidental. Every call throws; there is no "safe" JSON form.
  toJSON() {
    throw new TokenMapNotSerializableError();
  }
}

export function createTokenMap() {
  return new TokenMap();
}

// ---------------------------------------------------------------------------
// tokenize
// ---------------------------------------------------------------------------

/**
 * @param {string} text
 * @param {Array<object>} spans PiiSpan[] -- typically mergeSpans()'s output
 * @param {TokenMap} tokenMap
 * @returns {{ text: string, tokenMap: TokenMap, asked: Array<object> }}
 */
export function tokenize(text, spans, tokenMap) {
  if (typeof text !== "string") {
    throw new TypeError("tokenize(text, spans, tokenMap): text must be a string");
  }
  if (!(tokenMap instanceof TokenMap)) {
    throw new TypeError("tokenize(text, spans, tokenMap): tokenMap must come from createTokenMap()");
  }

  const ordered = Array.isArray(spans) ? spans.slice().sort((a, b) => a.start - b.start) : [];

  const asked = [];
  let out = "";
  let cursor = 0;

  for (const span of ordered) {
    // Defensive: if a caller hands tokenize() spans that were never run
    // through mergeSpans() and they DO overlap, don't let a
    // stale/already-consumed span corrupt the output -- skip it rather
    // than slicing backwards.
    if (span.start < cursor) continue;

    const band = classifyBand(span);
    if (band === "ignore") continue; // left untouched: the next emitted gap-copy naturally includes this span's raw text, since `cursor` was not advanced.

    out += text.slice(cursor, span.start);
    const rawValue = text.slice(span.start, span.end);
    const token = tokenMap.getOrCreateToken(span.label, rawValue);
    out += token;
    cursor = span.end;

    if (band === "ask") {
      // "ask"-band spans are tokenized (held, i.e. treated as strip for
      // the purposes of substitution) AND separately surfaced here so
      // the caller can prompt the user before the run proceeds.
      asked.push({ ...span });
    }
  }

  out += text.slice(cursor);
  return { text: out, tokenMap, asked };
}

// ---------------------------------------------------------------------------
// rehydrate
// ---------------------------------------------------------------------------

// A fresh RegExp literal per call (see below) rather than one shared
// module-level global regex: String.prototype.replace() DOES reset a
// global regex's lastIndex to 0 at the start of its own algorithm, so
// reusing one would technically be safe too -- but a fresh literal per
// call removes any doubt/shared-mutable-state review burden entirely,
// which matters here precisely because this is the function that decides
// whether a raw token-shaped substring is allowed to survive.
function tokenPatternGlobal() {
  return /[A-Z][A-Z0-9]*#[0-9]+/g;
}

// Exported so tests (and any caller that wants to sanity-check a string
// before calling rehydrate) can check "is this substring even
// token-shaped" without constructing their own copy of the grammar.
export const TOKEN_PATTERN = /^[A-Z][A-Z0-9]*#[0-9]+$/;

/**
 * Replace every token-shaped substring of `value` with its raw value
 * from `tokenMap`. Throws UnknownTokenError on the first token-shaped
 * substring that is not a key in `tokenMap` -- in that case NOTHING is
 * returned (the throw propagates out of String.prototype.replace before
 * it completes), so this function never returns a partially-rehydrated
 * string and never returns a string still containing an unresolved
 * token-shaped substring.
 *
 * @param {string} value
 * @param {TokenMap} tokenMap
 * @returns {string}
 */
export function rehydrate(value, tokenMap) {
  if (typeof value !== "string") {
    throw new TypeError("rehydrate(value, tokenMap): value must be a string");
  }
  if (!(tokenMap instanceof TokenMap)) {
    throw new TypeError("rehydrate(value, tokenMap): tokenMap must come from createTokenMap()");
  }
  return value.replace(tokenPatternGlobal(), (match) => {
    if (!tokenMap.has(match)) throw new UnknownTokenError(match);
    return tokenMap.get(match);
  });
}

// ---------------------------------------------------------------------------
// seedVault
//
// Profile vault values are pre-seeded into the TokenMap as PROFILE...#n
// tokens (C2: "so fill_profile becomes an ordinary `type` with a token
// value"). Deliberately a DIFFERENT token prefix family (PROFILENAME /
// PROFILEEMAIL / PROFILEPHONE) than what the regex/NER layers mint
// (EMAIL#n / PHONE#n / ...) for the same-shaped data -- a token's prefix
// is itself the provenance signal ("this came from the user's own saved
// profile, not from something detected on the page"), and collapsing the
// two families would make that provenance unrecoverable downstream.
//
// Profile shape per extension/lib/profile-vault.js's sanitizeProfile():
// { full_name: string, email: string, phone: string }, already trimmed,
// "" meaning "nothing saved" (profile-vault.js's own getProfileFieldValue
// treats "" identically to absent -- null, never a token). Mirrored here:
// no token is minted for an empty field.
// ---------------------------------------------------------------------------

const PROFILE_FIELD_TOKEN_LABEL = Object.freeze({
  full_name: "PROFILENAME",
  email: "PROFILEEMAIL",
  phone: "PROFILEPHONE",
});

/**
 * @param {TokenMap} tokenMap
 * @param {{full_name?:string, email?:string, phone?:string}|null|undefined} profile
 * @returns {{full_name: string|null, email: string|null, phone: string|null}}
 *   The token minted per field, or null when that field had nothing saved.
 */
export function seedVault(tokenMap, profile) {
  if (!(tokenMap instanceof TokenMap)) {
    throw new TypeError("seedVault(tokenMap, profile): tokenMap must come from createTokenMap()");
  }
  const out = { full_name: null, email: null, phone: null };
  if (!profile || typeof profile !== "object") return out;

  for (const field of Object.keys(PROFILE_FIELD_TOKEN_LABEL)) {
    const raw = typeof profile[field] === "string" ? profile[field].trim() : "";
    if (!raw) continue; // nothing saved for this field -- no token, matches profile-vault.js's null-for-empty contract
    out[field] = tokenMap.getOrCreateToken(PROFILE_FIELD_TOKEN_LABEL[field], raw);
  }
  return out;
}
