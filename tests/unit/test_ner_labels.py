"""Pure unit tests for ner/labels.py -- label mapping, per-label confidence
floors, and the structural-descriptor guard. No torch, no gliner.
"""

from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from ner import labels  # noqa: E402


def test_label_mapping_covers_every_requested_gliner_label():
    for gliner_label in labels.GLINER_LABELS:
        assert gliner_label in labels.LABEL_TO_PII_LABEL


def test_label_mapping_targets_match_c1_pii_labels():
    expected = {
        "person name": "PERSONNAME",
        "address": "ADDRESS",
        "date of birth": "DOB",
        "account number": "ACCOUNTNUMBER",
        "password": "PASSWORD",
        "email": "EMAIL",
        "phone number": "PHONE",
    }
    assert labels.LABEL_TO_PII_LABEL == expected


def test_pii_labels_are_uppercase_alphanumeric_only():
    # C1: "Labels are uppercase alphanumerics only -- they become token
    # prefixes." No underscores, no spaces, no punctuation.
    import re

    for pii_label in labels.LABEL_TO_PII_LABEL.values():
        assert re.fullmatch(r"[A-Z0-9]+", pii_label), pii_label


def test_personname_floor_is_012_others_035():
    assert labels.floor_for("PERSONNAME") == 0.12
    assert labels.floor_for("ADDRESS") == 0.35
    assert labels.floor_for("DOB") == 0.35
    assert labels.floor_for("ACCOUNTNUMBER") == 0.35
    assert labels.floor_for("PASSWORD") == 0.35
    assert labels.floor_for("EMAIL") == 0.35
    assert labels.floor_for("PHONE") == 0.35
    # Unknown label defaults to the higher (safer to require more evidence
    # from an unrecognised category) global floor.
    assert labels.floor_for("SOMETHING_NEW") == 0.35


def test_predict_floor_is_the_minimum_across_all_labels():
    assert labels.PREDICT_FLOOR == 0.12


def test_structural_descriptor_guard_catches_field_labels():
    assert labels.is_structural_descriptor("Password") is True
    assert labels.is_structural_descriptor("Delivery Address") is True
    assert labels.is_structural_descriptor("Email Address") is True
    assert labels.is_structural_descriptor("Full Name") is True


def test_structural_descriptor_guard_lets_real_values_through():
    assert labels.is_structural_descriptor("Francis Reuben R") is False
    assert labels.is_structural_descriptor("Priya Sharma") is False
    assert labels.is_structural_descriptor("rahul.v@example.com") is False
    assert labels.is_structural_descriptor("14/08/1999") is False
    assert labels.is_structural_descriptor("") is False
