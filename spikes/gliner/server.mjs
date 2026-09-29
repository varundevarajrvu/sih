// Minimal static file server for the browser spike. Serves:
//   /               -> index.html
//   /bundle.js      -> esbuild output (built separately, see build.mjs)
//   /models/*       -> the downloaded ONNX weights
//   /ort-wasm/*     -> onnxruntime-web's wasm binaries (renamed so GLiNER.js's
//                      wasmPaths setting can find them at a stable prefix)
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT ? Number(process.env.PORT) : 8934;

const MIME = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".wasm": "application/wasm",
  ".onnx": "application/octet-stream",
  ".json": "application/json",
};

function safeJoin(base, reqPath) {
  const p = path.normalize(path.join(base, reqPath));
  if (!p.startsWith(base)) return null;
  return p;
}

const server = http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split("?")[0]);
  if (urlPath === "/") urlPath = "/index.html";

  let filePath = null;
  if (urlPath.startsWith("/ort-wasm/")) {
    filePath = safeJoin(
      path.join(__dirname, "node_modules", "onnxruntime-web", "dist"),
      urlPath.replace("/ort-wasm/", "/")
    );
  } else {
    filePath = safeJoin(__dirname, urlPath);
  }

  if (!filePath || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404);
    res.end("not found: " + urlPath);
    return;
  }

  const ext = path.extname(filePath);
  res.writeHead(200, {
    "content-type": MIME[ext] || "application/octet-stream",
    "cross-origin-opener-policy": "same-origin",
    "cross-origin-embedder-policy": "require-corp",
  });
  fs.createReadStream(filePath).pipe(res);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[server] listening on http://127.0.0.1:${PORT}`);
});
