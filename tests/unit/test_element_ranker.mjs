// SIH 26171 -- Tier 2, element-ranker.js unit tests.
//
// Runs under plain Node, zero extra dependencies (no jsdom needed -- this
// module's input is already plain JSON, there is no HTML to parse).
//
// Run with: node --test tests/unit/test_element_ranker.mjs

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  rankElements,
  DEFAULT_MAX_ELEMENTS,
  DEFAULT_WEIGHTS,
  _internal,
} from "../../extension/lib/element-ranker.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.resolve(__dirname, "../fixtures");

function loadFixture(filename) {
  return JSON.parse(readFileSync(path.join(FIXTURES_DIR, filename), "utf8"));
}

function scoreFor(scores, agentId) {
  const entry = scores.find((s) => s.agentId === agentId);
  assert.ok(entry, `expected a scores entry for ${agentId}`);
  return entry.score;
}

function agentIds(nodes) {
  return nodes.map((n) => n.agentId);
}

// ---------------------------------------------------------------------------
// Basic input validation / determinism.
// ---------------------------------------------------------------------------
describe("input validation", () => {
  test("non-array domSnapshot throws TypeError", () => {
    assert.throws(() => rankElements({ not: "an array" }, "goal"), TypeError);
    assert.throws(() => rankElements(null, "goal"), TypeError);
    assert.throws(() => rankElements(undefined, "goal"), TypeError);
  });
});

describe("determinism -- same input always produces the same output", () => {
  test("large synthetic page ranked twice produces byte-identical results", () => {
    const fixture = loadFixture("element_ranker_large_synthetic_page.json");
    const first = rankElements(fixture.domSnapshot, fixture.taskGoal, { viewport: fixture.viewport });
    const second = rankElements(fixture.domSnapshot, fixture.taskGoal, { viewport: fixture.viewport });
    assert.deepEqual(first, second);
  });

  test("invalid options.maxElements (NaN/negative/non-number) falls back to DEFAULT_MAX_ELEMENTS deterministically", () => {
    const nodes = Array.from({ length: DEFAULT_MAX_ELEMENTS + 5 }, (_, i) => ({
      agentId: `agent-${i + 1}`,
      tag: "a",
      role: "link",
      type: null,
      text: `Link ${i}`,
      bbox: { x: 10, y: 10 + i * 25, w: 100, h: 20 },
      sensitive: false,
    }));
    const invalidValues = [NaN, -5, "forty", null, undefined, Infinity];
    const baseline = rankElements(nodes, "goal", { maxElements: DEFAULT_MAX_ELEMENTS });
    for (const bad of invalidValues) {
      const result = rankElements(nodes, "goal", { maxElements: bad });
      assert.equal(result.selected.length, DEFAULT_MAX_ELEMENTS, `maxElements=${bad} should fall back to the default`);
      assert.equal(result.dropped, baseline.dropped);
    }
  });
});

// ---------------------------------------------------------------------------
// Under-budget passthrough.
// ---------------------------------------------------------------------------
describe("under-budget passthrough (CLAUDE.md-style 'return it unchanged' requirement)", () => {
  test("a snapshot already under maxElements is returned unchanged, dropped=0, no scores computed", () => {
    const fixture = loadFixture("element_ranker_under_budget.json");
    const result = rankElements(fixture.domSnapshot, fixture.taskGoal, { maxElements: DEFAULT_MAX_ELEMENTS });
    assert.deepEqual(result.selected, fixture.domSnapshot);
    assert.equal(result.dropped, 0);
    assert.equal(result.scores, undefined);
  });

  test("default budget (no maxElements passed) also short-circuits for a 5-element snapshot", () => {
    const fixture = loadFixture("element_ranker_under_budget.json");
    const result = rankElements(fixture.domSnapshot, fixture.taskGoal);
    assert.deepEqual(result.selected, fixture.domSnapshot);
    assert.equal(result.dropped, 0);
  });
});

// ---------------------------------------------------------------------------
// THE critical safety test. Sensitive nodes must survive ranking no matter
// how low their score is or how tight the budget is -- they are load-bearing
// for server/schemas.py's find_pii_leaks() and action-executor.js's
// sensitive-target guard. See element-ranker.js's file-header rule and
// tests/fixtures/element_ranker_sensitive_survival.json's own comment for
// why the fixture is built the way it is.
// ---------------------------------------------------------------------------
describe("SAFETY: sensitive nodes always survive ranking (CRITICAL -- do not weaken this test)", () => {
  const fixture = loadFixture("element_ranker_sensitive_survival.json");
  const sensitiveIds = fixture.domSnapshot.filter((n) => n.sensitive).map((n) => n.agentId);
  const nonSensitiveIds = fixture.domSnapshot.filter((n) => !n.sensitive).map((n) => n.agentId);

  test("fixture sanity: exactly 3 sensitive nodes, 10 non-sensitive high scorers", () => {
    assert.equal(sensitiveIds.length, 3);
    assert.equal(nonSensitiveIds.length, 10);
  });

  test("the 3 sensitive nodes score at the ABSOLUTE BOTTOM of the whole set -- proves 'lowest possible score' isn't a hollow claim", () => {
    const result = rankElements(fixture.domSnapshot, fixture.taskGoal, { maxElements: 6 });
    assert.ok(result.scores, "scores should be reported when ranking actually ran");
    const sensitiveScores = sensitiveIds.map((id) => scoreFor(result.scores, id));
    const nonSensitiveScores = nonSensitiveIds.map((id) => scoreFor(result.scores, id));
    const worstNonSensitive = Math.min(...nonSensitiveScores);
    for (const s of sensitiveScores) {
      assert.ok(
        s < worstNonSensitive,
        `every sensitive node's score (${s}) must be lower than every non-sensitive node's score (worst non-sensitive: ${worstNonSensitive})`
      );
    }
  });

  for (const maxElements of [0, 1, 2, 3]) {
    test(`maxElements=${maxElements} (tighter than the sensitive-node count itself): all 3 sensitive nodes still selected, budget is overridden`, () => {
      const result = rankElements(fixture.domSnapshot, fixture.taskGoal, { maxElements });
      const selectedIds = new Set(agentIds(result.selected));
      for (const id of sensitiveIds) {
        assert.ok(selectedIds.has(id), `sensitive node ${id} must be in selected even at maxElements=${maxElements}`);
      }
      // No budget left for anything else -- selected is EXACTLY the 3
      // sensitive nodes, nothing more, and selected.length (3) exceeds
      // maxElements (${maxElements}) -- that overshoot is the point.
      assert.equal(result.selected.length, 3);
      assert.equal(result.dropped, fixture.domSnapshot.length - 3);
      for (const id of nonSensitiveIds) {
        assert.ok(!selectedIds.has(id), `non-sensitive node ${id} should have been dropped at maxElements=${maxElements}`);
      }
    });
  }

  test("maxElements=6 (room for sensitive + some candidates): all 3 sensitive + exactly 3 top-scoring non-sensitive candidates", () => {
    const result = rankElements(fixture.domSnapshot, fixture.taskGoal, { maxElements: 6 });
    const selectedIds = new Set(agentIds(result.selected));
    for (const id of sensitiveIds) assert.ok(selectedIds.has(id));
    assert.equal(result.selected.length, 6);
    assert.equal(result.dropped, fixture.domSnapshot.length - 6);
    const selectedNonSensitive = agentIds(result.selected).filter((id) => nonSensitiveIds.includes(id));
    assert.equal(selectedNonSensitive.length, 3);
  });

  test("sensitive nodes are still SCORED (for observability/logging) even though the score never decides their inclusion", () => {
    const result = rankElements(fixture.domSnapshot, fixture.taskGoal, { maxElements: 6 });
    for (const id of sensitiveIds) {
      const entry = result.scores.find((s) => s.agentId === id);
      assert.equal(typeof entry.score, "number");
      assert.equal(entry.sensitive, true);
      assert.equal(entry.kept, true);
    }
  });
});

// ---------------------------------------------------------------------------
// Task-relevance / signal-isolation test -- hand-computed fixture where
// near-identical node pairs differ in exactly one scoring dimension. See
// the fixture's own "_comment" and this repo's report for the worked math.
// ---------------------------------------------------------------------------
describe("scoring signals move the ranking the way the weighting comments claim", () => {
  const fixture = loadFixture("element_ranker_task_relevance.json");

  test("kind: input beats an otherwise-identical link (agent-1 vs agent-2)", () => {
    const result = rankElements(fixture.domSnapshot, fixture.taskGoal, { viewport: fixture.viewport, maxElements: 5 });
    assert.ok(scoreFor(result.scores, "agent-1") > scoreFor(result.scores, "agent-2"));
  });

  test("viewport: an on-screen node beats an otherwise-identical off-screen node (agent-1 vs agent-6)", () => {
    const result = rankElements(fixture.domSnapshot, fixture.taskGoal, { viewport: fixture.viewport, maxElements: 5 });
    assert.ok(scoreFor(result.scores, "agent-1") > scoreFor(result.scores, "agent-6"));
  });

  test("size: a normal-sized node beats an otherwise-identical 2x2px node (agent-1 vs agent-7)", () => {
    const result = rankElements(fixture.domSnapshot, fixture.taskGoal, { viewport: fixture.viewport, maxElements: 5 });
    assert.ok(scoreFor(result.scores, "agent-1") > scoreFor(result.scores, "agent-7"));
  });

  test("proximity: a node near a high-scoring anchor beats an otherwise-identical node far from everything (agent-8 vs agent-9)", () => {
    const result = rankElements(fixture.domSnapshot, fixture.taskGoal, { viewport: fixture.viewport, maxElements: 5 });
    assert.ok(scoreFor(result.scores, "agent-8") > scoreFor(result.scores, "agent-9"));
  });

  test("top-5 selection at maxElements=5 matches the hand-computed top scorers", () => {
    const result = rankElements(fixture.domSnapshot, fixture.taskGoal, { viewport: fixture.viewport, maxElements: 5 });
    assert.equal(result.selected.length, 5);
    assert.equal(result.dropped, 5);
    const selectedSet = new Set(agentIds(result.selected));
    assert.deepEqual(selectedSet, new Set(["agent-1", "agent-7", "agent-8", "agent-2", "agent-6"]));
  });

  test("scores are sorted descending", () => {
    const result = rankElements(fixture.domSnapshot, fixture.taskGoal, { viewport: fixture.viewport, maxElements: 5 });
    for (let i = 1; i < result.scores.length; i++) {
      assert.ok(result.scores[i - 1].score >= result.scores[i].score);
    }
  });
});

// ---------------------------------------------------------------------------
// Large-scale ("real site") behaviour: default budget, dropped-count
// reporting, and that genuinely relevant elements survive heavy noise even
// when one of them is off-screen.
// ---------------------------------------------------------------------------
describe("large synthetic page (150 elements, real-site scale)", () => {
  const fixture = loadFixture("element_ranker_large_synthetic_page.json");

  test("default budget caps selection at DEFAULT_MAX_ELEMENTS and reports the correct dropped count", () => {
    const result = rankElements(fixture.domSnapshot, fixture.taskGoal, { viewport: fixture.viewport });
    assert.equal(result.selected.length, DEFAULT_MAX_ELEMENTS);
    assert.equal(result.dropped, fixture.domSnapshot.length - DEFAULT_MAX_ELEMENTS);
  });

  test("all 6 deliberately task-relevant nodes survive, including the off-screen-but-relevant one, despite 144 noise nodes competing for the same 40-slot budget", () => {
    const result = rankElements(fixture.domSnapshot, fixture.taskGoal, { viewport: fixture.viewport });
    const selectedIds = new Set(agentIds(result.selected));
    for (const id of ["agent-1", "agent-2", "agent-3", "agent-4", "agent-5", "agent-6"]) {
      assert.ok(selectedIds.has(id), `relevant node ${id} should have survived ranking`);
    }
  });

  test("a handful of generic, irrelevant, deep-in-the-page noise links are dropped", () => {
    const result = rankElements(fixture.domSnapshot, fixture.taskGoal, { viewport: fixture.viewport });
    const selectedIds = new Set(agentIds(result.selected));
    // agent-150 is the last generated noise node, far down the page with
    // generic unrelated text -- should not survive a 40-of-150 cut.
    assert.ok(!selectedIds.has("agent-150"));
  });
});

// ---------------------------------------------------------------------------
// Default-budget interplay with sensitive nodes at realistic (not
// floor-engineered) scores -- complements the dedicated safety-override
// test above by proving the guarantee holds under DEFAULT_MAX_ELEMENTS too,
// not only under contrived tiny budgets.
// ---------------------------------------------------------------------------
describe("mixed default budget (60 elements, 5 realistic sensitive nodes)", () => {
  const fixture = loadFixture("element_ranker_mixed_default_budget.json");

  test("default budget still includes every sensitive node", () => {
    const result = rankElements(fixture.domSnapshot, fixture.taskGoal, {
      viewport: fixture.viewport,
      maxElements: DEFAULT_MAX_ELEMENTS,
    });
    assert.equal(result.selected.length, DEFAULT_MAX_ELEMENTS);
    assert.equal(result.dropped, fixture.domSnapshot.length - DEFAULT_MAX_ELEMENTS);
    const selectedIds = new Set(agentIds(result.selected));
    for (const id of ["agent-1", "agent-2", "agent-3", "agent-4", "agent-5"]) {
      assert.ok(selectedIds.has(id), `sensitive node ${id} must survive the default-budget cut`);
    }
  });
});

// ---------------------------------------------------------------------------
// Component score functions in isolation (_internal export).
// ---------------------------------------------------------------------------
describe("_internal.textRelevanceScore", () => {
  test("empty goalTermSet returns the neutral score, not zero", () => {
    const score = _internal.textRelevanceScore({ text: "anything" }, new Set());
    assert.equal(score, 0.5);
  });
  test("exact term match scores 1.0", () => {
    const score = _internal.textRelevanceScore({ text: "Email Address" }, new Set(["email"]));
    assert.equal(score, 1.0);
  });
  test("no overlap at all scores 0", () => {
    const score = _internal.textRelevanceScore({ text: "Full Name" }, new Set(["email"]));
    assert.equal(score, 0);
  });
  test("substring near-miss gets partial (not full) credit", () => {
    const score = _internal.textRelevanceScore({ text: "passwords reset" }, new Set(["password"]));
    assert.ok(score > 0 && score < 1);
  });
});

describe("_internal.elementKindScore", () => {
  test("input/textarea/select/button all score 1.0", () => {
    for (const tag of ["input", "textarea", "select", "button"]) {
      assert.equal(_internal.elementKindScore({ tag }), 1.0);
    }
  });
  test("a high-value ARIA role scores 0.9", () => {
    assert.equal(_internal.elementKindScore({ tag: "div", role: "checkbox" }), 0.9);
  });
  test("a plain link scores 0.5", () => {
    assert.equal(_internal.elementKindScore({ tag: "a" }), 0.5);
  });
  test("a generic actionable div (no role) scores the low-value floor", () => {
    assert.equal(_internal.elementKindScore({ tag: "div" }), 0.35);
  });
});

describe("_internal.viewportScore", () => {
  const viewport = { width: 1280, height: 800 };
  test("missing bbox returns the neutral score", () => {
    assert.equal(_internal.viewportScore({}, viewport), 0.4);
  });
  test("zero-area (collapsed) bbox scores near the floor", () => {
    assert.equal(_internal.viewportScore({ bbox: { x: 10, y: 10, w: 0, h: 0 } }, viewport), 0.05);
  });
  test("fully off-screen bbox scores low but not zero", () => {
    assert.equal(_internal.viewportScore({ bbox: { x: 10, y: 5000, w: 100, h: 20 } }, viewport), 0.1);
  });
  test("fully on-screen bbox scores the max", () => {
    assert.equal(_internal.viewportScore({ bbox: { x: 10, y: 10, w: 100, h: 20 } }, viewport), 1.0);
  });
  test("partially on-screen bbox scores strictly between the off-screen floor and the max", () => {
    const score = _internal.viewportScore({ bbox: { x: 10, y: 780, w: 100, h: 100 } }, viewport);
    assert.ok(score > 0.1 && score < 1.0);
  });
});

describe("_internal.sizeScore", () => {
  test("missing bbox returns the neutral score", () => {
    assert.equal(_internal.sizeScore({}), 0.5);
  });
  test("zero-area bbox scores exactly 0", () => {
    assert.equal(_internal.sizeScore({ bbox: { x: 0, y: 0, w: 0, h: 5 } }), 0);
  });
  test("a typical-sized element scores at/near the max", () => {
    const score = _internal.sizeScore({ bbox: { x: 0, y: 0, w: 160, h: 40 } });
    assert.ok(score >= 0.99);
  });
  test("a 2x2px element scores near zero", () => {
    const score = _internal.sizeScore({ bbox: { x: 0, y: 0, w: 2, h: 2 } });
    assert.ok(score < 0.05);
  });
});

describe("_internal.tokenize", () => {
  test("filters stopwords and single-character tokens", () => {
    assert.deepEqual(_internal.tokenize("Fill in the email field please"), ["email"]);
  });
  test("empty/falsy input returns an empty array", () => {
    assert.deepEqual(_internal.tokenize(""), []);
    assert.deepEqual(_internal.tokenize(null), []);
    assert.deepEqual(_internal.tokenize(undefined), []);
  });
});

// ---------------------------------------------------------------------------
// Weight sanity -- documents the shape callers can rely on (sums to 1.0),
// guards against an accidental edit silently changing the balance.
// ---------------------------------------------------------------------------
describe("DEFAULT_WEIGHTS", () => {
  test("weights sum to 1.0", () => {
    const sum = Object.values(DEFAULT_WEIGHTS).reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - 1.0) < 1e-9);
  });
  test("text has the largest single weight, per the file's justification comment", () => {
    const max = Math.max(...Object.values(DEFAULT_WEIGHTS));
    assert.equal(DEFAULT_WEIGHTS.text, max);
  });
});
