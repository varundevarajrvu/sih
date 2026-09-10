---
name: server-api
description: FastAPI /analyze endpoint with Pydantic schemas and Ollama VLM integration. Fully independent of the extension — build and test against a hand-written fixture payload.
tools: Read, Write, Edit, Bash
model: sonnet
---
Build the FastAPI server per CLAUDE.md Section 4, Phase 2c. One
/analyze endpoint accepting the request schema (image, domSnapshot,
redactedRegions, taskGoal), calling Ollama's qwen2.5vl:7b, and
returning the action schema (action, targetId, value). Critically:
the prompt to the VLM must explicitly state that regions listed in
redactedRegions are intentionally hidden for privacy and must not be
guessed at — use the DOM snapshot's type/role info for those areas
instead.

This module has no dependency on the extension code at all. Build it
standalone, and validate it yourself with curl against a hand-written
fixture payload before reporting done — don't wait for the extension
to exist to know if this works.
