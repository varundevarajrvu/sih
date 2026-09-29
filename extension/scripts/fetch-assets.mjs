#!/usr/bin/env node
// extension/scripts/fetch-assets.mjs
//
// Fetches the ML binaries .gitignore excludes from version control
// (extension/models/, extension/ort/, extension/offscreen.bundle.js --
// see .gitignore's "Vendored ML binaries" comment near line 30) so a
// fresh clone can reproduce them, then verifies each one against
// extension/scripts/assets.lock.json -- a sha256 manifest GENERATED FROM
// the files already present in this working copy (via --gen-lock), not
// re-derived from upstream. That distinction matters: three of the nine
// files below are confirmed NOT byte-identical to their canonical
// upstream source (see the per-file "verified" notes and
// extension/README.md "Fresh clone setup"). This script reports that
// precisely instead of silently accepting or silently overwriting.
//
// Usage:
//   node extension/scripts/fetch-assets.mjs
//       Fetch into extension/{models,ort} (skipping any file already
//       present -- see SAFETY below), verify against the lock file, then
//       run `npm run build`.
//   node extension/scripts/fetch-assets.mjs --dest <dir>
//       Fetch into <dir>/{models,ort} instead. Verification mode: never
//       touches extension/{models,ort}, never runs the build.
//   node extension/scripts/fetch-assets.mjs --gen-lock
//       (Re)generate assets.lock.json by hashing whatever already exists
//       on disk under extension/{models,ort} right now.
//   node extension/scripts/fetch-assets.mjs --verify-only
//       Hash what's on disk against the lock file; fetch nothing, build
//       nothing.
//   node extension/scripts/fetch-assets.mjs --allow-mismatch
//       Combine with the default mode to proceed to `npm run build` even
//       if a freshly downloaded file doesn't match the lock (still warns
//       loudly; never silent).
//
// No dependencies beyond Node's own fetch/fs/crypto/child_process.
// Requires Node >=18 (global fetch).
//
// SAFETY: in default (non---dest) mode, a destination file that already
// exists on disk is NEVER downloaded, overwritten, or deleted -- only
// files that are MISSING get fetched. This is what makes it safe to run
// against a working copy that already has local assets.
//
// TRACKED vs FETCHED (as of the .gitignore update tracking
// extension/models/ultraface/ and the two differing ORT glue files):
// a SOURCES entry with `tracked: true` is checked into git -- it is
// NEVER downloaded from its `provenance.upstreamUrl`. It is only
// sha256-verified against assets.lock.json, against its real on-disk
// copy in extension/, in every mode (including --dest, since there is
// nothing to fetch for it). `provenance` on those entries is upstream
// paper trail only -- see extension/README.md for the full story of why
// each one differs from its upstream source. Everything else is fetched
// as before.

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXT_ROOT = path.resolve(__dirname, "..");
const LOCK_PATH = path.join(__dirname, "assets.lock.json");

// ---------------------------------------------------------------------
// Canonical upstream sources. Verified 2026-09-27 by downloading each URL
// and sha256-comparing the result against this repo's working copy.
// ---------------------------------------------------------------------
const SOURCES = [
  // V1 detector (Xenova/yolos-tiny), via the Hugging Face Hub -- the same
  // approach README.md / spike/README.md already document (query the
  // repo, download onnx/model.onnx + config.json + preprocessor_config.json).
  {
    dest: "models/Xenova/yolos-tiny/onnx/model.onnx",
    url: "https://huggingface.co/Xenova/yolos-tiny/resolve/main/onnx/model.onnx",
    verified: "byte-identical to local copy (26,227,993 bytes).",
  },
  {
    dest: "models/Xenova/yolos-tiny/config.json",
    url: "https://huggingface.co/Xenova/yolos-tiny/resolve/main/config.json",
    verified: "byte-identical to local copy.",
  },
  {
    dest: "models/Xenova/yolos-tiny/preprocessor_config.json",
    url: "https://huggingface.co/Xenova/yolos-tiny/resolve/main/preprocessor_config.json",
    verified: "byte-identical to local copy.",
  },

  // V2 detector (UltraFace RFB-320) -- TRACKED in git (.gitignore
  // exempts extension/models/ultraface/), not fetched. The .onnx is a
  // DERIVED file: sih-2026's scripts/optimize-vision-model.py produced
  // it from the upstream Linzaer export below, so it is not, and is
  // never expected to be, byte-identical to that upstream URL.
  {
    dest: "models/ultraface/ultraface-rfb320.onnx",
    tracked: true,
    provenance: {
      upstreamUrl:
        "https://raw.githubusercontent.com/Linzaer/Ultra-Light-Fast-Generic-Face-Detector-1MB/dffdddda9794a50607cba8f318507a28c1c27cab/models/onnx/version-RFB-320.onnx",
      upstreamSha256: "34cd7e60aeff28744c657de7a3dc64e872d506741de66987f3426f2b79f88017",
      upstreamSize: 1270727,
      note:
        "Derived, not a re-download: sih-2026's scripts/optimize-vision-model.py " +
        "produced this file from the upstream ONNX at upstreamUrl (1,270,727 bytes). " +
        "This tracked copy is 1,257,907 bytes -- same architecture, different export. " +
        "See extension/README.md.",
    },
  },
  {
    dest: "models/ultraface/ULTRAFACE-LICENSE.txt",
    tracked: true,
    provenance: {
      upstreamUrl:
        "https://raw.githubusercontent.com/Linzaer/Ultra-Light-Fast-Generic-Face-Detector-1MB/dffdddda9794a50607cba8f318507a28c1c27cab/LICENSE",
      upstreamSha256: "21f0df2b54c9fef1b4f4061dd0b153bc72f071b5ce9fc04234f13ebfd093b44c",
      upstreamSize: 1063,
      note: "Text byte-identical to upstream; tracked copy has CRLF line endings (upstream is LF). Benign.",
    },
  },

  // ORT runtime, jsep variant: exactly what @huggingface/transformers@3.8.1
  // (the version pinned in extension/package-lock.json) bundles for its own
  // onnxruntime-web dependency (1.22.0-dev.20250409-89f8206ba4). Feeds the
  // yolos-tiny pipeline() path.
  {
    dest: "ort/ort-wasm-simd-threaded.jsep.mjs",
    url: "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0-dev.20250409-89f8206ba4/dist/ort-wasm-simd-threaded.jsep.mjs",
    verified: "byte-identical to local copy and to node_modules/onnxruntime-web/dist/ at this pinned version.",
  },
  {
    dest: "ort/ort-wasm-simd-threaded.jsep.wasm",
    url: "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0-dev.20250409-89f8206ba4/dist/ort-wasm-simd-threaded.jsep.wasm",
    verified: "byte-identical to local copy and to node_modules/onnxruntime-web/dist/ at this pinned version.",
  },

  // ORT runtime, plain (non-jsep) variant: added for the raw
  // onnxruntime-web UltraFace path -- @huggingface/transformers ships ONLY
  // the jsep build (spikes/ultraface/RESULT.md line 30), so this trio came
  // from onnxruntime-web directly. The .wasm binary matches
  // onnxruntime-web@1.23.2's published dist file exactly; the two .mjs glue
  // files do not (small byte diffs -- see notes).
  {
    dest: "ort/ort-wasm-simd-threaded.wasm",
    url: "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.23.2/dist/ort-wasm-simd-threaded.wasm",
    verified: "byte-identical to local copy (11,905,541 bytes).",
  },
  // These two glue files complete the non-jsep trio -- FETCHED, same as
  // the .wasm above. CORRECTION (see extension/README.md): an earlier
  // version of this script marked them `tracked: true` after finding a
  // 68-byte / 7-byte diff from onnxruntime-web@1.23.2's published files.
  // That diff was CRLF line endings from a Windows copy, not a patch --
  // stripping \r from the then-local copies produced an exact byte match
  // to upstream (68 and 7 CR bytes respectively, matching the diffs
  // exactly). The local files were replaced with the unmodified upstream
  // (LF) bytes and the .gitignore exception reverted; they fetch cleanly.
  {
    dest: "ort/ort-wasm-simd-threaded.mjs",
    url: "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.23.2/dist/ort-wasm-simd-threaded.mjs",
    verified: "byte-identical to local copy (20,321 bytes) once the local copy's CRLF artifact was corrected.",
  },
  {
    dest: "ort/ort.wasm.min.mjs",
    url: "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.23.2/dist/ort.wasm.min.mjs",
    verified: "byte-identical to local copy (49,856 bytes) once the local copy's CRLF artifact was corrected.",
  },
];

function printHelp() {
  console.log(
    "Usage: node fetch-assets.mjs [--dest <dir>] [--gen-lock] [--verify-only] [--allow-mismatch]\n" +
      "See the header comment in this file for what each flag does."
  );
}

function parseArgs(argv) {
  const args = { dest: null, genLock: false, verifyOnly: false, allowMismatch: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dest") args.dest = argv[++i];
    else if (a === "--gen-lock") args.genLock = true;
    else if (a === "--verify-only") args.verifyOnly = true;
    else if (a === "--allow-mismatch") args.allowMismatch = true;
    else if (a === "--help" || a === "-h") {
      printHelp();
      process.exit(0);
    } else {
      console.error(`unknown argument: ${a}`);
      printHelp();
      process.exit(1);
    }
  }
  return args;
}

async function fileExists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function genLock() {
  const files = {};
  for (const src of SOURCES) {
    const abs = path.join(EXT_ROOT, src.dest);
    if (!(await fileExists(abs))) {
      console.warn(`[gen-lock] SKIP (not present on disk): ${src.dest}`);
      continue;
    }
    const buf = await readFile(abs);
    files[src.dest] = {
      sha256: createHash("sha256").update(buf).digest("hex"),
      size: buf.length,
      tracked: Boolean(src.tracked),
      url: src.url ?? null,
      verified: src.verified ?? null,
      provenance: src.provenance ?? null,
    };
  }
  const lock = {
    generatedAt: new Date().toISOString(),
    note:
      "sha256 manifest generated FROM local files already present in this working " +
      "copy -- NOT re-derived from upstream. See fetch-assets.mjs SOURCES for " +
      "provenance and known upstream mismatches.",
    files,
  };
  await writeFile(LOCK_PATH, JSON.stringify(lock, null, 2) + "\n");
  console.log(`[gen-lock] wrote ${LOCK_PATH} (${Object.keys(files).length} files)`);
}

async function loadLock() {
  if (!(await fileExists(LOCK_PATH))) {
    console.error(`missing ${LOCK_PATH} -- run with --gen-lock first, from a checkout that has the real local assets.`);
    process.exit(1);
  }
  return JSON.parse(await readFile(LOCK_PATH, "utf8"));
}

async function downloadTo(url, destAbs) {
  const res = await fetch(url); // Node's global fetch follows redirects by default
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  // BINARY, always -- res.arrayBuffer() -> Buffer -> writeFile(Buffer) never
  // goes through a string/text encoding step, so there is no newline
  // translation anywhere in this path (CRLF vs LF is a git-checkout-time
  // concern, not a concern for what this script writes). Keep it this way:
  // an earlier CRLF mismatch in this repo's tracked assets came from a
  // Windows COPY/checkout, not from this function -- see extension/README.md.
  const buf = Buffer.from(await res.arrayBuffer());
  if (!Buffer.isBuffer(buf)) throw new Error(`downloadTo(${url}): expected a Buffer, refusing a non-binary write`);
  await mkdir(path.dirname(destAbs), { recursive: true });
  await writeFile(destAbs, buf);
  return buf;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.genLock) {
    await genLock();
    return;
  }

  const lock = await loadLock();
  const destRoot = args.dest ? path.resolve(args.dest) : EXT_ROOT;
  const verifying = Boolean(args.dest); // --dest: never touch real files, never build

  const mismatches = [];
  const skippedExisting = [];
  const trackedOk = [];

  for (const src of SOURCES) {
    const rec = lock.files[src.dest];
    if (!rec) {
      console.warn(`[warn] ${src.dest} has no lock entry -- run --gen-lock. Skipping.`);
      continue;
    }

    // TRACKED files are checked into git -- never fetched, never written into
    // --dest. Verified in place, against the real extension/ tree, in every mode.
    if (src.tracked) {
      const realAbs = path.join(EXT_ROOT, src.dest);
      if (!(await fileExists(realAbs))) {
        mismatches.push({
          dest: src.dest,
          tracked: true,
          expected: rec,
          actual: null,
          note: "TRACKED file is missing from extension/ -- it should be checked into git, not fetched. Run `git checkout -- " + src.dest + "` or restore it from version control.",
        });
        continue;
      }
      const buf = await readFile(realAbs);
      const sha256 = createHash("sha256").update(buf).digest("hex");
      if (sha256 === rec.sha256 && buf.length === rec.size) {
        trackedOk.push(src.dest);
      } else {
        mismatches.push({
          dest: src.dest,
          tracked: true,
          expected: rec,
          actual: { sha256, size: buf.length },
          note: "TRACKED file on disk has drifted from assets.lock.json -- someone modified the checked-in copy without regenerating the lock (or vice versa). This is not an upstream-provenance mismatch; see provenance." ,
        });
      }
      continue;
    }

    const destAbs = path.join(destRoot, src.dest);

    if (!verifying && !args.verifyOnly && (await fileExists(destAbs))) {
      skippedExisting.push(src.dest); // safety rule: never touch what's already there
      continue;
    }

    let buf;
    if (args.verifyOnly) {
      if (!(await fileExists(destAbs))) {
        console.warn(`[verify-only] MISSING: ${src.dest}`);
        continue;
      }
      buf = await readFile(destAbs);
    } else {
      console.log(`[fetch] ${src.dest} <- ${src.url}`);
      buf = await downloadTo(src.url, destAbs);
    }

    const sha256 = createHash("sha256").update(buf).digest("hex");
    if (sha256 === rec.sha256 && buf.length === rec.size) {
      console.log(`[ok] ${src.dest} matches assets.lock.json (${buf.length} bytes)`);
    } else {
      mismatches.push({ dest: src.dest, url: src.url, expected: rec, actual: { sha256, size: buf.length }, note: src.verified });
    }
  }

  if (trackedOk.length) console.log(`[ok] tracked, verified in place (not fetched): ${trackedOk.join(", ")}`);
  if (skippedExisting.length) console.log(`[skip] already present, not touched: ${skippedExisting.join(", ")}`);

  if (mismatches.length) {
    console.error("\n=== MISMATCHES ===");
    for (const m of mismatches) {
      console.error(`- ${m.dest}${m.tracked ? " (TRACKED)" : ""}`);
      if (!m.tracked) console.error(`    source:   ${m.url}`);
      console.error(`    expected: sha256=${m.expected.sha256} size=${m.expected.size}`);
      console.error(
        m.actual ? `    actual:   sha256=${m.actual.sha256} size=${m.actual.size}` : "    actual:   (file missing)"
      );
      console.error(`    note:     ${m.note}`);
    }
    console.error(`\n${mismatches.length} file(s) did not match the local-derived lock manifest.`);
    if (!args.allowMismatch) {
      console.error(
        "Refusing to run `npm run build` with mismatched assets. Re-run with " +
          "--allow-mismatch to proceed anyway, or resolve the source of the mismatch."
      );
      process.exit(1);
    }
    console.warn("--allow-mismatch set: proceeding despite the mismatch(es) above.");
  }

  if (verifying || args.verifyOnly) {
    console.log(
      verifying
        ? "\n--dest mode: verification complete. extension/models and extension/ort were not touched; npm run build was not run."
        : "\n--verify-only: complete. Nothing fetched or built."
    );
    return;
  }

  console.log("\n[build] running `npm run build` in extension/ ...");
  execFileSync("npm", ["run", "build"], { cwd: EXT_ROOT, stdio: "inherit", shell: process.platform === "win32" });
  console.log("[build] done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
