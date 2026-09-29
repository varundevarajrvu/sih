// SIH 26171 v2 rebuild -- Phase V4a. Unit tests for the one-place
// PIPELINE_VERSION switch (extension/lib/pipeline-version.js).

import test from "node:test";
import assert from "node:assert/strict";

import {
  getPipelineVersion,
  setPipelineVersion,
  DEFAULT_PIPELINE_VERSION,
  PIPELINE_VERSION_STORAGE_KEY,
} from "../../extension/lib/pipeline-version.js";

function fakeStorage(initial = {}) {
  const store = { ...initial };
  return {
    get: async (key) => ({ [key]: store[key] }),
    set: async (items) => Object.assign(store, items),
    _store: store,
  };
}

test("defaults to v2 when nothing is stored", async () => {
  const storage = fakeStorage();
  assert.equal(await getPipelineVersion(storage), "v2");
  assert.equal(DEFAULT_PIPELINE_VERSION, "v2");
});

test("defaults to v2 on a corrupt/unknown stored value, never throws", async () => {
  const storage = fakeStorage({ [PIPELINE_VERSION_STORAGE_KEY]: "not-a-real-version" });
  assert.equal(await getPipelineVersion(storage), "v2");
});

test("v1 stays intact and selectable", async () => {
  const storage = fakeStorage();
  await setPipelineVersion(storage, "v1");
  assert.equal(await getPipelineVersion(storage), "v1");
});

test("round-trips v2 explicitly too", async () => {
  const storage = fakeStorage();
  await setPipelineVersion(storage, "v2");
  assert.equal(await getPipelineVersion(storage), "v2");
});

test("setPipelineVersion rejects an invalid version", async () => {
  const storage = fakeStorage();
  await assert.rejects(() => setPipelineVersion(storage, "v3"), TypeError);
});

test("a storage.get() that throws still resolves to the default, never propagates", async () => {
  const storage = { get: async () => { throw new Error("storage unavailable"); } };
  assert.equal(await getPipelineVersion(storage), "v2");
});
