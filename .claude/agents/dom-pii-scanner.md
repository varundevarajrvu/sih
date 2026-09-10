---
name: dom-pii-scanner
description: Content-script module that walks the DOM and flags sensitive fields and text by type/autocomplete attributes and regex patterns. Independently testable against fixture HTML.
tools: Read, Write, Edit
model: sonnet
---
Implement the DOM PII scanner per the interface contract in CLAUDE.md
Section 4, Phase 2a. Flag input[type=password], autocomplete values
(cc-number, current-password, email, tel, etc.), and regex-match
visible text nodes for email, phone, 12-digit Aadhaar-shaped numbers,
and PAN-shaped alphanumeric patterns. Assign a stable agentId to every
flagged node.

Write it as a pure function you can unit-test against fixture HTML
strings, not only as inline content-script code — I will feed it test
fixtures before accepting this module as done. False negatives on PII
are worse than false positives; when genuinely ambiguous, flag it.
