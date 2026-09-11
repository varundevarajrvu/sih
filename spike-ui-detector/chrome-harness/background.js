// UI-detector spike -- minimal background service worker, copied pattern
// from Phase 0's spike/chrome-harness/background.js (not modified, that
// file is untouched; this is a fresh copy for a fresh manifest). Its only
// job: create the offscreen document. All real work (model load, inference,
// console logging) happens in offscreen.js inside that document -- read
// ITS console, not this one's.

async function setupOffscreenDocument() {
  try {
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["WORKERS"],
      justification:
        "Run ONNX/WASM/WebGPU UI-element-detector inference (OmniParser icon_detect, OpenDILab webpage_element_detection) off the visible extension pages. Research spike -- no other purpose.",
    });
    console.log("[ui-detector-spike/background] offscreen document created.");
  } catch (err) {
    if (String(err).includes("single offscreen")) {
      console.log("[ui-detector-spike/background] offscreen document already exists, not creating another.");
    } else {
      console.error("[ui-detector-spike/background] failed to create offscreen document:", err);
    }
  }
}

chrome.runtime.onInstalled.addListener(() => {
  console.log("[ui-detector-spike/background] onInstalled -- setting up offscreen document.");
  setupOffscreenDocument();
});

chrome.runtime.onStartup.addListener(() => {
  console.log("[ui-detector-spike/background] onStartup -- setting up offscreen document.");
  setupOffscreenDocument();
});
