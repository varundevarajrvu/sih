"""Tests for server/debug_dump.py and its wiring into POST /analyze.

Covers exactly the guarantees this debugging aid is required to hold
(see CLAUDE.md's Phase 2c blocks and the debug-dump task description):
  - OFF by default: unset DEBUG_DUMP_DIR -> zero writes, zero directory
    creation, zero behaviour change.
  - ON via DEBUG_DUMP_DIR: files actually get written, sortable and
    correlated by filename.
  - The written image decodes to a valid PNG.
  - The written payload JSON excludes the base64 `image` blob.
  - A write failure (bad path / permission-shaped error) never breaks
    /analyze — a debugging aid must not take down the endpoint it's
    attached to.

PNG SIGNATURE NOTE: no image library is a dependency of this server
(see server/requirements.txt), so "decodes to a valid PNG" is checked
via the 8-byte PNG magic signature (b"\\x89PNG\\r\\n\\x1a\\n"), which is
sufficient to prove the bytes on disk are genuinely PNG-shaped and not,
say, base64 text or an empty file. The fixture image itself is a real
1x1 PNG (verified independently below), so this also proves the bytes
written are a byte-for-byte decode of what the client sent, not just
"looks like a PNG".
"""

from __future__ import annotations

import base64
import json
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

import debug_dump
from main import app
from schemas import AnalyzeRequest

client = TestClient(app)

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


def _dump_files(directory: Path) -> list[Path]:
    return sorted(directory.iterdir())


# ---------------------------------------------------------------------------
# OFF by default
# ---------------------------------------------------------------------------


def test_dump_dir_helper_returns_none_when_env_var_unset(monkeypatch):
    monkeypatch.delenv(debug_dump.ENV_VAR, raising=False)
    assert debug_dump._dump_dir() is None


def test_dump_dir_helper_returns_none_when_env_var_blank(monkeypatch):
    monkeypatch.setenv(debug_dump.ENV_VAR, "   ")
    assert debug_dump._dump_dir() is None


def test_dump_request_is_a_complete_no_op_when_disabled(monkeypatch, load_fixture):
    """No directory creation, no filesystem write attempt at all -- not
    just 'no files visible afterwards'. Patches Path.mkdir so a bug that
    tries to create the directory unconditionally (behind an early
    return that later gets removed) would be caught even if it later
    failed silently for some other reason."""
    monkeypatch.delenv(debug_dump.ENV_VAR, raising=False)
    payload = AnalyzeRequest.model_validate(load_fixture("valid_request.json"))

    with patch("pathlib.Path.mkdir") as mock_mkdir:
        debug_dump.dump_request(payload)
        mock_mkdir.assert_not_called()


def test_analyze_endpoint_creates_no_dump_dir_when_env_var_unset(monkeypatch, tmp_path, load_fixture):
    """End-to-end: hitting the real endpoint with dumping off must not
    create so much as an empty directory anywhere."""
    monkeypatch.delenv(debug_dump.ENV_VAR, raising=False)
    data = load_fixture("valid_request.json")

    resp = client.post("/analyze", json=data)

    assert resp.status_code == 200
    # Nothing to assert on tmp_path directly (dumping is unconfigured,
    # so there's no directory to check) -- the real assertion is that
    # nothing blew up and the response is unaffected. Covered further
    # by the mkdir-not-called test above.


def test_warn_if_enabled_logs_nothing_when_disabled(monkeypatch, caplog):
    monkeypatch.delenv(debug_dump.ENV_VAR, raising=False)
    with caplog.at_level("WARNING", logger="server.debug_dump"):
        debug_dump.warn_if_enabled()
    assert caplog.records == []


# ---------------------------------------------------------------------------
# ON: files actually get written
# ---------------------------------------------------------------------------


def test_dump_request_writes_image_and_payload_files(monkeypatch, tmp_path, load_fixture):
    monkeypatch.setenv(debug_dump.ENV_VAR, str(tmp_path))
    payload = AnalyzeRequest.model_validate(load_fixture("valid_request.json"))

    debug_dump.dump_request(payload)

    files = _dump_files(tmp_path)
    assert len(files) == 2
    image_files = [f for f in files if f.name.endswith("-image.png")]
    payload_files = [f for f in files if f.name.endswith("-payload.json")]
    assert len(image_files) == 1
    assert len(payload_files) == 1


def test_dump_filenames_share_a_sortable_correlated_prefix(monkeypatch, tmp_path, load_fixture):
    monkeypatch.setenv(debug_dump.ENV_VAR, str(tmp_path))
    payload = AnalyzeRequest.model_validate(load_fixture("valid_request.json"))

    debug_dump.dump_request(payload)

    files = _dump_files(tmp_path)
    image_name = next(f.name for f in files if f.name.endswith("-image.png"))
    payload_name = next(f.name for f in files if f.name.endswith("-payload.json"))
    image_prefix = image_name[: -len("-image.png")]
    payload_prefix = payload_name[: -len("-payload.json")]
    assert image_prefix == payload_prefix
    # Sortable: starts with a plain ISO-ish date so a directory listing
    # sorts chronologically. No colons (illegal in Windows filenames).
    assert image_prefix[:4].isdigit()  # year
    assert ":" not in image_name and ":" not in payload_name


def test_dump_creates_directory_when_missing(monkeypatch, tmp_path, load_fixture):
    """DEBUG_DUMP_DIR pointing at a not-yet-existing path must be created
    (parents included) rather than failing -- this is what makes the
    feature a single env-var flip rather than a manual mkdir step."""
    nested = tmp_path / "does" / "not" / "exist" / "yet"
    monkeypatch.setenv(debug_dump.ENV_VAR, str(nested))
    payload = AnalyzeRequest.model_validate(load_fixture("valid_request.json"))

    assert not nested.exists()
    debug_dump.dump_request(payload)

    assert nested.is_dir()
    assert len(_dump_files(nested)) == 2


def test_dump_request_writes_a_second_pair_on_a_second_call(monkeypatch, tmp_path, load_fixture):
    """'Each received request' -- confirm repeated calls accumulate
    files rather than overwrite the previous dump."""
    monkeypatch.setenv(debug_dump.ENV_VAR, str(tmp_path))
    payload = AnalyzeRequest.model_validate(load_fixture("valid_request.json"))

    debug_dump.dump_request(payload)
    debug_dump.dump_request(payload)

    assert len(_dump_files(tmp_path)) == 4


def test_warn_if_enabled_logs_a_warning_naming_the_directory(monkeypatch, tmp_path, caplog):
    monkeypatch.setenv(debug_dump.ENV_VAR, str(tmp_path))
    with caplog.at_level("WARNING", logger="server.debug_dump"):
        debug_dump.warn_if_enabled()

    assert len(caplog.records) == 1
    message = caplog.records[0].getMessage()
    assert str(tmp_path) in message
    assert "PII" in message.upper()


# ---------------------------------------------------------------------------
# The image decodes to a valid PNG
# ---------------------------------------------------------------------------


def test_dumped_image_decodes_to_a_valid_png_matching_the_source(monkeypatch, tmp_path, load_fixture):
    monkeypatch.setenv(debug_dump.ENV_VAR, str(tmp_path))
    fixture = load_fixture("valid_request.json")
    payload = AnalyzeRequest.model_validate(fixture)
    expected_bytes = base64.b64decode(fixture["image"])
    assert expected_bytes[:8] == PNG_SIGNATURE  # sanity: fixture really is a PNG

    debug_dump.dump_request(payload)

    image_path = next(f for f in _dump_files(tmp_path) if f.name.endswith("-image.png"))
    written_bytes = image_path.read_bytes()
    assert written_bytes[:8] == PNG_SIGNATURE
    assert written_bytes == expected_bytes


# ---------------------------------------------------------------------------
# The payload JSON excludes the base64 image blob
# ---------------------------------------------------------------------------


def test_dumped_payload_json_excludes_the_image_field(monkeypatch, tmp_path, load_fixture):
    monkeypatch.setenv(debug_dump.ENV_VAR, str(tmp_path))
    fixture = load_fixture("valid_request.json")
    payload = AnalyzeRequest.model_validate(fixture)

    debug_dump.dump_request(payload)

    payload_path = next(f for f in _dump_files(tmp_path) if f.name.endswith("-payload.json"))
    written = json.loads(payload_path.read_text(encoding="utf-8"))
    assert "image" not in written
    # Belt and suspenders: the raw base64 string itself must not appear
    # anywhere in the file's text, not just absent as a top-level key.
    raw_text = payload_path.read_text(encoding="utf-8")
    assert fixture["image"] not in raw_text
    # The rest of the payload must still be present and correct.
    assert written["taskGoal"] == fixture["taskGoal"]
    assert len(written["domSnapshot"]) == len(fixture["domSnapshot"])
    assert written["domSnapshot"][0]["agentId"] == fixture["domSnapshot"][0]["agentId"]


def test_dumped_payload_json_notes_which_image_file_it_pairs_with(monkeypatch, tmp_path, load_fixture):
    monkeypatch.setenv(debug_dump.ENV_VAR, str(tmp_path))
    payload = AnalyzeRequest.model_validate(load_fixture("valid_request.json"))

    debug_dump.dump_request(payload)

    files = _dump_files(tmp_path)
    image_name = next(f.name for f in files if f.name.endswith("-image.png"))
    payload_path = next(f for f in files if f.name.endswith("-payload.json"))
    written = json.loads(payload_path.read_text(encoding="utf-8"))
    assert written["_dump"]["imageFile"] == image_name


# ---------------------------------------------------------------------------
# A write failure never breaks /analyze
# ---------------------------------------------------------------------------


def test_dump_request_swallows_a_write_failure_without_raising(monkeypatch, tmp_path, load_fixture):
    """Point DEBUG_DUMP_DIR at a path that already exists AS A FILE, so
    Path.mkdir(parents=True, exist_ok=True) raises (exist_ok only
    suppresses the error when the existing path is a directory). This
    must not propagate out of dump_request."""
    blocked_path = tmp_path / "not_a_directory"
    blocked_path.write_text("this is a file, not a directory")
    monkeypatch.setenv(debug_dump.ENV_VAR, str(blocked_path))
    payload = AnalyzeRequest.model_validate(load_fixture("valid_request.json"))

    debug_dump.dump_request(payload)  # must not raise

    # The blocking file must be untouched -- no partial/corrupt write.
    assert blocked_path.read_text() == "this is a file, not a directory"


def test_dump_request_logs_on_write_failure(monkeypatch, tmp_path, load_fixture, caplog):
    blocked_path = tmp_path / "not_a_directory"
    blocked_path.write_text("occupied")
    monkeypatch.setenv(debug_dump.ENV_VAR, str(blocked_path))
    payload = AnalyzeRequest.model_validate(load_fixture("valid_request.json"))

    with caplog.at_level("ERROR", logger="server.debug_dump"):
        debug_dump.dump_request(payload)

    assert any("debug dump failed" in r.getMessage() for r in caplog.records)


def test_analyze_endpoint_still_returns_200_when_dump_write_fails(monkeypatch, tmp_path, load_fixture):
    """The literal constraint: a debug-dump write failure must not break
    /analyze. Hit the real endpoint with DEBUG_DUMP_DIR pointed at an
    unwritable (file-blocked) path and confirm the response is
    completely unaffected -- same status, same schema."""
    blocked_path = tmp_path / "blocked"
    blocked_path.write_text("occupied")
    monkeypatch.setenv(debug_dump.ENV_VAR, str(blocked_path))
    data = load_fixture("valid_request.json")

    resp = client.post("/analyze", json=data)

    assert resp.status_code == 200
    body = resp.json()
    assert body["action"] in {"click", "type", "scroll", "done"}


def test_analyze_endpoint_pii_leak_path_still_returns_400_when_dump_write_fails(
    monkeypatch, tmp_path, load_fixture
):
    """Same guarantee on the PII-leak rejection path specifically, since
    dump_request() is called before find_pii_leaks() and must not
    interfere with that check either."""
    blocked_path = tmp_path / "blocked"
    blocked_path.write_text("occupied")
    monkeypatch.setenv(debug_dump.ENV_VAR, str(blocked_path))
    data = load_fixture("malformed_request_pii_leak.json")

    resp = client.post("/analyze", json=data)

    assert resp.status_code == 400
    assert resp.json()["errorCode"] == "PII_LEAK_DETECTED"


# ---------------------------------------------------------------------------
# End-to-end through the real endpoint: dumping ON
# ---------------------------------------------------------------------------


def test_analyze_endpoint_dumps_request_when_enabled(monkeypatch, tmp_path, load_fixture):
    monkeypatch.setenv(debug_dump.ENV_VAR, str(tmp_path))
    data = load_fixture("valid_request.json")

    resp = client.post("/analyze", json=data)

    assert resp.status_code == 200
    files = _dump_files(tmp_path)
    assert len(files) == 2
    image_path = next(f for f in files if f.name.endswith("-image.png"))
    payload_path = next(f for f in files if f.name.endswith("-payload.json"))
    assert image_path.read_bytes()[:8] == PNG_SIGNATURE
    written = json.loads(payload_path.read_text(encoding="utf-8"))
    assert "image" not in written
    assert written["taskGoal"] == data["taskGoal"]


def test_analyze_endpoint_dumps_the_pii_leak_rejected_request_too(monkeypatch, tmp_path, load_fixture):
    """A request that gets rejected as a PII leak is still dumped --
    deliberately (see get_validated_analyze_request's docstring):
    seeing exactly what leaked is itself a useful debugging target, and
    dump_request() runs before the leak check fires."""
    monkeypatch.setenv(debug_dump.ENV_VAR, str(tmp_path))
    data = load_fixture("malformed_request_pii_leak.json")

    resp = client.post("/analyze", json=data)

    assert resp.status_code == 400
    files = _dump_files(tmp_path)
    assert len(files) == 2


def test_analyze_endpoint_does_not_dump_structurally_invalid_requests(monkeypatch, tmp_path, load_fixture):
    """A request that fails ordinary Pydantic structural validation
    (422) never becomes an AnalyzeRequest, so there is nothing for
    dump_request() to receive -- the dependency function's body (where
    the dump call lives) never runs. Documented scope limit, not a bug:
    the debug dump inspects validated payloads only."""
    monkeypatch.setenv(debug_dump.ENV_VAR, str(tmp_path))
    data = load_fixture("malformed_request_missing_field.json")

    resp = client.post("/analyze", json=data)

    assert resp.status_code == 422
    assert _dump_files(tmp_path) == []
