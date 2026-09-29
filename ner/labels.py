"""ner/labels.py -- GLiNER label vocabulary, C1 label mapping, per-label
confidence floors, and the structural-descriptor false-positive guard.

Ported from Project B's warden/entities.py (see
C:\\Users\\varun\\AppData\\Local\\Temp\\claude\\C--Users-varun-brain-raw\\
efdce0cc-4955-44f1-b020-eebfa544c7b1\\scratchpad\\sih-2026\\warden\\
entities.py -- `LABELS`, `LABEL_TO_TYPE`, `UNCERTAIN_FLOOR_BY_LABEL`,
`_is_structural_descriptor`/`_DESCRIPTOR_WORDS`), retargeted at C1's
PiiLabel enum (docs/v2/ARCHITECTURE.md contract C1;
extension/lib/pii-tokenizer.js contract C2) instead of Warden's own
TYPE#n token-type strings.

Two labels Warden did NOT request ("email", "phone number") are included
here: this service's fixture set (spikes/gliner/fixtures.json) and its
baseline benchmark (spikes/gliner/bench_python.py's LABELS list, the V0a
gliner-spike that produced the LOCAL PROCESS decision this service
implements) were both built and measured against all 7 labels together, so
the label list below is deliberately the V0a spike's list, not Warden's
narrower 5-label one -- this service's recall claim is measured against
that fixture set and must request the exact same labels it was labelled
against.

Deliberately NOT ported: Warden's `_neutralise_scaffolding()`. It exists to
stop Warden's own "type=X selector=Y position=..." DOM-serialization string
from being misread as prose; C3's `texts: string[]` are raw page text, and
that serialization format never occurs here.
"""

from __future__ import annotations

import re

# Requested from GLiNER verbatim -- must match spikes/gliner/bench_python.py's
# LABELS list and spikes/gliner/fixtures.json's annotations exactly, since
# this service's recall claim (ner/bench.py) is measured against that
# fixture set with this exact wording.
GLINER_LABELS = [
    "person name",
    "address",
    "date of birth",
    "account number",
    "password",
    "email",
    "phone number",
]

# GLiNER natural-language label -> C1 PiiLabel. extension/lib/pii-tokenizer.js
# consumes these exact uppercase strings (C1: "Labels are uppercase
# alphanumerics only -- they become token prefixes").
LABEL_TO_PII_LABEL = {
    "person name": "PERSONNAME",
    "address": "ADDRESS",
    "date of birth": "DOB",
    "account number": "ACCOUNTNUMBER",
    "password": "PASSWORD",
    "email": "EMAIL",
    "phone number": "PHONE",
}

# C2's confidence bands (extension/lib/pii-tokenizer.js classifyBand):
#   score >= 0.60          -> strip
#   floor <= score < 0.60  -> ask
#   score <  floor         -> ignore
# Per-label floor: PERSONNAME 0.12, every other label 0.35 -- ported
# verbatim from Warden's UNCERTAIN_FLOOR_BY_LABEL, same numbers, same
# rationale: a missed name is a privacy breach; a spurious "ask the user"
# prompt costs one click, so names get a floor 3x lower than everything
# else to buy recall at the cost of more questions.
DEFAULT_FLOOR = 0.35
FLOOR_BY_PII_LABEL = {
    "PERSONNAME": 0.12,
}


def floor_for(pii_label: str) -> float:
    """The uncertain-band floor for one C1 PiiLabel. Below it, ignore."""
    return FLOOR_BY_PII_LABEL.get(pii_label, DEFAULT_FLOOR)


# Ask GLiNER for spans down to the LOWEST floor any label uses (currently
# PERSONNAME's 0.12), so a genuinely low-confidence name is never discarded
# by GLiNER's own internal candidate-span threshold before this service
# gets a chance to band it. Every other label is then re-filtered against
# its own (higher) floor in ner_engine._map_and_filter.
PREDICT_FLOOR = min([DEFAULT_FLOOR] + list(FLOOR_BY_PII_LABEL.values()))


# ---------------------------------------------------------------------------
# Structural-descriptor guard, ported verbatim from warden/entities.py
# (_is_structural_descriptor / _DESCRIPTOR_WORDS).
#
# Real DOM text nodes include field labels and placeholders ("Password",
# "Email Address", "Full Name") that GLiNER scores as PII values in their
# own right -- Warden measured 'Password' at 0.977 (label: password),
# 'Delivery address' at 0.901 (label: address), both comfortably above the
# 0.60 strip threshold. A match is a field NAME, not a value, when every
# word in it is a descriptor word; a real value carries a proper noun, a
# digit, or a symbol that no descriptor word has.
# ---------------------------------------------------------------------------
_DESCRIPTOR_WORDS = {
    "password", "passwd", "pwd", "passcode", "passphrase", "secret",
    "address", "name", "user", "username", "phone", "mobile", "number",
    "email", "mail", "delivery", "shipping", "billing", "contact",
    "sign", "login", "log", "forgot", "reset", "confirm", "current",
    "new", "old", "card", "account", "dob", "birth", "date",
    "aadhaar", "aadhar", "pan", "passport", "ssn", "otp", "pin",
    "cvv", "token", "key", "field", "input", "enter", "your", "my",
    # Added beyond Warden's original set: "full" (as in "Full Name") is a
    # common real-world field-label prefix that this service's own f10
    # fixture (spikes/gliner/fixtures.json) exercises ("Full Name: Ananya
    # Krishnan") and Warden's DOM-serialization-focused list never needed.
    "full",
}


def is_structural_descriptor(value: str) -> bool:
    """True when every word in `value` is a field-descriptor word, which
    makes it a field NAME (e.g. "Delivery Address") rather than a piece of
    personal data."""
    words = re.findall(r"[a-z]+", value.lower())
    if not words:
        return False
    return all(w in _DESCRIPTOR_WORDS for w in words)
