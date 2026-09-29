"""
Swappable VLM client behind one interface.

Four implementations:
  - MockVLMClient:   deterministic, no network, no model. DEFAULT backend —
                      used by all tests and every current runtime path
                      unless VLM_BACKEND is set otherwise.
  - OllamaVLMClient:  real integration targeting qwen2.5vl:7b via raw HTTP
                      (no official Ollama SDK exists, so httpx is the
                      correct pattern there). Written but NOT executed
                      anywhere in this module's test suite — no vision
                      model is installed on the dev machine.
  - ClaudeVLMClient:  real integration targeting a cloud Claude model via
                      the OFFICIAL `anthropic` Python SDK (an SDK exists
                      here, so — unlike Ollama — raw httpx would be the
                      WRONG pattern). Chief's decision: swap the
                      mock/Ollama dev path for a cloud model for the
                      finale, since this machine's ~3.7GB free RAM can't
                      run a 7B local VLM. Written but NOT executed against
                      a live API — no ANTHROPIC_API_KEY is configured on
                      this machine; validated entirely with a stubbed/
                      injected fake client (tests/unit/test_claude_vlm_client.py).
  - GeminiVLMClient:  real integration targeting a cloud Gemini model via
                      the OFFICIAL `google-genai` SDK (imported as
                      `from google import genai` — NOT the deprecated
                      `google-generativeai` package, and NOT raw HTTP).
                      Chief's second decision: add a FREE backend, since
                      the Anthropic API is pay-as-you-go and a hackathon
                      demo shouldn't need a paid key. Written but NOT
                      executed against a live API — no GEMINI_API_KEY /
                      GOOGLE_API_KEY is configured on this machine;
                      validated entirely with a stubbed/injected fake
                      client (tests/unit/test_gemini_vlm_client.py). Its
                      request/response shapes and exception hierarchy are
                      genuinely different from Claude's SDK, verified
                      independently against the installed package source
                      rather than assumed to mirror it — see the class
                      docstring below for the specific differences found.

Selection is via the VLM_BACKEND env var (defaults to "mock") through
get_vlm_client(). The interface (VLMClient.analyze) never mentions Ollama,
Claude, Gemini, or any other backend in its signature or docstring
contract — Section 4 requires this be swappable between backends without
touching main.py, and two swaps have now happened (mock -> Claude,
mock -> Gemini) with zero main.py changes either time.
"""

from __future__ import annotations

import base64
import json
import os
import re
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any

from schemas import PAGE_TARGET_ID, ActionType, DomNode, PressKey, ProfileField, RedactedRegion
from schemas_v2 import (
    PAGE_TARGET_ID_V2,
    ActionTypeV2,
    ElementV2,
    HistoryEntry,
    PressKeyV2,
    ProfileFieldV2,
    RegionV2,
    SceneMode,
    VaultEntry,
)


# ---------------------------------------------------------------------------
# Prompt construction — the one thing the whole problem statement hinges on.
# ---------------------------------------------------------------------------


def build_prompt(task_goal: str, dom_snapshot: list[DomNode], redacted_regions: list[RedactedRegion]) -> str:
    """Construct the text prompt sent to the VLM alongside the (already
    redacted) screenshot.

    Hard requirement (CLAUDE.md Section 4 Phase 2c, Section 5): the prompt
    must EXPLICITLY tell the VLM that every region in `redacted_regions`
    is intentionally hidden for privacy, that it must not guess or
    speculate about what's under it, and that it should fall back to the
    DOM snapshot's type/role metadata for those areas instead.

    Kept as its own pure function (no network, no client instance) so it
    is directly unit-testable: every redacted region's identifying info
    must be a literal substring of the returned prompt text.
    """
    lines: list[str] = []

    lines.append(
        "You are a browser automation agent. You are given a screenshot of the "
        "current page and a structured snapshot of its DOM elements. Decide the "
        "single next action needed to accomplish the task goal below."
    )
    lines.append("")
    lines.append(f"TASK GOAL: {task_goal}")
    lines.append("")

    if redacted_regions:
        lines.append(
            "PRIVACY NOTICE — READ CAREFULLY: The regions listed below have been "
            "intentionally blacked out / blurred in the screenshot you are given, "
            "for user privacy. This is deliberate redaction, not a rendering error "
            "or missing content. You MUST NOT guess, infer, speculate about, or "
            "attempt to reconstruct what text, numbers, or images were under any "
            "of these regions. Do not describe their hidden contents in any form. "
            "For any of these regions, rely ONLY on the corresponding node's "
            "`type`/`role` metadata in the DOM SNAPSHOT section below to decide "
            "what kind of action is appropriate (e.g. a redacted region whose DOM "
            "node has type='password' is a password field you may target for a "
            "'type' action, but you must never guess or state its value or the "
            "value of any other redacted field)."
        )
        lines.append("")
        lines.append(f"REDACTED REGIONS ({len(redacted_regions)} total, do not guess their contents):")
        for region in redacted_regions:
            # region.type is a PiiType enum member; .value gives the plain
            # string ("password", not "PiiType.PASSWORD" — Python's (str,
            # Enum) mixin does NOT give you the plain value under str()/
            # f-string formatting, verified against this project's Python
            # 3.14 interpreter).
            agent_id_part = f", agentId={region.agentId}" if region.agentId else ""
            raw_type_part = f" (rawType={region.rawType})" if region.rawType else ""
            lines.append(
                f"  - type={region.type.value}{raw_type_part}{agent_id_part}, "
                f"bbox=(x={region.bbox.x}, y={region.bbox.y}, w={region.bbox.w}, h={region.bbox.h})"
            )
        lines.append("")
    else:
        lines.append("No regions were redacted in this screenshot.")
        lines.append("")

    lines.append(f"DOM SNAPSHOT ({len(dom_snapshot)} nodes):")
    if dom_snapshot:
        for node in dom_snapshot:
            role_part = f", role={node.role}" if node.role else ""
            type_part = f", type={node.type}" if node.type else ""
            text_part = f", text={node.text!r}" if node.text else ""
            sensitive_part = ", sensitive=true" if node.sensitive else ""
            lines.append(
                f"  - agentId={node.agentId}, tag={node.tag}{role_part}{type_part}"
                f"{text_part}{sensitive_part}"
            )
    else:
        lines.append("  (empty)")
    lines.append("")

    lines.append(
        "PROFILE AUTOFILL — READ CAREFULLY: If a field plainly wants the user's "
        "own full name, email address, or phone number (for example: an empty "
        "field of type 'email' or 'tel', or a field whose visible label/"
        "placeholder says something like \"Full Name\"), respond with "
        "action='fill_profile' and set `profileField` to whichever category "
        "matches — \"full_name\", \"email\", or \"phone\" — instead of using "
        "'type' for it. You are never shown the user's actual profile data and "
        "you MUST NOT guess, invent, or reconstruct a value for a fill_profile "
        "action: `value` MUST be null whenever action is 'fill_profile'. The "
        "extension fills in the real value itself, locally, from the user's own "
        "device, after you return only the category name — you never see it and "
        "never supply it. A fill_profile action that includes a non-null value "
        "will be rejected outright, not silently corrected."
    )
    lines.append("")

    lines.append(
        "KEYBOARD: use action='press_key' with `key` set when the page needs a "
        "keystroke rather than a click — a search box that commits on Enter with "
        "no visible submit button, a modal or autocomplete list that closes on "
        "Escape, or a dropdown navigated with ArrowDown/ArrowUp. Allowed keys are "
        "exactly: " + ", ".join(k.value for k in PressKey) + ". `key` must be set "
        "ONLY for 'press_key' and must be null for every other action. To enter "
        "text use 'type', never a sequence of key presses."
    )
    lines.append("")

    lines.append(
        "Respond with ONLY a single JSON object, no prose, no markdown fences, "
        'matching exactly this shape: {"action": "click"|"type"|"scroll"|"done"'
        '|"fill_profile"|"press_key", "targetId": "<agentId from the DOM snapshot '
        'above>", "value": "<string or null>", "profileField": "full_name"|"email"|'
        '"phone"|null, "key": "Enter"|"Escape"|"Tab"|null}. '
        "Use 'type' only for text-entry actions and include the text to type in "
        "`value` (never a guessed/redacted value). Use 'fill_profile' (see the "
        "PROFILE AUTOFILL instruction above) instead of 'type' when a field "
        "plainly wants the user's own name/email/phone — for that action `value` "
        "must be null and `profileField` must be set; for every OTHER action, "
        "`profileField` must be null or omitted. `targetId` is always required, even "
        f"for 'scroll' or 'done' — if the action does not target a specific element, use "
        f'the exact string "{PAGE_TARGET_ID}" as targetId. Use \'done\' once the task '
        "goal is complete."
    )

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# v2 prompt construction (docs/v2/ARCHITECTURE.md contract C5). Alongside
# build_prompt() above, NOT a replacement -- v1's /analyze is untouched and
# keeps using build_prompt() exactly as before.
# ---------------------------------------------------------------------------


def build_prompt_v2(
    mode: SceneMode,
    task_goal: str,
    elements: list[ElementV2],
    regions: list[RegionV2],
    history: list[HistoryEntry],
    vault: list[VaultEntry] | None = None,
) -> str:
    """Construct the v2 text prompt. Hard requirements (C5 + this agent's
    brief item 4):
      - the model must understand that values appear as opaque tokens like
        `EMAIL#1` / `PERSONNAME#2`, must echo tokens VERBATIM when it wants
        to use that value, and must NEVER invent, guess, or reconstruct a
        raw value for a token or a redacted region;
      - every redacted region is intentionally hidden and must not be
        guessed at;
      - the model may answer `need_visual` (at most once per step -- the
        step boundary is enforced by the extension/loop, not by this
        single-call prompt) when it cannot decide the next action from
        structure (elements/regions) alone and mode is currently "semantic".

    Pure function, no network/client instance -- directly unit-testable,
    same posture as build_prompt().
    """
    lines: list[str] = []

    lines.append(
        "You are a privacy-preserving browser automation agent operating on a "
        "TOKENIZED, STRUCTURED representation of a web page (schema "
        "dhristi-scene-v2), not raw page content. Decide the single next "
        "action needed to accomplish the task goal below."
    )
    lines.append("")
    lines.append(f"MODE: {mode.value}")
    lines.append(f"TASK GOAL: {task_goal}")
    lines.append("")

    lines.append(
        "TOKENS -- READ CAREFULLY: any sensitive value (an email, a name, an "
        "account number, a password, ...) that would otherwise appear in "
        "this prompt has been replaced by an opaque token of the exact "
        "shape `EMAIL#1`, `PERSONNAME#2`, `PROFILEEMAIL#1`, etc. (one or "
        "more uppercase letters/digits, then '#', then digits). A token is "
        "NOT a value -- it is a reference to one. If you need to use that "
        "value (for example, typing a previously-seen email into a new "
        "field), you MUST copy the token STRING VERBATIM into `value` "
        "(e.g. value=\"EMAIL#1\"). You MUST NEVER invent, guess, decode, or "
        "reconstruct what a token or a redacted region actually contains, "
        "and you MUST NEVER produce a value that looks like a real email, "
        "phone number, card number, or similar directly -- only tokens or "
        "plain non-sensitive text belong in `value`."
    )
    lines.append("")

    lines.append(
        "SENSITIVE ELEMENTS: any element marked sensitive=true requires the "
        "user's live, explicit approval before your action on it executes -- "
        "targeting one is slow and often refused. Only target a sensitive "
        "element when the task goal specifically requires filling THAT "
        "element (e.g. the goal is literally about a password/email field). "
        "Never target a sensitive element as a fallback just because no "
        "other element seems to fit -- check HISTORY first: if the value "
        "the goal asked for has already been entered successfully, do not "
        "re-enter it elsewhere. Prefer a non-sensitive continue/submit/next "
        "control, or reply action='done' if nothing else is left to do."
    )
    lines.append("")

    if regions:
        lines.append(
            "PRIVACY NOTICE: the regions listed below are intentionally "
            "hidden/redacted for user privacy (in image mode they are "
            "blacked out in the screenshot; in semantic mode no pixels are "
            "sent at all). Do not guess, infer, or describe their hidden "
            "contents. Use the corresponding element's `type`/`role`/`tier` "
            "to decide what kind of action is appropriate."
        )
        lines.append(f"REGIONS ({len(regions)} total):")
        for region in regions:
            lines.append(
                f"  - kind={region.kind.value}, source={region.source.value}, "
                f"bbox=(x={region.bbox.x}, y={region.bbox.y}, w={region.bbox.w}, h={region.bbox.h})"
            )
        lines.append("")
    else:
        lines.append("No regions were redacted in this scene.")
        lines.append("")

    lines.append(f"ELEMENTS ({len(elements)} total):")
    if elements:
        for el in elements:
            role_part = f", role={el.role}" if el.role else ""
            type_part = f", type={el.type}" if el.type else ""
            label_part = f", label={el.label!r}" if el.label else ""
            tier_part = f", tier={el.tier.value}" if el.tier else ""
            sensitive_part = ", sensitive=true" if el.sensitive else ""
            lines.append(
                f"  - agentId={el.agentId}, tag={el.tag}{role_part}{type_part}"
                f"{label_part}{tier_part}{sensitive_part}"
            )
    else:
        lines.append("  (empty)")
    lines.append("")

    lines.append(f"HISTORY ({len(history)} prior step(s), most-recent-last):")
    if history:
        for h in history:
            lines.append(
                f"  - action={h.action.action.value}, targetId={h.action.targetId}, "
                f"outcome={h.outcome}"
            )
    else:
        lines.append("  (empty)")
    lines.append("")

    if mode == SceneMode.SEMANTIC:
        lines.append(
            "NEED_VISUAL: if, and only if, you genuinely cannot decide the "
            "next action from the ELEMENTS/REGIONS structure above alone "
            "(for example: several visually-distinct but structurally "
            "similar candidates), respond with action='need_visual' and "
            "targetId=\"" + PAGE_TARGET_ID_V2 + "\". You may do this AT MOST "
            "ONCE per step -- if you have already been given the image for "
            "this step, do not ask again; make your best decision from what "
            "you have."
        )
        lines.append("")

    # C5/C2 amendment (2026-09-26): the vault -- tokens + categories, never
    # values (VaultEntry's own docstring) -- announced here so a REAL
    # planner can legitimately reference a PROFILEEMAIL#1/PROFILENAME#1/
    # PROFILEPHONE#1 token it could otherwise never have learned exists
    # (before this, the only way to fill a saved detail was `fill_profile`,
    # which V3 already removed from the local planner's own model-facing
    # action schema -- leaving no way at all for that planner to use saved
    # details, and any OTHER planner that guessed a PROFILE token shape hit
    # a hard UNKNOWN_TOKEN rejection). This is the PREFERRED mechanism now;
    # the fill_profile paragraph below is kept for the OLDER mechanism,
    # which the wire still accepts (schemas_v2 ActionTypeV2 is unchanged).
    if vault:
        lines.append(
            "SAVED DETAILS (vault): the user has these saved details available, named ONLY by "
            "token and category below -- you are never shown the actual value. To fill one of "
            "these into a matching field, respond with action='type' and set `value` to the "
            "EXACT token string listed (copy it verbatim -- never invent or guess a token not "
            "listed here, even if it looks like the right shape)."
        )
        for entry in vault:
            lines.append(f"  - token={entry.token}, category={entry.field.value}")
        lines.append("")

    lines.append(
        "PROFILE AUTOFILL (older mechanism, still accepted): if a field plainly wants the "
        "user's own full name, email, or phone and no matching vault token above already "
        "covers it, you MAY respond with action='fill_profile' and set `profileField` to "
        "\"full_name\", \"email\", or \"phone\". You are never shown the actual profile value: "
        "`value` MUST be null whenever action is 'fill_profile'."
    )
    lines.append("")

    lines.append(
        "KEYBOARD: use action='press_key' with `key` set for a keystroke "
        "rather than a click (Enter to submit a search box with no visible "
        "button, Escape to close a modal, ArrowDown/ArrowUp for a dropdown). "
        "`key` must be null for every other action."
    )
    lines.append("")

    lines.append(
        "Respond with ONLY a single JSON object, no prose, no markdown "
        'fences, matching exactly this shape: {"action": '
        '"click"|"type"|"scroll"|"press_key"|"done"|"need_visual"|'
        '"fill_profile", "targetId": "<agentId from ELEMENTS above, or '
        f'\\"{PAGE_TARGET_ID_V2}\\" if the action targets no specific element>", '
        '"value": "<token, plain non-sensitive text, or null>", '
        '"profileField": "full_name"|"email"|"phone"|null, '
        '"key": "Enter"|"Escape"|"Tab"|null}. Use \'done\' once the task '
        "goal is complete. Do not include `revision` or `serverVerdict` in "
        "your response -- the server computes both."
    )

    return "\n".join(lines)


# ---------------------------------------------------------------------------
# V3 (planner-local) — a CONCISE v2 prompt for small local text models
# (qwen2.5:1.5b/3b/8b via Ollama), used ONLY by OllamaVLMClient.analyze_v2()
# below. build_prompt_v2() above is UNTOUCHED and stays the shared prompt
# every other backend (mock, observe, Claude, Gemini) keeps using — trimming
# this one touches no other backend's behaviour or tests.
#
# Built from VLMRequestContextV2's own structured fields, not
# context.prompt (which main.py already built via build_prompt_v2() for
# every backend uniformly, before the backend is even selected — that call
# is simply unused by this backend). Brief requirement: "keep
# build_prompt_v2's privacy statements verbatim IN SUBSTANCE" — the
# wording is shorter, the RULES are not: token verbatim-echo, never guess
# a redacted region's contents, press_key's key-only-for-press_key shape,
# and JSON-only output are all still stated explicitly below.
#
# RETRY 1 (CLAUDE.md §7, coordinator's read of benchmarks/results/v3-planner.json):
#   (a) fill_profile REMOVED from the model-facing v2 action list and from
#       this prompt entirely. Per C2, fill_profile is subsumed by
#       PROFILE...#n vault tokens in v2 — it stays on the wire
#       (schemas_v2.ActionTypeV2 / ModelActionV2 still structurally accept
#       it) for back-compat only; the LOCAL PLANNER is no longer told it
#       exists. A field that wants the user's own name/email/phone now
#       just carries a PROFILE...#n token in its own context (goal or
#       label) like any other token — the generic TOKENS rule below
#       already covers copying it verbatim.
#   (b) Each element now renders its ALLOWED action(s) (`allowedActions=
#       [type]` / `[click]`) so the model isn't guessing click-vs-type
#       from tag alone, plus two short few-shot examples (one type, one
#       click) right before the output-format instruction.
#   (c) The per-request, constrained JSON Schema (`targetId` enum'd to
#       THIS scene's agentIds + page, `action` enum'd to the trimmed
#       model-facing set) is built by _build_ollama_action_schema() below
#       and lives in OllamaVLMClient.analyze_v2, not here — this function
#       only emits the prompt text.
#
# C5/C2 AMENDMENT (2026-09-26) — CORRECTION TO ITEM (a) ABOVE: "a field
# that wants the user's own name/email/phone now just carries a
# PROFILE...#n token in its own context (goal or label) like any other
# token" was WRONG. seedVault() mints PROFILE...#n tokens straight into
# the run's TokenMap — never into taskGoal or any element label — so
# there was in fact no text anywhere in this prompt the local planner
# could ever have read that token from. It could only ever guess a
# PROFILE-shaped token and be UNKNOWN_TOKEN-rejected. See the new
# "SAVED (vault, ...)" line below, which is the actual fix: the vault is
# now announced explicitly, by name, rather than assumed reachable
# through the generic TOKENS rule.
# ---------------------------------------------------------------------------


def _element_allowed_actions(el: "ElementV2") -> list[str]:
    """V3 retry item (b): the action(s) this element structurally supports,
    so the model is told rather than left to infer click-vs-type from tag
    alone (llama3.1:8b's observed failure mode: right target+value, wrong
    verb). Judgment calls, stated rather than hidden:
      - text-like inputs (text/email/tel/search/password/number/url),
        textarea, or role=textbox -> type only.
      - checkbox/radio/submit/button inputs, <button>, <a>, <select> ->
        click only (v2's action surface has no dedicated "select option"
        action yet, so a dropdown is best modelled as a click target).
      - anything unrecognised -> both, permissive rather than silently
        excluding a real target.
    """
    tag = (el.tag or "").lower()
    el_type = (el.type or "").lower()
    role = (el.role or "").lower()

    text_like_types = {
        "text", "email", "tel", "search", "password", "number", "url", "",
    }
    click_only_types = {"checkbox", "radio", "submit", "button", "image", "reset"}

    if tag == "textarea" or (tag == "input" and el_type in text_like_types) or role == "textbox":
        return ["type"]
    if tag == "input" and el_type in click_only_types:
        return ["click"]
    if tag in {"button", "a", "select"}:
        return ["click"]
    return ["click", "type"]


def build_prompt_v2_concise(context: "VLMRequestContextV2") -> str:
    lines: list[str] = []
    lines.append(
        "You are a privacy-preserving browser agent. The page is given as "
        "STRUCTURE only (elements/regions), not raw content. Pick ONE next "
        "action for the task goal."
    )
    lines.append(f"MODE: {context.mode.value}")
    lines.append(f"GOAL: {context.task_goal}")
    lines.append(
        "TOKENS: any sensitive value — including the user's OWN saved "
        "profile info (name/email/phone) — is replaced by an opaque token "
        "like EMAIL#1, PERSONNAME#2, or PROFILENAME#1 (letters/digits, "
        "then '#', then digits). A token is NOT a value. To use one, copy "
        'it VERBATIM into `value` (e.g. value="EMAIL#1"). NEVER invent, '
        "guess, or output a real-looking email/phone/name/card number — "
        "only a token or plain non-sensitive text belongs in `value`."
    )
    lines.append(
        "SENSITIVE: sensitive=true elements need the user's live approval "
        "first — only target one when the goal specifically needs THAT "
        "field. Check HISTORY FIRST, before picking a target: if an entry "
        "there already did what the goal asked (outcome 'ok'), the goal is "
        "DONE — do not repeat it on a different element, sensitive or not. "
        "Then either click a non-sensitive continue/submit control if one "
        "is listed, or reply action='done'."
    )

    # C5/C2 amendment (2026-09-26): the fix for the exact gap this
    # concise prompt's own item (a) comment above assumed away --
    # "a field that wants the user's own name/email/phone now just
    # carries a PROFILE...#n token in its own context (goal or label)"
    # is FALSE for a vault-sourced token: seedVault() mints PROFILE...#n
    # tokens directly into the run's TokenMap, never into taskGoal or any
    # element label, so the local planner had no text ANYWHERE in this
    # prompt from which to discover such a token exists. This is that
    # discovery mechanism.
    if context.vault:
        vault_bits = ", ".join(f"{e.token}({e.field.value})" for e in context.vault)
        lines.append(
            f"SAVED (vault, {len(context.vault)}): {vault_bits}. To fill one of these into a "
            'matching field, action="type" with `value` set to the token EXACTLY as listed. '
            "Never guess a PROFILE...#n token that is not listed here."
        )

    if context.regions:
        region_bits = ", ".join(
            f"{r.kind.value}@({r.bbox.x:.0f},{r.bbox.y:.0f},{r.bbox.w:.0f},{r.bbox.h:.0f})"
            for r in context.regions
        )
        lines.append(f"REDACTED ({len(context.regions)}, do not guess contents): {region_bits}")
    else:
        lines.append("REDACTED: none")

    lines.append(f"ELEMENTS ({len(context.elements)}):")
    if context.elements:
        for el in context.elements:
            bits = [f"agentId={el.agentId}", f"tag={el.tag}"]
            if el.type:
                bits.append(f"type={el.type}")
            if el.label:
                bits.append(f"label={el.label!r}")
            if el.tier:
                bits.append(f"tier={el.tier.value}")
            if el.sensitive:
                bits.append("sensitive=true (needs user approval -- do NOT type here unless the goal is specifically about this exact field)")
            bits.append("allowedActions=[" + ",".join(_element_allowed_actions(el)) + "]")
            lines.append("  - " + ", ".join(bits))
    else:
        lines.append("  (empty)")

    if context.history:
        lines.append(f"HISTORY ({len(context.history)}, most-recent-last):")
        for h in context.history:
            lines.append(f"  - {h.action.action.value} -> {h.action.targetId} ({h.outcome})")

    if context.mode == SceneMode.SEMANTIC:
        lines.append(
            "NEED_VISUAL: only if you truly cannot decide from ELEMENTS/"
            'REGIONS alone, answer action="need_visual", targetId="'
            + PAGE_TARGET_ID_V2
            + '". At most once per step.'
        )

    lines.append(
        'KEYBOARD: action="press_key" with `key` set (Enter/Escape/Tab/'
        "Backspace/ArrowUp/ArrowDown/ArrowLeft/ArrowRight) for a keystroke "
        "instead of a click. `key` is null for every other action."
    )

    # V3 retry item (b): two short few-shot examples, one per verb, using
    # the EXACT trimmed output shape (no profileField — fill_profile is
    # gone from this prompt per item (a)).
    #
    # V3 RETRY 2 (CLAUDE.md §7, item 3): both examples are now NEUTRAL.
    # Retry 1's type example used a plain string ("shoes") as `value` and
    # never demonstrated token echo at all; the live benchmark then
    # showed llama3.1:8b inventing a PERSONNAME-shaped token
    # ("PERSONNAME#2") that existed nowhere in the real request — the
    # coordinator's read was that this was most likely pattern-copied
    # from a few-shot example, so the fix is two-fold: (1) the type
    # example now DOES demonstrate copying a token verbatim, but (2) the
    # token used is QUERY#1 — deliberately NOT PERSONNAME/EMAIL/PASSWORD/
    # PROFILE-shaped, and it appears in the example's OWN "Goal:" text,
    # so the lesson taught is "copy a token you were given", never
    # "produce a PERSONNAME#N-shaped string on your own initiative". The
    # click example carries no token at all.
    lines.append("EXAMPLES:")
    lines.append(
        "  Element: agentId=agent-9, tag=input, type=text, label='Search', "
        'allowedActions=[type]. Goal: "search for QUERY#1". Reply: '
        '{"action":"type","targetId":"agent-9","value":"QUERY#1","key":null}'
    )
    lines.append(
        "  Element: agentId=agent-9, tag=button, label='Submit', "
        "allowedActions=[click]. Goal: \"submit the form\". Reply: "
        '{"action":"click","targetId":"agent-9","value":null,"key":null}'
    )
    # 2026-09-27: a third example demonstrating "goal already satisfied per
    # HISTORY, remaining candidates are sensitive-only plus one button" --
    # the real-Ollama V4b live run showed llama3.1:8b re-typing an
    # already-successfully-entered value into a leftover sensitive field
    # (e.g. an email input) rather than clicking a listed non-sensitive
    # continue/submit control -- a case V3's step-1-only benchmark never
    # exercised. Few-shot beats prose for this model family (V3 retry 2's
    # own lesson re: token invention); this teaches the pattern directly
    # rather than only asserting it in prose above.
    lines.append(
        "  Elements: agentId=agent-7 (tag=input, type=email, sensitive=true, "
        "needs approval); agentId=agent-9 (tag=button, label='Next', "
        "allowedActions=[click]). Goal: \"fill the city as CITY#1\". "
        "HISTORY: type -> agent-6 (ok). [agent-6, where CITY#1 was already "
        "typed, is no longer listed -- the goal is already done.] Reply: "
        '{"action":"click","targetId":"agent-9","value":null,"key":null} '
        "-- NOT typing CITY#1 into agent-7, which is unrelated and sensitive."
    )

    lines.append(
        "Reply with ONLY one JSON object, no prose: "
        '{"action":"click"|"type"|"scroll"|"press_key"|"done"|"need_visual"'
        ',"targetId":"<agentId or \\"'
        + PAGE_TARGET_ID_V2
        + '\\">","value":"<token, plain text, or null>","key":"Enter"|'
        '"Escape"|"Tab"|"Backspace"|"ArrowUp"|"ArrowDown"|"ArrowLeft"|'
        '"ArrowRight"|null}. Use each element\'s own `allowedActions` to '
        "choose `action` — `type` for a text-like field, `click` for a "
        "button/link/control. `key` is null unless action is press_key. "
        "targetId is always required; use "
        f'"{PAGE_TARGET_ID_V2}" when no specific element applies.'
    )
    return "\n".join(lines)


_OLLAMA_NUM_CTX_STEPS: tuple[int, ...] = (512, 1024, 2048, 4096, 8192, 16384, 32768)


def _estimate_ollama_num_ctx(prompt: str, response_headroom_tokens: int = 256) -> int:
    """Cheap, dependency-free context-size estimate (~4 chars/token, a
    standard rough estimate — no tokenizer is bundled server-side for an
    arbitrary Ollama model). Rounds UP to the next of Ollama's usual
    power-of-two-ish context sizes, so num_ctx is never smaller than the
    prompt needs, while staying far below Ollama's own ~4096+ default for
    the common short-fixture case — a smaller num_ctx materially speeds up
    small-model CPU inference (V3 brief item 3: "num_ctx sized to the
    prompt")."""
    estimated_prompt_tokens = max(1, (len(prompt) + 3) // 4)
    needed = estimated_prompt_tokens + response_headroom_tokens
    for step in _OLLAMA_NUM_CTX_STEPS:
        if needed <= step:
            return step
    return _OLLAMA_NUM_CTX_STEPS[-1]


# V3 retry item (c): the model-facing action set for the LOCAL PLANNER,
# fill_profile excluded per item (a). schemas_v2.ActionTypeV2 itself is
# UNCHANGED (fill_profile still parses/validates for wire back-compat,
# C2) — this is only the subset this backend's structured-output schema
# and prompt offer to the model.
_OLLAMA_MODEL_FACING_ACTIONS: tuple[str, ...] = tuple(
    a.value for a in ActionTypeV2 if a != ActionTypeV2.FILL_PROFILE
)


def _build_ollama_action_schema(elements: list["ElementV2"]) -> dict:
    """V3 retry item (c): a JSON Schema built FRESH per request (not a
    module-level constant like MODEL_ACTION_V2_JSON_SCHEMA below, which
    stays static for Claude/Gemini) — confirmed live against this
    machine's Ollama 0.34.0 that a per-request `format` object is
    honoured per call, not cached from the first one.

    `targetId` is enum-constrained to THIS scene's actual agentIds plus
    the page sentinel — directly targets qwen2.5:3b's observed failure
    (hallucinating the literal string "agentId=agent-1" as a value: the
    concise prompt's own `agentId=` label prefix bleeding into the
    model's output). An enum of real ids makes that string simply
    unreachable, rather than merely discouraged in prose.

    `action` is enum-constrained to _OLLAMA_MODEL_FACING_ACTIONS
    (fill_profile excluded, item (a)). `profileField` is dropped from
    `properties`/`required` entirely — with fill_profile gone there is
    nothing for it to gate, and ModelActionV2.model_validate() defaults
    a field the model never emits to None on its own (Optional with a
    default, not a required key), so omitting it here is fully
    compatible with the existing validation boundary in main.py.
    """
    target_ids = [el.agentId for el in elements] + [PAGE_TARGET_ID_V2]
    return {
        "type": "object",
        "properties": {
            "action": {"type": "string", "enum": list(_OLLAMA_MODEL_FACING_ACTIONS)},
            "targetId": {"type": "string", "enum": target_ids},
            "value": {"type": ["string", "null"]},
            "key": {
                "type": ["string", "null"],
                "enum": [k.value for k in PressKeyV2] + [None],
            },
        },
        "required": ["action", "targetId", "value", "key"],
        "additionalProperties": False,
    }


def _maybe_log_ollama_v2_metrics(
    *,
    model: str,
    prompt: str,
    num_ctx: int,
    temperature: float,
    used_schema_format: bool,
    ollama_body: dict[str, Any],
) -> None:
    """Opt-in benchmarking hook for benchmarks/bench_v3_planner.py (V3
    brief item 2: "Record per model: score, s/step p50/p95, prompt
    tokens, and the CPU load"). When OLLAMA_METRICS_LOG_V2 points at a
    file path, appends one JSON line per real Ollama call carrying
    Ollama's OWN tokenizer counts (prompt_eval_count/eval_count) — far
    more accurate than this module's char/4 num_ctx ESTIMATE above, which
    only sizes the request and is never itself reported as a "prompt
    tokens" figure. No-ops silently when the env var is unset: zero
    behavioural change for every other caller (the real server, every
    existing test)."""
    path = os.environ.get("OLLAMA_METRICS_LOG_V2")
    if not path:
        return
    import time as _time

    record = {
        "ts": _time.time(),
        "model": model,
        "prompt_chars": len(prompt),
        "num_ctx": num_ctx,
        "temperature": temperature,
        "used_schema_format": used_schema_format,
        "prompt_eval_count": ollama_body.get("prompt_eval_count"),
        "eval_count": ollama_body.get("eval_count"),
        "total_duration_ms": (ollama_body.get("total_duration") or 0) / 1_000_000,
        "load_duration_ms": (ollama_body.get("load_duration") or 0) / 1_000_000,
    }
    try:
        with open(path, "a", encoding="utf-8") as f:
            f.write(json.dumps(record) + "\n")
    except OSError:
        # Benchmarking convenience only — never let a logging failure
        # break a real /v2/analyze call.
        pass


# ---------------------------------------------------------------------------
# Interface
# ---------------------------------------------------------------------------


@dataclass
class VLMRequestContext:
    """Everything a VLM implementation needs to produce an action.

    `prompt` is pre-built by build_prompt() so every implementation sends
    identical instructions/redaction context — implementations differ only
    in *how* they transmit (prompt, image) to a model and parse the reply.
    """

    image_b64: str
    dom_snapshot: list[DomNode]
    redacted_regions: list[RedactedRegion]
    task_goal: str
    prompt: str


@dataclass
class VLMRequestContextV2:
    """v2 analog of VLMRequestContext (docs/v2/ARCHITECTURE.md contract
    C5). `image_b64` is None in semantic mode, present (already redacted)
    in image mode -- AnalyzeRequestV2's own mode/image validation
    (schemas_v2.ModeViolationV2) guarantees that invariant before this
    context is ever built."""

    mode: SceneMode
    task_goal: str
    elements: list[ElementV2]
    regions: list[RegionV2]
    history: list[HistoryEntry]
    image_b64: str | None
    prompt: str
    # C5/C2 amendment (2026-09-26): tokens + categories only, never values.
    # Defaulted (not a required positional) so every EXISTING call site
    # that builds a VLMRequestContextV2 fixture without a vault (most of
    # tests/unit/test_v2_analyze.py, test_ollama_v2_tightening.py, etc.)
    # keeps working unchanged.
    vault: list[VaultEntry] = field(default_factory=list)


class VLMClient(ABC):
    """One interface, swappable implementations. No implementation-specific
    details (Ollama, cloud provider, etc.) may appear in this contract."""

    @abstractmethod
    def analyze(self, context: VLMRequestContext) -> dict[str, Any]:
        """Return a raw dict shaped like the action response contract:
        {"action": str, "targetId": str, "value": str | None}.

        Implementations must NOT validate against ActionResponse
        themselves — that validation happens once, at the boundary in
        main.py, so a malformed/improvised action from any backend fails
        loudly and consistently regardless of which backend produced it.
        """
        raise NotImplementedError

    def analyze_v2(self, context: VLMRequestContextV2) -> dict[str, Any]:
        """v2 counterpart of analyze() (contract C5). Default
        implementation: NOT IMPLEMENTED. Backends that support v2 override
        this method; ClaudeVLMClient/GeminiVLMClient deliberately do NOT
        override it yet (V3 finishes cloud-backend v2 wiring — see this
        agent's report) and so raise this clear error rather than silently
        misbehaving via the v1 path.

        Same single-validation-boundary rule as analyze(): implementations
        must NOT validate against ModelActionV2 themselves.
        """
        raise NotImplementedError(
            f"{type(self).__name__} does not implement the v2 "
            "(dhristi-scene-v2) analyze path yet — V3 (planner-local) "
            "finishes cloud-backend v2 wiring. Use VLM_BACKEND=mock, "
            "observe, or ollama for /v2/analyze in the meantime."
        )


# ---------------------------------------------------------------------------
# Observe-only implementation — for running the pipeline against REAL
# websites without ever touching them.
# ---------------------------------------------------------------------------


class ObserveOnlyVLMClient(VLMClient):
    """Always returns `done`. Never calls a model, never selects a target.

    WHY THIS EXISTS: every browser verification in this project to date
    has run against `demo/test-page.html` — a fixture in this repo, built
    to exercise the paths it tests. The capture/scan/redact pipeline has
    therefore never met a real website's DOM: hundreds of actionable
    elements, third-party ad iframes, framework-generated markup, real
    shadow roots. That is the largest untested surface in the build.

    Pointing the NORMAL loop at a real site is not an acceptable way to
    find out. `content.js` runs up to MAX_STEPS=25 steps dispatching real
    clicks and keystrokes; `action-risk.js` is text-based and openly
    cannot classify an icon-only control; and a live site may be
    logged-in, transactional, or both. The irreversible-action guard is a
    safety net, not a licence to let an autonomous agent loose on
    somebody's account.

    This backend removes the risk at the source rather than relying on a
    guard to catch it. The client still performs capture -> detect ->
    scan -> rank -> redact -> assert -> POST in full, so every stage
    produces real instrumentation on a real page; the server then replies
    `done`, and the loop exits after exactly ONE step having mutated
    nothing. Combined with DEBUG_DUMP_DIR, one run yields the transmitted
    image and the exact transmitted payload for inspection.

    Deliberately returns the PAGE_TARGET_ID sentinel rather than any
    element id: `done` is ungated by the action guards (it neither writes
    to nor triggers an element — see CLAUDE.md's Phase 3 safety ruling),
    and naming no element is what makes "this cannot act" true by
    construction rather than by policy.
    """

    def analyze(self, context: VLMRequestContext) -> dict[str, Any]:
        return {"action": "done", "targetId": PAGE_TARGET_ID, "value": None}

    def analyze_v2(self, context: VLMRequestContextV2) -> dict[str, Any]:
        """v2 counterpart, same "always done, name no element" contract —
        see the class docstring above for why."""
        return {"action": "done", "targetId": PAGE_TARGET_ID_V2, "value": None}


# ---------------------------------------------------------------------------
# Mock implementation — deterministic, no network. Default and test backend.
# ---------------------------------------------------------------------------


class MockVLMClient(VLMClient):
    """Deterministic mock. Never touches the network or an LLM.

    Decision rule (purely structural, not NLP on the prompt text — the
    mock is a stand-in for grounding+action-selection behavior, not for
    language understanding):
      1. If domSnapshot is empty -> {"action": "done", "targetId": PAGE_TARGET_ID, "value": None}
      2. Else if the first non-redacted/non-sensitive EMPTY node is
         obviously profile-shaped (type 'email'/'tel', or a name-ish
         visible label) -> "fill_profile" on it, naming the matching
         `profileField` category, `value` always None (ruling #7 —
         this mock NEVER fabricates a value for fill_profile; that's
         the entire point of the action existing). Added 2026-09-14 so
         every demo/CI path can exercise the fill_profile contract with
         no API key, and so the extension side has a deterministic
         target to test against.
      3. Else if the first non-sensitive node with type in
         {"text","email","tel","search","password"} exists -> "type" on it,
         with a canned non-PII placeholder value (never the node's own
         text, and never a value for a redacted node).
      4. Else -> "click" on the first node's agentId.
    This is intentionally simple: the mock's job is to prove the
    request/response contract and prompt-construction path end-to-end, not
    to simulate real visual reasoning.
    """

    PLACEHOLDER_VALUE = "mock-input"

    # Direct type -> category mapping for step 2's structural detection.
    _PROFILE_TYPE_MAP: dict[str, ProfileField] = {
        "email": ProfileField.EMAIL,
        "tel": ProfileField.PHONE,
    }

    # A "name-ish" visible label: the whole word "name" (so it matches
    # "Full Name" / "Your Name" / "Name"), but NOT when "user" also
    # appears (so "Username" is correctly excluded — a username is not
    # the user's full name).
    _NAME_LABEL_RE = re.compile(r"\bname\b", re.IGNORECASE)

    @classmethod
    def _profile_field_for(cls, node: DomNode) -> ProfileField | None:
        """Purely structural profile-category detection — same
        philosophy as the rest of this mock (pattern matching on
        `type`/`text`, not NLP):

          - type == 'email', with no existing value -> ProfileField.EMAIL
          - type == 'tel', with no existing value   -> ProfileField.PHONE
          - otherwise, a name-ish VISIBLE label (e.g. "Full Name" /
            "Your Name") -> ProfileField.FULL_NAME

        "Emptiness" is deliberately checked per-branch, not once up
        front by the caller, because the two signals mean different
        things for DomNode.text: for the type-based branches, `text` is
        the field's current VALUE, and only an empty one is a fill
        target — a field that already holds something isn't. For the
        label-based branch, `text` on an unfilled input IS its visible
        placeholder (DomNode has no separate placeholder/value field —
        an accepted scope limit, see Phase 2a's DomNode shape); a
        label match (e.g. text == "Full Name") already means nothing
        real has been typed there, so gating it on emptiness as well
        would be self-contradictory — the label IS the non-empty text.

        Returns None when no category plainly applies.
        """
        mapped = cls._PROFILE_TYPE_MAP.get(node.type)
        if mapped is not None:
            has_value = bool(node.text) and bool(node.text.strip())
            return None if has_value else mapped
        label = (node.text or "").strip().lower()
        if label and cls._NAME_LABEL_RE.search(label) and "user" not in label:
            return ProfileField.FULL_NAME
        return None

    def analyze(self, context: VLMRequestContext) -> dict[str, Any]:
        redacted_agent_ids = {r.agentId for r in context.redacted_regions if r.agentId}

        if not context.dom_snapshot:
            return {"action": "done", "targetId": PAGE_TARGET_ID, "value": None}

        def _is_redacted_or_sensitive(node: DomNode) -> bool:
            return node.agentId in redacted_agent_ids or node.sensitive

        # Step 2: an obviously-profile-shaped field -> fill_profile,
        # naming the category only. Checked BEFORE the ordinary typeable-
        # field branch below, so a profile-shaped field is routed here
        # first rather than getting the generic PLACEHOLDER_VALUE typed
        # into it. `value` is always None here — never a guessed/
        # fabricated value; see ModelSuppliedProfileValue for what the
        # server does if a (real) backend ever gets this wrong.
        for node in context.dom_snapshot:
            if _is_redacted_or_sensitive(node):
                continue
            profile_field = self._profile_field_for(node)
            if profile_field is not None:
                return {
                    "action": "fill_profile",
                    "targetId": node.agentId,
                    "value": None,
                    "profileField": profile_field.value,
                }

        for node in context.dom_snapshot:
            if _is_redacted_or_sensitive(node):
                continue
            if node.type in {"text", "email", "tel", "search", "password"}:
                return {"action": "type", "targetId": node.agentId, "value": self.PLACEHOLDER_VALUE}

        # No safe typeable node — fall back to clicking the first node that
        # is NOT redacted/sensitive. Must never target a redacted/sensitive
        # node in either branch (that would defeat the whole point of
        # sending redactedRegions in the first place).
        for node in context.dom_snapshot:
            if not _is_redacted_or_sensitive(node):
                return {"action": "click", "targetId": node.agentId, "value": None}

        # Every node in the snapshot is redacted/sensitive — nothing safe
        # to act on.
        return {"action": "done", "targetId": PAGE_TARGET_ID, "value": None}

    # -- v2 -----------------------------------------------------------------
    # Deterministic v2 mock, same structural philosophy as analyze() above
    # (pattern matching on element type/label, not NLP) so v2 tests/demos
    # never need a real model either. `elements[].label` is v2's renamed,
    # 120-char-capped analog of v1 DomNode.text; `sensitive` and `tier`
    # carry over the same way. Values used are always plain non-PII
    # placeholder text or a token verbatim from an element's own label —
    # this mock never fabricates a raw PII-shaped value.
    _NAME_LABEL_RE_V2 = re.compile(r"\bname\b", re.IGNORECASE)

    @classmethod
    def _profile_field_for_v2(cls, el: ElementV2) -> ProfileFieldV2 | None:
        mapped = {"email": ProfileFieldV2.EMAIL, "tel": ProfileFieldV2.PHONE}.get(el.type)
        if mapped is not None:
            has_value = bool(el.label) and bool((el.label or "").strip())
            return None if has_value else mapped
        label = (el.label or "").strip().lower()
        if label and cls._NAME_LABEL_RE_V2.search(label) and "user" not in label:
            return ProfileFieldV2.FULL_NAME
        return None

    def analyze_v2(self, context: VLMRequestContextV2) -> dict[str, Any]:
        if not context.elements:
            return {"action": "done", "targetId": PAGE_TARGET_ID_V2, "value": None}

        def _is_sensitive(el: ElementV2) -> bool:
            return bool(el.sensitive)

        # C5/C2 amendment (2026-09-26): PREFERRED mechanism -- if the
        # request's vault names a token for this element's own wanted
        # category, respond with `type` + that TOKEN (never a value),
        # mirroring exactly what a real v2 planner is now told to do
        # (build_prompt_v2's "SAVED DETAILS" / build_prompt_v2_concise's
        # "SAVED (vault, ...)" instructions). Checked BEFORE the older
        # fill_profile branch below, which is now reached only when the
        # vault doesn't cover this run at all (e.g. no vault sent, or no
        # matching category) -- back-compat for callers/tests that never
        # populate `vault`.
        vault_by_field = {entry.field: entry.token for entry in context.vault}
        if vault_by_field:
            for el in context.elements:
                if _is_sensitive(el):
                    continue
                profile_field = self._profile_field_for_v2(el)
                token = vault_by_field.get(profile_field) if profile_field is not None else None
                if token is not None:
                    return {"action": "type", "targetId": el.agentId, "value": token}

        for el in context.elements:
            if _is_sensitive(el):
                continue
            profile_field = self._profile_field_for_v2(el)
            if profile_field is not None:
                return {
                    "action": "fill_profile",
                    "targetId": el.agentId,
                    "value": None,
                    "profileField": profile_field.value,
                }

        for el in context.elements:
            if _is_sensitive(el):
                continue
            if el.type in {"text", "email", "tel", "search", "password"}:
                return {"action": "type", "targetId": el.agentId, "value": self.PLACEHOLDER_VALUE}

        for el in context.elements:
            if not _is_sensitive(el):
                return {"action": "click", "targetId": el.agentId, "value": None}

        return {"action": "done", "targetId": PAGE_TARGET_ID_V2, "value": None}


# ---------------------------------------------------------------------------
# Ollama implementation — written, NOT executed by this codebase's tests.
# ---------------------------------------------------------------------------


class OllamaVLMClient(VLMClient):
    """Real integration targeting qwen2.5vl:7b via Ollama's local HTTP API.

    NOT executed as part of this module's build/test — no vision model is
    pulled on this machine (only text-only llama3.1:8b, qwen2.5:3b,
    qwen2.5:1.5b are present; qwen2.5vl:7b is not). This class is
    write-only validated: it imports cleanly and is exercised by unit
    tests only with the HTTP call itself mocked/stubbed, never against a
    live Ollama server.

    Uses raw HTTP (httpx) against Ollama's /api/generate rather than the
    `ollama` pip package, to avoid an extra dependency for a path that
    isn't run in this environment.
    """

    def __init__(
        self,
        model: str = "qwen2.5vl:7b",
        base_url: str | None = None,
        timeout_s: float = 120.0,
    ) -> None:
        self.model = model
        self.base_url = base_url or os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434")
        self.timeout_s = timeout_s

    def analyze(self, context: VLMRequestContext) -> dict[str, Any]:
        import httpx  # local import: keep this dependency optional for mock-only runs

        payload = {
            "model": self.model,
            "prompt": context.prompt,
            "images": [context.image_b64],
            "stream": False,
            "format": "json",
        }
        response = httpx.post(
            f"{self.base_url}/api/generate",
            json=payload,
            timeout=self.timeout_s,
        )
        response.raise_for_status()
        body = response.json()
        raw_text = body.get("response", "")
        try:
            return json.loads(raw_text)
        except json.JSONDecodeError as exc:
            raise ValueError(f"Ollama response was not valid JSON: {raw_text!r}") from exc

    # -- v2 -----------------------------------------------------------------
    # Per this agent's brief: "text-only model for semantic mode, VL model
    # for image mode". Two separate model names because a text-only Ollama
    # model cannot accept an `images` payload at all, and in semantic mode
    # there is no image to send anyway (schemas_v2's mode/image contract
    # guarantees that), so using the (heavier, slower) VL model
    # unconditionally would be strictly worse with no benefit.
    #
    # V3 (planner-local) TIGHTENING for small models, all four pieces of
    # this agent's original brief item 3, PLUS retry-1 items (a)/(b)/(c)
    # (CLAUDE.md §7 — see build_prompt_v2_concise's and
    # _build_ollama_action_schema's own docstrings for the reasoning
    # behind each):
    #   1. `format` is a PER-REQUEST JSON Schema built by
    #      _build_ollama_action_schema(context.elements) — confirmed live
    #      against this machine's Ollama 0.34.0 + qwen2.5:1.5b (curl smoke
    #      test, not assumed) that it accepts an object-schema `format`,
    #      and separately confirmed the per-request enum actually
    #      constrains output (a scene with a single real agentId no
    #      longer lets the model emit an unrelated string). Falls back to
    #      plain "json" ONLY on a 400/422 (a format-incompatibility
    #      signal) — never on any other failure, which must propagate as
    #      a real error (invariant 4: a down/broken Ollama must error,
    #      never silently degrade into calling anything else).
    #   2. `num_ctx` sized to the actual prompt via _estimate_ollama_num_ctx.
    #   3. `keep_alive` so the model stays warm between loop steps
    #      (OLLAMA_KEEP_ALIVE, default "10m").
    #   4. The CONCISE prompt (build_prompt_v2_concise) — built from
    #      context's structured fields directly, not context.prompt (the
    #      verbose build_prompt_v2 output main.py already built for every
    #      backend uniformly; simply unused here).
    # temperature defaults to 0 (OLLAMA_TEMPERATURE) — a deterministic
    # planner is the right default for an action-selection loop, not just
    # a benchmarking convenience; override the env var for anything that
    # wants sampling.
    #
    # NOT executed against a live Ollama server by this module's own test
    # suite (network calls are stubbed/mocked there, same posture as
    # before this pass) — it IS exercised live by benchmarks/bench_v3_planner.py,
    # this agent's pre-registered model-selection benchmark.
    def analyze_v2(self, context: VLMRequestContextV2) -> dict[str, Any]:
        import httpx  # local import: keep this dependency optional for mock-only runs

        if context.mode == SceneMode.IMAGE:
            model = os.environ.get("OLLAMA_VL_MODEL", "qwen2.5vl:3b")
            images = [context.image_b64] if context.image_b64 else []
        else:
            model = os.environ.get("OLLAMA_TEXT_MODEL", DEFAULT_OLLAMA_TEXT_MODEL_V2)
            images = []

        prompt = build_prompt_v2_concise(context)
        temperature = float(os.environ.get("OLLAMA_TEMPERATURE", "0"))
        num_ctx = _estimate_ollama_num_ctx(prompt)
        keep_alive = os.environ.get("OLLAMA_KEEP_ALIVE", "10m")
        request_schema = _build_ollama_action_schema(context.elements)

        base_payload: dict[str, Any] = {
            "model": model,
            "prompt": prompt,
            "stream": False,
            "keep_alive": keep_alive,
            "options": {"temperature": temperature, "num_ctx": num_ctx},
        }
        if images:
            base_payload["images"] = images

        response = None
        used_schema_format = True
        for fmt_label, fmt in (("schema", request_schema), ("json", "json")):
            payload = {**base_payload, "format": fmt}
            try:
                response = httpx.post(
                    f"{self.base_url}/api/generate",
                    json=payload,
                    timeout=self.timeout_s,
                )
                response.raise_for_status()
                used_schema_format = fmt_label == "schema"
                break
            except httpx.HTTPStatusError as exc:
                if fmt_label == "schema" and exc.response.status_code in (400, 422):
                    # This Ollama build/model rejected the per-request
                    # JSON-Schema `format` — fall back to the
                    # always-supported bare "json" mode instead of
                    # failing the whole call. Never falls back on any
                    # OTHER status (404 unknown model, 5xx, ...) — those
                    # are real failures and must propagate, not be masked
                    # by a silent retry.
                    continue
                raise

        assert response is not None  # loop above always either returns or raises
        body = response.json()
        raw_text = body.get("response", "")
        _maybe_log_ollama_v2_metrics(
            model=model,
            prompt=prompt,
            num_ctx=num_ctx,
            temperature=temperature,
            used_schema_format=used_schema_format,
            ollama_body=body,
        )
        try:
            return json.loads(raw_text)
        except json.JSONDecodeError as exc:
            raise ValueError(f"Ollama v2 response was not valid JSON: {raw_text!r}") from exc


# ---------------------------------------------------------------------------
# Claude implementation — written, NOT executed against a live API. No
# ANTHROPIC_API_KEY is configured on this machine; validated entirely
# against a stubbed/injected fake client (see
# tests/unit/test_claude_vlm_client.py).
# ---------------------------------------------------------------------------

DEFAULT_CLAUDE_MODEL = "claude-opus-4-8"
"""Exact model id string per Chief's instruction — no date suffix appended."""

ACTION_RESPONSE_JSON_SCHEMA: dict = {
    "type": "object",
    "properties": {
        "action": {"type": "string", "enum": [a.value for a in ActionType]},
        "targetId": {"type": "string"},
        "value": {"type": ["string", "null"]},
        "profileField": {
            "type": ["string", "null"],
            "enum": [f.value for f in ProfileField] + [None],
        },
        "key": {
            "type": ["string", "null"],
            "enum": [k.value for k in PressKey] + [None],
        },
    },
    "required": ["action", "targetId", "value", "profileField", "key"],
    "additionalProperties": False,
}
"""Mirrors schemas.ActionResponse, sent to Claude via `output_config` so
the model is CONSTRAINED at generation time to this exact shape — this is
the structured-output requirement the whole integration hinges on: a
model returning prose instead of {action, targetId, value, profileField}
breaks the agent loop. `action`'s enum is derived from schemas.ActionType
and `profileField`'s enum from schemas.ProfileField (single source of
truth for both, never a hand-copied duplicate list — ruling #7). `value`
and `profileField` are nullable rather than "optional" keys because
JSON-schema structured-output modes generally require every property
listed in `required` once additionalProperties is locked down — there's
no separate "optional property" concept to reach for. `profileField`'s
own enum list includes a literal `None` entry (-> JSON `null`) alongside
the three category strings, since a nullable enum in JSON Schema is
expressed by listing `null` as one of the allowed enum values, not by
`type` alone.

NOTE: server-side enforcement of the fill_profile contract (value MUST
be null when action is fill_profile; profileField required iff
fill_profile) does NOT live in this JSON Schema — structured-output
schemas typically can't express that kind of cross-field "iff"
constraint portably across providers. This schema only shapes what the
model is capable of emitting per-field; schemas.ActionResponse's
`_enforce_fill_profile_contract` model_validator is the actual security
boundary, enforced independently of whether the backend's structured-
output mode is trusted to have honored it."""


# ---------------------------------------------------------------------------
# V3 (planner-local) — v2 analog of ACTION_RESPONSE_JSON_SCHEMA above, for
# ModelActionV2 (schemas_v2.py) rather than v1's ActionResponse. Used as
# Ollama's `format` (OllamaVLMClient.analyze_v2, confirmed live against
# this machine's Ollama 0.34.0 to accept an object-schema `format`) and as
# Claude/Gemini's structured-output schema in their own analyze_v2()
# implementations below — one source of truth for the v2 action shape
# across all three real backends, same "never a hand-copied duplicate
# list" posture as ACTION_RESPONSE_JSON_SCHEMA. Same cross-field caveat as
# that schema: ModelActionV2's own `_enforce_shape` model_validator (not
# this JSON Schema) is the actual boundary for "profileField/key only
# when the matching action is used" — a structured-output mode honoring
# this schema still needs that validator behind it, which is why every
# analyze_v2() implementation deliberately does NOT validate against
# ModelActionV2 itself (single-validation-boundary rule, main.py only —
# see VLMClient.analyze_v2's docstring).
# ---------------------------------------------------------------------------

DEFAULT_OLLAMA_TEXT_MODEL_V2 = "llama3.1:8b"
"""Pre-registered-benchmark default (V3 brief item 1/2/6) — see
server/PLANNER.md and benchmarks/results/v3-planner-retry2.json for the
full selection table, raw trials, and caveats.

GATE RESULT (retry 2, final): PASSED — llama3.1:8b scored 15/15 on the 5
pre-registered planner fixtures (3 trials each, temperature 0, real
/v2/analyze, C5-compliant tokenized goals). Scores: llama3.1:8b 15/15,
qwen2.5:3b 9/15, qwen2.5:1.5b 3/15. `chosen_default_model` in
benchmarks/results/v3-planner-retry2.json is "llama3.1:8b".

2026-09-27 CORRECTION: this constant was left at "qwen2.5:1.5b" (run 1's
flagged, non-passing "highest scorer, 4/15" pick) after the gate moved to
llama3.1:8b across retry 1 and retry 2 -- run 1's prompt/schema (offered
fill_profile to the model, no per-request targetId enum, untokenized
fixtures) is not the prompt/schema this backend actually builds today
(build_prompt_v2_concise + _build_ollama_action_schema, both added by
retry 1/2). The stale value meant every live run through start-demo.ps1
-Planner local (which never sets OLLAMA_TEXT_MODEL) silently used
qwen2.5:1.5b -- confirmed via Ollama's own `GET /api/ps` reporting
qwen2.5:1.5b loaded during a "real llama3.1:8b" bench run -- reproducing
qwen2.5:1.5b's own documented retry-2 failure modes (3/15: wrong
action verb, hallucinated/empty targets) instead of exercising the
model V3 actually validated. See docs/v2/ARCHITECTURE.md's "V4 real
local planner (first live run)" row. Fixed here so the fallback this
backend actually uses matches the one the gate passed on; the correct
long-term fix is for OLLAMA_TEXT_MODEL to always be explicit at deploy
time, but a fallback that silently regresses to the worst-scoring model
is worse than leaving it unset would have been."""

MODEL_ACTION_V2_JSON_SCHEMA: dict = {
    "type": "object",
    "properties": {
        "action": {"type": "string", "enum": [a.value for a in ActionTypeV2]},
        "targetId": {"type": "string"},
        "value": {"type": ["string", "null"]},
        "profileField": {
            "type": ["string", "null"],
            "enum": [f.value for f in ProfileFieldV2] + [None],
        },
        "key": {
            "type": ["string", "null"],
            "enum": [k.value for k in PressKeyV2] + [None],
        },
    },
    "required": ["action", "targetId", "value", "profileField", "key"],
    "additionalProperties": False,
}


class ClaudeCredentialsMissing(Exception):
    """Raised by ClaudeVLMClient.analyze() when the Anthropic SDK client
    has no resolved API key at call time.

    Deliberately a pre-flight check on the SDK client's own `.api_key`
    attribute (set during `anthropic.Anthropic()`'s own credential
    resolution — this class never reads ANTHROPIC_API_KEY itself), rather
    than catching-and-string-matching the SDK's internal TypeError from
    header validation. That TypeError fires deep inside request
    preparation and its message text is not a stable public contract to
    depend on; inspecting the client's already-resolved `.api_key` is a
    directly testable, version-stable signal instead.
    """


class ClaudeModelNotFound(RuntimeError):
    """Wraps anthropic.NotFoundError — bad/unavailable ANTHROPIC_MODEL. Not retryable."""


class ClaudeRateLimited(RuntimeError):
    """Wraps anthropic.RateLimitError (HTTP 429). Retryable in principle — this
    class does not retry itself, but callers can distinguish this from a hard failure."""


class ClaudeAPIError(RuntimeError):
    """Wraps any other anthropic.APIStatusError (4xx/5xx) not already handled above."""


class ClaudeConnectionError(RuntimeError):
    """Wraps anthropic.APIConnectionError — no HTTP response at all (DNS/timeout/network)."""


class ClaudeVLMClient(VLMClient):
    """Real integration targeting a cloud Claude model via the OFFICIAL
    `anthropic` Python SDK — not raw httpx. (Raw httpx is the correct
    pattern for OllamaVLMClient above because no official Ollama SDK
    exists; here one does, so using it is the correct pattern, not an
    inconsistency between the two implementations.)

    SECTION 5 / PRIVACY NOTE: sending redacted data to a cloud model is
    exactly the scenario this project exists to make safe, not a weakening
    of the invariant. The invariant is "nothing leaves the client except
    the redacted image and sanitized DOM JSON" — this class sends exactly
    that (`context.image_b64` and `context.prompt`, both already
    constructed upstream from the already-redacted/sanitized
    VLMRequestContext; see the request-shape tests in
    test_claude_vlm_client.py that assert on this directly). Nothing about
    swapping mock/Ollama for a cloud backend changes what data the
    client-side pipeline is allowed to produce in the first place.

    NOT executed live: no ANTHROPIC_API_KEY is configured on this
    machine. Every code path here is exercised via a fake object injected
    through the `client=` constructor parameter, standing in for
    `anthropic.Anthropic` — request shape, response parsing, and each
    error branch are all unit-tested without credentials or network
    access.
    """

    def __init__(
        self,
        model: str | None = None,
        max_tokens: int = 2048,
        client: Any = None,
    ) -> None:
        self.model = model or os.environ.get("ANTHROPIC_MODEL", DEFAULT_CLAUDE_MODEL)
        self.max_tokens = max_tokens
        # Dependency-injection point for tests: a fake object exposing
        # `.api_key` and `.messages.create(...)`. When None (the real
        # runtime path), a bare `anthropic.Anthropic()` is constructed
        # lazily on first use in analyze() — never here — so merely
        # SELECTING this backend (VLM_BACKEND=claude, i.e. constructing
        # this class via get_vlm_client()) never touches the SDK's
        # credential resolution or makes any network call.
        self._injected_client = client

    def _get_client(self) -> Any:
        if self._injected_client is not None:
            return self._injected_client
        import anthropic  # local import: keep this dependency optional for mock-only runs

        # Bare constructor — per Chief's instruction, let the SDK resolve
        # credentials itself (env var, credential files, etc.). This
        # class does not hardcode or read the key itself.
        return anthropic.Anthropic()

    def analyze(self, context: VLMRequestContext) -> dict[str, Any]:
        import anthropic  # local import: keep this dependency optional for mock-only runs

        client = self._get_client()

        if not getattr(client, "api_key", None):
            raise ClaudeCredentialsMissing(
                "Claude backend selected (VLM_BACKEND=claude) but no API key is "
                "configured — set the ANTHROPIC_API_KEY environment variable "
                "before starting the server."
            )

        messages = [
            {
                "role": "user",
                "content": [
                    # Image block BEFORE the text block — per Chief's
                    # explicit instruction on vision content ordering.
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": "image/png",
                            "data": context.image_b64,
                        },
                    },
                    # build_prompt() REUSED VERBATIM (already built into
                    # context.prompt upstream) — it is the already
                    # unit-tested privacy contract: every redacted region
                    # named, "do not guess" instruction present. Not
                    # rewritten or paraphrased here.
                    {"type": "text", "text": context.prompt},
                ],
            }
            # Exactly one user turn. No assistant-role message is ever
            # added here — assistant prefill is removed on this model
            # family and returns a 400.
        ]

        try:
            response = client.messages.create(
                model=self.model,
                max_tokens=self.max_tokens,
                messages=messages,
                output_config={
                    "format": {"type": "json_schema", "schema": ACTION_RESPONSE_JSON_SCHEMA}
                },
                # No `thinking` kwarg at all (not thinking=None or
                # thinking=False — simply absent). Omitting it is what
                # makes Opus 4.8 run without thinking, which a real-time
                # agent loop wants. Do NOT add budget_tokens — it is
                # fully removed on 4.8 and returns a 400.
            )
        except anthropic.NotFoundError as exc:
            raise ClaudeModelNotFound(
                f"Claude model {self.model!r} not found or unavailable "
                f"(check ANTHROPIC_MODEL if you set it)."
            ) from exc
        except anthropic.RateLimitError as exc:
            raise ClaudeRateLimited("Claude API rate limit exceeded (HTTP 429).") from exc
        except anthropic.APIStatusError as exc:
            raise ClaudeAPIError(
                f"Claude API returned an error status (HTTP {exc.status_code})."
            ) from exc
        except anthropic.APIConnectionError as exc:
            raise ClaudeConnectionError("Could not connect to the Claude API.") from exc

        return self._extract_action_dict(response)

    @staticmethod
    def _extract_action_dict(response: Any) -> dict[str, Any]:
        """Pull the structured JSON out of the response's text content
        block.

        Deliberately does NOT validate against ActionResponse here — same
        single-validation-boundary rule as every VLMClient implementation
        (see the base class's analyze() docstring): main.py is the one
        place a malformed/improvised action gets rejected, regardless of
        which backend produced it.

        Uses raw `messages.create()` + manual JSON parsing rather than
        `messages.parse()`'s `output_format=<PydanticModel>` convenience:
        that path does its own SDK-internal validation via
        pydantic.TypeAdapter before returning, which would be a second,
        backend-specific validation path living outside main.py's single
        boundary — exactly what this codebase's architecture rules out.
        `output_config={"format": {...}}` (used above) is the correct,
        SDK-confirmed way to pass a raw JSON schema dict without pulling
        in that second path; `output_format` was explicitly avoided per
        instruction.
        """
        for block in response.content:
            if getattr(block, "type", None) == "text":
                return json.loads(block.text)
        raise ValueError("Claude response contained no text content block to parse as JSON.")

    # -- v2 -------------------------------------------------------------
    # V3 (planner-local) brief item 5: "Finish Claude + Gemini analyze_v2
    # as explicit opt-in (reuse their v1 client code)." Reuses this same
    # class's _get_client()/_extract_action_dict() and the same
    # credentials-missing / error-mapping design as analyze() above —
    # duplicated only where the v1/v2 request shapes genuinely differ
    # (v2's image is OPTIONAL — semantic mode sends no pixels at all,
    # per C5 — and the schema is MODEL_ACTION_V2_JSON_SCHEMA, not
    # ACTION_RESPONSE_JSON_SCHEMA). Selecting VLM_BACKEND_V2=claude with
    # no ANTHROPIC_API_KEY configured fails with the SAME
    # ClaudeCredentialsMissing this class already raises for v1 — never a
    # silent fallback to another backend (invariant 4's "no silent cloud
    # fallback" cuts both ways: Ollama down must never reach here, and
    # here must never reach anything else either).
    def analyze_v2(self, context: VLMRequestContextV2) -> dict[str, Any]:
        import anthropic  # local import: keep this dependency optional for mock-only runs

        client = self._get_client()

        if not getattr(client, "api_key", None):
            raise ClaudeCredentialsMissing(
                "Claude backend selected (VLM_BACKEND_V2=claude) but no API key is "
                "configured — set the ANTHROPIC_API_KEY environment variable "
                "before starting the server."
            )

        content: list[dict[str, Any]] = []
        if context.image_b64:
            # Image block BEFORE the text block, same ordering as v1 —
            # only present in image mode (context.image_b64 is None in
            # semantic mode, guaranteed by schemas_v2.ModeViolationV2's
            # request-time check before this context is ever built).
            content.append(
                {
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": "image/png",
                        "data": context.image_b64,
                    },
                }
            )
        # context.prompt is build_prompt_v2()'s output (main.py builds it
        # once, upstream, the same way for every backend) — REUSED
        # VERBATIM here, not rewritten or paraphrased, same posture as v1.
        content.append({"type": "text", "text": context.prompt})

        messages = [{"role": "user", "content": content}]

        try:
            response = client.messages.create(
                model=self.model,
                max_tokens=self.max_tokens,
                messages=messages,
                output_config={
                    "format": {"type": "json_schema", "schema": MODEL_ACTION_V2_JSON_SCHEMA}
                },
            )
        except anthropic.NotFoundError as exc:
            raise ClaudeModelNotFound(
                f"Claude model {self.model!r} not found or unavailable "
                f"(check ANTHROPIC_MODEL if you set it)."
            ) from exc
        except anthropic.RateLimitError as exc:
            raise ClaudeRateLimited("Claude API rate limit exceeded (HTTP 429).") from exc
        except anthropic.APIStatusError as exc:
            raise ClaudeAPIError(
                f"Claude API returned an error status (HTTP {exc.status_code})."
            ) from exc
        except anthropic.APIConnectionError as exc:
            raise ClaudeConnectionError("Could not connect to the Claude API.") from exc

        return self._extract_action_dict(response)


# ---------------------------------------------------------------------------
# Gemini implementation — written, NOT executed against a live API. No
# GEMINI_API_KEY / GOOGLE_API_KEY is configured on this machine; validated
# entirely against a stubbed/injected fake client (see
# tests/unit/test_gemini_vlm_client.py).
#
# Everything below was verified against the installed `google-genai`
# v2.22.0 package's own source (client.py, _api_client.py, types.py,
# errors.py, _transformers.py) — not recalled from training data. Where it
# genuinely differs from ClaudeVLMClient's design, that's because the two
# SDKs are actually built differently, confirmed by reading both, not an
# inconsistency between the two implementations:
#   - google-genai's Client() raises ValueError SYNCHRONOUSLY AT
#     CONSTRUCTION when no API key resolves (anthropic.Anthropic() defers
#     that failure to the first request).
#   - google-genai's error hierarchy is FLAT: only APIError -> ClientError
#     (any 4xx) / ServerError (any 5xx), no dedicated NotFoundError /
#     RateLimitError classes to catch by type. Distinguishing "rate
#     limited" from "model not found" requires inspecting the caught
#     ClientError's `.code` (int HTTP status) and `.status` (Google's own
#     string error code, e.g. "RESOURCE_EXHAUSTED", "NOT_FOUND") — there
#     is no other way to do this with this SDK's actual exception design.
#   - google-genai does not wrap network-level failures at all; a DNS/
#     timeout/connection failure propagates as a raw httpx.HTTPError
#     subclass straight from the underlying transport.
#   - Structured output uses `response_mime_type` + `response_json_schema`
#     on GenerateContentConfig (confirmed: response_json_schema accepts a
#     raw JSON Schema dict directly — the exact ACTION_RESPONSE_JSON_SCHEMA
#     already built for Claude is reused here unmodified).
#   - Image parts take RAW BYTES (`Part.from_bytes(data=<bytes>, ...)`),
#     not a base64 string — unlike Claude's wire format, which takes the
#     base64 string directly. context.image_b64 must be decoded first.
# ---------------------------------------------------------------------------

# VERIFIED LIVE 2026-09-11 against a real free-tier key: this model id
# returns a schema-conforming action for a real image+prompt request.
# The previous default ("gemini-2.0-flash", taken from the SDK's own
# examples) was NOT callable on a live key — it isn't in models.list().
# Note models.list() is NOT a reliable guide on its own: "gemini-2.5-flash"
# IS listed yet 404s on generateContent. Verify with a real call, not a listing.
# "gemini-flash-latest" also works but floats between releases — pinned
# deliberately so a demo can't shift under you mid-run.
DEFAULT_GEMINI_MODEL = "gemini-3.8-flash"
"""NOT verified against a live API call — no credentials are configured on
this machine, and guessing a model id from training-data recall was
explicitly ruled out (Gemini's model lineup and id strings are exactly
the kind of thing that goes stale). This value was instead read directly
out of the INSTALLED google-genai v2.22.0 SDK's own bundled source code:
it is the consistent illustrative example across client.py, models.py,
chats.py, batches.py, live.py, and types.py (40+ occurrences), including
literally being cited in a parameter docstring as: "The Gemini model ID,
for example: 'gemini-2.0-flash'". That is meaningfully stronger evidence
than recalled training data — it is what the SDK's own authors chose as
their canonical safe example as of this SDK release — but it is still
NOT a live confirmation that this id is currently servable, especially
on the free tier specifically. Override with GEMINI_MODEL if it's wrong;
list_gemini_models() / the GeminiModelNotFound error message below both
point at how to discover a currently-valid id instead of guessing again.
"""


class GeminiCredentialsMissing(Exception):
    """Raised by GeminiVLMClient.analyze() when no API key can be resolved.

    Structurally different from ClaudeCredentialsMissing by necessity, not
    by choice: anthropic.Anthropic() constructs successfully even with no
    key (the failure is deferred to request time, so there's a live client
    object whose `.api_key` attribute can be inspected first). google-genai's
    Client() does NOT get that far — confirmed in _api_client.py's
    BaseApiClient.__init__: on the plain Gemini Developer API path (no
    vertexai/enterprise/project/location args, which is all this class ever
    passes), it raises `ValueError('No API key was provided...')`
    SYNCHRONOUSLY, inside the constructor itself. There is no
    post-construction object to inspect. So this class catches that
    specific ValueError at construction time (see _get_client()) and
    re-raises with a clear, actionable message — still never reading
    GEMINI_API_KEY/GOOGLE_API_KEY itself; it only reacts to the SDK's own
    resolution failing, exactly like the Claude client does, just at a
    different point in the call sequence because the two SDKs fail
    differently.
    """


class GeminiModelNotFound(RuntimeError):
    """The configured GEMINI_MODEL was rejected (HTTP 404 / Google status
    "NOT_FOUND"). Not retryable with the same model id — see
    list_gemini_models() to discover a valid one."""


class GeminiRateLimited(RuntimeError):
    """HTTP 429 / Google status "RESOURCE_EXHAUSTED". The Gemini free tier
    is aggressively rate-limited — this is an expected, routine failure
    mode for this backend, not a rare edge case, which is why it gets its
    own distinguishable type rather than folding into a generic API-error
    branch."""


class GeminiAPIError(RuntimeError):
    """Any other Gemini APIError (ClientError or ServerError) not covered
    by the more specific branches above."""


class GeminiConnectionError(RuntimeError):
    """No HTTP response at all — DNS/timeout/network failure. google-genai
    does not wrap these itself (confirmed: no try/except around the
    underlying httpx send call in _api_client.py); they propagate as raw
    httpx.HTTPError subclasses, caught and re-wrapped here so all three
    real backends (Ollama, Claude, Gemini) expose a consistent
    "connection failed" exception shape."""


def list_gemini_models(client: Any = None) -> list[str]:
    """Discover currently-valid Gemini model ids. This is the safety net
    DEFAULT_GEMINI_MODEL's docstring promises: since that default could
    not be verified live, this function (and the equivalent inline
    one-liner below) is how a caller finds out what actually works.

    Equivalent one-liner, if you'd rather run it directly in a shell:

        python -c "from google import genai; [print(m.name) for m in genai.Client().models.list()]"

    Requires GEMINI_API_KEY or GOOGLE_API_KEY to be set — this makes a
    real (lightweight) API call, which is exactly why this function is
    NOT exercised by this module's test suite (no credentials on this
    machine). `client` accepts an injected fake for testing that it wires
    through correctly, without requiring a live call.
    """
    if client is None:
        from google import genai  # local import: keep this dependency optional for mock-only runs

        client = genai.Client()
    return [m.name for m in client.models.list() if getattr(m, "name", None)]


class GeminiVLMClient(VLMClient):
    """Real integration targeting a cloud Gemini model via the OFFICIAL
    `google-genai` SDK (`from google import genai`) — not the deprecated
    `google-generativeai` package, and not raw HTTP (an official SDK
    exists, so, same reasoning as ClaudeVLMClient, using it is correct).

    Chief's second cloud-backend decision: the Gemini API has a free tier
    (unlike Anthropic's pay-as-you-go pricing), which matters for a
    hackathon demo that shouldn't need a paid key to run. Section 5 note
    carries over unchanged from ClaudeVLMClient: sending already-redacted
    data to ANY cloud model, free or paid, is the scenario this project
    exists to make safe, not an exception to the invariant.

    NOT executed live: no GEMINI_API_KEY/GOOGLE_API_KEY is configured on
    this machine. Every code path here is exercised via a fake object
    injected through the `client=` constructor parameter, standing in for
    `google.genai.Client` — request shape, response parsing, and each
    error branch are all unit-tested without credentials or network
    access.
    """

    def __init__(
        self,
        model: str | None = None,
        max_output_tokens: int = 2048,
        client: Any = None,
    ) -> None:
        self.model = model or os.environ.get("GEMINI_MODEL", DEFAULT_GEMINI_MODEL)
        self.max_output_tokens = max_output_tokens
        # Dependency-injection point for tests — see ClaudeVLMClient's
        # identical pattern. Constructing this class never touches the
        # network or resolves credentials; only _get_client() does, lazily.
        self._injected_client = client

    def _get_client(self) -> Any:
        if self._injected_client is not None:
            return self._injected_client
        from google import genai  # local import: keep this dependency optional for mock-only runs

        try:
            # Bare constructor — the SDK resolves GOOGLE_API_KEY (priority)
            # or GEMINI_API_KEY (fallback) itself; this class does not read
            # either env var directly. On the plain Gemini Developer API
            # path (no vertexai/project/location passed here), a missing
            # key raises ValueError synchronously — see
            # GeminiCredentialsMissing's docstring for why this differs
            # from the Claude client's post-construction check.
            return genai.Client()
        except ValueError as exc:
            raise GeminiCredentialsMissing(
                "Gemini backend selected (VLM_BACKEND=gemini) but no API key is "
                "configured. Set the GEMINI_API_KEY environment variable "
                "(GOOGLE_API_KEY is also accepted, and takes priority if both are "
                "set) before starting the server. Get a free key at "
                "https://aistudio.google.com/apikey."
            ) from exc

    def analyze(self, context: VLMRequestContext) -> dict[str, Any]:
        from google.genai import errors, types
        import httpx  # transport-level exceptions surface raw from this SDK

        client = self._get_client()

        image_bytes = base64.b64decode(context.image_b64)

        contents = [
            # Image part BEFORE the text part — per Chief's explicit
            # instruction, same ordering rationale as the Claude client.
            # Part.from_bytes() requires raw bytes, not a base64 string
            # (confirmed: types.Blob.data is typed `bytes`) — hence the
            # decode above.
            types.Part.from_bytes(data=image_bytes, mime_type="image/png"),
            # build_prompt() REUSED VERBATIM (already built into
            # context.prompt upstream) — the already unit-tested privacy
            # contract, not rewritten or paraphrased here.
            types.Part.from_text(text=context.prompt),
        ]

        config = types.GenerateContentConfig(
            max_output_tokens=self.max_output_tokens,
            # Structured output is load-bearing here exactly as for
            # Claude: response_json_schema accepts a raw JSON Schema dict
            # (confirmed against types.py's GenerateContentConfig
            # docstring) and reuses ACTION_RESPONSE_JSON_SCHEMA verbatim —
            # one source of truth for the action enum, not a hand-copied
            # duplicate.
            response_mime_type="application/json",
            response_json_schema=ACTION_RESPONSE_JSON_SCHEMA,
            # No thinking_config is set. Some Gemini model families default
            # to enabled "thinking" with a model-dependent budget/latency
            # cost (ThinkingConfig.thinking_budget: "-1 is AUTOMATIC...
            # default values and allowed ranges are model dependent," per
            # the SDK's own docstring) — but forcing thinking_budget=0
            # unconditionally risks a 400 on a model that doesn't support
            # thinking at all, on top of an already-unverified model id.
            # Left as a documented, deliberate omission rather than a
            # second unverified guess stacked on the first.
        )

        try:
            response = client.models.generate_content(
                model=self.model,
                contents=contents,
                config=config,
            )
        except errors.ClientError as exc:
            # google-genai's error hierarchy has no dedicated RateLimitError/
            # NotFoundError types (confirmed in errors.py) — every 4xx is a
            # ClientError, distinguished only by `.code` / `.status`.
            if exc.code == 429 or exc.status == "RESOURCE_EXHAUSTED":
                raise GeminiRateLimited(
                    "Gemini API rate limit exceeded — the free tier is "
                    f"aggressively rate-limited ({exc.status or exc.code})."
                ) from exc
            if exc.code == 404 or exc.status == "NOT_FOUND":
                raise GeminiModelNotFound(
                    f"Gemini model {self.model!r} not found or unavailable. Run "
                    "list_gemini_models() (or `python -c \"from google import genai; "
                    "[print(m.name) for m in genai.Client().models.list()]\"`) to "
                    "discover currently-valid ids, then set GEMINI_MODEL."
                ) from exc
            raise GeminiAPIError(
                f"Gemini API returned a client error (HTTP {exc.code}, status={exc.status})."
            ) from exc
        except errors.ServerError as exc:
            raise GeminiAPIError(
                f"Gemini API returned a server error (HTTP {exc.code})."
            ) from exc
        except httpx.HTTPError as exc:
            raise GeminiConnectionError("Could not connect to the Gemini API.") from exc

        return self._extract_action_dict(response)

    @staticmethod
    def _extract_action_dict(response: Any) -> dict[str, Any]:
        """Pull the structured JSON out of response.text.

        Deliberately does NOT validate against ActionResponse here — same
        single-validation-boundary rule as every VLMClient implementation
        (see the base class's analyze() docstring): main.py is the one
        place a malformed/improvised action gets rejected, regardless of
        which backend produced it.

        `response.text` is the SDK's own convenience property (confirmed
        in types.py's GenerateContentResponse: "Returns the concatenation
        of all text parts... from only the first [candidate]") — used
        instead of manually walking response.candidates[0].content.parts,
        which is equivalent but more brittle across SDK versions.
        """
        text = getattr(response, "text", None)
        if not text:
            raise ValueError("Gemini response contained no text to parse as JSON.")
        return json.loads(text)

    # -- v2 -------------------------------------------------------------
    # Same "finish as explicit opt-in, reuse v1 client code" brief as
    # ClaudeVLMClient.analyze_v2 above. Missing credentials fail with the
    # SAME GeminiCredentialsMissing this class already raises for v1 —
    # never a silent fallback.
    def analyze_v2(self, context: VLMRequestContextV2) -> dict[str, Any]:
        from google.genai import errors, types
        import httpx  # transport-level exceptions surface raw from this SDK

        client = self._get_client()  # raises GeminiCredentialsMissing itself if unresolved

        contents: list[Any] = []
        if context.image_b64:
            # Image part BEFORE the text part, same ordering as v1. Only
            # present in image mode — context.image_b64 is None in
            # semantic mode (schemas_v2.ModeViolationV2 guarantees this
            # before the context is ever built). Part.from_bytes() needs
            # raw bytes, not base64 — same decode as v1's analyze().
            image_bytes = base64.b64decode(context.image_b64)
            contents.append(types.Part.from_bytes(data=image_bytes, mime_type="image/png"))
        # context.prompt is build_prompt_v2()'s output, REUSED VERBATIM —
        # not rewritten here, same posture as v1's analyze().
        contents.append(types.Part.from_text(text=context.prompt))

        config = types.GenerateContentConfig(
            max_output_tokens=self.max_output_tokens,
            response_mime_type="application/json",
            response_json_schema=MODEL_ACTION_V2_JSON_SCHEMA,
        )

        try:
            response = client.models.generate_content(
                model=self.model,
                contents=contents,
                config=config,
            )
        except errors.ClientError as exc:
            if exc.code == 429 or exc.status == "RESOURCE_EXHAUSTED":
                raise GeminiRateLimited(
                    "Gemini API rate limit exceeded — the free tier is "
                    f"aggressively rate-limited ({exc.status or exc.code})."
                ) from exc
            if exc.code == 404 or exc.status == "NOT_FOUND":
                raise GeminiModelNotFound(
                    f"Gemini model {self.model!r} not found or unavailable. Run "
                    "list_gemini_models() to discover currently-valid ids, then "
                    "set GEMINI_MODEL."
                ) from exc
            raise GeminiAPIError(
                f"Gemini API returned a client error (HTTP {exc.code}, status={exc.status})."
            ) from exc
        except errors.ServerError as exc:
            raise GeminiAPIError(
                f"Gemini API returned a server error (HTTP {exc.code})."
            ) from exc
        except httpx.HTTPError as exc:
            raise GeminiConnectionError("Could not connect to the Gemini API.") from exc

        return self._extract_action_dict(response)


# ---------------------------------------------------------------------------
# Factory — env-var selection, defaulting to mock.
# ---------------------------------------------------------------------------


def get_vlm_client() -> VLMClient:
    """Select a VLMClient implementation via the VLM_BACKEND env var.

    Defaults to "mock" — nothing currently working breaks by adding a new
    backend option. "ollama" targets a local qwen2.5vl:7b (untested, no
    model installed here). "claude" targets a cloud Claude model via the
    official SDK (Chief's cloud decision) — untested live, no
    ANTHROPIC_API_KEY on this machine, but fully unit-tested against a
    stubbed client. "gemini" targets a cloud Gemini model via the official
    google-genai SDK (Chief's FREE-tier decision, additive to Claude, not
    a replacement) — same story: untested live (no GEMINI_API_KEY/
    GOOGLE_API_KEY here), fully unit-tested against a stubbed client.
    Constructing any of these four does NOT itself touch a network or
    resolve credentials — that only happens inside .analyze(), on first
    real use.
    """
    backend = os.environ.get("VLM_BACKEND", "mock").strip().lower()
    if backend == "mock":
        return MockVLMClient()
    if backend == "observe":
        return ObserveOnlyVLMClient()
    if backend == "ollama":
        return OllamaVLMClient()
    if backend == "claude":
        return ClaudeVLMClient()
    if backend == "gemini":
        return GeminiVLMClient()
    raise ValueError(
        f"Unknown VLM_BACKEND: {backend!r} (expected 'mock', 'observe', 'ollama', "
        "'claude', or 'gemini')"
    )


def get_vlm_client_v2() -> VLMClient:
    """Select a VLMClient implementation for POST /v2/analyze via the
    VLM_BACKEND_V2 env var — DELIBERATELY SEPARATE from get_vlm_client()/
    VLM_BACKEND above, which stays exactly as-is and keeps gating v1's
    /analyze (V3 brief item 6: "Do not change v1 /analyze defaults — the
    demo still runs v1 until V4").

    Defaults to "ollama" (V3 brief item 6 / pre-registered benchmark in
    server/PLANNER.md and benchmarks/results/v3-planner.json) — unlike
    get_vlm_client()'s "mock" default, v2 has a real local planner to
    default to now. Same backend names, same "constructing never touches
    the network" contract as get_vlm_client() — only the env var read and
    the default differ.
    """
    backend = os.environ.get("VLM_BACKEND_V2", "ollama").strip().lower()
    if backend == "mock":
        return MockVLMClient()
    if backend == "observe":
        return ObserveOnlyVLMClient()
    if backend == "ollama":
        return OllamaVLMClient()
    if backend == "claude":
        return ClaudeVLMClient()
    if backend == "gemini":
        return GeminiVLMClient()
    raise ValueError(
        f"Unknown VLM_BACKEND_V2: {backend!r} (expected 'mock', 'observe', 'ollama', "
        "'claude', or 'gemini')"
    )
