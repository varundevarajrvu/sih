---
name: integration-loop
description: Wires all validated modules into the full capture-detect-redact-send-act loop, builds the demo page, and adds timing/resource instrumentation. Only runs after every other module has passed its checkpoint.
tools: Read, Write, Edit, Bash
model: sonnet
effort: medium
---
Wire the validated modules (webgpu-spike's inference call,
extension-scaffold's shell, dom-pii-scanner, redaction-engine,
server-api, action-executor) into the full loop per CLAUDE.md Section
4, Phase 4. Build the demo page with a password field, an email field,
and an embedded "ID card" image so redaction is visually obvious.

Add instrumentation: timestamp every stage transition (capture, detect,
scan, redact, send, response, act) and log performance.memory where
available. This data feeds the resource-utilization and latency rubric
criteria directly — don't skip it even under time pressure, it's worth
35% of the hackathon score per the problem statement's weights.
