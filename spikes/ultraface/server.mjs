// Minimal static file server for the ultraface-spike harness. No framework
// dependency -- serves spikes/ultraface/public at "/", models at "/models/",
// and fixtures at "/fixtures/". Exports start(port) for run-bench.mjs.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".json": "application/json",
  ".wasm": "application/wasm",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
};

const ROUTES = [
  ["/models/", path.join(__dirname, "models")],
  ["/fixtures/", path.join(__dirname, "fixtures")],
  ["/", path.join(__dirname, "public")],
];

function resolveFile(urlPath) {
  for (const [prefix, dir] of ROUTES) {
    if (urlPath.startsWith(prefix)) {
      const rel = urlPath.slice(prefix.length);
      const full = path.join(dir, rel);
      if (!full.startsWith(dir)) return null; // path traversal guard
      return full;
    }
  }
  return null;
}

export function start(port = 8990) {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(req.url.split("?")[0]);
    const file = resolveFile(urlPath === "/" ? "/harness.html" : urlPath);
    if (!file || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      res.end("not found: " + urlPath);
      return;
    }
    const ext = path.extname(file);
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "credentialless",
    });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

// Windows-safe entry-point check: process.argv[1] is a native path
// (backslashes, no leading slash); import.meta.url is a file:// URL. A naive
// string-concat comparison never matches on Windows, so main() silently
// never runs and the process exits immediately (observed: exited 0 with
// zero log output). pathToFileURL() normalizes both sides correctly.
if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const port = Number(process.argv[2]) || 8990;
  start(port).then(() => console.log(`serving on http://127.0.0.1:${port}`));
}
