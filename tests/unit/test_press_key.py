"""press_key: the keyboard action, and the contract that keeps it narrow.

A large share of the real web is only reachable from the keyboard — search
boxes that commit on Enter with no submit button, modals and autocomplete
popups that close on Escape, comboboxes driven by arrow keys. With click/type
alone an agent fills a search field and then has nothing to press.

The parallel to guard: `key` is required exactly when action == "press_key"
and forbidden otherwise, mirroring how `profileField` behaves for
fill_profile. That shape is what stops a stray field riding along on an
unrelated action.
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from schemas import ActionResponse, ActionType, PressKey


def test_press_key_is_in_the_action_enum():
    assert ActionType.PRESS_KEY.value == "press_key"


def test_keys_are_a_closed_set_with_no_printable_characters():
    """Typing text is `type`'s job and goes through the guards. If a printable
    character were pressable here it would be a way to enter text that skips
    them."""
    values = {k.value for k in PressKey}
    assert values == {
        "Enter", "Escape", "Tab", "Backspace",
        "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
    }
    for v in values:
        assert len(v) > 1, f"{v!r} looks like a printable character"


def test_a_valid_press_key_action_validates():
    a = ActionResponse(action="press_key", targetId="agent-3", value=None, key="Enter")
    assert a.action == ActionType.PRESS_KEY
    assert a.key == PressKey.ENTER


def test_press_key_without_a_key_is_rejected():
    with pytest.raises(ValidationError):
        ActionResponse(action="press_key", targetId="agent-3", value=None)


def test_an_unrecognised_key_is_rejected_rather_than_forwarded():
    """The extension dispatches synthetic keyboard events into whatever page is
    loaded. What it can trigger should be enumerable by reading the enum, not
    whatever string a model emits."""
    with pytest.raises(ValidationError):
        ActionResponse(action="press_key", targetId="agent-3", value=None, key="F12")
    with pytest.raises(ValidationError):
        ActionResponse(action="press_key", targetId="agent-3", value=None, key="a")


@pytest.mark.parametrize("action", ["click", "type", "scroll", "done"])
def test_key_is_forbidden_on_every_other_action(action):
    with pytest.raises(ValidationError):
        ActionResponse(action=action, targetId="agent-1", value=None, key="Enter")


def test_key_and_profileField_constraints_do_not_interfere():
    """Both fields are 'required exactly when' — a fill_profile action must
    still reject a stray key, and vice versa."""
    with pytest.raises(ValidationError):
        ActionResponse(
            action="fill_profile", targetId="agent-1", value=None,
            profileField="email", key="Enter",
        )
    with pytest.raises(ValidationError):
        ActionResponse(
            action="press_key", targetId="agent-1", value=None,
            key="Enter", profileField="email",
        )


def test_ordinary_actions_still_validate_unchanged():
    """No regression in the shapes that already worked."""
    assert ActionResponse(action="click", targetId="agent-1", value=None).key is None
    assert ActionResponse(action="type", targetId="agent-1", value="hi").key is None
    assert ActionResponse(action="done", targetId="page", value=None).key is None
    assert ActionResponse(
        action="fill_profile", targetId="agent-1", value=None, profileField="email"
    ).key is None


def test_the_prompt_tells_the_model_the_action_exists_and_which_keys_are_legal():
    """A capability the model is never told about is a capability that does not
    exist. Assert on the real prompt, not on a description of it."""
    from vlm_client import build_prompt

    prompt = build_prompt("search for shoes", [], [])
    assert "press_key" in prompt
    for k in PressKey:
        assert k.value in prompt, f"{k.value} missing from the prompt's allowed-key list"
    # And that it says when NOT to use it.
    assert "type" in prompt


def test_structured_output_schema_constrains_key_to_the_enum():
    """The schema is what actually forces a cloud model to stay in the set."""
    from vlm_client import ACTION_RESPONSE_JSON_SCHEMA

    key_prop = ACTION_RESPONSE_JSON_SCHEMA["properties"]["key"]
    assert set(key_prop["enum"]) == {k.value for k in PressKey} | {None}
    assert "key" in ACTION_RESPONSE_JSON_SCHEMA["required"]
    assert ACTION_RESPONSE_JSON_SCHEMA["additionalProperties"] is False
