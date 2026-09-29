// SIH 26171 v2 rebuild -- Phase V4a (integration-v2).
//
// THE ONE PLACE the v1-vs-v2 loop switch lives (CLAUDE.md's V4a brief,
// item 1: "A PIPELINE_VERSION switch in ONE place, defaulting to 'v2'.
// The v1 loop stays intact and selectable ('v1'), and all tests stay
// green."). Every other file (content.js's message listener, popup.js if
// it ever grows a selector) reads the version through getPipelineVersion()
// below rather than re-deriving the storage key or the default anywhere
// else.
//
// Pure except for the injected storage parameter (same
// dependency-injection shape as profile-vault.js's getProfile(storage) --
// `{get(key) => Promise<object>}`), so this is unit-testable with a fake
// storage object and needs no browser.

export const PIPELINE_VERSION_STORAGE_KEY = "pipelineVersion";
export const PIPELINE_VERSIONS = Object.freeze(["v1", "v2"]);
export const DEFAULT_PIPELINE_VERSION = "v2";

/**
 * @param {{get: function(string): Promise<Object>}} storage chrome.storage.local-shaped.
 * @returns {Promise<"v1"|"v2">} DEFAULT_PIPELINE_VERSION on anything
 *   unset/invalid -- never throws, so a corrupt/missing storage value
 *   degrades to the documented default rather than breaking the loop.
 */
export async function getPipelineVersion(storage) {
  if (!storage || typeof storage.get !== "function") {
    throw new TypeError("pipeline-version.js: getPipelineVersion(storage) requires a storage object exposing get(key)");
  }
  try {
    const stored = await storage.get(PIPELINE_VERSION_STORAGE_KEY);
    const value = stored && stored[PIPELINE_VERSION_STORAGE_KEY];
    return PIPELINE_VERSIONS.includes(value) ? value : DEFAULT_PIPELINE_VERSION;
  } catch (_err) {
    return DEFAULT_PIPELINE_VERSION;
  }
}

/**
 * @param {{set: function(Object): Promise<void>}} storage
 * @param {string} version must be one of PIPELINE_VERSIONS.
 */
export async function setPipelineVersion(storage, version) {
  if (!storage || typeof storage.set !== "function") {
    throw new TypeError("pipeline-version.js: setPipelineVersion(storage, version) requires a storage object exposing set(items)");
  }
  if (!PIPELINE_VERSIONS.includes(version)) {
    throw new TypeError(`pipeline-version.js: invalid pipeline version ${JSON.stringify(version)} (expected one of ${PIPELINE_VERSIONS.join(", ")})`);
  }
  await storage.set({ [PIPELINE_VERSION_STORAGE_KEY]: version });
}
