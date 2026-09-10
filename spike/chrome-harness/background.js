// Phase 0 spike -- minimal background service worker.
// Its only job: create the offscreen document. All the actual work
// (model load, inference, console logging) happens in offscreen.js
// inside that document -- read ITS console, not this one's.

async function setupOffscreenDocument() {
  try {
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["WORKERS"],
      justification:
        "Run ONNX/WASM/WebGPU object-detection model inference (Xenova/yolos-tiny via @huggingface/transformers) off the visible extension pages. Phase 0 spike -- no other purpose.",
    });
    console.log("[spike/background] offscreen document created.");
  } catch (err) {
    // Chrome throws if a document already exists for this extension.
    if (String(err).includes("single offscreen")) {
      console.log("[spike/background] offscreen document already exists, not creating another.");
    } else {
      console.error("[spike/background] failed to create offscreen document:", err);
    }
  }
}

chrome.runtime.onInstalled.addListener(() => {
  console.log("[spike/background] onInstalled -- setting up offscreen document.");
  setupOffscreenDocument();
});

chrome.runtime.onStartup.addListener(() => {
  console.log("[spike/background] onStartup -- setting up offscreen document.");
  setupOffscreenDocument();
});
