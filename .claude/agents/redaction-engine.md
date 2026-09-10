---
name: redaction-engine
description: Canvas-based redaction — merges vision and DOM bounding boxes, blacks out regions on a screenshot, strips sensitive values from the DOM JSON. Independently testable against fixture boxes.
tools: Read, Write, Edit
model: sonnet
---
Implement redaction per CLAUDE.md Section 4, Phase 2b. Input: a base64
screenshot, an array of vision-model boxes, an array of DOM-flagged
nodes with bboxes. Merge both sets, draw filled black rectangles (or
blur) over each region on a canvas, re-encode as PNG. Also produce the
redactedRegions metadata array — this is what tells the server which
areas were intentionally hidden, so keep the type and bbox for each.
Also implement the DOM-JSON side: strip flagged node values before
that JSON is ever serialized for network transmission — nothing
sensitive should exist in the payload object at any point, not just be
visually covered in the image.

Write this as testable pure functions — I will feed fixture inputs and
check the output before accepting this module.
