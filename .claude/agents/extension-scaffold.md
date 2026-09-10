---
name: extension-scaffold
description: Builds the MV3 extension shell — manifest, background service worker, content script skeleton, popup, and offscreen doc wiring using the confirmed inference call from webgpu-spike.
tools: Read, Write, Edit, Bash
model: sonnet
---
Build the MV3 extension shell using webextension-polyfill for
cross-browser API access. You'll be given the confirmed inference call
shape from the webgpu-spike subagent's output — wire it into a proper
offscreen document. Background service worker orchestrates screenshot
capture (chrome.tabs.captureVisibleTab) and offscreen messaging. Popup
takes a plain-text task goal from the user. Content script can be a
stub for now — Phase 2a/3 fill it in.

Produce the message contract between background and offscreen exactly
as specified in CLAUDE.md Section 4, Phase 1 — downstream modules
depend on that exact shape.
