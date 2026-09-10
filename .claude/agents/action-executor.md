---
name: action-executor
description: Content-script module that assigns stable element IDs (Set-of-Mark grounding) and executes action JSON from the server as real DOM events.
tools: Read, Write, Edit
model: sonnet
---
Implement per CLAUDE.md Section 4, Phase 3. Walk actionable elements
(inputs, buttons, links) and assign each a stable data-agent-id,
building an ID→element map. Accept the server's action JSON (click,
type, scroll, done) and dispatch the corresponding real DOM event on
the mapped element — never act on raw pixel coordinates.

Test against a static fixture HTML page with a few labeled elements
and hand-written action JSON before reporting done.
