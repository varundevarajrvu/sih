var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __esm = (fn, res, err) => function __init() {
  if (err) throw err[0];
  try {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  } catch (e) {
    throw err = [e], e;
  }
};
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// node_modules/@xenova/transformers/src/utils/core.js
function dispatchCallback(progress_callback, data) {
  if (progress_callback) progress_callback(data);
}
function reverseDictionary(data) {
  return Object.fromEntries(Object.entries(data).map(([key, value]) => [value, key]));
}
function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function isTypedArray(val) {
  return val?.prototype?.__proto__?.constructor?.name === "TypedArray";
}
function isIntegralNumber(x) {
  return Number.isInteger(x) || typeof x === "bigint";
}
function exists(x) {
  return x !== void 0 && x !== null;
}
function calculateDimensions(arr) {
  const dimensions = [];
  let current = arr;
  while (Array.isArray(current)) {
    dimensions.push(current.length);
    current = current[0];
  }
  return dimensions;
}
function pop(obj, key, defaultValue = void 0) {
  const value = obj[key];
  if (value !== void 0) {
    delete obj[key];
    return value;
  }
  if (defaultValue === void 0) {
    throw Error(`Key ${key} does not exist in object.`);
  }
  return defaultValue;
}
function mergeArrays(...arrs) {
  return Array.prototype.concat.apply([], arrs);
}
function product(...a) {
  return a.reduce((a2, b) => a2.flatMap((d) => b.map((e) => [d, e])));
}
function calculateReflectOffset(i, w) {
  return Math.abs((i + w) % (2 * w) - w);
}
var Callable;
var init_core = __esm({
  "node_modules/@xenova/transformers/src/utils/core.js"() {
    Callable = /** @type {any} */
    class {
      /**
      * Creates a new instance of the Callable class.
      */
      constructor() {
        let closure = function(...args) {
          return closure._call(...args);
        };
        return Object.setPrototypeOf(closure, new.target.prototype);
      }
      /**
       * This method should be implemented in subclasses to provide the
       * functionality of the callable object.
       *
       * @param {any[]} args
       * @throws {Error} If the subclass does not implement the `_call` method.
       */
      _call(...args) {
        throw Error("Must implement _call method in subclass");
      }
    };
  }
});

// (disabled):fs
var require_fs = __commonJS({
  "(disabled):fs"() {
  }
});

// (disabled):path
var require_path = __commonJS({
  "(disabled):path"() {
  }
});

// (disabled):url
var require_url = __commonJS({
  "(disabled):url"() {
  }
});

// (disabled):node_modules/@xenova/transformers/node_modules/onnxruntime-node/dist/index.js
var require_dist = __commonJS({
  "(disabled):node_modules/@xenova/transformers/node_modules/onnxruntime-node/dist/index.js"() {
  }
});

// node_modules/@xenova/transformers/src/backends/onnx.js
import * as ONNX_WEB from "onnxruntime-web";
var ONNX_NODE, ONNX, executionProviders;
var init_onnx = __esm({
  "node_modules/@xenova/transformers/src/backends/onnx.js"() {
    ONNX_NODE = __toESM(require_dist(), 1);
    executionProviders = [
      // 'webgpu',
      "wasm"
    ];
    if (typeof process !== "undefined" && process?.release?.name === "node") {
      ONNX = ONNX_NODE.default ?? ONNX_NODE;
      executionProviders.unshift("cpu");
    } else {
      ONNX = ONNX_WEB.default ?? ONNX_WEB;
      const isIOS = typeof navigator !== "undefined" && /iP(hone|od|ad).+16_4.+AppleWebKit/.test(navigator.userAgent);
      if (isIOS) {
        ONNX.env.wasm.simd = false;
      }
    }
  }
});

// node_modules/@xenova/transformers/src/env.js
function isEmpty(obj) {
  return Object.keys(obj).length === 0;
}
var import_fs, import_path, import_url, onnx_env, VERSION, WEB_CACHE_AVAILABLE, FS_AVAILABLE, PATH_AVAILABLE, RUNNING_LOCALLY, __dirname, DEFAULT_CACHE_DIR, DEFAULT_LOCAL_MODEL_PATH, localModelPath, env;
var init_env = __esm({
  "node_modules/@xenova/transformers/src/env.js"() {
    import_fs = __toESM(require_fs(), 1);
    import_path = __toESM(require_path(), 1);
    import_url = __toESM(require_url(), 1);
    init_onnx();
    ({ env: onnx_env } = ONNX);
    VERSION = "2.17.2";
    WEB_CACHE_AVAILABLE = typeof self !== "undefined" && "caches" in self;
    FS_AVAILABLE = !isEmpty(import_fs.default);
    PATH_AVAILABLE = !isEmpty(import_path.default);
    RUNNING_LOCALLY = FS_AVAILABLE && PATH_AVAILABLE;
    __dirname = RUNNING_LOCALLY ? import_path.default.dirname(import_path.default.dirname(import_url.default.fileURLToPath(import.meta.url))) : "./";
    DEFAULT_CACHE_DIR = RUNNING_LOCALLY ? import_path.default.join(__dirname, "/.cache/") : null;
    DEFAULT_LOCAL_MODEL_PATH = "/models/";
    localModelPath = RUNNING_LOCALLY ? import_path.default.join(__dirname, DEFAULT_LOCAL_MODEL_PATH) : DEFAULT_LOCAL_MODEL_PATH;
    if (onnx_env?.wasm) {
      onnx_env.wasm.wasmPaths = RUNNING_LOCALLY ? import_path.default.join(__dirname, "/dist/") : `https://cdn.jsdelivr.net/npm/@xenova/transformers@${VERSION}/dist/`;
    }
    env = {
      /////////////////// Backends settings ///////////////////
      backends: {
        // onnxruntime-web/onnxruntime-node
        onnx: onnx_env,
        // TensorFlow.js
        tfjs: {}
      },
      __dirname,
      version: VERSION,
      /////////////////// Model settings ///////////////////
      allowRemoteModels: true,
      remoteHost: "https://huggingface.co/",
      remotePathTemplate: "{model}/resolve/{revision}/",
      allowLocalModels: true,
      localModelPath,
      useFS: FS_AVAILABLE,
      /////////////////// Cache settings ///////////////////
      useBrowserCache: WEB_CACHE_AVAILABLE,
      useFSCache: FS_AVAILABLE,
      cacheDir: DEFAULT_CACHE_DIR,
      useCustomCache: false,
      customCache: null
      //////////////////////////////////////////////////////
    };
  }
});

// node_modules/@xenova/transformers/src/utils/hub.js
function isValidUrl(string, protocols = null, validHosts = null) {
  let url2;
  try {
    url2 = new URL(string);
  } catch (_) {
    return false;
  }
  if (protocols && !protocols.includes(url2.protocol)) {
    return false;
  }
  if (validHosts && !validHosts.includes(url2.hostname)) {
    return false;
  }
  return true;
}
async function getFile(urlOrPath) {
  if (env.useFS && !isValidUrl(urlOrPath, ["http:", "https:", "blob:"])) {
    return new FileResponse(urlOrPath);
  } else if (typeof process !== "undefined" && process?.release?.name === "node") {
    const IS_CI = !!process.env?.TESTING_REMOTELY;
    const version = env.version;
    const headers = new Headers();
    headers.set("User-Agent", `transformers.js/${version}; is_ci/${IS_CI};`);
    const isHFURL = isValidUrl(urlOrPath, ["http:", "https:"], ["huggingface.co", "hf.co"]);
    if (isHFURL) {
      const token = process.env?.HF_TOKEN ?? process.env?.HF_ACCESS_TOKEN;
      if (token) {
        headers.set("Authorization", `Bearer ${token}`);
      }
    }
    return fetch(urlOrPath, { headers });
  } else {
    return fetch(urlOrPath);
  }
}
function handleError(status, remoteURL, fatal) {
  if (!fatal) {
    return null;
  }
  const message = ERROR_MAPPING[status] ?? `Error (${status}) occurred while trying to load file`;
  throw Error(`${message}: "${remoteURL}".`);
}
async function tryCache(cache, ...names) {
  for (let name of names) {
    try {
      let result = await cache.match(name);
      if (result) return result;
    } catch (e) {
      continue;
    }
  }
  return void 0;
}
async function getModelFile(path_or_repo_id, filename, fatal = true, options = {}) {
  if (!env.allowLocalModels) {
    if (options.local_files_only) {
      throw Error("Invalid configuration detected: local models are disabled (`env.allowLocalModels=false`) but you have requested to only use local models (`local_files_only=true`).");
    } else if (!env.allowRemoteModels) {
      throw Error("Invalid configuration detected: both local and remote models are disabled. Fix by setting `env.allowLocalModels` or `env.allowRemoteModels` to `true`.");
    }
  }
  dispatchCallback(options.progress_callback, {
    status: "initiate",
    name: path_or_repo_id,
    file: filename
  });
  let cache;
  if (!cache && env.useBrowserCache) {
    if (typeof caches === "undefined") {
      throw Error("Browser cache is not available in this environment.");
    }
    try {
      cache = await caches.open("transformers-cache");
    } catch (e) {
      console.warn("An error occurred while opening the browser cache:", e);
    }
  }
  if (!cache && env.useFSCache) {
    cache = new FileCache(options.cache_dir ?? env.cacheDir);
  }
  if (!cache && env.useCustomCache) {
    if (!env.customCache) {
      throw Error("`env.useCustomCache=true`, but `env.customCache` is not defined.");
    }
    if (!env.customCache.match || !env.customCache.put) {
      throw new Error(
        "`env.customCache` must be an object which implements the `match` and `put` functions of the Web Cache API. For more information, see https://developer.mozilla.org/en-US/docs/Web/API/Cache"
      );
    }
    cache = env.customCache;
  }
  const revision = options.revision ?? "main";
  let requestURL = pathJoin(path_or_repo_id, filename);
  let localPath = pathJoin(env.localModelPath, requestURL);
  let remoteURL = pathJoin(
    env.remoteHost,
    env.remotePathTemplate.replaceAll("{model}", path_or_repo_id).replaceAll("{revision}", encodeURIComponent(revision)),
    filename
  );
  let fsCacheKey = revision === "main" ? requestURL : pathJoin(path_or_repo_id, revision, filename);
  let cacheKey;
  let proposedCacheKey = cache instanceof FileCache ? fsCacheKey : remoteURL;
  let toCacheResponse = false;
  let response;
  if (cache) {
    response = await tryCache(cache, localPath, proposedCacheKey);
  }
  const cacheHit = response !== void 0;
  if (response === void 0) {
    if (env.allowLocalModels) {
      const isURL = isValidUrl(requestURL, ["http:", "https:"]);
      if (!isURL) {
        try {
          response = await getFile(localPath);
          cacheKey = localPath;
        } catch (e) {
          console.warn(`Unable to load from local path "${localPath}": "${e}"`);
        }
      } else if (options.local_files_only) {
        throw new Error(`\`local_files_only=true\`, but attempted to load a remote file from: ${requestURL}.`);
      } else if (!env.allowRemoteModels) {
        throw new Error(`\`env.allowRemoteModels=false\`, but attempted to load a remote file from: ${requestURL}.`);
      }
    }
    if (response === void 0 || response.status === 404) {
      if (options.local_files_only || !env.allowRemoteModels) {
        if (fatal) {
          throw Error(`\`local_files_only=true\` or \`env.allowRemoteModels=false\` and file was not found locally at "${localPath}".`);
        } else {
          return null;
        }
      }
      response = await getFile(remoteURL);
      if (response.status !== 200) {
        return handleError(response.status, remoteURL, fatal);
      }
      cacheKey = proposedCacheKey;
    }
    toCacheResponse = cache && typeof Response !== "undefined" && response instanceof Response && response.status === 200;
  }
  dispatchCallback(options.progress_callback, {
    status: "download",
    name: path_or_repo_id,
    file: filename
  });
  const progressInfo = {
    status: "progress",
    name: path_or_repo_id,
    file: filename
  };
  let buffer;
  if (!options.progress_callback) {
    buffer = new Uint8Array(await response.arrayBuffer());
  } else if (cacheHit && typeof navigator !== "undefined" && /firefox/i.test(navigator.userAgent)) {
    buffer = new Uint8Array(await response.arrayBuffer());
    dispatchCallback(options.progress_callback, {
      ...progressInfo,
      progress: 100,
      loaded: buffer.length,
      total: buffer.length
    });
  } else {
    buffer = await readResponse(response, (data) => {
      dispatchCallback(options.progress_callback, {
        ...progressInfo,
        ...data
      });
    });
  }
  if (
    // Only cache web responses
    // i.e., do not cache FileResponses (prevents duplication)
    toCacheResponse && cacheKey && // Check again whether request is in cache. If not, we add the response to the cache
    await cache.match(cacheKey) === void 0
  ) {
    await cache.put(cacheKey, new Response(buffer, {
      headers: response.headers
    })).catch((err) => {
      console.warn(`Unable to add response to browser cache: ${err}.`);
    });
  }
  dispatchCallback(options.progress_callback, {
    status: "done",
    name: path_or_repo_id,
    file: filename
  });
  return buffer;
}
async function getModelJSON(modelPath, fileName, fatal = true, options = {}) {
  let buffer = await getModelFile(modelPath, fileName, fatal, options);
  if (buffer === null) {
    return {};
  }
  let decoder = new TextDecoder("utf-8");
  let jsonData = decoder.decode(buffer);
  return JSON.parse(jsonData);
}
async function readResponse(response, progress_callback) {
  const contentLength = response.headers.get("Content-Length");
  if (contentLength === null) {
    console.warn("Unable to determine content-length from response headers. Will expand buffer when needed.");
  }
  let total = parseInt(contentLength ?? "0");
  let buffer = new Uint8Array(total);
  let loaded = 0;
  const reader = response.body.getReader();
  async function read() {
    const { done, value } = await reader.read();
    if (done) return;
    let newLoaded = loaded + value.length;
    if (newLoaded > total) {
      total = newLoaded;
      let newBuffer = new Uint8Array(total);
      newBuffer.set(buffer);
      buffer = newBuffer;
    }
    buffer.set(value, loaded);
    loaded = newLoaded;
    const progress = loaded / total * 100;
    progress_callback({
      progress,
      loaded,
      total
    });
    return read();
  }
  await read();
  return buffer;
}
function pathJoin(...parts) {
  parts = parts.map((part, index) => {
    if (index) {
      part = part.replace(new RegExp("^/"), "");
    }
    if (index !== parts.length - 1) {
      part = part.replace(new RegExp("/$"), "");
    }
    return part;
  });
  return parts.join("/");
}
var import_fs2, import_path2, FileResponse, ERROR_MAPPING, FileCache;
var init_hub = __esm({
  "node_modules/@xenova/transformers/src/utils/hub.js"() {
    import_fs2 = __toESM(require_fs(), 1);
    import_path2 = __toESM(require_path(), 1);
    init_env();
    init_core();
    FileResponse = class _FileResponse {
      /**
       * Mapping from file extensions to MIME types.
       */
      _CONTENT_TYPE_MAP = {
        "txt": "text/plain",
        "html": "text/html",
        "css": "text/css",
        "js": "text/javascript",
        "json": "application/json",
        "png": "image/png",
        "jpg": "image/jpeg",
        "jpeg": "image/jpeg",
        "gif": "image/gif"
      };
      /**
       * Creates a new `FileResponse` object.
       * @param {string|URL} filePath
       */
      constructor(filePath) {
        this.filePath = filePath;
        this.headers = new Headers();
        this.exists = import_fs2.default.existsSync(filePath);
        if (this.exists) {
          this.status = 200;
          this.statusText = "OK";
          let stats = import_fs2.default.statSync(filePath);
          this.headers.set("content-length", stats.size.toString());
          this.updateContentType();
          let self2 = this;
          this.body = new ReadableStream({
            start(controller) {
              self2.arrayBuffer().then((buffer) => {
                controller.enqueue(new Uint8Array(buffer));
                controller.close();
              });
            }
          });
        } else {
          this.status = 404;
          this.statusText = "Not Found";
          this.body = null;
        }
      }
      /**
       * Updates the 'content-type' header property of the response based on the extension of
       * the file specified by the filePath property of the current object.
       * @returns {void}
       */
      updateContentType() {
        const extension = this.filePath.toString().split(".").pop().toLowerCase();
        this.headers.set("content-type", this._CONTENT_TYPE_MAP[extension] ?? "application/octet-stream");
      }
      /**
       * Clone the current FileResponse object.
       * @returns {FileResponse} A new FileResponse object with the same properties as the current object.
       */
      clone() {
        let response = new _FileResponse(this.filePath);
        response.exists = this.exists;
        response.status = this.status;
        response.statusText = this.statusText;
        response.headers = new Headers(this.headers);
        return response;
      }
      /**
       * Reads the contents of the file specified by the filePath property and returns a Promise that
       * resolves with an ArrayBuffer containing the file's contents.
       * @returns {Promise<ArrayBuffer>} A Promise that resolves with an ArrayBuffer containing the file's contents.
       * @throws {Error} If the file cannot be read.
       */
      async arrayBuffer() {
        const data = await import_fs2.default.promises.readFile(this.filePath);
        return data.buffer;
      }
      /**
       * Reads the contents of the file specified by the filePath property and returns a Promise that
       * resolves with a Blob containing the file's contents.
       * @returns {Promise<Blob>} A Promise that resolves with a Blob containing the file's contents.
       * @throws {Error} If the file cannot be read.
       */
      async blob() {
        const data = await import_fs2.default.promises.readFile(this.filePath);
        return new Blob([data], { type: this.headers.get("content-type") });
      }
      /**
       * Reads the contents of the file specified by the filePath property and returns a Promise that
       * resolves with a string containing the file's contents.
       * @returns {Promise<string>} A Promise that resolves with a string containing the file's contents.
       * @throws {Error} If the file cannot be read.
       */
      async text() {
        const data = await import_fs2.default.promises.readFile(this.filePath, "utf8");
        return data;
      }
      /**
       * Reads the contents of the file specified by the filePath property and returns a Promise that
       * resolves with a parsed JavaScript object containing the file's contents.
       * 
       * @returns {Promise<Object>} A Promise that resolves with a parsed JavaScript object containing the file's contents.
       * @throws {Error} If the file cannot be read.
       */
      async json() {
        return JSON.parse(await this.text());
      }
    };
    ERROR_MAPPING = {
      // 4xx errors (https://developer.mozilla.org/en-US/docs/Web/HTTP/Status#client_error_responses)
      400: "Bad request error occurred while trying to load file",
      401: "Unauthorized access to file",
      403: "Forbidden access to file",
      404: "Could not locate file",
      408: "Request timeout error occurred while trying to load file",
      // 5xx errors (https://developer.mozilla.org/en-US/docs/Web/HTTP/Status#server_error_responses)
      500: "Internal server error error occurred while trying to load file",
      502: "Bad gateway error occurred while trying to load file",
      503: "Service unavailable error occurred while trying to load file",
      504: "Gateway timeout error occurred while trying to load file"
    };
    FileCache = class {
      /**
       * Instantiate a `FileCache` object.
       * @param {string} path 
       */
      constructor(path3) {
        this.path = path3;
      }
      /**
       * Checks whether the given request is in the cache.
       * @param {string} request 
       * @returns {Promise<FileResponse | undefined>}
       */
      async match(request) {
        let filePath = import_path2.default.join(this.path, request);
        let file = new FileResponse(filePath);
        if (file.exists) {
          return file;
        } else {
          return void 0;
        }
      }
      /**
       * Adds the given response to the cache.
       * @param {string} request 
       * @param {Response|FileResponse} response 
       * @returns {Promise<void>}
       */
      async put(request, response) {
        const buffer = Buffer.from(await response.arrayBuffer());
        let outputPath = import_path2.default.join(this.path, request);
        try {
          await import_fs2.default.promises.mkdir(import_path2.default.dirname(outputPath), { recursive: true });
          await import_fs2.default.promises.writeFile(outputPath, buffer);
        } catch (err) {
          console.warn("An error occurred while writing the file to cache:", err);
        }
      }
      // TODO add the rest?
      // addAll(requests: RequestInfo[]): Promise<void>;
      // delete(request: RequestInfo | URL, options?: CacheQueryOptions): Promise<boolean>;
      // keys(request?: RequestInfo | URL, options?: CacheQueryOptions): Promise<ReadonlyArray<Request>>;
      // match(request: RequestInfo | URL, options?: CacheQueryOptions): Promise<Response | undefined>;
      // matchAll(request?: RequestInfo | URL, options?: CacheQueryOptions): Promise<ReadonlyArray<Response>>;
    };
  }
});

// node_modules/@xenova/transformers/src/utils/maths.js
function interpolate_data(input, [in_channels, in_height, in_width], [out_height, out_width], mode = "bilinear", align_corners = false) {
  const x_scale = out_width / in_width;
  const y_scale = out_height / in_height;
  const out_img = new input.constructor(out_height * out_width * in_channels);
  const inStride = in_height * in_width;
  const outStride = out_height * out_width;
  for (let i = 0; i < out_height; ++i) {
    for (let j = 0; j < out_width; ++j) {
      const outOffset = i * out_width + j;
      const x = (j + 0.5) / x_scale - 0.5;
      const y = (i + 0.5) / y_scale - 0.5;
      let x1 = Math.floor(x);
      let y1 = Math.floor(y);
      const x2 = Math.min(x1 + 1, in_width - 1);
      const y2 = Math.min(y1 + 1, in_height - 1);
      x1 = Math.max(x1, 0);
      y1 = Math.max(y1, 0);
      const s = x - x1;
      const t = y - y1;
      const w1 = (1 - s) * (1 - t);
      const w2 = s * (1 - t);
      const w3 = (1 - s) * t;
      const w4 = s * t;
      const yStride = y1 * in_width;
      const xStride = y2 * in_width;
      const idx1 = yStride + x1;
      const idx2 = yStride + x2;
      const idx3 = xStride + x1;
      const idx4 = xStride + x2;
      for (let k = 0; k < in_channels; ++k) {
        const cOffset = k * inStride;
        out_img[k * outStride + outOffset] = w1 * input[cOffset + idx1] + w2 * input[cOffset + idx2] + w3 * input[cOffset + idx3] + w4 * input[cOffset + idx4];
      }
    }
  }
  return out_img;
}
function permute_data(array, dims, axes) {
  const shape = new Array(axes.length);
  const stride = new Array(axes.length);
  for (let i = axes.length - 1, s = 1; i >= 0; --i) {
    stride[i] = s;
    shape[i] = dims[axes[i]];
    s *= shape[i];
  }
  const invStride = axes.map((_, i) => stride[axes.indexOf(i)]);
  const permutedData = new array.constructor(array.length);
  for (let i = 0; i < array.length; ++i) {
    let newIndex = 0;
    for (let j = dims.length - 1, k = i; j >= 0; --j) {
      newIndex += k % dims[j] * invStride[j];
      k = Math.floor(k / dims[j]);
    }
    permutedData[newIndex] = array[i];
  }
  return [permutedData, shape];
}
function softmax(arr) {
  const maxVal = max(arr)[0];
  const exps = arr.map((x) => Math.exp(x - maxVal));
  const sumExps = exps.reduce((acc, val) => acc + val, 0);
  const softmaxArr = exps.map((x) => x / sumExps);
  return (
    /** @type {T} */
    softmaxArr
  );
}
function log_softmax(arr) {
  const softmaxArr = softmax(arr);
  const logSoftmaxArr = softmaxArr.map((x) => Math.log(x));
  return (
    /** @type {T} */
    logSoftmaxArr
  );
}
function getTopItems(items, top_k = 0) {
  items = Array.from(items).map((x, i) => [i, x]).sort((a, b) => b[1] - a[1]);
  if (top_k !== null && top_k > 0) {
    items = items.slice(0, top_k);
  }
  return items;
}
function min(arr) {
  if (arr.length === 0) throw Error("Array must not be empty");
  let min2 = arr[0];
  let indexOfMin = 0;
  for (let i = 1; i < arr.length; ++i) {
    if (arr[i] < min2) {
      min2 = arr[i];
      indexOfMin = i;
    }
  }
  return [min2, indexOfMin];
}
function max(arr) {
  if (arr.length === 0) throw Error("Array must not be empty");
  let max2 = arr[0];
  let indexOfMax = 0;
  for (let i = 1; i < arr.length; ++i) {
    if (arr[i] > max2) {
      max2 = arr[i];
      indexOfMax = i;
    }
  }
  return [Number(max2), indexOfMax];
}
function isPowerOfTwo(number) {
  return number > 0 && (number & number - 1) === 0;
}
function medianFilter(data, windowSize) {
  if (windowSize % 2 === 0 || windowSize <= 0) {
    throw new Error("Window size must be a positive odd number");
  }
  const outputArray = new data.constructor(data.length);
  const buffer = new data.constructor(windowSize);
  const halfWindowSize = Math.floor(windowSize / 2);
  for (let i = 0; i < data.length; ++i) {
    let valuesIndex = 0;
    for (let j = -halfWindowSize; j <= halfWindowSize; ++j) {
      let index = i + j;
      if (index < 0) {
        index = Math.abs(index);
      } else if (index >= data.length) {
        index = 2 * (data.length - 1) - index;
      }
      buffer[valuesIndex++] = data[index];
    }
    buffer.sort();
    outputArray[i] = buffer[halfWindowSize];
  }
  return outputArray;
}
function round(num, decimals) {
  const pow = Math.pow(10, decimals);
  return Math.round(num * pow) / pow;
}
function bankers_round(x) {
  const r = Math.round(x);
  const br = Math.abs(x) % 1 === 0.5 ? r % 2 === 0 ? r : r - 1 : r;
  return br;
}
var P2FFT, NP2FFT, FFT;
var init_maths = __esm({
  "node_modules/@xenova/transformers/src/utils/maths.js"() {
    P2FFT = class {
      /**
       * @param {number} size The size of the input array. Must be a power of two larger than 1.
       * @throws {Error} FFT size must be a power of two larger than 1.
       */
      constructor(size) {
        this.size = size | 0;
        if (this.size <= 1 || !isPowerOfTwo(this.size))
          throw new Error("FFT size must be a power of two larger than 1");
        this._csize = size << 1;
        this.table = new Float64Array(this.size * 2);
        for (let i = 0; i < this.table.length; i += 2) {
          const angle = Math.PI * i / this.size;
          this.table[i] = Math.cos(angle);
          this.table[i + 1] = -Math.sin(angle);
        }
        let power = 0;
        for (let t = 1; this.size > t; t <<= 1)
          ++power;
        this._width = power % 2 === 0 ? power - 1 : power;
        this._bitrev = new Int32Array(1 << this._width);
        for (let j = 0; j < this._bitrev.length; ++j) {
          this._bitrev[j] = 0;
          for (let shift = 0; shift < this._width; shift += 2) {
            const revShift = this._width - shift - 2;
            this._bitrev[j] |= (j >>> shift & 3) << revShift;
          }
        }
      }
      /**
       * Create a complex number array with size `2 * size`
       *
       * @returns {Float64Array} A complex number array with size `2 * size`
       */
      createComplexArray() {
        return new Float64Array(this._csize);
      }
      /**
       * Converts a complex number representation stored in a Float64Array to an array of real numbers.
       * 
       * @param {Float64Array} complex The complex number representation to be converted.
       * @param {number[]} [storage] An optional array to store the result in.
       * @returns {number[]} An array of real numbers representing the input complex number representation.
       */
      fromComplexArray(complex, storage) {
        const res = storage || new Array(complex.length >>> 1);
        for (let i = 0; i < complex.length; i += 2)
          res[i >>> 1] = complex[i];
        return res;
      }
      /**
       * Convert a real-valued input array to a complex-valued output array.
       * @param {Float64Array} input The real-valued input array.
       * @param {Float64Array} [storage] Optional buffer to store the output array.
       * @returns {Float64Array} The complex-valued output array.
       */
      toComplexArray(input, storage) {
        const res = storage || this.createComplexArray();
        for (let i = 0; i < res.length; i += 2) {
          res[i] = input[i >>> 1];
          res[i + 1] = 0;
        }
        return res;
      }
      /**
       * Performs a Fast Fourier Transform (FFT) on the given input data and stores the result in the output buffer.
       * 
       * @param {Float64Array} out The output buffer to store the result.
       * @param {Float64Array} data The input data to transform.
       * 
       * @throws {Error} Input and output buffers must be different.
       * 
       * @returns {void}
       */
      transform(out, data) {
        if (out === data)
          throw new Error("Input and output buffers must be different");
        this._transform4(
          out,
          data,
          1
          /* DONE */
        );
      }
      /**
       * Performs a real-valued forward FFT on the given input buffer and stores the result in the given output buffer.
       * The input buffer must contain real values only, while the output buffer will contain complex values. The input and
       * output buffers must be different.
       *
       * @param {Float64Array} out The output buffer.
       * @param {Float64Array} data The input buffer containing real values.
       *
       * @throws {Error} If the input and output buffers are the same.
       */
      realTransform(out, data) {
        if (out === data)
          throw new Error("Input and output buffers must be different");
        this._realTransform4(
          out,
          data,
          1
          /* DONE */
        );
      }
      /**
       * Performs an inverse FFT transformation on the given `data` array, and stores the result in `out`.
       * The `out` array must be a different buffer than the `data` array. The `out` array will contain the
       * result of the transformation. The `data` array will not be modified.
       * 
       * @param {Float64Array} out The output buffer for the transformed data.
       * @param {Float64Array} data The input data to transform.
       * @throws {Error} If `out` and `data` refer to the same buffer.
       * @returns {void}
       */
      inverseTransform(out, data) {
        if (out === data)
          throw new Error("Input and output buffers must be different");
        this._transform4(
          out,
          data,
          -1
          /* DONE */
        );
        for (let i = 0; i < out.length; ++i)
          out[i] /= this.size;
      }
      /**
       * Performs a radix-4 implementation of a discrete Fourier transform on a given set of data.
       *
       * @param {Float64Array} out The output buffer for the transformed data.
       * @param {Float64Array} data The input buffer of data to be transformed.
       * @param {number} inv A scaling factor to apply to the transform.
       * @returns {void}
       */
      _transform4(out, data, inv) {
        const size = this._csize;
        const width = this._width;
        let step = 1 << width;
        let len = size / step << 1;
        let outOff;
        let t;
        const bitrev = this._bitrev;
        if (len === 4) {
          for (outOff = 0, t = 0; outOff < size; outOff += len, ++t) {
            const off = bitrev[t];
            this._singleTransform2(data, out, outOff, off, step);
          }
        } else {
          for (outOff = 0, t = 0; outOff < size; outOff += len, ++t) {
            const off = bitrev[t];
            this._singleTransform4(data, out, outOff, off, step, inv);
          }
        }
        const table = this.table;
        for (step >>= 2; step >= 2; step >>= 2) {
          len = size / step << 1;
          const quarterLen = len >>> 2;
          for (outOff = 0; outOff < size; outOff += len) {
            const limit = outOff + quarterLen - 1;
            for (let i = outOff, k = 0; i < limit; i += 2, k += step) {
              const A = i;
              const B = A + quarterLen;
              const C = B + quarterLen;
              const D = C + quarterLen;
              const Ar = out[A];
              const Ai = out[A + 1];
              const Br = out[B];
              const Bi = out[B + 1];
              const Cr = out[C];
              const Ci = out[C + 1];
              const Dr = out[D];
              const Di = out[D + 1];
              const tableBr = table[k];
              const tableBi = inv * table[k + 1];
              const MBr = Br * tableBr - Bi * tableBi;
              const MBi = Br * tableBi + Bi * tableBr;
              const tableCr = table[2 * k];
              const tableCi = inv * table[2 * k + 1];
              const MCr = Cr * tableCr - Ci * tableCi;
              const MCi = Cr * tableCi + Ci * tableCr;
              const tableDr = table[3 * k];
              const tableDi = inv * table[3 * k + 1];
              const MDr = Dr * tableDr - Di * tableDi;
              const MDi = Dr * tableDi + Di * tableDr;
              const T0r = Ar + MCr;
              const T0i = Ai + MCi;
              const T1r = Ar - MCr;
              const T1i = Ai - MCi;
              const T2r = MBr + MDr;
              const T2i = MBi + MDi;
              const T3r = inv * (MBr - MDr);
              const T3i = inv * (MBi - MDi);
              out[A] = T0r + T2r;
              out[A + 1] = T0i + T2i;
              out[B] = T1r + T3i;
              out[B + 1] = T1i - T3r;
              out[C] = T0r - T2r;
              out[C + 1] = T0i - T2i;
              out[D] = T1r - T3i;
              out[D + 1] = T1i + T3r;
            }
          }
        }
      }
      /**
       * Performs a radix-2 implementation of a discrete Fourier transform on a given set of data.
       *
       * @param {Float64Array} data The input buffer of data to be transformed.
       * @param {Float64Array} out The output buffer for the transformed data.
       * @param {number} outOff The offset at which to write the output data.
       * @param {number} off The offset at which to begin reading the input data.
       * @param {number} step The step size for indexing the input data.
       * @returns {void}
       */
      _singleTransform2(data, out, outOff, off, step) {
        const evenR = data[off];
        const evenI = data[off + 1];
        const oddR = data[off + step];
        const oddI = data[off + step + 1];
        out[outOff] = evenR + oddR;
        out[outOff + 1] = evenI + oddI;
        out[outOff + 2] = evenR - oddR;
        out[outOff + 3] = evenI - oddI;
      }
      /**
       * Performs radix-4 transformation on input data of length 8
       *
       * @param {Float64Array} data Input data array of length 8
       * @param {Float64Array} out Output data array of length 8
       * @param {number} outOff Index of output array to start writing from
       * @param {number} off Index of input array to start reading from
       * @param {number} step Step size between elements in input array
       * @param {number} inv Scaling factor for inverse transform
       * 
       * @returns {void}
       */
      _singleTransform4(data, out, outOff, off, step, inv) {
        const step2 = step * 2;
        const step3 = step * 3;
        const Ar = data[off];
        const Ai = data[off + 1];
        const Br = data[off + step];
        const Bi = data[off + step + 1];
        const Cr = data[off + step2];
        const Ci = data[off + step2 + 1];
        const Dr = data[off + step3];
        const Di = data[off + step3 + 1];
        const T0r = Ar + Cr;
        const T0i = Ai + Ci;
        const T1r = Ar - Cr;
        const T1i = Ai - Ci;
        const T2r = Br + Dr;
        const T2i = Bi + Di;
        const T3r = inv * (Br - Dr);
        const T3i = inv * (Bi - Di);
        out[outOff] = T0r + T2r;
        out[outOff + 1] = T0i + T2i;
        out[outOff + 2] = T1r + T3i;
        out[outOff + 3] = T1i - T3r;
        out[outOff + 4] = T0r - T2r;
        out[outOff + 5] = T0i - T2i;
        out[outOff + 6] = T1r - T3i;
        out[outOff + 7] = T1i + T3r;
      }
      /**
       * Real input radix-4 implementation
       * @param {Float64Array} out Output array for the transformed data
       * @param {Float64Array} data Input array of real data to be transformed
       * @param {number} inv The scale factor used to normalize the inverse transform
       */
      _realTransform4(out, data, inv) {
        const size = this._csize;
        const width = this._width;
        let step = 1 << width;
        let len = size / step << 1;
        let outOff;
        let t;
        const bitrev = this._bitrev;
        if (len === 4) {
          for (outOff = 0, t = 0; outOff < size; outOff += len, ++t) {
            const off = bitrev[t];
            this._singleRealTransform2(data, out, outOff, off >>> 1, step >>> 1);
          }
        } else {
          for (outOff = 0, t = 0; outOff < size; outOff += len, ++t) {
            const off = bitrev[t];
            this._singleRealTransform4(data, out, outOff, off >>> 1, step >>> 1, inv);
          }
        }
        const table = this.table;
        for (step >>= 2; step >= 2; step >>= 2) {
          len = size / step << 1;
          const halfLen = len >>> 1;
          const quarterLen = halfLen >>> 1;
          const hquarterLen = quarterLen >>> 1;
          for (outOff = 0; outOff < size; outOff += len) {
            for (let i = 0, k = 0; i <= hquarterLen; i += 2, k += step) {
              const A = outOff + i;
              const B = A + quarterLen;
              const C = B + quarterLen;
              const D = C + quarterLen;
              const Ar = out[A];
              const Ai = out[A + 1];
              const Br = out[B];
              const Bi = out[B + 1];
              const Cr = out[C];
              const Ci = out[C + 1];
              const Dr = out[D];
              const Di = out[D + 1];
              const MAr = Ar;
              const MAi = Ai;
              const tableBr = table[k];
              const tableBi = inv * table[k + 1];
              const MBr = Br * tableBr - Bi * tableBi;
              const MBi = Br * tableBi + Bi * tableBr;
              const tableCr = table[2 * k];
              const tableCi = inv * table[2 * k + 1];
              const MCr = Cr * tableCr - Ci * tableCi;
              const MCi = Cr * tableCi + Ci * tableCr;
              const tableDr = table[3 * k];
              const tableDi = inv * table[3 * k + 1];
              const MDr = Dr * tableDr - Di * tableDi;
              const MDi = Dr * tableDi + Di * tableDr;
              const T0r = MAr + MCr;
              const T0i = MAi + MCi;
              const T1r = MAr - MCr;
              const T1i = MAi - MCi;
              const T2r = MBr + MDr;
              const T2i = MBi + MDi;
              const T3r = inv * (MBr - MDr);
              const T3i = inv * (MBi - MDi);
              out[A] = T0r + T2r;
              out[A + 1] = T0i + T2i;
              out[B] = T1r + T3i;
              out[B + 1] = T1i - T3r;
              if (i === 0) {
                out[C] = T0r - T2r;
                out[C + 1] = T0i - T2i;
                continue;
              }
              if (i === hquarterLen)
                continue;
              const SA = outOff + quarterLen - i;
              const SB = outOff + halfLen - i;
              out[SA] = T1r - inv * T3i;
              out[SA + 1] = -T1i - inv * T3r;
              out[SB] = T0r - inv * T2r;
              out[SB + 1] = -T0i + inv * T2i;
            }
          }
        }
        const half = size >>> 1;
        for (let i = 2; i < half; i += 2) {
          out[size - i] = out[i];
          out[size - i + 1] = -out[i + 1];
        }
      }
      /**
       * Performs a single real input radix-2 transformation on the provided data
       * 
       * @param {Float64Array} data The input data array
       * @param {Float64Array} out The output data array
       * @param {number} outOff The output offset
       * @param {number} off The input offset
       * @param {number} step The step
       * 
       * @returns {void}
       */
      _singleRealTransform2(data, out, outOff, off, step) {
        const evenR = data[off];
        const oddR = data[off + step];
        out[outOff] = evenR + oddR;
        out[outOff + 1] = 0;
        out[outOff + 2] = evenR - oddR;
        out[outOff + 3] = 0;
      }
      /**
       * Computes a single real-valued transform using radix-4 algorithm.
       * This method is only called for len=8.
       *
       * @param {Float64Array} data The input data array.
       * @param {Float64Array} out The output data array.
       * @param {number} outOff The offset into the output array.
       * @param {number} off The offset into the input array.
       * @param {number} step The step size for the input array.
       * @param {number} inv The value of inverse.
       */
      _singleRealTransform4(data, out, outOff, off, step, inv) {
        const step2 = step * 2;
        const step3 = step * 3;
        const Ar = data[off];
        const Br = data[off + step];
        const Cr = data[off + step2];
        const Dr = data[off + step3];
        const T0r = Ar + Cr;
        const T1r = Ar - Cr;
        const T2r = Br + Dr;
        const T3r = inv * (Br - Dr);
        out[outOff] = T0r + T2r;
        out[outOff + 1] = 0;
        out[outOff + 2] = T1r;
        out[outOff + 3] = -T3r;
        out[outOff + 4] = T0r - T2r;
        out[outOff + 5] = 0;
        out[outOff + 6] = T1r;
        out[outOff + 7] = T3r;
      }
    };
    NP2FFT = class {
      /**
       * Constructs a new NP2FFT object.
       * @param {number} fft_length The length of the FFT
       */
      constructor(fft_length) {
        const a = 2 * (fft_length - 1);
        const b = 2 * (2 * fft_length - 1);
        const nextP2 = 2 ** Math.ceil(Math.log2(b));
        this.bufferSize = nextP2;
        this._a = a;
        const chirp = new Float64Array(b);
        const ichirp = new Float64Array(nextP2);
        this._chirpBuffer = new Float64Array(nextP2);
        this._buffer1 = new Float64Array(nextP2);
        this._buffer2 = new Float64Array(nextP2);
        this._outBuffer1 = new Float64Array(nextP2);
        this._outBuffer2 = new Float64Array(nextP2);
        const theta = -2 * Math.PI / fft_length;
        const baseR = Math.cos(theta);
        const baseI = Math.sin(theta);
        for (let i = 0; i < b >> 1; ++i) {
          const e = (i + 1 - fft_length) ** 2 / 2;
          const result_mod = Math.sqrt(baseR ** 2 + baseI ** 2) ** e;
          const result_arg = e * Math.atan2(baseI, baseR);
          const i2 = 2 * i;
          chirp[i2] = result_mod * Math.cos(result_arg);
          chirp[i2 + 1] = result_mod * Math.sin(result_arg);
          ichirp[i2] = chirp[i2];
          ichirp[i2 + 1] = -chirp[i2 + 1];
        }
        this._slicedChirpBuffer = chirp.subarray(a, b);
        this._f = new P2FFT(nextP2 >> 1);
        this._f.transform(this._chirpBuffer, ichirp);
      }
      _transform(output, input, real) {
        const ib1 = this._buffer1;
        const ib2 = this._buffer2;
        const ob2 = this._outBuffer1;
        const ob3 = this._outBuffer2;
        const cb = this._chirpBuffer;
        const sb = this._slicedChirpBuffer;
        const a = this._a;
        if (real) {
          for (let j = 0; j < sb.length; j += 2) {
            const j2 = j + 1;
            const j3 = j >> 1;
            const a_real = input[j3];
            ib1[j] = a_real * sb[j];
            ib1[j2] = a_real * sb[j2];
          }
        } else {
          for (let j = 0; j < sb.length; j += 2) {
            const j2 = j + 1;
            ib1[j] = input[j] * sb[j] - input[j2] * sb[j2];
            ib1[j2] = input[j] * sb[j2] + input[j2] * sb[j];
          }
        }
        this._f.transform(ob2, ib1);
        for (let j = 0; j < cb.length; j += 2) {
          const j2 = j + 1;
          ib2[j] = ob2[j] * cb[j] - ob2[j2] * cb[j2];
          ib2[j2] = ob2[j] * cb[j2] + ob2[j2] * cb[j];
        }
        this._f.inverseTransform(ob3, ib2);
        for (let j = 0; j < ob3.length; j += 2) {
          const a_real = ob3[j + a];
          const a_imag = ob3[j + a + 1];
          const b_real = sb[j];
          const b_imag = sb[j + 1];
          output[j] = a_real * b_real - a_imag * b_imag;
          output[j + 1] = a_real * b_imag + a_imag * b_real;
        }
      }
      transform(output, input) {
        this._transform(output, input, false);
      }
      realTransform(output, input) {
        this._transform(output, input, true);
      }
    };
    FFT = class {
      constructor(fft_length) {
        this.fft_length = fft_length;
        this.isPowerOfTwo = isPowerOfTwo(fft_length);
        if (this.isPowerOfTwo) {
          this.fft = new P2FFT(fft_length);
          this.outputBufferSize = 2 * fft_length;
        } else {
          this.fft = new NP2FFT(fft_length);
          this.outputBufferSize = this.fft.bufferSize;
        }
      }
      realTransform(out, input) {
        this.fft.realTransform(out, input);
      }
      transform(out, input) {
        this.fft.transform(out, input);
      }
    };
  }
});

// node_modules/@xenova/transformers/src/utils/tensor.js
function reshape(data, dimensions) {
  const totalElements = data.length;
  const dimensionSize = dimensions.reduce((a, b) => a * b);
  if (totalElements !== dimensionSize) {
    throw Error(`cannot reshape array of size ${totalElements} into shape (${dimensions})`);
  }
  let reshapedArray = data;
  for (let i = dimensions.length - 1; i >= 0; i--) {
    reshapedArray = reshapedArray.reduce((acc, val) => {
      let lastArray = acc[acc.length - 1];
      if (lastArray.length < dimensions[i]) {
        lastArray.push(val);
      } else {
        acc.push([val]);
      }
      return acc;
    }, [[]]);
  }
  return reshapedArray[0];
}
function permute(tensor, axes) {
  const [permutedData, shape] = permute_data(tensor.data, tensor.dims, axes);
  return new Tensor(tensor.type, permutedData, shape);
}
function interpolate(input, [out_height, out_width], mode = "bilinear", align_corners = false) {
  const in_channels = input.dims.at(-3) ?? 1;
  const in_height = input.dims.at(-2);
  const in_width = input.dims.at(-1);
  let output = interpolate_data(
    /** @type {import('./maths.js').TypedArray}*/
    input.data,
    [in_channels, in_height, in_width],
    [out_height, out_width],
    mode,
    align_corners
  );
  return new Tensor(input.type, output, [in_channels, out_height, out_width]);
}
function mean_pooling(last_hidden_state, attention_mask) {
  let shape = [last_hidden_state.dims[0], last_hidden_state.dims[2]];
  let returnedData = new last_hidden_state.data.constructor(shape[0] * shape[1]);
  let [batchSize, seqLength, embedDim] = last_hidden_state.dims;
  let outIndex = 0;
  for (let i = 0; i < batchSize; ++i) {
    let offset = i * embedDim * seqLength;
    for (let k = 0; k < embedDim; ++k) {
      let sum = 0;
      let count = 0;
      let attnMaskOffset = i * seqLength;
      let offset2 = offset + k;
      for (let j = 0; j < seqLength; ++j) {
        let attn = Number(attention_mask.data[attnMaskOffset + j]);
        count += attn;
        sum += last_hidden_state.data[offset2 + j * embedDim] * attn;
      }
      let avg = sum / count;
      returnedData[outIndex++] = avg;
    }
  }
  return new Tensor(
    last_hidden_state.type,
    returnedData,
    shape
  );
}
function calc_squeeze_dims(dims, dim) {
  dims = dims.slice();
  if (dim === null) {
    dims = dims.filter((d) => d !== 1);
  } else if (typeof dim === "number") {
    if (dims[dim] === 1) {
      dims.splice(dim, 1);
    }
  } else if (Array.isArray(dim)) {
    dims = dims.filter((x, i) => {
      return x !== 1 || !dim.includes(i);
    });
  }
  return dims;
}
function calc_unsqueeze_dims(dims, dim) {
  dim = safeIndex(dim, dims.length + 1);
  dims = dims.slice();
  dims.splice(dim, 0, 1);
  return dims;
}
function safeIndex(index, size, dimension = null) {
  if (index < -size || index >= size) {
    throw new Error(`IndexError: index ${index} is out of bounds for dimension${dimension === null ? "" : " " + dimension} with size ${size}`);
  }
  if (index < 0) {
    index = (index % size + size) % size;
  }
  return index;
}
function cat(tensors, dim = 0) {
  dim = safeIndex(dim, tensors[0].dims.length);
  const resultDims = tensors[0].dims.slice();
  resultDims[dim] = tensors.reduce((a, b) => a + b.dims[dim], 0);
  const resultSize = resultDims.reduce((a, b) => a * b, 1);
  const result = new tensors[0].data.constructor(resultSize);
  const resultType = tensors[0].type;
  if (dim === 0) {
    let offset = 0;
    for (let t of tensors) {
      result.set(t.data, offset);
      offset += t.data.length;
    }
  } else {
    let currentDim = 0;
    for (let t = 0; t < tensors.length; ++t) {
      let tensor = tensors[t];
      for (let i = 0; i < tensor.data.length; ++i) {
        let resultIndex = 0;
        for (let j = tensor.dims.length - 1, num = i, resultMultiplier = 1; j >= 0; --j) {
          const size = tensor.dims[j];
          let index = num % size;
          if (j === dim) {
            index += currentDim;
          }
          resultIndex += index * resultMultiplier;
          resultMultiplier *= resultDims[j];
          num = Math.floor(num / size);
        }
        result[resultIndex] = tensor.data[i];
      }
      currentDim += tensor.dims[dim];
    }
  }
  return new Tensor(resultType, result, resultDims);
}
function stack(tensors, dim = 0) {
  return cat(tensors.map((t) => t.unsqueeze(dim)), dim);
}
function std_mean(input, dim = null, correction = 1, keepdim = false) {
  if (dim === null) {
    const sum = input.data.reduce((a, b) => a + b, 0);
    const mean2 = sum / input.data.length;
    const std = Math.sqrt(input.data.reduce((a, b) => a + (b - mean2) ** 2, 0) / (input.data.length - correction));
    const meanTensor2 = new Tensor(input.type, [mean2], [
      /* scalar */
    ]);
    const stdTensor2 = new Tensor(input.type, [std], [
      /* scalar */
    ]);
    return [stdTensor2, meanTensor2];
  }
  dim = safeIndex(dim, input.dims.length);
  const meanTensor = mean(input, dim, keepdim);
  const resultDims = input.dims.slice();
  resultDims[dim] = 1;
  const result = new input.data.constructor(input.data.length / input.dims[dim]);
  for (let i = 0; i < input.data.length; ++i) {
    let resultIndex = 0;
    for (let j = input.dims.length - 1, num = i, resultMultiplier = 1; j >= 0; --j) {
      const size = input.dims[j];
      if (j !== dim) {
        const index = num % size;
        resultIndex += index * resultMultiplier;
        resultMultiplier *= resultDims[j];
      }
      num = Math.floor(num / size);
    }
    result[resultIndex] += (input.data[i] - meanTensor.data[resultIndex]) ** 2;
  }
  for (let i = 0; i < result.length; ++i) {
    result[i] = Math.sqrt(result[i] / (input.dims[dim] - correction));
  }
  if (!keepdim) {
    resultDims.splice(dim, 1);
  }
  const stdTensor = new Tensor(input.type, result, resultDims);
  return [stdTensor, meanTensor];
}
function mean(input, dim = null, keepdim = false) {
  if (dim === null) {
    let val = input.data.reduce((a, b) => a + b, 0);
    return new Tensor(input.type, [val / input.data.length], [
      /* scalar */
    ]);
  }
  dim = safeIndex(dim, input.dims.length);
  const resultDims = input.dims.slice();
  resultDims[dim] = 1;
  const result = new input.data.constructor(input.data.length / input.dims[dim]);
  for (let i = 0; i < input.data.length; ++i) {
    let resultIndex = 0;
    for (let j = input.dims.length - 1, num = i, resultMultiplier = 1; j >= 0; --j) {
      const size = input.dims[j];
      if (j !== dim) {
        const index = num % size;
        resultIndex += index * resultMultiplier;
        resultMultiplier *= resultDims[j];
      }
      num = Math.floor(num / size);
    }
    result[resultIndex] += input.data[i];
  }
  if (input.dims[dim] !== 1) {
    for (let i = 0; i < result.length; ++i) {
      result[i] = result[i] / input.dims[dim];
    }
  }
  if (!keepdim) {
    resultDims.splice(dim, 1);
  }
  return new Tensor(input.type, result, resultDims);
}
function dynamicTimeWarping(matrix) {
  const [output_length, input_length] = matrix.dims;
  const outputShape = [output_length + 1, input_length + 1];
  const cost = new Tensor(
    "float32",
    new Float32Array(outputShape[0] * outputShape[1]).fill(Infinity),
    outputShape
  );
  const trace = new Tensor(
    "float32",
    new Float32Array(outputShape[0] * outputShape[1]).fill(-1),
    outputShape
  );
  cost[0].data[0] = 0;
  for (let j2 = 1; j2 < input_length + 1; ++j2) {
    for (let i2 = 1; i2 < output_length + 1; ++i2) {
      const c0 = cost[i2 - 1][j2 - 1].item();
      const c1 = cost[i2 - 1][j2].item();
      const c2 = cost[i2][j2 - 1].item();
      let c, t;
      if (c0 < c1 && c0 < c2) {
        c = c0;
        t = 0;
      } else if (c1 < c0 && c1 < c2) {
        c = c1;
        t = 1;
      } else {
        c = c2;
        t = 2;
      }
      cost[i2].data[j2] = matrix[i2 - 1][j2 - 1].item() + c;
      trace[i2].data[j2] = t;
    }
  }
  let i = output_length;
  let j = input_length;
  trace.data.fill(2, 0, outputShape[1]);
  for (let i2 = 0; i2 < outputShape[0]; ++i2) {
    trace[i2].data[0] = 1;
  }
  let text_indices = [];
  let time_indices = [];
  while (i > 0 || j > 0) {
    text_indices.push(i - 1);
    time_indices.push(j - 1);
    const t = trace[i][j].item();
    switch (t) {
      case 0:
        --i;
        --j;
        break;
      case 1:
        --i;
        break;
      case 2:
        --j;
        break;
      default:
        throw new Error(
          `Internal error in dynamic time warping. Unexpected trace[${i}, ${j}]. Please file a bug report.`
        );
    }
  }
  text_indices.reverse();
  time_indices.reverse();
  return [text_indices, time_indices];
}
function dimsToStride(dims) {
  const stride = new Array(dims.length);
  for (let i = dims.length - 1, s2 = 1; i >= 0; --i) {
    stride[i] = s2;
    s2 *= dims[i];
  }
  return stride;
}
function ones(size) {
  const numElements = size.reduce((a, b) => a * b, 1);
  return new Tensor(
    "int64",
    new BigInt64Array(numElements).fill(1n),
    size
  );
}
function ones_like(tensor) {
  return ones(tensor.dims);
}
function quantize_embeddings(tensor, precision) {
  if (tensor.dims.length !== 2) {
    throw new Error("The tensor must have 2 dimensions");
  }
  if (tensor.dims.at(-1) % 8 !== 0) {
    throw new Error("The last dimension of the tensor must be a multiple of 8");
  }
  if (!["binary", "ubinary"].includes(precision)) {
    throw new Error("The precision must be either 'binary' or 'ubinary'");
  }
  const signed = precision === "binary";
  const dtype = signed ? "int8" : "uint8";
  const cls = signed ? Int8Array : Uint8Array;
  const inputData = tensor.data;
  const outputData = new cls(inputData.length / 8);
  for (let i = 0; i < inputData.length; ++i) {
    const bit = inputData[i] > 0 ? 1 : 0;
    const arrayIndex = Math.floor(i / 8);
    const bitPosition = i % 8;
    outputData[arrayIndex] |= bit << 7 - bitPosition;
    if (signed && bitPosition === 0) {
      outputData[arrayIndex] -= 128;
    }
  }
  ;
  return new Tensor(dtype, outputData, [tensor.dims[0], tensor.dims[1] / 8]);
}
var DataTypeMap, ONNXTensor, Tensor;
var init_tensor = __esm({
  "node_modules/@xenova/transformers/src/utils/tensor.js"() {
    init_onnx();
    init_maths();
    DataTypeMap = Object.freeze({
      float32: Float32Array,
      float64: Float64Array,
      string: Array,
      // string[]
      int8: Int8Array,
      uint8: Uint8Array,
      int16: Int16Array,
      uint16: Uint16Array,
      int32: Int32Array,
      uint32: Uint32Array,
      int64: BigInt64Array,
      uint64: BigUint64Array,
      bool: Uint8Array
    });
    ONNXTensor = ONNX.Tensor;
    Tensor = class _Tensor {
      /** @type {number[]} Dimensions of the tensor. */
      dims;
      /** @type {DataType} Type of the tensor. */
      type;
      /** @type {DataArray} The data stored in the tensor. */
      data;
      /** @type {number} The number of elements in the tensor. */
      size;
      /**
       * Create a new Tensor or copy an existing Tensor.
       * @param {[DataType, DataArray, number[]]|[import('onnxruntime-common').Tensor]} args
       */
      constructor(...args) {
        if (args[0] instanceof ONNXTensor) {
          Object.assign(this, args[0]);
        } else {
          Object.assign(this, new ONNXTensor(
            /** @type {DataType} */
            args[0],
            /** @type {Exclude<import('./maths.js').AnyTypedArray, Uint8ClampedArray>} */
            args[1],
            args[2]
          ));
        }
        return new Proxy(this, {
          get: (obj, key) => {
            if (typeof key === "string") {
              let index = Number(key);
              if (Number.isInteger(index)) {
                return obj._getitem(index);
              }
            }
            return obj[key];
          },
          set: (obj, key, value) => {
            return obj[key] = value;
          }
        });
      }
      /**
       * Returns an iterator object for iterating over the tensor data in row-major order.
       * If the tensor has more than one dimension, the iterator will yield subarrays.
       * @returns {Iterator} An iterator object for iterating over the tensor data in row-major order.
       */
      *[Symbol.iterator]() {
        const [iterLength, ...iterDims] = this.dims;
        if (iterDims.length > 0) {
          const iterSize = iterDims.reduce((a, b) => a * b);
          for (let i = 0; i < iterLength; ++i) {
            yield this._subarray(i, iterSize, iterDims);
          }
        } else {
          yield* this.data;
        }
      }
      /**
       * Index into a Tensor object.
       * @param {number} index The index to access.
       * @returns {Tensor} The data at the specified index.
       */
      _getitem(index) {
        const [iterLength, ...iterDims] = this.dims;
        index = safeIndex(index, iterLength);
        if (iterDims.length > 0) {
          const iterSize = iterDims.reduce((a, b) => a * b);
          return this._subarray(index, iterSize, iterDims);
        } else {
          return new _Tensor(this.type, [this.data[index]], iterDims);
        }
      }
      /**
       * @param {number|bigint} item The item to search for in the tensor
       * @returns {number} The index of the first occurrence of item in the tensor data.
       */
      indexOf(item) {
        for (let index = 0; index < this.data.length; ++index) {
          if (this.data[index] == item) {
            return index;
          }
        }
        return -1;
      }
      /**
       * @param {number} index 
       * @param {number} iterSize 
       * @param {any} iterDims 
       * @returns {Tensor}
       */
      _subarray(index, iterSize, iterDims) {
        const o1 = index * iterSize;
        const o2 = (index + 1) * iterSize;
        const data = "subarray" in this.data ? this.data.subarray(o1, o2) : this.data.slice(o1, o2);
        return new _Tensor(this.type, data, iterDims);
      }
      /**
       * Returns the value of this tensor as a standard JavaScript Number. This only works
       * for tensors with one element. For other cases, see `Tensor.tolist()`.
       * @returns {number|bigint} The value of this tensor as a standard JavaScript Number.
       * @throws {Error} If the tensor has more than one element.
       */
      item() {
        if (this.data.length !== 1) {
          throw new Error(`a Tensor with ${this.data.length} elements cannot be converted to Scalar`);
        }
        return this.data[0];
      }
      /**
       * Convert tensor data to a n-dimensional JS list
       * @returns {Array}
       */
      tolist() {
        return reshape(this.data, this.dims);
      }
      /**
       * Return a new Tensor with the sigmoid function applied to each element.
       * @returns {Tensor} The tensor with the sigmoid function applied.
       */
      sigmoid() {
        return this.clone().sigmoid_();
      }
      /**
       * Applies the sigmoid function to the tensor in place.
       * @returns {Tensor} Returns `this`.
       */
      sigmoid_() {
        for (let i = 0; i < this.data.length; ++i) {
          this.data[i] = 1 / (1 + Math.exp(-this.data[i]));
        }
        return this;
      }
      /**
       * Return a new Tensor with every element multiplied by a constant.
       * @param {number} val The value to multiply by.
       * @returns {Tensor} The new tensor.
       */
      mul(val) {
        return this.clone().mul_(val);
      }
      /**
       * Multiply the tensor by a constant in place.
       * @param {number} val The value to multiply by.
       * @returns {Tensor} Returns `this`.
       */
      mul_(val) {
        for (let i = 0; i < this.data.length; ++i) {
          this.data[i] *= val;
        }
        return this;
      }
      /**
       * Return a new Tensor with every element added by a constant.
       * @param {number} val The value to add by.
       * @returns {Tensor} The new tensor.
       */
      add(val) {
        return this.clone().add_(val);
      }
      /**
       * Add the tensor by a constant in place.
       * @param {number} val The value to add by.
       * @returns {Tensor} Returns `this`.
       */
      add_(val) {
        for (let i = 0; i < this.data.length; ++i) {
          this.data[i] += val;
        }
        return this;
      }
      clone() {
        return new _Tensor(this.type, this.data.slice(), this.dims.slice());
      }
      slice(...slices) {
        let newTensorDims = [];
        let newOffsets = [];
        for (let sliceIndex = 0; sliceIndex < this.dims.length; ++sliceIndex) {
          let slice2 = slices[sliceIndex];
          if (slice2 === null || slice2 === void 0) {
            newOffsets.push([0, this.dims[sliceIndex]]);
            newTensorDims.push(this.dims[sliceIndex]);
          } else if (typeof slice2 === "number") {
            slice2 = safeIndex(slice2, this.dims[sliceIndex], sliceIndex);
            newOffsets.push([slice2, slice2 + 1]);
          } else if (Array.isArray(slice2) && slice2.length === 2) {
            if (slice2[0] > slice2[1]) {
              throw new Error(`Invalid slice: ${slice2}`);
            }
            let offsets = [
              Math.max(slice2[0], 0),
              Math.min(slice2[1], this.dims[sliceIndex])
            ];
            newOffsets.push(offsets);
            newTensorDims.push(offsets[1] - offsets[0]);
          } else {
            throw new Error(`Invalid slice: ${slice2}`);
          }
        }
        let newDims = newOffsets.map(([start, end]) => end - start);
        let newBufferSize = newDims.reduce((a, b) => a * b);
        let data = new this.data.constructor(newBufferSize);
        const stride = this.stride();
        for (let i = 0; i < newBufferSize; ++i) {
          let originalIndex = 0;
          for (let j = newDims.length - 1, num = i; j >= 0; --j) {
            const size = newDims[j];
            originalIndex += (num % size + newOffsets[j][0]) * stride[j];
            num = Math.floor(num / size);
          }
          data[i] = this.data[originalIndex];
        }
        return new _Tensor(this.type, data, newTensorDims);
      }
      /**
       * Return a permuted version of this Tensor, according to the provided dimensions.
       * @param  {...number} dims Dimensions to permute.
       * @returns {Tensor} The permuted tensor.
       */
      permute(...dims) {
        return permute(this, dims);
      }
      // TODO: implement transpose. For now (backwards compatibility), it's just an alias for permute()
      transpose(...dims) {
        return this.permute(...dims);
      }
      // TODO add .max() and .min() methods
      /**
       * Returns the sum of each row of the input tensor in the given dimension dim.
       * 
       * @param {number} [dim=null] The dimension or dimensions to reduce. If `null`, all dimensions are reduced.
       * @param {boolean} keepdim Whether the output tensor has `dim` retained or not.
       * @returns The summed tensor
       */
      sum(dim = null, keepdim = false) {
        return this.norm(1, dim, keepdim);
      }
      /**
       * Returns the matrix norm or vector norm of a given tensor.
       * @param {number|string} [p='fro'] The order of norm
       * @param {number} [dim=null] Specifies which dimension of the tensor to calculate the norm across.
       * If dim is None, the norm will be calculated across all dimensions of input.
       * @param {boolean} [keepdim=false] Whether the output tensors have dim retained or not.
       * @returns {Tensor} The norm of the tensor.
       */
      norm(p = "fro", dim = null, keepdim = false) {
        if (p === "fro") {
          p = 2;
        } else if (typeof p === "string") {
          throw Error(`Unsupported norm: ${p}`);
        }
        if (dim === null) {
          let val = this.data.reduce((a, b) => a + b ** p, 0) ** (1 / p);
          return new _Tensor(this.type, [val], []);
        }
        dim = safeIndex(dim, this.dims.length);
        const resultDims = this.dims.slice();
        resultDims[dim] = 1;
        const result = new this.data.constructor(this.data.length / this.dims[dim]);
        for (let i = 0; i < this.data.length; ++i) {
          let resultIndex = 0;
          for (let j = this.dims.length - 1, num = i, resultMultiplier = 1; j >= 0; --j) {
            const size = this.dims[j];
            if (j !== dim) {
              const index = num % size;
              resultIndex += index * resultMultiplier;
              resultMultiplier *= resultDims[j];
            }
            num = Math.floor(num / size);
          }
          result[resultIndex] += this.data[i] ** p;
        }
        if (p !== 1) {
          for (let i = 0; i < result.length; ++i) {
            result[i] = result[i] ** (1 / p);
          }
        }
        if (!keepdim) {
          resultDims.splice(dim, 1);
        }
        return new _Tensor(this.type, result, resultDims);
      }
      /**
       * Performs `L_p` normalization of inputs over specified dimension. Operates in place.
       * @param {number} [p=2] The exponent value in the norm formulation
       * @param {number} [dim=1] The dimension to reduce
       * @returns {Tensor} `this` for operation chaining.
       */
      normalize_(p = 2, dim = 1) {
        dim = safeIndex(dim, this.dims.length);
        const norm = this.norm(p, dim, true);
        for (let i = 0; i < this.data.length; ++i) {
          let resultIndex = 0;
          for (let j = this.dims.length - 1, num = i, resultMultiplier = 1; j >= 0; --j) {
            const size = this.dims[j];
            if (j !== dim) {
              const index = num % size;
              resultIndex += index * resultMultiplier;
              resultMultiplier *= this.dims[j];
            }
            num = Math.floor(num / size);
          }
          this.data[i] /= norm.data[resultIndex];
        }
        return this;
      }
      /**
       * Performs `L_p` normalization of inputs over specified dimension.
       * @param {number} [p=2] The exponent value in the norm formulation
       * @param {number} [dim=1] The dimension to reduce
       * @returns {Tensor} The normalized tensor.
       */
      normalize(p = 2, dim = 1) {
        return this.clone().normalize_(p, dim);
      }
      /**
       * Compute and return the stride of this tensor.
       * Stride is the jump necessary to go from one element to the next one in the specified dimension dim.
       * @returns {number[]} The stride of this tensor.
       */
      stride() {
        return dimsToStride(this.dims);
      }
      /**
       * Returns a tensor with all specified dimensions of input of size 1 removed.
       * 
       * NOTE: The returned tensor shares the storage with the input tensor, so changing the contents of one will change the contents of the other.
       * If you would like a copy, use `tensor.clone()` before squeezing.
       * 
       * @param {number} [dim=null] If given, the input will be squeezed only in the specified dimensions.
       * @returns The squeezed tensor
       */
      squeeze(dim = null) {
        return new _Tensor(
          this.type,
          this.data,
          calc_squeeze_dims(this.dims, dim)
        );
      }
      /**
       * In-place version of @see {@link Tensor.squeeze}
       */
      squeeze_(dim = null) {
        this.dims = calc_squeeze_dims(this.dims, dim);
        return this;
      }
      /**
       * Returns a new tensor with a dimension of size one inserted at the specified position.
       * 
       * NOTE: The returned tensor shares the same underlying data with this tensor.
       * 
       * @param {number} dim The index at which to insert the singleton dimension
       * @returns The unsqueezed tensor
       */
      unsqueeze(dim = null) {
        return new _Tensor(
          this.type,
          this.data,
          calc_unsqueeze_dims(this.dims, dim)
        );
      }
      /**
       * In-place version of @see {@link Tensor.unsqueeze}
       */
      unsqueeze_(dim = null) {
        this.dims = calc_unsqueeze_dims(this.dims, dim);
        return this;
      }
      /**
       * In-place version of @see {@link Tensor.flatten}
       */
      flatten_(start_dim = 0, end_dim = -1) {
        end_dim = (end_dim + this.dims.length) % this.dims.length;
        let dimsToKeepBefore = this.dims.slice(0, start_dim);
        let dimsToFlatten = this.dims.slice(start_dim, end_dim + 1);
        let dimsToKeepAfter = this.dims.slice(end_dim + 1);
        this.dims = [...dimsToKeepBefore, dimsToFlatten.reduce((a, b) => a * b, 1), ...dimsToKeepAfter];
        return this;
      }
      /**
       * Flattens input by reshaping it into a one-dimensional tensor.
       * If `start_dim` or `end_dim` are passed, only dimensions starting with `start_dim`
       * and ending with `end_dim` are flattened. The order of elements in input is unchanged.
       * @param {number} start_dim the first dim to flatten
       * @param {number} end_dim the last dim to flatten
       * @returns The flattened tensor.
       */
      flatten(start_dim = 0, end_dim = -1) {
        return this.clone().flatten_(start_dim, end_dim);
      }
      /**
       * Returns a new tensor with the same data as the `self` tensor but of a different `shape`.
       * @param  {...number} dims the desired size
       * @returns {Tensor} The tensor with the same data but different shape
       */
      view(...dims) {
        let inferredIndex = -1;
        for (let i = 0; i < dims.length; ++i) {
          if (dims[i] === -1) {
            if (inferredIndex !== -1) {
              throw new Error("Only one dimension can be inferred");
            }
            inferredIndex = i;
          }
        }
        if (inferredIndex !== -1) {
          const productOther = dims.reduce((product2, curr, index) => {
            return index !== inferredIndex ? product2 * curr : product2;
          }, 1);
          dims[inferredIndex] = this.data.length / productOther;
        }
        return new _Tensor(this.type, this.data, dims);
      }
      neg_() {
        for (let i = 0; i < this.data.length; ++i) {
          this.data[i] = -this.data[i];
        }
        return this;
      }
      neg() {
        return this.clone().neg_();
      }
      /**
       * In-place version of @see {@link Tensor.clamp}
       */
      clamp_(min2, max2) {
        for (let i = 0; i < this.data.length; ++i) {
          this.data[i] = Math.min(Math.max(this.data[i], min2), max2);
        }
        return this;
      }
      /**
       * Clamps all elements in input into the range [ min, max ]
       * @param {number} min lower-bound of the range to be clamped to
       * @param {number} max upper-bound of the range to be clamped to
       * @returns the output tensor.
       */
      clamp(min2, max2) {
        return this.clone().clamp_(min2, max2);
      }
      /**
       * In-place version of @see {@link Tensor.round}
       */
      round_() {
        for (let i = 0; i < this.data.length; ++i) {
          this.data[i] = Math.round(this.data[i]);
        }
        return this;
      }
      /**
       * Rounds elements of input to the nearest integer.
       * @returns the output tensor.
       */
      round() {
        return this.clone().round_();
      }
      /**
       * Performs Tensor dtype conversion.
       * @param {DataType} type The desired data type.
       * @returns {Tensor} The converted tensor.
       */
      to(type) {
        if (this.type === type) return this;
        if (!DataTypeMap.hasOwnProperty(type)) {
          throw new Error(`Unsupported type: ${type}`);
        }
        return new _Tensor(type, DataTypeMap[type].from(this.data), this.dims);
      }
    };
  }
});

// node_modules/@xenova/transformers/src/utils/data-structures.js
var PriorityQueue, CharTrie, CharTrieNode, TokenLattice, TokenLatticeNode;
var init_data_structures = __esm({
  "node_modules/@xenova/transformers/src/utils/data-structures.js"() {
    PriorityQueue = class {
      /**
       * Create a new PriorityQueue.
       * @param {Function} comparator Comparator function to determine priority. Defaults to a MaxHeap.
       */
      constructor(comparator = (a, b) => a > b) {
        this._heap = [];
        this._comparator = comparator;
      }
      /**
       * The size of the queue
       */
      get size() {
        return this._heap.length;
      }
      /**
       * Check if the queue is empty.
       * @returns {boolean} `true` if the queue is empty, `false` otherwise.
       */
      isEmpty() {
        return this.size === 0;
      }
      /**
       * Return the element with the highest priority in the queue.
       * @returns {any} The highest priority element in the queue.
       */
      peek() {
        return this._heap[0];
      }
      /**
       * Add one or more elements to the queue.
       * @param  {...any} values The values to push into the queue.
       * @returns {number} The new size of the queue.
       */
      push(...values) {
        return this.extend(values);
      }
      /**
       * Add multiple elements to the queue.
       * @param {any[]} values The values to push into the queue.
       * @returns {number} The new size of the queue.
       */
      extend(values) {
        for (const value of values) {
          this._heap.push(value);
          this._siftUp();
        }
        return this.size;
      }
      /**
       * Remove and return the element with the highest priority in the queue.
       * @returns {any} The element with the highest priority in the queue.
       */
      pop() {
        const poppedValue = this.peek();
        const bottom = this.size - 1;
        if (bottom > 0) {
          this._swap(0, bottom);
        }
        this._heap.pop();
        this._siftDown();
        return poppedValue;
      }
      /**
       * Replace the element with the highest priority in the queue with a new value.
       * @param {*} value The new value.
       * @returns {*} The replaced value.
       */
      replace(value) {
        const replacedValue = this.peek();
        this._heap[0] = value;
        this._siftDown();
        return replacedValue;
      }
      /**
       * Compute the index for the parent of the node at index `i`.
       * @param {number} i The index of the node to get the parent of.
       * @returns {number} The index of the parent node.
       * @private
       */
      _parent(i) {
        return (i + 1 >>> 1) - 1;
      }
      /**
       * Compute the index for the left child of the node at index `i`.
       * @param {number} i The index of the node to get the left child of.
       * @returns {number} The index of the left child.
       * @private
       */
      _left(i) {
        return (i << 1) + 1;
      }
      /**
       * Compute the index for the right child of the node at index `i`.
       * @param {number} i The index of the node to get the right child of.
       * @returns {number} The index of the right child.
       * @private
       */
      _right(i) {
        return i + 1 << 1;
      }
      /**
       * Check if the element at index `i` is greater than the element at index `j`.
       * @param {number} i The index of the first element to compare.
       * @param {number} j The index of the second element to compare.
       * @returns {boolean} `true` if the element at index `i` is greater than the element at index `j`, `false` otherwise.
       * @private
       */
      _greater(i, j) {
        return this._comparator(this._heap[i], this._heap[j]);
      }
      /**
       * Swap the elements at indices `i` and `j`.
       * @param {number} i The index of the first element to swap.
       * @param {number} j The index of the second element to swap.
       * @private
       */
      _swap(i, j) {
        const temp = this._heap[i];
        this._heap[i] = this._heap[j];
        this._heap[j] = temp;
      }
      /**
       * Maintain the heap property by updating positions in the heap,
       * starting at the last element and moving up the heap.
       * @private
       */
      _siftUp() {
        let node = this.size - 1;
        while (node > 0 && this._greater(node, this._parent(node))) {
          this._swap(node, this._parent(node));
          node = this._parent(node);
        }
      }
      /**
       * Maintain the heap property by updating positions in the heap,
       * starting at the first element and moving down the heap.
       * @private
       */
      _siftDown() {
        let node = 0;
        while (this._left(node) < this.size && this._greater(this._left(node), node) || this._right(node) < this.size && this._greater(this._right(node), node)) {
          const maxChild = this._right(node) < this.size && this._greater(this._right(node), this._left(node)) ? this._right(node) : this._left(node);
          this._swap(node, maxChild);
          node = maxChild;
        }
      }
    };
    CharTrie = class {
      constructor() {
        this.root = CharTrieNode.default();
      }
      /**
       * Adds one or more `texts` to the trie.
       * @param {string[]} texts The strings to add to the trie.
       */
      extend(texts) {
        for (let text of texts) {
          this.push(text);
        }
      }
      /**
       * Adds text to the trie.
       * @param {string} text The string to add to the trie.
       */
      push(text) {
        let node = this.root;
        for (let ch of text) {
          let child = node.children.get(ch);
          if (child === void 0) {
            child = CharTrieNode.default();
            node.children.set(ch, child);
          }
          node = child;
        }
        node.isLeaf = true;
      }
      /**
       * Searches the trie for all strings with a common prefix of `text`.
       * @param {string} text The common prefix to search for.
       * @yields {string} Each string in the trie that has `text` as a prefix.
       */
      *commonPrefixSearch(text) {
        let node = this.root;
        let prefix = "";
        for (let i = 0; i < text.length && node !== void 0; ++i) {
          const ch = text[i];
          prefix += ch;
          node = node.children.get(ch);
          if (node !== void 0 && node.isLeaf) {
            yield prefix;
          }
        }
      }
    };
    CharTrieNode = class _CharTrieNode {
      /**
       * Create a new CharTrieNode.
       * @param {boolean} isLeaf Whether the node is a leaf node or not.
       * @param {Map<string, CharTrieNode>} children A map containing the node's children, where the key is a character and the value is a `CharTrieNode`.
       */
      constructor(isLeaf, children) {
        this.isLeaf = isLeaf;
        this.children = children;
      }
      /**
       * Returns a new `CharTrieNode` instance with default values.
       * @returns {CharTrieNode} A new `CharTrieNode` instance with `isLeaf` set to `false` and an empty `children` map.
       */
      static default() {
        return new _CharTrieNode(false, /* @__PURE__ */ new Map());
      }
    };
    TokenLattice = class {
      /**
       * Creates a new TokenLattice instance.
       *
       * @param {string} sentence The input sentence to be tokenized.
       * @param {number} bosTokenId The beginning-of-sequence token ID.
       * @param {number} eosTokenId The end-of-sequence token ID.
       */
      constructor(sentence, bosTokenId, eosTokenId) {
        this.sentence = sentence;
        this.len = sentence.length;
        this.bosTokenId = bosTokenId;
        this.eosTokenId = eosTokenId;
        this.nodes = [];
        this.beginNodes = Array.from({ length: this.len + 1 }, () => []);
        this.endNodes = Array.from({ length: this.len + 1 }, () => []);
        const bos = new TokenLatticeNode(this.bosTokenId, 0, 0, 0, 0);
        const eos = new TokenLatticeNode(this.eosTokenId, 1, this.len, 0, 0);
        this.nodes.push(bos.clone());
        this.nodes.push(eos.clone());
        this.beginNodes[this.len].push(eos);
        this.endNodes[0].push(bos);
      }
      /**
       * Inserts a new token node into the token lattice.
       *
       * @param {number} pos The starting position of the token.
       * @param {number} length The length of the token.
       * @param {number} score The score of the token.
       * @param {number} tokenId The token ID of the token.
       */
      insert(pos, length, score, tokenId) {
        const nodeId = this.nodes.length;
        const node = new TokenLatticeNode(tokenId, nodeId, pos, length, score);
        this.beginNodes[pos].push(node);
        this.endNodes[pos + length].push(node);
        this.nodes.push(node);
      }
      /**
       * Implements the Viterbi algorithm to compute the most likely sequence of tokens.
       *
       * @returns {TokenLatticeNode[]} The array of nodes representing the most likely sequence of tokens.
       */
      viterbi() {
        const len = this.len;
        let pos = 0;
        while (pos <= len) {
          if (this.beginNodes[pos].length == 0) {
            return [];
          }
          for (let rnode of this.beginNodes[pos]) {
            rnode.prev = null;
            let bestScore = 0;
            let bestNode = null;
            for (let lnode of this.endNodes[pos]) {
              const score = lnode.backtraceScore + rnode.score;
              if (bestNode === null || score > bestScore) {
                bestNode = lnode.clone();
                bestScore = score;
              }
            }
            if (bestNode !== null) {
              rnode.prev = bestNode;
              rnode.backtraceScore = bestScore;
            } else {
              return [];
            }
          }
          ++pos;
        }
        const results = [];
        const root = this.beginNodes[len][0];
        const prev = root.prev;
        if (prev === null) {
          return [];
        }
        let node = prev.clone();
        while (node.prev !== null) {
          results.push(node.clone());
          const n = node.clone();
          node = n.prev.clone();
        }
        results.reverse();
        return results;
      }
      /**
       * @param {TokenLatticeNode} node
       * @returns {string} The array of nodes representing the most likely sequence of tokens.
       */
      piece(node) {
        return this.sentence.slice(node.pos, node.pos + node.length);
      }
      /**
       * @returns {Array} The array of nodes representing the most likely sequence of tokens.
       */
      tokens() {
        const nodes = this.viterbi();
        return nodes.map((x) => this.piece(x));
      }
      /**
       * @returns {Array} The array of nodes representing the most likely sequence of tokens.
       */
      tokenIds() {
        const nodes = this.viterbi();
        return nodes.map((x) => x.tokenId);
      }
    };
    TokenLatticeNode = class _TokenLatticeNode {
      /**
       * Represents a node in a token lattice for a given sentence.
       * @param {number} tokenId The ID of the token associated with this node.
       * @param {number} nodeId The ID of this node.
       * @param {number} pos The starting position of the token in the sentence.
       * @param {number} length The length of the token.
       * @param {number} score The score associated with the token.
       */
      constructor(tokenId, nodeId, pos, length, score) {
        this.tokenId = tokenId;
        this.nodeId = nodeId;
        this.pos = pos;
        this.length = length;
        this.score = score;
        this.prev = null;
        this.backtraceScore = 0;
      }
      /**
       * Returns a clone of this node.
       * @returns {TokenLatticeNode} A clone of this node.
       */
      clone() {
        const n = new _TokenLatticeNode(this.tokenId, this.nodeId, this.pos, this.length, this.score);
        n.prev = this.prev;
        n.backtraceScore = this.backtraceScore;
        return n;
      }
    };
  }
});

// node_modules/@huggingface/jinja/dist/index.js
function isWord(char) {
  return /\w/.test(char);
}
function isInteger(char) {
  return /[0-9]/.test(char);
}
function preprocess(template, options = {}) {
  if (template.endsWith("\n")) {
    template = template.slice(0, -1);
  }
  template = template.replace(/{#.*?#}/gs, "{##}");
  if (options.lstrip_blocks) {
    template = template.replace(/^[ \t]*({[#%])/gm, "$1");
  }
  if (options.trim_blocks) {
    template = template.replace(/([#%]})\n/g, "$1");
  }
  return template.replace(/{##}/g, "").replace(/-%}\s*/g, "%}").replace(/\s*{%-/g, "{%").replace(/-}}\s*/g, "}}").replace(/\s*{{-/g, "{{");
}
function tokenize(source, options = {}) {
  const tokens = [];
  const src = preprocess(source, options);
  let cursorPosition = 0;
  const consumeWhile = (predicate) => {
    let str = "";
    while (predicate(src[cursorPosition])) {
      if (src[cursorPosition] === "\\") {
        ++cursorPosition;
        if (cursorPosition >= src.length)
          throw new SyntaxError("Unexpected end of input");
        const escaped = src[cursorPosition++];
        const unescaped = ESCAPE_CHARACTERS.get(escaped);
        if (unescaped === void 0) {
          throw new SyntaxError(`Unexpected escaped character: ${escaped}`);
        }
        str += unescaped;
        continue;
      }
      str += src[cursorPosition++];
      if (cursorPosition >= src.length)
        throw new SyntaxError("Unexpected end of input");
    }
    return str;
  };
  main:
    while (cursorPosition < src.length) {
      const lastTokenType = tokens.at(-1)?.type;
      if (lastTokenType === void 0 || lastTokenType === TOKEN_TYPES.CloseStatement || lastTokenType === TOKEN_TYPES.CloseExpression) {
        let text = "";
        while (cursorPosition < src.length && // Keep going until we hit the next Jinja statement or expression
        !(src[cursorPosition] === "{" && (src[cursorPosition + 1] === "%" || src[cursorPosition + 1] === "{"))) {
          text += src[cursorPosition++];
        }
        if (text.length > 0) {
          tokens.push(new Token(text, TOKEN_TYPES.Text));
          continue;
        }
      }
      consumeWhile((char2) => /\s/.test(char2));
      const char = src[cursorPosition];
      if (char === "-" || char === "+") {
        const lastTokenType2 = tokens.at(-1)?.type;
        if (lastTokenType2 === TOKEN_TYPES.Text || lastTokenType2 === void 0) {
          throw new SyntaxError(`Unexpected character: ${char}`);
        }
        switch (lastTokenType2) {
          case TOKEN_TYPES.Identifier:
          case TOKEN_TYPES.NumericLiteral:
          case TOKEN_TYPES.BooleanLiteral:
          case TOKEN_TYPES.StringLiteral:
          case TOKEN_TYPES.CloseParen:
          case TOKEN_TYPES.CloseSquareBracket:
            break;
          default: {
            ++cursorPosition;
            const num = consumeWhile(isInteger);
            tokens.push(
              new Token(`${char}${num}`, num.length > 0 ? TOKEN_TYPES.NumericLiteral : TOKEN_TYPES.UnaryOperator)
            );
            continue;
          }
        }
      }
      for (const [char2, token] of ORDERED_MAPPING_TABLE) {
        const slice2 = src.slice(cursorPosition, cursorPosition + char2.length);
        if (slice2 === char2) {
          tokens.push(new Token(char2, token));
          cursorPosition += char2.length;
          continue main;
        }
      }
      if (char === "'" || char === '"') {
        ++cursorPosition;
        const str = consumeWhile((c) => c !== char);
        tokens.push(new Token(str, TOKEN_TYPES.StringLiteral));
        ++cursorPosition;
        continue;
      }
      if (isInteger(char)) {
        const num = consumeWhile(isInteger);
        tokens.push(new Token(num, TOKEN_TYPES.NumericLiteral));
        continue;
      }
      if (isWord(char)) {
        const word = consumeWhile(isWord);
        const type = Object.hasOwn(KEYWORDS, word) ? KEYWORDS[word] : TOKEN_TYPES.Identifier;
        if (type === TOKEN_TYPES.In && tokens.at(-1)?.type === TOKEN_TYPES.Not) {
          tokens.pop();
          tokens.push(new Token("not in", TOKEN_TYPES.NotIn));
        } else {
          tokens.push(new Token(word, type));
        }
        continue;
      }
      throw new SyntaxError(`Unexpected character: ${char}`);
    }
  return tokens;
}
function parse(tokens) {
  const program = new Program([]);
  let current = 0;
  function expect(type, error) {
    const prev = tokens[current++];
    if (!prev || prev.type !== type) {
      throw new Error(`Parser Error: ${error}. ${prev.type} !== ${type}.`);
    }
    return prev;
  }
  function parseAny() {
    switch (tokens[current].type) {
      case TOKEN_TYPES.Text:
        return parseText();
      case TOKEN_TYPES.OpenStatement:
        return parseJinjaStatement();
      case TOKEN_TYPES.OpenExpression:
        return parseJinjaExpression();
      default:
        throw new SyntaxError(`Unexpected token type: ${tokens[current].type}`);
    }
  }
  function not(...types) {
    return current + types.length <= tokens.length && types.some((type, i) => type !== tokens[current + i].type);
  }
  function is(...types) {
    return current + types.length <= tokens.length && types.every((type, i) => type === tokens[current + i].type);
  }
  function parseText() {
    return new StringLiteral(expect(TOKEN_TYPES.Text, "Expected text token").value);
  }
  function parseJinjaStatement() {
    expect(TOKEN_TYPES.OpenStatement, "Expected opening statement token");
    let result;
    switch (tokens[current].type) {
      case TOKEN_TYPES.Set:
        ++current;
        result = parseSetStatement();
        expect(TOKEN_TYPES.CloseStatement, "Expected closing statement token");
        break;
      case TOKEN_TYPES.If:
        ++current;
        result = parseIfStatement();
        expect(TOKEN_TYPES.OpenStatement, "Expected {% token");
        expect(TOKEN_TYPES.EndIf, "Expected endif token");
        expect(TOKEN_TYPES.CloseStatement, "Expected %} token");
        break;
      case TOKEN_TYPES.For:
        ++current;
        result = parseForStatement();
        expect(TOKEN_TYPES.OpenStatement, "Expected {% token");
        expect(TOKEN_TYPES.EndFor, "Expected endfor token");
        expect(TOKEN_TYPES.CloseStatement, "Expected %} token");
        break;
      default:
        throw new SyntaxError(`Unknown statement type: ${tokens[current].type}`);
    }
    return result;
  }
  function parseJinjaExpression() {
    expect(TOKEN_TYPES.OpenExpression, "Expected opening expression token");
    const result = parseExpression();
    expect(TOKEN_TYPES.CloseExpression, "Expected closing expression token");
    return result;
  }
  function parseSetStatement() {
    const left = parseExpression();
    if (is(TOKEN_TYPES.Equals)) {
      ++current;
      const value = parseSetStatement();
      return new SetStatement(left, value);
    }
    return left;
  }
  function parseIfStatement() {
    const test = parseExpression();
    expect(TOKEN_TYPES.CloseStatement, "Expected closing statement token");
    const body = [];
    const alternate = [];
    while (!(tokens[current]?.type === TOKEN_TYPES.OpenStatement && (tokens[current + 1]?.type === TOKEN_TYPES.ElseIf || tokens[current + 1]?.type === TOKEN_TYPES.Else || tokens[current + 1]?.type === TOKEN_TYPES.EndIf))) {
      body.push(parseAny());
    }
    if (tokens[current]?.type === TOKEN_TYPES.OpenStatement && tokens[current + 1]?.type !== TOKEN_TYPES.EndIf) {
      ++current;
      if (is(TOKEN_TYPES.ElseIf)) {
        expect(TOKEN_TYPES.ElseIf, "Expected elseif token");
        alternate.push(parseIfStatement());
      } else {
        expect(TOKEN_TYPES.Else, "Expected else token");
        expect(TOKEN_TYPES.CloseStatement, "Expected closing statement token");
        while (!(tokens[current]?.type === TOKEN_TYPES.OpenStatement && tokens[current + 1]?.type === TOKEN_TYPES.EndIf)) {
          alternate.push(parseAny());
        }
      }
    }
    return new If(test, body, alternate);
  }
  function parseExpressionSequence(primary = false) {
    const fn = primary ? parsePrimaryExpression : parseExpression;
    const expressions = [fn()];
    const isTuple = is(TOKEN_TYPES.Comma);
    while (isTuple) {
      ++current;
      expressions.push(fn());
      if (!is(TOKEN_TYPES.Comma)) {
        break;
      }
    }
    return isTuple ? new TupleLiteral(expressions) : expressions[0];
  }
  function parseForStatement() {
    const loopVariable = parseExpressionSequence(true);
    if (!(loopVariable instanceof Identifier || loopVariable instanceof TupleLiteral)) {
      throw new SyntaxError(`Expected identifier/tuple for the loop variable, got ${loopVariable.type} instead`);
    }
    expect(TOKEN_TYPES.In, "Expected `in` keyword following loop variable");
    const iterable = parseExpression();
    expect(TOKEN_TYPES.CloseStatement, "Expected closing statement token");
    const body = [];
    while (not(TOKEN_TYPES.OpenStatement, TOKEN_TYPES.EndFor)) {
      body.push(parseAny());
    }
    return new For(loopVariable, iterable, body);
  }
  function parseExpression() {
    return parseTernaryExpression();
  }
  function parseTernaryExpression() {
    const a = parseLogicalOrExpression();
    if (is(TOKEN_TYPES.If)) {
      ++current;
      const predicate = parseLogicalOrExpression();
      expect(TOKEN_TYPES.Else, "Expected else token");
      const b = parseLogicalOrExpression();
      return new If(predicate, [a], [b]);
    }
    return a;
  }
  function parseLogicalOrExpression() {
    let left = parseLogicalAndExpression();
    while (is(TOKEN_TYPES.Or)) {
      const operator = tokens[current];
      ++current;
      const right = parseLogicalAndExpression();
      left = new BinaryExpression(operator, left, right);
    }
    return left;
  }
  function parseLogicalAndExpression() {
    let left = parseLogicalNegationExpression();
    while (is(TOKEN_TYPES.And)) {
      const operator = tokens[current];
      ++current;
      const right = parseLogicalNegationExpression();
      left = new BinaryExpression(operator, left, right);
    }
    return left;
  }
  function parseLogicalNegationExpression() {
    let right;
    while (is(TOKEN_TYPES.Not)) {
      const operator = tokens[current];
      ++current;
      const arg = parseLogicalNegationExpression();
      right = new UnaryExpression(operator, arg);
    }
    return right ?? parseComparisonExpression();
  }
  function parseComparisonExpression() {
    let left = parseAdditiveExpression();
    while (is(TOKEN_TYPES.ComparisonBinaryOperator) || is(TOKEN_TYPES.In) || is(TOKEN_TYPES.NotIn)) {
      const operator = tokens[current];
      ++current;
      const right = parseAdditiveExpression();
      left = new BinaryExpression(operator, left, right);
    }
    return left;
  }
  function parseAdditiveExpression() {
    let left = parseMultiplicativeExpression();
    while (is(TOKEN_TYPES.AdditiveBinaryOperator)) {
      const operator = tokens[current];
      ++current;
      const right = parseMultiplicativeExpression();
      left = new BinaryExpression(operator, left, right);
    }
    return left;
  }
  function parseCallMemberExpression() {
    const member = parseMemberExpression();
    if (is(TOKEN_TYPES.OpenParen)) {
      return parseCallExpression(member);
    }
    return member;
  }
  function parseCallExpression(callee) {
    let callExpression = new CallExpression(callee, parseArgs());
    if (is(TOKEN_TYPES.OpenParen)) {
      callExpression = parseCallExpression(callExpression);
    }
    return callExpression;
  }
  function parseArgs() {
    expect(TOKEN_TYPES.OpenParen, "Expected opening parenthesis for arguments list");
    const args = parseArgumentsList();
    expect(TOKEN_TYPES.CloseParen, "Expected closing parenthesis for arguments list");
    return args;
  }
  function parseArgumentsList() {
    const args = [];
    while (!is(TOKEN_TYPES.CloseParen)) {
      let argument = parseExpression();
      if (is(TOKEN_TYPES.Equals)) {
        ++current;
        if (!(argument instanceof Identifier)) {
          throw new SyntaxError(`Expected identifier for keyword argument`);
        }
        const value = parseExpression();
        argument = new KeywordArgumentExpression(argument, value);
      }
      args.push(argument);
      if (is(TOKEN_TYPES.Comma)) {
        ++current;
      }
    }
    return args;
  }
  function parseMemberExpressionArgumentsList() {
    const slices = [];
    let isSlice = false;
    while (!is(TOKEN_TYPES.CloseSquareBracket)) {
      if (is(TOKEN_TYPES.Colon)) {
        slices.push(void 0);
        ++current;
        isSlice = true;
      } else {
        slices.push(parseExpression());
        if (is(TOKEN_TYPES.Colon)) {
          ++current;
          isSlice = true;
        }
      }
    }
    if (slices.length === 0) {
      throw new SyntaxError(`Expected at least one argument for member/slice expression`);
    }
    if (isSlice) {
      if (slices.length > 3) {
        throw new SyntaxError(`Expected 0-3 arguments for slice expression`);
      }
      return new SliceExpression(...slices);
    }
    return slices[0];
  }
  function parseMemberExpression() {
    let object = parsePrimaryExpression();
    while (is(TOKEN_TYPES.Dot) || is(TOKEN_TYPES.OpenSquareBracket)) {
      const operator = tokens[current];
      ++current;
      let property;
      const computed = operator.type !== TOKEN_TYPES.Dot;
      if (computed) {
        property = parseMemberExpressionArgumentsList();
        expect(TOKEN_TYPES.CloseSquareBracket, "Expected closing square bracket");
      } else {
        property = parsePrimaryExpression();
        if (property.type !== "Identifier") {
          throw new SyntaxError(`Expected identifier following dot operator`);
        }
      }
      object = new MemberExpression(object, property, computed);
    }
    return object;
  }
  function parseMultiplicativeExpression() {
    let left = parseTestExpression();
    while (is(TOKEN_TYPES.MultiplicativeBinaryOperator)) {
      const operator = tokens[current];
      ++current;
      const right = parseTestExpression();
      left = new BinaryExpression(operator, left, right);
    }
    return left;
  }
  function parseTestExpression() {
    let operand = parseFilterExpression();
    while (is(TOKEN_TYPES.Is)) {
      ++current;
      const negate = is(TOKEN_TYPES.Not);
      if (negate) {
        ++current;
      }
      let filter = parsePrimaryExpression();
      if (filter instanceof BooleanLiteral) {
        filter = new Identifier(filter.value.toString());
      }
      if (!(filter instanceof Identifier)) {
        throw new SyntaxError(`Expected identifier for the test`);
      }
      operand = new TestExpression(operand, negate, filter);
    }
    return operand;
  }
  function parseFilterExpression() {
    let operand = parseCallMemberExpression();
    while (is(TOKEN_TYPES.Pipe)) {
      ++current;
      let filter = parsePrimaryExpression();
      if (!(filter instanceof Identifier)) {
        throw new SyntaxError(`Expected identifier for the filter`);
      }
      if (is(TOKEN_TYPES.OpenParen)) {
        filter = parseCallExpression(filter);
      }
      operand = new FilterExpression(operand, filter);
    }
    return operand;
  }
  function parsePrimaryExpression() {
    const token = tokens[current];
    switch (token.type) {
      case TOKEN_TYPES.NumericLiteral:
        ++current;
        return new NumericLiteral(Number(token.value));
      case TOKEN_TYPES.StringLiteral:
        ++current;
        return new StringLiteral(token.value);
      case TOKEN_TYPES.BooleanLiteral:
        ++current;
        return new BooleanLiteral(token.value === "true");
      case TOKEN_TYPES.Identifier:
        ++current;
        return new Identifier(token.value);
      case TOKEN_TYPES.OpenParen: {
        ++current;
        const expression = parseExpressionSequence();
        if (tokens[current].type !== TOKEN_TYPES.CloseParen) {
          throw new SyntaxError(`Expected closing parenthesis, got ${tokens[current].type} instead`);
        }
        ++current;
        return expression;
      }
      case TOKEN_TYPES.OpenSquareBracket: {
        ++current;
        const values = [];
        while (!is(TOKEN_TYPES.CloseSquareBracket)) {
          values.push(parseExpression());
          if (is(TOKEN_TYPES.Comma)) {
            ++current;
          }
        }
        ++current;
        return new ArrayLiteral(values);
      }
      case TOKEN_TYPES.OpenCurlyBracket: {
        ++current;
        const values = /* @__PURE__ */ new Map();
        while (!is(TOKEN_TYPES.CloseCurlyBracket)) {
          const key = parseExpression();
          expect(TOKEN_TYPES.Colon, "Expected colon between key and value in object literal");
          const value = parseExpression();
          values.set(key, value);
          if (is(TOKEN_TYPES.Comma)) {
            ++current;
          }
        }
        ++current;
        return new ObjectLiteral(values);
      }
      default:
        throw new SyntaxError(`Unexpected token: ${token.type}`);
    }
  }
  while (current < tokens.length) {
    program.body.push(parseAny());
  }
  return program;
}
function range(start, stop, step = 1) {
  if (stop === void 0) {
    stop = start;
    start = 0;
  }
  const result = [];
  for (let i = start; i < stop; i += step) {
    result.push(i);
  }
  return result;
}
function slice(array, start, stop, step = 1) {
  const direction = Math.sign(step);
  if (direction >= 0) {
    start = (start ??= 0) < 0 ? Math.max(array.length + start, 0) : Math.min(start, array.length);
    stop = (stop ??= array.length) < 0 ? Math.max(array.length + stop, 0) : Math.min(stop, array.length);
  } else {
    start = (start ??= array.length - 1) < 0 ? Math.max(array.length + start, -1) : Math.min(start, array.length - 1);
    stop = (stop ??= -1) < -1 ? Math.max(array.length + stop, -1) : Math.min(stop, array.length - 1);
  }
  const result = [];
  for (let i = start; direction * i < direction * stop; i += step) {
    result.push(array[i]);
  }
  return result;
}
function titleCase(value) {
  return value.replace(/\b\w/g, (c) => c.toUpperCase());
}
function convertToRuntimeValues(input) {
  switch (typeof input) {
    case "number":
      return new NumericValue(input);
    case "string":
      return new StringValue(input);
    case "boolean":
      return new BooleanValue(input);
    case "object":
      if (input === null) {
        return new NullValue();
      } else if (Array.isArray(input)) {
        return new ArrayValue(input.map(convertToRuntimeValues));
      } else {
        return new ObjectValue(
          new Map(Object.entries(input).map(([key, value]) => [key, convertToRuntimeValues(value)]))
        );
      }
    case "function":
      return new FunctionValue((args, _scope) => {
        const result = input(...args.map((x) => x.value)) ?? null;
        return convertToRuntimeValues(result);
      });
    default:
      throw new Error(`Cannot convert to runtime value: ${input}`);
  }
}
var TOKEN_TYPES, KEYWORDS, Token, ORDERED_MAPPING_TABLE, ESCAPE_CHARACTERS, Statement, Program, If, For, SetStatement, Expression, MemberExpression, CallExpression, Identifier, Literal, NumericLiteral, StringLiteral, BooleanLiteral, ArrayLiteral, TupleLiteral, ObjectLiteral, BinaryExpression, FilterExpression, TestExpression, UnaryExpression, SliceExpression, KeywordArgumentExpression, RuntimeValue, NumericValue, StringValue, BooleanValue, ObjectValue, ArrayValue, TupleValue, FunctionValue, NullValue, UndefinedValue, Environment, Interpreter, Template;
var init_dist = __esm({
  "node_modules/@huggingface/jinja/dist/index.js"() {
    TOKEN_TYPES = Object.freeze({
      Text: "Text",
      // The text between Jinja statements or expressions
      NumericLiteral: "NumericLiteral",
      // e.g., 123
      BooleanLiteral: "BooleanLiteral",
      // true or false
      StringLiteral: "StringLiteral",
      // 'string'
      Identifier: "Identifier",
      // Variables, functions, etc.
      Equals: "Equals",
      // =
      OpenParen: "OpenParen",
      // (
      CloseParen: "CloseParen",
      // )
      OpenStatement: "OpenStatement",
      // {%
      CloseStatement: "CloseStatement",
      // %}
      OpenExpression: "OpenExpression",
      // {{
      CloseExpression: "CloseExpression",
      // }}
      OpenSquareBracket: "OpenSquareBracket",
      // [
      CloseSquareBracket: "CloseSquareBracket",
      // ]
      OpenCurlyBracket: "OpenCurlyBracket",
      // {
      CloseCurlyBracket: "CloseCurlyBracket",
      // }
      Comma: "Comma",
      // ,
      Dot: "Dot",
      // .
      Colon: "Colon",
      // :
      Pipe: "Pipe",
      // |
      CallOperator: "CallOperator",
      // ()
      AdditiveBinaryOperator: "AdditiveBinaryOperator",
      // + -
      MultiplicativeBinaryOperator: "MultiplicativeBinaryOperator",
      // * / %
      ComparisonBinaryOperator: "ComparisonBinaryOperator",
      // < > <= >= == !=
      UnaryOperator: "UnaryOperator",
      // ! - +
      // Keywords
      Set: "Set",
      If: "If",
      For: "For",
      In: "In",
      Is: "Is",
      NotIn: "NotIn",
      Else: "Else",
      EndIf: "EndIf",
      ElseIf: "ElseIf",
      EndFor: "EndFor",
      And: "And",
      Or: "Or",
      Not: "UnaryOperator"
    });
    KEYWORDS = Object.freeze({
      set: TOKEN_TYPES.Set,
      for: TOKEN_TYPES.For,
      in: TOKEN_TYPES.In,
      is: TOKEN_TYPES.Is,
      if: TOKEN_TYPES.If,
      else: TOKEN_TYPES.Else,
      endif: TOKEN_TYPES.EndIf,
      elif: TOKEN_TYPES.ElseIf,
      endfor: TOKEN_TYPES.EndFor,
      and: TOKEN_TYPES.And,
      or: TOKEN_TYPES.Or,
      not: TOKEN_TYPES.Not,
      "not in": TOKEN_TYPES.NotIn,
      // Literals
      true: TOKEN_TYPES.BooleanLiteral,
      false: TOKEN_TYPES.BooleanLiteral
    });
    Token = class {
      /**
       * Constructs a new Token.
       * @param {string} value The raw value as seen inside the source code.
       * @param {TokenType} type The type of token.
       */
      constructor(value, type) {
        this.value = value;
        this.type = type;
      }
    };
    ORDERED_MAPPING_TABLE = [
      // Control sequences
      ["{%", TOKEN_TYPES.OpenStatement],
      ["%}", TOKEN_TYPES.CloseStatement],
      ["{{", TOKEN_TYPES.OpenExpression],
      ["}}", TOKEN_TYPES.CloseExpression],
      // Single character tokens
      ["(", TOKEN_TYPES.OpenParen],
      [")", TOKEN_TYPES.CloseParen],
      ["{", TOKEN_TYPES.OpenCurlyBracket],
      ["}", TOKEN_TYPES.CloseCurlyBracket],
      ["[", TOKEN_TYPES.OpenSquareBracket],
      ["]", TOKEN_TYPES.CloseSquareBracket],
      [",", TOKEN_TYPES.Comma],
      [".", TOKEN_TYPES.Dot],
      [":", TOKEN_TYPES.Colon],
      ["|", TOKEN_TYPES.Pipe],
      // Comparison operators
      ["<=", TOKEN_TYPES.ComparisonBinaryOperator],
      [">=", TOKEN_TYPES.ComparisonBinaryOperator],
      ["==", TOKEN_TYPES.ComparisonBinaryOperator],
      ["!=", TOKEN_TYPES.ComparisonBinaryOperator],
      ["<", TOKEN_TYPES.ComparisonBinaryOperator],
      [">", TOKEN_TYPES.ComparisonBinaryOperator],
      // Arithmetic operators
      ["+", TOKEN_TYPES.AdditiveBinaryOperator],
      ["-", TOKEN_TYPES.AdditiveBinaryOperator],
      ["*", TOKEN_TYPES.MultiplicativeBinaryOperator],
      ["/", TOKEN_TYPES.MultiplicativeBinaryOperator],
      ["%", TOKEN_TYPES.MultiplicativeBinaryOperator],
      // Assignment operator
      ["=", TOKEN_TYPES.Equals]
    ];
    ESCAPE_CHARACTERS = /* @__PURE__ */ new Map([
      ["n", "\n"],
      // New line
      ["t", "	"],
      // Horizontal tab
      ["r", "\r"],
      // Carriage return
      ["b", "\b"],
      // Backspace
      ["f", "\f"],
      // Form feed
      ["v", "\v"],
      // Vertical tab
      ["'", "'"],
      // Single quote
      ['"', '"'],
      // Double quote
      ["\\", "\\"]
      // Backslash
    ]);
    Statement = class {
      type = "Statement";
    };
    Program = class extends Statement {
      constructor(body) {
        super();
        this.body = body;
      }
      type = "Program";
    };
    If = class extends Statement {
      constructor(test, body, alternate) {
        super();
        this.test = test;
        this.body = body;
        this.alternate = alternate;
      }
      type = "If";
    };
    For = class extends Statement {
      constructor(loopvar, iterable, body) {
        super();
        this.loopvar = loopvar;
        this.iterable = iterable;
        this.body = body;
      }
      type = "For";
    };
    SetStatement = class extends Statement {
      constructor(assignee, value) {
        super();
        this.assignee = assignee;
        this.value = value;
      }
      type = "Set";
    };
    Expression = class extends Statement {
      type = "Expression";
    };
    MemberExpression = class extends Expression {
      constructor(object, property, computed) {
        super();
        this.object = object;
        this.property = property;
        this.computed = computed;
      }
      type = "MemberExpression";
    };
    CallExpression = class extends Expression {
      constructor(callee, args) {
        super();
        this.callee = callee;
        this.args = args;
      }
      type = "CallExpression";
    };
    Identifier = class extends Expression {
      /**
       * @param {string} value The name of the identifier
       */
      constructor(value) {
        super();
        this.value = value;
      }
      type = "Identifier";
    };
    Literal = class extends Expression {
      constructor(value) {
        super();
        this.value = value;
      }
      type = "Literal";
    };
    NumericLiteral = class extends Literal {
      type = "NumericLiteral";
    };
    StringLiteral = class extends Literal {
      type = "StringLiteral";
    };
    BooleanLiteral = class extends Literal {
      type = "BooleanLiteral";
    };
    ArrayLiteral = class extends Literal {
      type = "ArrayLiteral";
    };
    TupleLiteral = class extends Literal {
      type = "TupleLiteral";
    };
    ObjectLiteral = class extends Literal {
      type = "ObjectLiteral";
    };
    BinaryExpression = class extends Expression {
      constructor(operator, left, right) {
        super();
        this.operator = operator;
        this.left = left;
        this.right = right;
      }
      type = "BinaryExpression";
    };
    FilterExpression = class extends Expression {
      constructor(operand, filter) {
        super();
        this.operand = operand;
        this.filter = filter;
      }
      type = "FilterExpression";
    };
    TestExpression = class extends Expression {
      constructor(operand, negate, test) {
        super();
        this.operand = operand;
        this.negate = negate;
        this.test = test;
      }
      type = "TestExpression";
    };
    UnaryExpression = class extends Expression {
      constructor(operator, argument) {
        super();
        this.operator = operator;
        this.argument = argument;
      }
      type = "UnaryExpression";
    };
    SliceExpression = class extends Expression {
      constructor(start = void 0, stop = void 0, step = void 0) {
        super();
        this.start = start;
        this.stop = stop;
        this.step = step;
      }
      type = "SliceExpression";
    };
    KeywordArgumentExpression = class extends Expression {
      constructor(key, value) {
        super();
        this.key = key;
        this.value = value;
      }
      type = "KeywordArgumentExpression";
    };
    RuntimeValue = class {
      type = "RuntimeValue";
      value;
      /**
       * A collection of built-in functions for this type.
       */
      builtins = /* @__PURE__ */ new Map();
      /**
       * Creates a new RuntimeValue.
       */
      constructor(value = void 0) {
        this.value = value;
      }
      /**
       * Determines truthiness or falsiness of the runtime value.
       * This function should be overridden by subclasses if it has custom truthiness criteria.
       * @returns {BooleanValue} BooleanValue(true) if the value is truthy, BooleanValue(false) otherwise.
       */
      __bool__() {
        return new BooleanValue(!!this.value);
      }
    };
    NumericValue = class extends RuntimeValue {
      type = "NumericValue";
    };
    StringValue = class extends RuntimeValue {
      type = "StringValue";
      builtins = /* @__PURE__ */ new Map([
        [
          "upper",
          new FunctionValue(() => {
            return new StringValue(this.value.toUpperCase());
          })
        ],
        [
          "lower",
          new FunctionValue(() => {
            return new StringValue(this.value.toLowerCase());
          })
        ],
        [
          "strip",
          new FunctionValue(() => {
            return new StringValue(this.value.trim());
          })
        ],
        [
          "title",
          new FunctionValue(() => {
            return new StringValue(titleCase(this.value));
          })
        ],
        ["length", new NumericValue(this.value.length)]
      ]);
    };
    BooleanValue = class extends RuntimeValue {
      type = "BooleanValue";
    };
    ObjectValue = class extends RuntimeValue {
      type = "ObjectValue";
      /**
       * NOTE: necessary to override since all JavaScript arrays are considered truthy,
       * while only non-empty Python arrays are consider truthy.
       *
       * e.g.,
       *  - JavaScript:  {} && 5 -> 5
       *  - Python:      {} and 5 -> {}
       */
      __bool__() {
        return new BooleanValue(this.value.size > 0);
      }
      builtins = /* @__PURE__ */ new Map([
        [
          "get",
          new FunctionValue(([key, defaultValue]) => {
            if (!(key instanceof StringValue)) {
              throw new Error(`Object key must be a string: got ${key.type}`);
            }
            return this.value.get(key.value) ?? defaultValue ?? new NullValue();
          })
        ],
        [
          "items",
          new FunctionValue(() => {
            return new ArrayValue(
              Array.from(this.value.entries()).map(([key, value]) => new ArrayValue([new StringValue(key), value]))
            );
          })
        ]
      ]);
    };
    ArrayValue = class extends RuntimeValue {
      type = "ArrayValue";
      builtins = /* @__PURE__ */ new Map([["length", new NumericValue(this.value.length)]]);
      /**
       * NOTE: necessary to override since all JavaScript arrays are considered truthy,
       * while only non-empty Python arrays are consider truthy.
       *
       * e.g.,
       *  - JavaScript:  [] && 5 -> 5
       *  - Python:      [] and 5 -> []
       */
      __bool__() {
        return new BooleanValue(this.value.length > 0);
      }
    };
    TupleValue = class extends ArrayValue {
      type = "TupleValue";
    };
    FunctionValue = class extends RuntimeValue {
      type = "FunctionValue";
    };
    NullValue = class extends RuntimeValue {
      type = "NullValue";
    };
    UndefinedValue = class extends RuntimeValue {
      type = "UndefinedValue";
    };
    Environment = class {
      constructor(parent) {
        this.parent = parent;
      }
      /**
       * The variables declared in this environment.
       */
      variables = /* @__PURE__ */ new Map([
        [
          "namespace",
          new FunctionValue((args) => {
            if (args.length === 0) {
              return new ObjectValue(/* @__PURE__ */ new Map());
            }
            if (args.length !== 1 || !(args[0] instanceof ObjectValue)) {
              throw new Error("`namespace` expects either zero arguments or a single object argument");
            }
            return args[0];
          })
        ]
      ]);
      /**
       * The tests available in this environment.
       */
      tests = /* @__PURE__ */ new Map([
        ["boolean", (operand) => operand.type === "BooleanValue"],
        ["callable", (operand) => operand instanceof FunctionValue],
        [
          "odd",
          (operand) => {
            if (operand.type !== "NumericValue") {
              throw new Error(`Cannot apply test "odd" to type: ${operand.type}`);
            }
            return operand.value % 2 !== 0;
          }
        ],
        [
          "even",
          (operand) => {
            if (operand.type !== "NumericValue") {
              throw new Error(`Cannot apply test "even" to type: ${operand.type}`);
            }
            return operand.value % 2 === 0;
          }
        ],
        ["false", (operand) => operand.type === "BooleanValue" && !operand.value],
        ["true", (operand) => operand.type === "BooleanValue" && operand.value],
        ["number", (operand) => operand.type === "NumericValue"],
        ["integer", (operand) => operand.type === "NumericValue" && Number.isInteger(operand.value)],
        ["iterable", (operand) => operand instanceof ArrayValue || operand instanceof StringValue],
        [
          "lower",
          (operand) => {
            const str = operand.value;
            return operand.type === "StringValue" && str === str.toLowerCase();
          }
        ],
        [
          "upper",
          (operand) => {
            const str = operand.value;
            return operand.type === "StringValue" && str === str.toUpperCase();
          }
        ],
        ["none", (operand) => operand.type === "NullValue"],
        ["defined", (operand) => operand.type !== "UndefinedValue"],
        ["undefined", (operand) => operand.type === "UndefinedValue"],
        ["equalto", (a, b) => a.value === b.value]
      ]);
      /**
       * Set the value of a variable in the current environment.
       */
      set(name, value) {
        return this.declareVariable(name, convertToRuntimeValues(value));
      }
      declareVariable(name, value) {
        if (this.variables.has(name)) {
          throw new SyntaxError(`Variable already declared: ${name}`);
        }
        this.variables.set(name, value);
        return value;
      }
      // private assignVariable(name: string, value: AnyRuntimeValue): AnyRuntimeValue {
      // 	const env = this.resolve(name);
      // 	env.variables.set(name, value);
      // 	return value;
      // }
      /**
       * Set variable in the current scope.
       * See https://jinja.palletsprojects.com/en/3.0.x/templates/#assignments for more information.
       */
      setVariable(name, value) {
        this.variables.set(name, value);
        return value;
      }
      /**
       * Resolve the environment in which the variable is declared.
       * @param {string} name The name of the variable.
       * @returns {Environment} The environment in which the variable is declared.
       */
      resolve(name) {
        if (this.variables.has(name)) {
          return this;
        }
        if (this.parent) {
          return this.parent.resolve(name);
        }
        throw new Error(`Unknown variable: ${name}`);
      }
      lookupVariable(name) {
        try {
          return this.resolve(name).variables.get(name) ?? new UndefinedValue();
        } catch {
          return new UndefinedValue();
        }
      }
    };
    Interpreter = class {
      global;
      constructor(env3) {
        this.global = env3 ?? new Environment();
      }
      /**
       * Run the program.
       */
      run(program) {
        return this.evaluate(program, this.global);
      }
      /**
       * Evaluates expressions following the binary operation type.
       */
      evaluateBinaryExpression(node, environment) {
        const left = this.evaluate(node.left, environment);
        switch (node.operator.value) {
          case "and":
            return left.__bool__().value ? this.evaluate(node.right, environment) : left;
          case "or":
            return left.__bool__().value ? left : this.evaluate(node.right, environment);
        }
        const right = this.evaluate(node.right, environment);
        switch (node.operator.value) {
          case "==":
            return new BooleanValue(left.value == right.value);
          case "!=":
            return new BooleanValue(left.value != right.value);
        }
        if (left instanceof UndefinedValue || right instanceof UndefinedValue) {
          throw new Error("Cannot perform operation on undefined values");
        } else if (left instanceof NullValue || right instanceof NullValue) {
          throw new Error("Cannot perform operation on null values");
        } else if (left instanceof NumericValue && right instanceof NumericValue) {
          switch (node.operator.value) {
            case "+":
              return new NumericValue(left.value + right.value);
            case "-":
              return new NumericValue(left.value - right.value);
            case "*":
              return new NumericValue(left.value * right.value);
            case "/":
              return new NumericValue(left.value / right.value);
            case "%":
              return new NumericValue(left.value % right.value);
            case "<":
              return new BooleanValue(left.value < right.value);
            case ">":
              return new BooleanValue(left.value > right.value);
            case ">=":
              return new BooleanValue(left.value >= right.value);
            case "<=":
              return new BooleanValue(left.value <= right.value);
          }
        } else if (left instanceof ArrayValue && right instanceof ArrayValue) {
          switch (node.operator.value) {
            case "+":
              return new ArrayValue(left.value.concat(right.value));
          }
        } else if (right instanceof ArrayValue) {
          const member = right.value.find((x) => x.value === left.value) !== void 0;
          switch (node.operator.value) {
            case "in":
              return new BooleanValue(member);
            case "not in":
              return new BooleanValue(!member);
          }
        }
        if (left instanceof StringValue || right instanceof StringValue) {
          switch (node.operator.value) {
            case "+":
              return new StringValue(left.value.toString() + right.value.toString());
          }
        }
        if (left instanceof StringValue && right instanceof StringValue) {
          switch (node.operator.value) {
            case "in":
              return new BooleanValue(right.value.includes(left.value));
            case "not in":
              return new BooleanValue(!right.value.includes(left.value));
          }
        }
        if (left instanceof StringValue && right instanceof ObjectValue) {
          switch (node.operator.value) {
            case "in":
              return new BooleanValue(right.value.has(left.value));
            case "not in":
              return new BooleanValue(!right.value.has(left.value));
          }
        }
        throw new SyntaxError(`Unknown operator "${node.operator.value}" between ${left.type} and ${right.type}`);
      }
      /**
       * Evaluates expressions following the filter operation type.
       */
      evaluateFilterExpression(node, environment) {
        const operand = this.evaluate(node.operand, environment);
        if (node.filter.type === "Identifier") {
          const filter = node.filter;
          if (operand instanceof ArrayValue) {
            switch (filter.value) {
              case "list":
                return operand;
              case "first":
                return operand.value[0];
              case "last":
                return operand.value[operand.value.length - 1];
              case "length":
                return new NumericValue(operand.value.length);
              case "reverse":
                return new ArrayValue(operand.value.reverse());
              case "sort":
                return new ArrayValue(
                  operand.value.sort((a, b) => {
                    if (a.type !== b.type) {
                      throw new Error(`Cannot compare different types: ${a.type} and ${b.type}`);
                    }
                    switch (a.type) {
                      case "NumericValue":
                        return a.value - b.value;
                      case "StringValue":
                        return a.value.localeCompare(b.value);
                      default:
                        throw new Error(`Cannot compare type: ${a.type}`);
                    }
                  })
                );
              default:
                throw new Error(`Unknown ArrayValue filter: ${filter.value}`);
            }
          } else if (operand instanceof StringValue) {
            switch (filter.value) {
              case "length":
                return new NumericValue(operand.value.length);
              case "upper":
                return new StringValue(operand.value.toUpperCase());
              case "lower":
                return new StringValue(operand.value.toLowerCase());
              case "title":
                return new StringValue(titleCase(operand.value));
              case "capitalize":
                return new StringValue(operand.value.charAt(0).toUpperCase() + operand.value.slice(1));
              case "trim":
                return new StringValue(operand.value.trim());
              default:
                throw new Error(`Unknown StringValue filter: ${filter.value}`);
            }
          } else if (operand instanceof NumericValue) {
            switch (filter.value) {
              case "abs":
                return new NumericValue(Math.abs(operand.value));
              default:
                throw new Error(`Unknown NumericValue filter: ${filter.value}`);
            }
          } else if (operand instanceof ObjectValue) {
            switch (filter.value) {
              case "items":
                return new ArrayValue(
                  Array.from(operand.value.entries()).map(([key, value]) => new ArrayValue([new StringValue(key), value]))
                );
              case "length":
                return new NumericValue(operand.value.size);
              default:
                throw new Error(`Unknown ObjectValue filter: ${filter.value}`);
            }
          }
          throw new Error(`Cannot apply filter "${filter.value}" to type: ${operand.type}`);
        } else if (node.filter.type === "CallExpression") {
          const filter = node.filter;
          if (filter.callee.type !== "Identifier") {
            throw new Error(`Unknown filter: ${filter.callee.type}`);
          }
          const filterName = filter.callee.value;
          if (operand instanceof ArrayValue) {
            switch (filterName) {
              case "selectattr": {
                if (operand.value.some((x) => !(x instanceof ObjectValue))) {
                  throw new Error("`selectattr` can only be applied to array of objects");
                }
                if (filter.args.some((x) => x.type !== "StringLiteral")) {
                  throw new Error("arguments of `selectattr` must be strings");
                }
                const [attr, testName, value] = filter.args.map((x) => this.evaluate(x, environment));
                let testFunction;
                if (testName) {
                  const test = environment.tests.get(testName.value);
                  if (!test) {
                    throw new Error(`Unknown test: ${testName.value}`);
                  }
                  testFunction = test;
                } else {
                  testFunction = (...x) => x[0].__bool__().value;
                }
                const filtered = operand.value.filter((item) => {
                  const a = item.value.get(attr.value);
                  if (a) {
                    return testFunction(a, value);
                  }
                  return false;
                });
                return new ArrayValue(filtered);
              }
            }
            throw new Error(`Unknown ArrayValue filter: ${filterName}`);
          } else {
            throw new Error(`Cannot apply filter "${filterName}" to type: ${operand.type}`);
          }
        }
        throw new Error(`Unknown filter: ${node.filter.type}`);
      }
      /**
       * Evaluates expressions following the test operation type.
       */
      evaluateTestExpression(node, environment) {
        const operand = this.evaluate(node.operand, environment);
        const test = environment.tests.get(node.test.value);
        if (!test) {
          throw new Error(`Unknown test: ${node.test.value}`);
        }
        const result = test(operand);
        return new BooleanValue(node.negate ? !result : result);
      }
      /**
       * Evaluates expressions following the unary operation type.
       */
      evaluateUnaryExpression(node, environment) {
        const argument = this.evaluate(node.argument, environment);
        switch (node.operator.value) {
          case "not":
            return new BooleanValue(!argument.value);
          default:
            throw new SyntaxError(`Unknown operator: ${node.operator.value}`);
        }
      }
      evalProgram(program, environment) {
        return this.evaluateBlock(program.body, environment);
      }
      evaluateBlock(statements, environment) {
        let result = "";
        for (const statement of statements) {
          const lastEvaluated = this.evaluate(statement, environment);
          if (lastEvaluated.type !== "NullValue" && lastEvaluated.type !== "UndefinedValue") {
            result += lastEvaluated.value;
          }
        }
        return new StringValue(result);
      }
      evaluateIdentifier(node, environment) {
        return environment.lookupVariable(node.value);
      }
      evaluateCallExpression(expr, environment) {
        const args = [];
        const kwargs = /* @__PURE__ */ new Map();
        for (const argument of expr.args) {
          if (argument.type === "KeywordArgumentExpression") {
            const kwarg = argument;
            kwargs.set(kwarg.key.value, this.evaluate(kwarg.value, environment));
          } else {
            args.push(this.evaluate(argument, environment));
          }
        }
        if (kwargs.size > 0) {
          args.push(new ObjectValue(kwargs));
        }
        const fn = this.evaluate(expr.callee, environment);
        if (fn.type !== "FunctionValue") {
          throw new Error(`Cannot call something that is not a function: got ${fn.type}`);
        }
        return fn.value(args, environment);
      }
      evaluateSliceExpression(object, expr, environment) {
        if (!(object instanceof ArrayValue || object instanceof StringValue)) {
          throw new Error("Slice object must be an array or string");
        }
        const start = this.evaluate(expr.start, environment);
        const stop = this.evaluate(expr.stop, environment);
        const step = this.evaluate(expr.step, environment);
        if (!(start instanceof NumericValue || start instanceof UndefinedValue)) {
          throw new Error("Slice start must be numeric or undefined");
        }
        if (!(stop instanceof NumericValue || stop instanceof UndefinedValue)) {
          throw new Error("Slice stop must be numeric or undefined");
        }
        if (!(step instanceof NumericValue || step instanceof UndefinedValue)) {
          throw new Error("Slice step must be numeric or undefined");
        }
        if (object instanceof ArrayValue) {
          return new ArrayValue(slice(object.value, start.value, stop.value, step.value));
        } else {
          return new StringValue(slice(Array.from(object.value), start.value, stop.value, step.value).join(""));
        }
      }
      evaluateMemberExpression(expr, environment) {
        const object = this.evaluate(expr.object, environment);
        let property;
        if (expr.computed) {
          if (expr.property.type === "SliceExpression") {
            return this.evaluateSliceExpression(object, expr.property, environment);
          } else {
            property = this.evaluate(expr.property, environment);
          }
        } else {
          property = new StringValue(expr.property.value);
        }
        let value;
        if (object instanceof ObjectValue) {
          if (!(property instanceof StringValue)) {
            throw new Error(`Cannot access property with non-string: got ${property.type}`);
          }
          value = object.value.get(property.value) ?? object.builtins.get(property.value);
        } else if (object instanceof ArrayValue || object instanceof StringValue) {
          if (property instanceof NumericValue) {
            value = object.value.at(property.value);
            if (object instanceof StringValue) {
              value = new StringValue(object.value.at(property.value));
            }
          } else if (property instanceof StringValue) {
            value = object.builtins.get(property.value);
          } else {
            throw new Error(`Cannot access property with non-string/non-number: got ${property.type}`);
          }
        } else {
          if (!(property instanceof StringValue)) {
            throw new Error(`Cannot access property with non-string: got ${property.type}`);
          }
          value = object.builtins.get(property.value);
        }
        return value instanceof RuntimeValue ? value : new UndefinedValue();
      }
      evaluateSet(node, environment) {
        const rhs = this.evaluate(node.value, environment);
        if (node.assignee.type === "Identifier") {
          const variableName = node.assignee.value;
          environment.setVariable(variableName, rhs);
        } else if (node.assignee.type === "MemberExpression") {
          const member = node.assignee;
          const object = this.evaluate(member.object, environment);
          if (!(object instanceof ObjectValue)) {
            throw new Error("Cannot assign to member of non-object");
          }
          if (member.property.type !== "Identifier") {
            throw new Error("Cannot assign to member with non-identifier property");
          }
          object.value.set(member.property.value, rhs);
        } else {
          throw new Error(`Invalid LHS inside assignment expression: ${JSON.stringify(node.assignee)}`);
        }
        return new NullValue();
      }
      evaluateIf(node, environment) {
        const test = this.evaluate(node.test, environment);
        return this.evaluateBlock(test.__bool__().value ? node.body : node.alternate, environment);
      }
      evaluateFor(node, environment) {
        const scope = new Environment(environment);
        const iterable = this.evaluate(node.iterable, scope);
        if (!(iterable instanceof ArrayValue)) {
          throw new Error(`Expected iterable type in for loop: got ${iterable.type}`);
        }
        let result = "";
        for (let i = 0; i < iterable.value.length; ++i) {
          const loop = /* @__PURE__ */ new Map([
            ["index", new NumericValue(i + 1)],
            ["index0", new NumericValue(i)],
            ["revindex", new NumericValue(iterable.value.length - i)],
            ["revindex0", new NumericValue(iterable.value.length - i - 1)],
            ["first", new BooleanValue(i === 0)],
            ["last", new BooleanValue(i === iterable.value.length - 1)],
            ["length", new NumericValue(iterable.value.length)],
            ["previtem", i > 0 ? iterable.value[i - 1] : new UndefinedValue()],
            ["nextitem", i < iterable.value.length - 1 ? iterable.value[i + 1] : new UndefinedValue()]
          ]);
          scope.setVariable("loop", new ObjectValue(loop));
          const current = iterable.value[i];
          if (node.loopvar.type === "Identifier") {
            scope.setVariable(node.loopvar.value, current);
          } else if (node.loopvar.type === "TupleLiteral") {
            const loopvar = node.loopvar;
            if (current.type !== "ArrayValue") {
              throw new Error(`Cannot unpack non-iterable type: ${current.type}`);
            }
            const c = current;
            if (loopvar.value.length !== c.value.length) {
              throw new Error(`Too ${loopvar.value.length > c.value.length ? "few" : "many"} items to unpack`);
            }
            for (let j = 0; j < loopvar.value.length; ++j) {
              if (loopvar.value[j].type !== "Identifier") {
                throw new Error(`Cannot unpack non-identifier type: ${loopvar.value[j].type}`);
              }
              scope.setVariable(loopvar.value[j].value, c.value[j]);
            }
          }
          const evaluated = this.evaluateBlock(node.body, scope);
          result += evaluated.value;
        }
        return new StringValue(result);
      }
      evaluate(statement, environment) {
        if (statement === void 0)
          return new UndefinedValue();
        switch (statement.type) {
          case "Program":
            return this.evalProgram(statement, environment);
          case "Set":
            return this.evaluateSet(statement, environment);
          case "If":
            return this.evaluateIf(statement, environment);
          case "For":
            return this.evaluateFor(statement, environment);
          case "NumericLiteral":
            return new NumericValue(Number(statement.value));
          case "StringLiteral":
            return new StringValue(statement.value);
          case "BooleanLiteral":
            return new BooleanValue(statement.value);
          case "ArrayLiteral":
            return new ArrayValue(statement.value.map((x) => this.evaluate(x, environment)));
          case "TupleLiteral":
            return new TupleValue(statement.value.map((x) => this.evaluate(x, environment)));
          case "ObjectLiteral": {
            const mapping = /* @__PURE__ */ new Map();
            for (const [key, value] of statement.value) {
              const evaluatedKey = this.evaluate(key, environment);
              if (!(evaluatedKey instanceof StringValue)) {
                throw new Error(`Object keys must be strings: got ${evaluatedKey.type}`);
              }
              mapping.set(evaluatedKey.value, this.evaluate(value, environment));
            }
            return new ObjectValue(mapping);
          }
          case "Identifier":
            return this.evaluateIdentifier(statement, environment);
          case "CallExpression":
            return this.evaluateCallExpression(statement, environment);
          case "MemberExpression":
            return this.evaluateMemberExpression(statement, environment);
          case "UnaryExpression":
            return this.evaluateUnaryExpression(statement, environment);
          case "BinaryExpression":
            return this.evaluateBinaryExpression(statement, environment);
          case "FilterExpression":
            return this.evaluateFilterExpression(statement, environment);
          case "TestExpression":
            return this.evaluateTestExpression(statement, environment);
          default:
            throw new SyntaxError(`Unknown node type: ${statement.type}`);
        }
      }
    };
    Template = class {
      parsed;
      /**
       * @param {string} template The template string
       */
      constructor(template) {
        const tokens = tokenize(template, {
          lstrip_blocks: true,
          trim_blocks: true
        });
        this.parsed = parse(tokens);
      }
      render(items) {
        const env3 = new Environment();
        env3.set("false", false);
        env3.set("true", true);
        env3.set("raise_exception", (args) => {
          throw new Error(args);
        });
        env3.set("range", range);
        for (const [key, value] of Object.entries(items)) {
          env3.set(key, value);
        }
        const interpreter = new Interpreter(env3);
        const result = interpreter.run(this.parsed);
        return result.value;
      }
    };
  }
});

// node_modules/@xenova/transformers/src/tokenizers.js
async function loadTokenizer(pretrained_model_name_or_path, options) {
  const info = await Promise.all([
    getModelJSON(pretrained_model_name_or_path, "tokenizer.json", true, options),
    getModelJSON(pretrained_model_name_or_path, "tokenizer_config.json", true, options)
  ]);
  if (options.legacy !== null) {
    info[1].legacy = options.legacy;
  }
  return info;
}
function regexSplit(text, regex) {
  const result = [];
  let prev = 0;
  for (const match of text.matchAll(regex)) {
    const fullMatch = match[0];
    if (prev < match.index) {
      result.push(text.slice(prev, match.index));
    }
    if (fullMatch.length > 0) {
      result.push(fullMatch);
    }
    prev = match.index + fullMatch.length;
  }
  if (prev < text.length) {
    result.push(text.slice(prev));
  }
  return result;
}
function createPattern(pattern, invert = true) {
  if (pattern.Regex !== void 0) {
    let regex = pattern.Regex.replace(/\\([#&~])/g, "$1");
    for (const [key, value] of PROBLEMATIC_REGEX_MAP) {
      regex = regex.replaceAll(key, value);
    }
    return new RegExp(regex, "gu");
  } else if (pattern.String !== void 0) {
    const escaped = escapeRegExp(pattern.String);
    return new RegExp(invert ? escaped : `(${escaped})`, "gu");
  } else {
    console.warn("Unknown pattern type:", pattern);
    return null;
  }
}
function objectToMap(obj) {
  return new Map(Object.entries(obj));
}
function prepareTensorForDecode(tensor) {
  const dims = tensor.dims;
  switch (dims.length) {
    case 1:
      return tensor.tolist();
    case 2:
      if (dims[0] !== 1) {
        throw new Error("Unable to decode tensor with `batch size !== 1`. Use `tokenizer.batch_decode(...)` for batched inputs.");
      }
      return tensor.tolist()[0];
    default:
      throw new Error(`Expected tensor to have 1-2 dimensions, got ${dims.length}.`);
  }
}
function clean_up_tokenization(text) {
  return text.replace(/ \./g, ".").replace(/ \?/g, "?").replace(/ \!/g, "!").replace(/ ,/g, ",").replace(/ \' /g, "'").replace(/ n\'t/g, "n't").replace(/ \'m/g, "'m").replace(/ \'s/g, "'s").replace(/ \'ve/g, "'ve").replace(/ \'re/g, "'re");
}
function remove_accents(text) {
  return text.replace(/[\u0300-\u036f]/g, "");
}
function lowercase_and_remove_accent(text) {
  return remove_accents(text.toLowerCase());
}
function fuse(arr, value, mapping) {
  const fused = [];
  let i = 0;
  while (i < arr.length) {
    fused.push(arr[i]);
    if ((mapping.get(arr[i]) ?? value) !== value) {
      ++i;
      continue;
    }
    while (i < arr.length && (mapping.get(arr[i]) ?? value) === value) {
      ++i;
    }
  }
  return fused;
}
function whitespace_split(text) {
  return text.match(/\S+/g) || [];
}
function padHelper(item, length, value_fn, side) {
  for (const key of Object.keys(item)) {
    const diff = length - item[key].length;
    const value = value_fn(key);
    const padData = new Array(diff).fill(value);
    item[key] = side === "right" ? mergeArrays(item[key], padData) : mergeArrays(padData, item[key]);
  }
}
function truncateHelper(item, length) {
  for (const key of Object.keys(item)) {
    item[key].length = length;
  }
}
function _build_translation_inputs(self2, raw_inputs, tokenizer_options, generate_kwargs) {
  if (!("language_codes" in self2) || !Array.isArray(self2.language_codes)) {
    throw new Error("Tokenizer must have `language_codes` attribute set and it should be an array of language ids.");
  }
  if (!("languageRegex" in self2) || !(self2.languageRegex instanceof RegExp)) {
    throw new Error("Tokenizer must have `languageRegex` attribute set and it should be a regular expression.");
  }
  if (!("lang_to_token" in self2) || typeof self2.lang_to_token !== "function") {
    throw new Error("Tokenizer must have `lang_to_token` attribute set and it should be a function.");
  }
  const src_lang_token = generate_kwargs.src_lang;
  const tgt_lang_token = generate_kwargs.tgt_lang;
  if (!self2.language_codes.includes(tgt_lang_token)) {
    throw new Error(`Target language code "${tgt_lang_token}" is not valid. Must be one of: {${self2.language_codes.join(", ")}}`);
  }
  if (src_lang_token !== void 0) {
    if (!self2.language_codes.includes(src_lang_token)) {
      throw new Error(`Source language code "${src_lang_token}" is not valid. Must be one of: {${self2.language_codes.join(", ")}}`);
    }
    for (const item of self2.post_processor.config.single) {
      if ("SpecialToken" in item && self2.languageRegex.test(item.SpecialToken.id)) {
        item.SpecialToken.id = self2.lang_to_token(src_lang_token);
        break;
      }
    }
  }
  generate_kwargs.forced_bos_token_id = self2.model.convert_tokens_to_ids([self2.lang_to_token(tgt_lang_token)])[0];
  return self2._call(raw_inputs, tokenizer_options);
}
var PUNCTUATION_REGEX, PROBLEMATIC_REGEX_MAP, AddedToken, TokenizerModel, WordPieceTokenizer, Unigram, BYTES_TO_UNICODE, UNICODE_TO_BYTES, BPE, LegacyTokenizerModel, Normalizer, Replace, NFC, NFKC, NFKD, StripNormalizer, StripAccents, Lowercase, Prepend, NormalizerSequence, BertNormalizer, PreTokenizer, BertPreTokenizer, ByteLevelPreTokenizer, SplitPreTokenizer, PunctuationPreTokenizer, DigitsPreTokenizer, PostProcessor, BertProcessing, RobertaProcessing, TemplateProcessing, ByteLevelPostProcessor, PostProcessorSequence, Decoder, ReplaceDecoder, ByteFallback, FuseDecoder, StripDecoder, WordPieceDecoder, ByteLevelDecoder, CTCDecoder, DecoderSequence, BPEDecoder, VitsDecoder, MetaspacePreTokenizer, MetaspaceDecoder, Precompiled, PreTokenizerSequence, WhitespacePreTokenizer, WhitespaceSplit, ReplacePreTokenizer, SPECIAL_TOKEN_ATTRIBUTES, PreTrainedTokenizer, BertTokenizer, AlbertTokenizer, MobileBertTokenizer, SqueezeBertTokenizer, DebertaTokenizer, DebertaV2Tokenizer, HerbertTokenizer, ConvBertTokenizer, RoFormerTokenizer, DistilBertTokenizer, CamembertTokenizer, XLMTokenizer, ElectraTokenizer, T5Tokenizer, GPT2Tokenizer, BartTokenizer, MBartTokenizer, MBart50Tokenizer, RobertaTokenizer, BloomTokenizer, SPIECE_UNDERLINE, LlamaTokenizer, CodeLlamaTokenizer, XLMRobertaTokenizer, MPNetTokenizer, FalconTokenizer, GPTNeoXTokenizer, EsmTokenizer, Qwen2Tokenizer, GemmaTokenizer, Grok1Tokenizer, NllbTokenizer, M2M100Tokenizer, WHISPER_LANGUAGES, WHISPER_LANGUAGE_MAPPING, WHISPER_TO_LANGUAGE_CODE_MAPPING, WhisperTokenizer, CodeGenTokenizer, CLIPTokenizer, SiglipTokenizer, MarianTokenizer, Wav2Vec2CTCTokenizer, BlenderbotTokenizer, BlenderbotSmallTokenizer, SpeechT5Tokenizer, NougatTokenizer, VitsTokenizer, CohereTokenizer, AutoTokenizer;
var init_tokenizers = __esm({
  "node_modules/@xenova/transformers/src/tokenizers.js"() {
    init_core();
    init_hub();
    init_maths();
    init_tensor();
    init_data_structures();
    init_dist();
    PUNCTUATION_REGEX = "\\p{P}\\u0021-\\u002F\\u003A-\\u0040\\u005B-\\u0060\\u007B-\\u007E";
    PROBLEMATIC_REGEX_MAP = /* @__PURE__ */ new Map([
      // This uses the case insensitive group modifier, which is not supported in JavaScript.
      // When parsing the regex, an "Invalid group" error is thrown.
      ["(?i:'s|'t|'re|'ve|'m|'ll|'d)", "(?:'([sS]|[tT]|[rR][eE]|[vV][eE]|[mM]|[lL][lL]|[dD]))"]
    ]);
    AddedToken = class {
      /**
       * Creates a new instance of AddedToken.
       * @param {Object} config Added token configuration object.
       * @param {string} config.content The content of the added token.
       * @param {number} config.id The id of the added token.
       * @param {boolean} [config.single_word=false] Whether this token must be a single word or can break words.
       * @param {boolean} [config.lstrip=false] Whether this token should strip whitespaces on its left.
       * @param {boolean} [config.rstrip=false] Whether this token should strip whitespaces on its right.
       * @param {boolean} [config.normalized=false] Whether this token should be normalized.
       * @param {boolean} [config.special=false] Whether this token is special.
       */
      constructor(config) {
        this.content = config.content;
        this.id = config.id;
        this.single_word = config.single_word ?? false;
        this.lstrip = config.lstrip ?? false;
        this.rstrip = config.rstrip ?? false;
        this.special = config.special ?? false;
        this.normalized = config.normalized ?? null;
      }
    };
    TokenizerModel = class extends Callable {
      /**
       * Creates a new instance of TokenizerModel.
       * @param {Object} config The configuration object for the TokenizerModel.
       */
      constructor(config) {
        super();
        this.config = config;
        this.vocab = [];
        this.tokens_to_ids = /* @__PURE__ */ new Map();
        this.unk_token_id = void 0;
        this.unk_token = void 0;
        this.end_of_word_suffix = void 0;
        this.fuse_unk = this.config.fuse_unk ?? false;
      }
      /**
       * Instantiates a new TokenizerModel instance based on the configuration object provided.
       * @param {Object} config The configuration object for the TokenizerModel.
       * @param {...*} args Optional arguments to pass to the specific TokenizerModel constructor.
       * @returns {TokenizerModel} A new instance of a TokenizerModel.
       * @throws Will throw an error if the TokenizerModel type in the config is not recognized.
       */
      static fromConfig(config, ...args) {
        switch (config.type) {
          case "WordPiece":
            return new WordPieceTokenizer(config);
          case "Unigram":
            return new Unigram(config, ...args);
          case "BPE":
            return new BPE(config);
          default:
            if (config.vocab) {
              return new LegacyTokenizerModel(config, ...args);
            }
            throw new Error(`Unknown TokenizerModel type: ${config.type}`);
        }
      }
      /**
       * Internal function to call the TokenizerModel instance.
       * @param {string[]} tokens The tokens to encode.
       * @returns {string[]} The encoded token IDs.
       */
      _call(tokens) {
        let ids = this.encode(tokens);
        if (this.fuse_unk) {
          ids = fuse(ids, this.unk_token_id, this.tokens_to_ids);
        }
        return ids;
      }
      /**
       * Encodes a list of tokens into a list of token IDs.
       * @param {string[]} tokens The tokens to encode.
       * @returns {string[]} The encoded tokens.
       * @throws Will throw an error if not implemented in a subclass.
       */
      encode(tokens) {
        throw Error("encode should be implemented in subclass.");
      }
      /**
       * Converts a list of tokens into a list of token IDs.
       * @param {string[]} tokens The tokens to convert.
       * @returns {number[]} The converted token IDs.
       */
      convert_tokens_to_ids(tokens) {
        return tokens.map((t) => this.tokens_to_ids.get(t) ?? this.unk_token_id);
      }
      /**
       * Converts a list of token IDs into a list of tokens.
       * @param {number[]} ids The token IDs to convert.
       * @returns {string[]} The converted tokens.
       */
      convert_ids_to_tokens(ids) {
        return ids.map((i) => this.vocab[i] ?? this.unk_token);
      }
    };
    WordPieceTokenizer = class extends TokenizerModel {
      /**
       * @param {Object} config The configuration object.
       * @param {Object} config.vocab A mapping of tokens to ids.
       * @param {string} config.unk_token The unknown token string.
       * @param {string} config.continuing_subword_prefix The prefix to use for continuing subwords.
       * @param {number} [config.max_input_chars_per_word=100] The maximum number of characters per word.
       */
      constructor(config) {
        super(config);
        this.tokens_to_ids = objectToMap(config.vocab);
        this.unk_token_id = this.tokens_to_ids.get(config.unk_token);
        this.unk_token = config.unk_token;
        this.max_input_chars_per_word = config.max_input_chars_per_word ?? 100;
        this.vocab = new Array(this.tokens_to_ids.size);
        for (const [key, value] of this.tokens_to_ids) {
          this.vocab[value] = key;
        }
      }
      /**
       * Encodes an array of tokens using WordPiece encoding.
       * @param {string[]} tokens The tokens to encode.
       * @returns {string[]} An array of encoded tokens.
       */
      encode(tokens) {
        const outputTokens = [];
        for (const token of tokens) {
          const chars = [...token];
          if (chars.length > this.max_input_chars_per_word) {
            outputTokens.push(this.unk_token);
            continue;
          }
          let isUnknown = false;
          let start = 0;
          const subTokens = [];
          while (start < chars.length) {
            let end = chars.length;
            let currentSubstring = null;
            while (start < end) {
              let substr = chars.slice(start, end).join("");
              if (start > 0) {
                substr = this.config.continuing_subword_prefix + substr;
              }
              if (this.tokens_to_ids.has(substr)) {
                currentSubstring = substr;
                break;
              }
              --end;
            }
            if (currentSubstring === null) {
              isUnknown = true;
              break;
            }
            subTokens.push(currentSubstring);
            start = end;
          }
          if (isUnknown) {
            outputTokens.push(this.unk_token);
          } else {
            outputTokens.push(...subTokens);
          }
        }
        return outputTokens;
      }
    };
    Unigram = class extends TokenizerModel {
      /**
       * Create a new Unigram tokenizer model.
       * @param {Object} config The configuration object for the Unigram model.
       * @param {number} config.unk_id The ID of the unknown token
       * @param {any[][]} config.vocab A 2D array representing a mapping of tokens to scores.
       * @param {Object} moreConfig Additional configuration object for the Unigram model.
       */
      constructor(config, moreConfig) {
        super(config);
        const vocabSize = config.vocab.length;
        this.vocab = new Array(vocabSize);
        this.scores = new Array(vocabSize);
        for (let i = 0; i < vocabSize; ++i) {
          const piece = config.vocab[i];
          this.vocab[i] = piece[0];
          this.scores[i] = piece[1];
        }
        this.unk_token_id = config.unk_id;
        this.unk_token = this.vocab[config.unk_id];
        this.tokens_to_ids = new Map(this.vocab.map((x, i) => [x, i]));
        this.bosToken = " ";
        this.bosTokenId = this.tokens_to_ids.get(this.bosToken);
        this.eosToken = moreConfig.eos_token;
        this.eosTokenId = this.tokens_to_ids.get(this.eosToken);
        this.unkToken = this.vocab[this.unk_token_id];
        this.minScore = min(this.scores)[0];
        this.unkScore = this.minScore - 10;
        this.scores[this.unk_token_id] = this.unkScore;
        this.trie = new CharTrie();
        this.trie.extend(this.vocab);
        this.fuse_unk = true;
      }
      /**
       * Populates lattice nodes.
       * @param {TokenLattice} lattice The token lattice to populate with nodes.
       */
      populateNodes(lattice) {
        const sentence = lattice.sentence;
        const len = sentence.length;
        let beginPos = 0;
        while (beginPos < len) {
          const mblen = 1;
          let hasSingleNode = false;
          const tokens = [];
          for (let token of this.trie.commonPrefixSearch(sentence.slice(beginPos))) {
            tokens.push(token);
            const tokenId = this.tokens_to_ids.get(token);
            const tokenScore = this.scores[tokenId];
            const n = token.length;
            lattice.insert(beginPos, n, tokenScore, tokenId);
            if (!hasSingleNode && n === mblen) {
              hasSingleNode = true;
            }
          }
          if (!hasSingleNode) {
            lattice.insert(beginPos, mblen, this.unkScore, this.unk_token_id);
          }
          beginPos += mblen;
        }
      }
      /**
       * Encodes an array of tokens into an array of subtokens using the unigram model.
       *
       * @param {string} normalized The normalized string.
       * @returns {string[]} An array of subtokens obtained by encoding the input tokens using the unigram model.
       */
      tokenize(normalized) {
        const lattice = new TokenLattice(normalized, this.bosTokenId, this.eosTokenId);
        this.populateNodes(lattice);
        return lattice.tokens();
      }
      /**
       * Encodes an array of tokens using Unigram encoding.
       * @param {string[]} tokens The tokens to encode.
       * @returns {string[]} An array of encoded tokens.
       */
      encode(tokens) {
        const toReturn = [];
        for (const token of tokens) {
          const tokenized = this.tokenize(token);
          toReturn.push(...tokenized);
        }
        return toReturn;
      }
    };
    BYTES_TO_UNICODE = (() => {
      const bs = [
        ...Array.from({ length: "~".charCodeAt(0) - "!".charCodeAt(0) + 1 }, (_, i) => i + "!".charCodeAt(0)),
        ...Array.from({ length: "\xAC".charCodeAt(0) - "\xA1".charCodeAt(0) + 1 }, (_, i) => i + "\xA1".charCodeAt(0)),
        ...Array.from({ length: "\xFF".charCodeAt(0) - "\xAE".charCodeAt(0) + 1 }, (_, i) => i + "\xAE".charCodeAt(0))
      ];
      const cs = bs.slice();
      let n = 0;
      for (let b = 0; b < 256; ++b) {
        if (!bs.includes(b)) {
          bs.push(b);
          cs.push(256 + n);
          n += 1;
        }
      }
      const ccs = cs.map((n2) => String.fromCharCode(n2));
      return Object.fromEntries(bs.map((b, i) => [b, ccs[i]]));
    })();
    UNICODE_TO_BYTES = reverseDictionary(BYTES_TO_UNICODE);
    BPE = class extends TokenizerModel {
      /**
       * Create a BPE instance.
       * @param {Object} config The configuration object for BPE.
       * @param {Object} config.vocab A mapping of tokens to ids.
       * @param {string[]} config.merges An array of BPE merges as strings.
       * @param {string} config.unk_token The unknown token used for out of vocabulary words.
       * @param {string} config.end_of_word_suffix The suffix to place at the end of each word.
       * @param {string} [config.continuing_subword_suffix] The suffix to insert between words.
       * @param {boolean} [config.byte_fallback=false] Whether to use spm byte-fallback trick (defaults to False)
       * @param {boolean} [config.ignore_merges=false] Whether or not to match tokens with the vocab before using merges.
       */
      constructor(config) {
        super(config);
        this.BPE_SPLIT_TOKEN = " ";
        this.tokens_to_ids = objectToMap(config.vocab);
        this.unk_token_id = this.tokens_to_ids.get(config.unk_token);
        this.unk_token = config.unk_token;
        this.vocab = new Array(this.tokens_to_ids.size);
        for (const [key, value] of this.tokens_to_ids) {
          this.vocab[value] = key;
        }
        this.bpe_ranks = new Map(config.merges.map((x, i) => [x, i]));
        this.merges = config.merges.map((x) => x.split(this.BPE_SPLIT_TOKEN));
        this.end_of_word_suffix = config.end_of_word_suffix;
        this.continuing_subword_suffix = config.continuing_subword_suffix ?? null;
        this.byte_fallback = this.config.byte_fallback ?? false;
        if (this.byte_fallback) {
          this.text_encoder = new TextEncoder();
        }
        this.ignore_merges = this.config.ignore_merges ?? false;
        this.cache = /* @__PURE__ */ new Map();
      }
      /**
       * Apply Byte-Pair-Encoding (BPE) to a given token. Efficient heap-based priority
       * queue implementation adapted from https://github.com/belladoreai/llama-tokenizer-js.
       * @param {string} token The token to encode.
       * @returns {string[]} The BPE encoded tokens.
       */
      bpe(token) {
        if (token.length === 0) {
          return [];
        }
        const cached = this.cache.get(token);
        if (cached !== void 0) {
          return cached;
        }
        const word = Array.from(token);
        if (this.end_of_word_suffix) {
          word[word.length - 1] += this.end_of_word_suffix;
        }
        let result = [];
        if (word.length > 1) {
          const queue = new PriorityQueue((a, b) => a.score < b.score);
          let startingNode = {
            token: word[0],
            bias: 0,
            prev: null,
            next: null
          };
          let previousNode = startingNode;
          for (let i = 1; i < word.length; ++i) {
            const currentNode = {
              bias: i / word.length,
              // Add fractional component to break ties
              token: word[i],
              prev: previousNode,
              next: null
            };
            previousNode.next = currentNode;
            this._add_node(queue, previousNode);
            previousNode = currentNode;
          }
          while (!queue.isEmpty()) {
            const node = queue.pop();
            if (node.deleted || !node.next || node.next.deleted) continue;
            node.deleted = true;
            node.next.deleted = true;
            if (node.prev) {
              const newPreviousNode = { ...node.prev };
              node.prev.deleted = true;
              node.prev = newPreviousNode;
              if (newPreviousNode.prev) {
                newPreviousNode.prev.next = newPreviousNode;
              } else {
                startingNode = newPreviousNode;
              }
            }
            const merged = {
              token: node.token + node.next.token,
              bias: node.bias,
              prev: node.prev,
              next: node.next.next
            };
            if (merged.prev) {
              merged.prev.next = merged;
              this._add_node(queue, merged.prev);
            } else {
              startingNode = merged;
            }
            if (merged.next) {
              merged.next.prev = merged;
              this._add_node(queue, merged);
            }
          }
          for (let currentNode = startingNode; currentNode !== null; currentNode = currentNode.next) {
            result.push(currentNode.token);
          }
        } else {
          result = word;
        }
        if (this.continuing_subword_suffix) {
          for (let i = 0; i < result.length - 1; ++i) {
            result[i] += this.continuing_subword_suffix;
          }
        }
        this.cache.set(token, result);
        return result;
      }
      /**
       * Helper function to add a node to the priority queue.
       * @param {PriorityQueue} queue 
       * @param {BPENode} node
       * @private
       */
      _add_node(queue, node) {
        const rank = this.bpe_ranks.get(node.token + this.BPE_SPLIT_TOKEN + node.next.token);
        if (rank !== void 0) {
          node.score = rank + node.bias;
          queue.push(node);
        }
      }
      /**
       * Encodes the input sequence of tokens using the BPE algorithm and returns the resulting subword tokens.
       * @param {string[]} tokens The input sequence of tokens to encode.
       * @returns {string[]} The resulting subword tokens after applying the BPE algorithm to the input sequence of tokens.
       */
      encode(tokens) {
        const outputTokens = [];
        for (const token of tokens) {
          if (this.ignore_merges && this.tokens_to_ids.has(token)) {
            outputTokens.push(token);
            continue;
          }
          const bpe_token_list = this.bpe(token);
          for (const t of bpe_token_list) {
            if (this.tokens_to_ids.has(t)) {
              outputTokens.push(t);
            } else {
              if (this.byte_fallback) {
                outputTokens.push(
                  ...Array.from(this.text_encoder.encode(t)).map((x) => `<0x${x.toString(16).toUpperCase().padStart(2, "0")}>`)
                );
              } else {
                outputTokens.push(this.unk_token);
              }
            }
          }
        }
        return outputTokens;
      }
    };
    LegacyTokenizerModel = class extends TokenizerModel {
      /**
       * Create a LegacyTokenizerModel instance.
       * @param {Object} config The configuration object for LegacyTokenizerModel.
       * @param {Object} config.vocab A (possibly nested) mapping of tokens to ids.
       * @param {Object} moreConfig Additional configuration object for the LegacyTokenizerModel model.
       */
      constructor(config, moreConfig) {
        super(config);
        this.tokens_to_ids = objectToMap(
          moreConfig.target_lang ? config.vocab[moreConfig.target_lang] : config.vocab
        );
        this.bos_token = moreConfig.bos_token;
        this.bos_token_id = this.tokens_to_ids.get(this.bos_token);
        this.eos_token = moreConfig.eos_token;
        this.eos_token_id = this.tokens_to_ids.get(this.eos_token);
        this.pad_token = moreConfig.pad_token;
        this.pad_token_id = this.tokens_to_ids.get(this.pad_token);
        this.unk_token = moreConfig.unk_token;
        this.unk_token_id = this.tokens_to_ids.get(this.unk_token);
        this.vocab = new Array(this.tokens_to_ids.size);
        for (const [key, value] of this.tokens_to_ids) {
          this.vocab[value] = key;
        }
      }
      encode(tokens) {
        return tokens;
      }
    };
    Normalizer = class extends Callable {
      /**
       * @param {Object} config The configuration object for the normalizer.
       */
      constructor(config) {
        super();
        this.config = config;
      }
      /**
       * Factory method for creating normalizers from config objects.
       * @static
       * @param {Object} config The configuration object for the normalizer.
       * @returns {Normalizer} A Normalizer object.
       * @throws {Error} If an unknown Normalizer type is specified in the config.
       */
      static fromConfig(config) {
        if (config === null) return null;
        switch (config.type) {
          case "BertNormalizer":
            return new BertNormalizer(config);
          case "Precompiled":
            return new Precompiled(config);
          case "Sequence":
            return new NormalizerSequence(config);
          case "Replace":
            return new Replace(config);
          case "NFC":
            return new NFC(config);
          case "NFKC":
            return new NFKC(config);
          case "NFKD":
            return new NFKD(config);
          case "Strip":
            return new StripNormalizer(config);
          case "StripAccents":
            return new StripAccents(config);
          case "Lowercase":
            return new Lowercase(config);
          case "Prepend":
            return new Prepend(config);
          default:
            throw new Error(`Unknown Normalizer type: ${config.type}`);
        }
      }
      /**
       * Normalize the input text.
       * @abstract
       * @param {string} text The text to normalize.
       * @returns {string} The normalized text.
       * @throws {Error} If this method is not implemented in a subclass.
       */
      normalize(text) {
        throw Error("normalize should be implemented in subclass.");
      }
      /**
       * Alias for {@link Normalizer#normalize}.
       * @param {string} text The text to normalize.
       * @returns {string} The normalized text.
       */
      _call(text) {
        return this.normalize(text);
      }
    };
    Replace = class extends Normalizer {
      /**
       * Normalize the input text by replacing the pattern with the content.
       * @param {string} text The input text to be normalized.
       * @returns {string} The normalized text after replacing the pattern with the content.
       */
      normalize(text) {
        const pattern = createPattern(this.config.pattern);
        return pattern === null ? text : text.replaceAll(pattern, this.config.content);
      }
    };
    NFC = class extends Normalizer {
      /**
       * Normalize the input text by applying Unicode normalization form C (NFC).
       * @param {string} text The input text to be normalized.
       * @returns {string} The normalized text.
       */
      normalize(text) {
        text = text.normalize("NFC");
        return text;
      }
    };
    NFKC = class extends Normalizer {
      /**
       * Normalize text using NFKC normalization.
       * @param {string} text The text to be normalized.
       * @returns {string} The normalized text.
       */
      normalize(text) {
        text = text.normalize("NFKC");
        return text;
      }
    };
    NFKD = class extends Normalizer {
      /**
       * Normalize text using NFKD normalization.
       * @param {string} text The text to be normalized.
       * @returns {string} The normalized text.
       */
      normalize(text) {
        text = text.normalize("NFKD");
        return text;
      }
    };
    StripNormalizer = class extends Normalizer {
      /**
       * Strip leading and/or trailing whitespace from the input text.
       * @param {string} text The input text.
       * @returns {string} The normalized text.
       */
      normalize(text) {
        if (this.config.strip_left && this.config.strip_right) {
          text = text.trim();
        } else {
          if (this.config.strip_left) {
            text = text.trimStart();
          }
          if (this.config.strip_right) {
            text = text.trimEnd();
          }
        }
        return text;
      }
    };
    StripAccents = class extends Normalizer {
      /**
       * Remove all accents from the text.
       * @param {string} text The input text.
       * @returns {string} The normalized text without accents.
       */
      normalize(text) {
        text = remove_accents(text);
        return text;
      }
    };
    Lowercase = class extends Normalizer {
      /**
       * Lowercases the input string.
       * @param {string} text The text to normalize.
       * @returns {string} The normalized text.
       */
      normalize(text) {
        text = text.toLowerCase();
        return text;
      }
    };
    Prepend = class extends Normalizer {
      /**
       * Prepends the input string.
       * @param {string} text The text to normalize.
       * @returns {string} The normalized text.
       */
      normalize(text) {
        text = this.config.prepend + text;
        return text;
      }
    };
    NormalizerSequence = class extends Normalizer {
      /**
      * Create a new instance of NormalizerSequence.
      * @param {Object} config The configuration object.
      * @param {Object[]} config.normalizers An array of Normalizer configuration objects.
      */
      constructor(config) {
        super(config);
        this.normalizers = config.normalizers.map((x) => Normalizer.fromConfig(x));
      }
      /**
      * Apply a sequence of Normalizers to the input text.
      * @param {string} text The text to normalize.
      * @returns {string} The normalized text.
      */
      normalize(text) {
        return this.normalizers.reduce((t, normalizer) => {
          return normalizer.normalize(t);
        }, text);
      }
    };
    BertNormalizer = class extends Normalizer {
      /**
       * Adds whitespace around any CJK (Chinese, Japanese, or Korean) character in the input text.
       *
       * @param {string} text The input text to tokenize.
       * @returns {string} The tokenized text with whitespace added around CJK characters.
       */
      _tokenize_chinese_chars(text) {
        const output = [];
        for (let i = 0; i < text.length; ++i) {
          const char = text[i];
          const cp = char.charCodeAt(0);
          if (this._is_chinese_char(cp)) {
            output.push(" ");
            output.push(char);
            output.push(" ");
          } else {
            output.push(char);
          }
        }
        return output.join("");
      }
      /**
       * Checks whether the given Unicode codepoint represents a CJK (Chinese, Japanese, or Korean) character.
       *
       * A "chinese character" is defined as anything in the CJK Unicode block:
       * https://en.wikipedia.org/wiki/CJK_Unified_Ideographs_(Unicode_block)
       *
       * Note that the CJK Unicode block is NOT all Japanese and Korean characters, despite its name.
       * The modern Korean Hangul alphabet is a different block, as is Japanese Hiragana and Katakana.
       * Those alphabets are used to write space-separated words, so they are not treated specially
       * and are handled like all other languages.
       *
       * @param {number} cp The Unicode codepoint to check.
       * @returns {boolean} True if the codepoint represents a CJK character, false otherwise.
       */
      _is_chinese_char(cp) {
        return cp >= 19968 && cp <= 40959 || cp >= 13312 && cp <= 19903 || cp >= 131072 && cp <= 173791 || cp >= 173824 && cp <= 177983 || cp >= 177984 && cp <= 178207 || cp >= 178208 && cp <= 183983 || cp >= 63744 && cp <= 64255 || cp >= 194560 && cp <= 195103;
      }
      /**
       * Strips accents from the given text.
       * @param {string} text The text to strip accents from.
       * @returns {string} The text with accents removed.
       */
      stripAccents(text) {
        return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      }
      /**
       * Checks whether `char` is a control character.
       * @param {string} char The character to check.
       * @returns {boolean} Whether `char` is a control character.
       * @private
       */
      _is_control(char) {
        switch (char) {
          case "	":
          case "\n":
          case "\r":
            return false;
          default:
            return /^\p{Cc}|\p{Cf}|\p{Co}|\p{Cs}$/u.test(char);
        }
      }
      /**
       * Performs invalid character removal and whitespace cleanup on text.
       * @param {string} text The text to clean.
       * @returns {string} The cleaned text.
       * @private
       */
      _clean_text(text) {
        const output = [];
        for (const char of text) {
          const cp = char.charCodeAt(0);
          if (cp === 0 || cp === 65533 || this._is_control(char)) {
            continue;
          }
          if (/^\s$/.test(char)) {
            output.push(" ");
          } else {
            output.push(char);
          }
        }
        return output.join("");
      }
      /**
       * Normalizes the given text based on the configuration.
       * @param {string} text The text to normalize.
       * @returns {string} The normalized text.
       */
      normalize(text) {
        if (this.config.clean_text) {
          text = this._clean_text(text);
        }
        if (this.config.handle_chinese_chars) {
          text = this._tokenize_chinese_chars(text);
        }
        if (this.config.lowercase) {
          text = text.toLowerCase();
          if (this.config.strip_accents !== false) {
            text = this.stripAccents(text);
          }
        } else if (this.config.strip_accents) {
          text = this.stripAccents(text);
        }
        return text;
      }
    };
    PreTokenizer = class extends Callable {
      /**
      * Factory method that returns an instance of a subclass of `PreTokenizer` based on the provided configuration.
      *
      * @static
      * @param {Object} config A configuration object for the pre-tokenizer.
      * @returns {PreTokenizer} An instance of a subclass of `PreTokenizer`.
      * @throws {Error} If the provided configuration object does not correspond to any known pre-tokenizer.
      */
      static fromConfig(config) {
        if (config === null) return null;
        switch (config.type) {
          case "BertPreTokenizer":
            return new BertPreTokenizer(config);
          case "Sequence":
            return new PreTokenizerSequence(config);
          case "Whitespace":
            return new WhitespacePreTokenizer(config);
          case "WhitespaceSplit":
            return new WhitespaceSplit(config);
          case "Metaspace":
            return new MetaspacePreTokenizer(config);
          case "ByteLevel":
            return new ByteLevelPreTokenizer(config);
          case "Split":
            return new SplitPreTokenizer(config);
          case "Punctuation":
            return new PunctuationPreTokenizer(config);
          case "Digits":
            return new DigitsPreTokenizer(config);
          case "Replace":
            return new ReplacePreTokenizer(config);
          default:
            throw new Error(`Unknown PreTokenizer type: ${config.type}`);
        }
      }
      /**
       * Method that should be implemented by subclasses to define the specific pre-tokenization logic.
       *
       * @abstract
       * @param {string} text The text to pre-tokenize.
       * @param {Object} [options] Additional options for the pre-tokenization logic.
       * @returns {string[]} The pre-tokenized text.
       * @throws {Error} If the method is not implemented in the subclass.
       */
      pre_tokenize_text(text, options) {
        throw Error("pre_tokenize_text should be implemented in subclass.");
      }
      /**
       * Tokenizes the given text into pre-tokens.
       * @param {string|string[]} text The text or array of texts to pre-tokenize.
       * @param {Object} [options] Additional options for the pre-tokenization logic.
       * @returns {string[]} An array of pre-tokens.
       */
      pre_tokenize(text, options) {
        return (Array.isArray(text) ? text.map((x) => this.pre_tokenize_text(x, options)) : this.pre_tokenize_text(text, options)).flat();
      }
      /**
       * Alias for {@link PreTokenizer#pre_tokenize}.
       * @param {string|string[]} text The text or array of texts to pre-tokenize.
       * @param {Object} [options] Additional options for the pre-tokenization logic.
       * @returns {string[]} An array of pre-tokens.
       */
      _call(text, options) {
        return this.pre_tokenize(text, options);
      }
    };
    BertPreTokenizer = class extends PreTokenizer {
      /**
       * A PreTokenizer that splits text into wordpieces using a basic tokenization scheme
       * similar to that used in the original implementation of BERT.
       * 
       * @param {Object} config The configuration object.
       */
      constructor(config) {
        super();
        this.pattern = new RegExp(`[^\\s${PUNCTUATION_REGEX}]+|[${PUNCTUATION_REGEX}]`, "gu");
      }
      /**
       * Tokenizes a single text using the BERT pre-tokenization scheme.
       * 
       * @param {string} text The text to tokenize.
       * @param {Object} [options] Additional options for the pre-tokenization logic.
       * @returns {string[]} An array of tokens.
       */
      pre_tokenize_text(text, options) {
        return text.trim().match(this.pattern) || [];
      }
    };
    ByteLevelPreTokenizer = class extends PreTokenizer {
      /**
       * Creates a new instance of the `ByteLevelPreTokenizer` class.
       * @param {Object} config The configuration object.
       */
      constructor(config) {
        super();
        this.config = config;
        this.add_prefix_space = this.config.add_prefix_space;
        this.trim_offsets = this.config.trim_offsets;
        this.use_regex = this.config.use_regex ?? true;
        this.pattern = /'s|'t|'re|'ve|'m|'ll|'d| ?\p{L}+| ?\p{N}+| ?[^\s\p{L}\p{N}]+|\s+(?!\S)|\s+/gu;
        this.byte_encoder = BYTES_TO_UNICODE;
        this.text_encoder = new TextEncoder();
      }
      /**
       * Tokenizes a single piece of text using byte-level tokenization.
       * @param {string} text The text to tokenize.
       * @param {Object} [options] Additional options for the pre-tokenization logic.
       * @returns {string[]} An array of tokens.
       */
      pre_tokenize_text(text, options) {
        if (this.add_prefix_space && !text.startsWith(" ")) {
          text = " " + text;
        }
        const tokens = this.use_regex ? text.match(this.pattern) || [] : [text];
        return tokens.map(
          (token) => Array.from(this.text_encoder.encode(token), (byte) => this.byte_encoder[byte]).join("")
        );
      }
    };
    SplitPreTokenizer = class extends PreTokenizer {
      /**
       * @param {Object} config The configuration options for the pre-tokenizer.
       * @param {Object} config.pattern The pattern used to split the text. Can be a string or a regex object.
       * @param {string|undefined} config.pattern.String The string to use for splitting. Only defined if the pattern is a string.
       * @param {string|undefined} config.pattern.Regex The regex to use for splitting. Only defined if the pattern is a regex.
       * @param {SplitDelimiterBehavior} config.behavior The behavior to use when splitting.
       * @param {boolean} config.invert Whether to split (invert=false) or match (invert=true) the pattern.
       */
      constructor(config) {
        super();
        this.config = config;
        this.pattern = createPattern(this.config.pattern, this.config.invert);
      }
      /**
       * Tokenizes text by splitting it using the given pattern.
       * @param {string} text The text to tokenize.
       * @param {Object} [options] Additional options for the pre-tokenization logic.
       * @returns {string[]} An array of tokens.
       */
      pre_tokenize_text(text, options) {
        if (this.pattern === null) {
          return [];
        }
        if (this.config.invert) {
          return text.match(this.pattern) || [];
        } else {
          return regexSplit(text, this.pattern);
        }
      }
    };
    PunctuationPreTokenizer = class extends PreTokenizer {
      /**
       * @param {Object} config The configuration options for the pre-tokenizer.
       * @param {SplitDelimiterBehavior} config.behavior The behavior to use when splitting.
       */
      constructor(config) {
        super();
        this.config = config;
        this.pattern = new RegExp(`[^${PUNCTUATION_REGEX}]+|[${PUNCTUATION_REGEX}]+`, "gu");
      }
      /**
       * Tokenizes text by splitting it using the given pattern.
       * @param {string} text The text to tokenize.
       * @param {Object} [options] Additional options for the pre-tokenization logic.
       * @returns {string[]} An array of tokens.
       */
      pre_tokenize_text(text, options) {
        return text.match(this.pattern) || [];
      }
    };
    DigitsPreTokenizer = class extends PreTokenizer {
      /**
       * @param {Object} config The configuration options for the pre-tokenizer.
       * @param {boolean} config.individual_digits Whether to split on individual digits.
       */
      constructor(config) {
        super();
        this.config = config;
        const digit_pattern = `[^\\d]+|\\d${this.config.individual_digits ? "" : "+"}`;
        this.pattern = new RegExp(digit_pattern, "gu");
      }
      /**
       * Tokenizes text by splitting it using the given pattern.
       * @param {string} text The text to tokenize.
       * @param {Object} [options] Additional options for the pre-tokenization logic.
       * @returns {string[]} An array of tokens.
       */
      pre_tokenize_text(text, options) {
        return text.match(this.pattern) || [];
      }
    };
    PostProcessor = class extends Callable {
      /**
       * @param {Object} config The configuration for the post-processor.
       */
      constructor(config) {
        super();
        this.config = config;
      }
      /**
       * Factory method to create a PostProcessor object from a configuration object.
       *
       * @param {Object} config Configuration object representing a PostProcessor.
       * @returns {PostProcessor} A PostProcessor object created from the given configuration.
       * @throws {Error} If an unknown PostProcessor type is encountered.
       */
      static fromConfig(config) {
        if (config === null) return null;
        switch (config.type) {
          case "TemplateProcessing":
            return new TemplateProcessing(config);
          case "ByteLevel":
            return new ByteLevelPostProcessor(config);
          case "RobertaProcessing":
            return new RobertaProcessing(config);
          case "BertProcessing":
            return new BertProcessing(config);
          case "Sequence":
            return new PostProcessorSequence(config);
          default:
            throw new Error(`Unknown PostProcessor type: ${config.type}`);
        }
      }
      /**
       * Method to be implemented in subclass to apply post-processing on the given tokens.
       *
       * @param {Array} tokens The input tokens to be post-processed.
       * @param {...*} args Additional arguments required by the post-processing logic.
       * @returns {PostProcessedOutput} The post-processed tokens.
       * @throws {Error} If the method is not implemented in subclass.
       */
      post_process(tokens, ...args) {
        throw Error("post_process should be implemented in subclass.");
      }
      /**
       * Alias for {@link PostProcessor#post_process}.
       * @param {Array} tokens The text or array of texts to post-process.
       * @param {...*} args Additional arguments required by the post-processing logic.
       * @returns {PostProcessedOutput} The post-processed tokens.
       */
      _call(tokens, ...args) {
        return this.post_process(tokens, ...args);
      }
    };
    BertProcessing = class extends PostProcessor {
      /**
       * @param {Object} config The configuration for the post-processor.
       * @param {string[]} config.cls The special tokens to add to the beginning of the input.
       * @param {string[]} config.sep The special tokens to add to the end of the input.
       */
      constructor(config) {
        super(config);
        this.cls = config.cls[0];
        this.sep = config.sep[0];
      }
      /**
       * Adds the special tokens to the beginning and end of the input.
       * @param {string[]} tokens The input tokens.
       * @param {string[]} [tokens_pair=null] An optional second set of input tokens.
       * @returns {PostProcessedOutput} The post-processed tokens with the special tokens added to the beginning and end.
       */
      post_process(tokens, tokens_pair = null, {
        add_special_tokens = true
      } = {}) {
        if (add_special_tokens) {
          tokens = mergeArrays([this.cls], tokens, [this.sep]);
        }
        let token_type_ids = new Array(tokens.length).fill(0);
        if (tokens_pair !== null) {
          const middle = add_special_tokens && this instanceof RobertaProcessing ? [this.sep] : [];
          const after = add_special_tokens ? [this.sep] : [];
          tokens = mergeArrays(tokens, middle, tokens_pair, after);
          token_type_ids = mergeArrays(token_type_ids, new Array(tokens_pair.length + middle.length + after.length).fill(1));
        }
        return { tokens, token_type_ids };
      }
    };
    RobertaProcessing = class extends BertProcessing {
    };
    TemplateProcessing = class extends PostProcessor {
      /**
       * Creates a new instance of `TemplateProcessing`.
       * @param {Object} config The configuration options for the post processor.
       * @param {Array} config.single The template for a single sequence of tokens.
       * @param {Array} config.pair The template for a pair of sequences of tokens.
       */
      constructor(config) {
        super(config);
        this.single = config.single;
        this.pair = config.pair;
      }
      /**
       * Replaces special tokens in the template with actual tokens.
       * @param {string[]} tokens The list of tokens for the first sequence.
       * @param {string[]} [tokens_pair=null] The list of tokens for the second sequence (optional).
       * @returns {PostProcessedOutput} An object containing the list of tokens with the special tokens replaced with actual tokens.
       */
      post_process(tokens, tokens_pair = null, {
        add_special_tokens = true
      } = {}) {
        const type = tokens_pair === null ? this.single : this.pair;
        let processedTokens = [];
        let types = [];
        for (const item of type) {
          if ("SpecialToken" in item) {
            if (add_special_tokens) {
              processedTokens.push(item.SpecialToken.id);
              types.push(item.SpecialToken.type_id);
            }
          } else if ("Sequence" in item) {
            if (item.Sequence.id === "A") {
              processedTokens = mergeArrays(processedTokens, tokens);
              types = mergeArrays(types, new Array(tokens.length).fill(item.Sequence.type_id));
            } else if (item.Sequence.id === "B") {
              processedTokens = mergeArrays(processedTokens, tokens_pair);
              types = mergeArrays(types, new Array(tokens_pair.length).fill(item.Sequence.type_id));
            }
          }
        }
        return { tokens: processedTokens, token_type_ids: types };
      }
    };
    ByteLevelPostProcessor = class extends PostProcessor {
      /**
       * Post process the given tokens.
       * @param {string[]} tokens The list of tokens for the first sequence.
       * @param {string[]} [tokens_pair=null] The list of tokens for the second sequence (optional).
       * @returns {PostProcessedOutput} An object containing the post-processed tokens.
       */
      post_process(tokens, tokens_pair = null) {
        if (tokens_pair) {
          tokens = mergeArrays(tokens, tokens_pair);
        }
        return { tokens };
      }
    };
    PostProcessorSequence = class extends PostProcessor {
      /**
       * Creates a new instance of PostProcessorSequence.
       * @param {Object} config The configuration object.
       * @param {Object[]} config.processors The list of post-processors to apply.
       */
      constructor(config) {
        super(config);
        this.processors = config.processors.map((x) => PostProcessor.fromConfig(x));
      }
      /**
       * Post process the given tokens.
       * @param {string[]} tokens The list of tokens for the first sequence.
       * @param {string[]} [tokens_pair=null] The list of tokens for the second sequence (optional).
       * @returns {PostProcessedOutput} An object containing the post-processed tokens.
       */
      post_process(tokens, tokens_pair = null, options = {}) {
        let token_type_ids;
        for (const processor of this.processors) {
          if (processor instanceof ByteLevelPostProcessor) {
            const output = processor.post_process(tokens);
            tokens = output.tokens;
            if (tokens_pair) {
              const pair_output = processor.post_process(tokens_pair);
              tokens_pair = pair_output.tokens;
            }
          } else {
            const output = processor.post_process(tokens, tokens_pair, options);
            tokens = output.tokens;
            token_type_ids = output.token_type_ids;
          }
        }
        return { tokens, token_type_ids };
      }
    };
    Decoder = class extends Callable {
      /**
      * Creates an instance of `Decoder`.
      *
      * @param {Object} config The configuration object.
      */
      constructor(config) {
        super();
        this.config = config;
        this.added_tokens = [];
        this.end_of_word_suffix = null;
        this.trim_offsets = config.trim_offsets;
      }
      /**
      * Creates a decoder instance based on the provided configuration.
      *
      * @param {Object} config The configuration object.
      * @returns {Decoder} A decoder instance.
      * @throws {Error} If an unknown decoder type is provided.
      */
      static fromConfig(config) {
        if (config === null) return null;
        switch (config.type) {
          case "WordPiece":
            return new WordPieceDecoder(config);
          case "Metaspace":
            return new MetaspaceDecoder(config);
          case "ByteLevel":
            return new ByteLevelDecoder(config);
          case "Replace":
            return new ReplaceDecoder(config);
          case "ByteFallback":
            return new ByteFallback(config);
          case "Fuse":
            return new FuseDecoder(config);
          case "Strip":
            return new StripDecoder(config);
          case "Sequence":
            return new DecoderSequence(config);
          case "CTC":
            return new CTCDecoder(config);
          case "BPEDecoder":
            return new BPEDecoder(config);
          default:
            throw new Error(`Unknown Decoder type: ${config.type}`);
        }
      }
      /**
      * Calls the `decode` method.
      *
      * @param {string[]} tokens The list of tokens.
      * @returns {string} The decoded string.
      */
      _call(tokens) {
        return this.decode(tokens);
      }
      /**
      * Decodes a list of tokens.
      * @param {string[]} tokens The list of tokens.
      * @returns {string} The decoded string.
      */
      decode(tokens) {
        return this.decode_chain(tokens).join("");
      }
      /**
       * Apply the decoder to a list of tokens.
       * 
       * @param {string[]} tokens The list of tokens.
       * @returns {string[]} The decoded list of tokens.
       * @throws {Error} If the `decode_chain` method is not implemented in the subclass.
       */
      decode_chain(tokens) {
        throw Error("`decode_chain` should be implemented in subclass.");
      }
    };
    ReplaceDecoder = class extends Decoder {
      /** @type {Decoder['decode_chain']} */
      decode_chain(tokens) {
        const pattern = createPattern(this.config.pattern);
        return pattern === null ? tokens : tokens.map((token) => token.replaceAll(pattern, this.config.content));
      }
    };
    ByteFallback = class extends Decoder {
      constructor(config) {
        super(config);
        this.text_decoder = new TextDecoder();
      }
      /** @type {Decoder['decode_chain']} */
      decode_chain(tokens) {
        const new_tokens = [];
        let previous_byte_tokens = [];
        for (const token of tokens) {
          let bytes = null;
          if (token.length === 6 && token.startsWith("<0x") && token.endsWith(">")) {
            const byte = parseInt(token.slice(3, 5), 16);
            if (!isNaN(byte)) {
              bytes = byte;
            }
          }
          if (bytes !== null) {
            previous_byte_tokens.push(bytes);
          } else {
            if (previous_byte_tokens.length > 0) {
              const string = this.text_decoder.decode(Uint8Array.from(previous_byte_tokens));
              new_tokens.push(string);
              previous_byte_tokens = [];
            }
            new_tokens.push(token);
          }
        }
        if (previous_byte_tokens.length > 0) {
          const string = this.text_decoder.decode(Uint8Array.from(previous_byte_tokens));
          new_tokens.push(string);
          previous_byte_tokens = [];
        }
        return new_tokens;
      }
    };
    FuseDecoder = class extends Decoder {
      /** @type {Decoder['decode_chain']} */
      decode_chain(tokens) {
        return [tokens.join("")];
      }
    };
    StripDecoder = class extends Decoder {
      constructor(config) {
        super(config);
        this.content = this.config.content;
        this.start = this.config.start;
        this.stop = this.config.stop;
      }
      /** @type {Decoder['decode_chain']} */
      decode_chain(tokens) {
        return tokens.map((token) => {
          let start_cut = 0;
          for (let i = 0; i < this.start; ++i) {
            if (token[i] === this.content) {
              start_cut = i + 1;
              continue;
            } else {
              break;
            }
          }
          let stop_cut = token.length;
          for (let i = 0; i < this.stop; ++i) {
            const index = token.length - i - 1;
            if (token[index] === this.content) {
              stop_cut = index;
              continue;
            } else {
              break;
            }
          }
          return token.slice(start_cut, stop_cut);
        });
      }
    };
    WordPieceDecoder = class extends Decoder {
      /**
       * Creates a new instance of WordPieceDecoder.
       * @param {Object} config The configuration object.
       * @param {string} config.prefix The prefix used for WordPiece encoding.
       * @param {boolean} config.cleanup Whether to cleanup the decoded string.
       */
      constructor(config) {
        super(config);
        this.cleanup = config.cleanup;
      }
      /** @type {Decoder['decode_chain']} */
      decode_chain(tokens) {
        return tokens.map((token, i) => {
          if (i !== 0) {
            if (token.startsWith(this.config.prefix)) {
              token = token.replace(this.config.prefix, "");
            } else {
              token = " " + token;
            }
          }
          if (this.cleanup) {
            token = clean_up_tokenization(token);
          }
          return token;
        });
      }
    };
    ByteLevelDecoder = class extends Decoder {
      /**
       * Create a `ByteLevelDecoder` object.
       * @param {Object} config Configuration object.
       */
      constructor(config) {
        super(config);
        this.byte_decoder = UNICODE_TO_BYTES;
        this.text_decoder = new TextDecoder("utf-8", {
          fatal: false,
          ignoreBOM: true
        });
        this.end_of_word_suffix = null;
      }
      /**
       * Convert an array of tokens to string by decoding each byte.
       * @param {string[]} tokens Array of tokens to be decoded.
       * @returns {string} The decoded string.
       */
      convert_tokens_to_string(tokens) {
        const text = tokens.join("");
        const byteArray = new Uint8Array([...text].map((c) => this.byte_decoder[c]));
        const decoded_text = this.text_decoder.decode(byteArray);
        return decoded_text;
      }
      /** @type {Decoder['decode_chain']} */
      decode_chain(tokens) {
        const sub_texts = [];
        let current_sub_text = [];
        for (const token of tokens) {
          if (this.added_tokens.find((x) => x.content === token) !== void 0) {
            if (current_sub_text.length > 0) {
              sub_texts.push(this.convert_tokens_to_string(current_sub_text));
              current_sub_text = [];
            }
            sub_texts.push(token);
          } else {
            current_sub_text.push(token);
          }
        }
        if (current_sub_text.length > 0) {
          sub_texts.push(this.convert_tokens_to_string(current_sub_text));
        }
        return sub_texts;
      }
    };
    CTCDecoder = class extends Decoder {
      constructor(config) {
        super(config);
        this.pad_token = this.config.pad_token;
        this.word_delimiter_token = this.config.word_delimiter_token;
        this.cleanup = this.config.cleanup;
      }
      /**
       * Converts a connectionist-temporal-classification (CTC) output tokens into a single string.
       * @param {string[]} tokens Array of tokens to be decoded.
       * @returns {string} The decoded string.
       */
      convert_tokens_to_string(tokens) {
        if (tokens.length === 0) return "";
        const grouped_tokens = [tokens[0]];
        for (let i = 1; i < tokens.length; ++i) {
          if (tokens[i] !== grouped_tokens.at(-1)) {
            grouped_tokens.push(tokens[i]);
          }
        }
        const filtered_tokens = grouped_tokens.filter((token) => token !== this.pad_token);
        let text = filtered_tokens.join("");
        if (this.cleanup) {
          text = clean_up_tokenization(text).replaceAll(this.word_delimiter_token, " ").trim();
        }
        return text;
      }
      /** @type {Decoder['decode_chain']} */
      decode_chain(tokens) {
        return [this.convert_tokens_to_string(tokens)];
      }
    };
    DecoderSequence = class extends Decoder {
      /**
       * Creates a new instance of DecoderSequence.
       * @param {Object} config The configuration object.
       * @param {Object[]} config.decoders The list of decoders to apply.
       */
      constructor(config) {
        super(config);
        this.decoders = config.decoders.map((x) => Decoder.fromConfig(x));
      }
      /** @type {Decoder['decode_chain']} */
      decode_chain(tokens) {
        return this.decoders.reduce((toks, decoder) => {
          return decoder.decode_chain(toks);
        }, tokens);
      }
    };
    BPEDecoder = class extends Decoder {
      constructor(config) {
        super(config);
        this.suffix = this.config.suffix;
      }
      /** @type {Decoder['decode_chain']} */
      decode_chain(tokens) {
        return tokens.map((token, i) => {
          return token.replaceAll(this.suffix, i === tokens.length - 1 ? "" : " ");
        });
      }
    };
    VitsDecoder = class extends Decoder {
      /** @type {Decoder['decode_chain']} */
      decode_chain(tokens) {
        let decoded = "";
        for (let i = 1; i < tokens.length; i += 2) {
          decoded += tokens[i];
        }
        return [decoded];
      }
    };
    MetaspacePreTokenizer = class extends PreTokenizer {
      /**
       * @param {Object} config The configuration object for the MetaspacePreTokenizer.
       * @param {boolean} config.add_prefix_space Whether to add a prefix space to the first token.
       * @param {string} config.replacement The character to replace spaces with.
       * @param {string} [config.str_rep=config.replacement] An optional string representation of the replacement character.
       * @param {'first'|'never'|'always'} [config.prepend_scheme='always'] The metaspace prepending scheme.
       */
      constructor(config) {
        super();
        this.addPrefixSpace = config.add_prefix_space;
        this.replacement = config.replacement;
        this.strRep = config.str_rep || this.replacement;
        this.prepend_scheme = config.prepend_scheme ?? "always";
      }
      /**
       * This method takes a string, replaces spaces with the replacement character,
       * adds a prefix space if requested, and returns a new list of tokens.
       * @param {string} text The text to pre-tokenize.
       * @param {Object} [options] The options for the pre-tokenization.
       * @param {number} [options.section_index] The index of the section to pre-tokenize.
       * @returns {string[]} A new list of pre-tokenized tokens.
       */
      pre_tokenize_text(text, {
        section_index = void 0
      } = {}) {
        let normalized = text.replaceAll(" ", this.strRep);
        if (
          // We add a prefix space if:
          //  (1) The addPrefixSpace option is enabled and the normalized
          //      token does not already start with the replacement character.
          this.addPrefixSpace && !normalized.startsWith(this.replacement) && (this.prepend_scheme === "always" || this.prepend_scheme === "first" && section_index === 0)
        ) {
          normalized = this.strRep + normalized;
        }
        return [normalized];
      }
    };
    MetaspaceDecoder = class extends Decoder {
      /**
       * Constructs a new MetaspaceDecoder object.
       * @param {Object} config The configuration object for the MetaspaceDecoder.
       * @param {boolean} config.add_prefix_space Whether to add a prefix space to the decoded string.
       * @param {string} config.replacement The string to replace spaces with.
       */
      constructor(config) {
        super(config);
        this.addPrefixSpace = config.add_prefix_space;
        this.replacement = config.replacement;
      }
      /** @type {Decoder['decode_chain']} */
      decode_chain(tokens) {
        const result = [];
        for (let i = 0; i < tokens.length; ++i) {
          let normalized = tokens[i].replaceAll(this.replacement, " ");
          if (this.addPrefixSpace && i == 0 && normalized.startsWith(" ")) {
            normalized = normalized.substring(1);
          }
          result.push(normalized);
        }
        return result;
      }
    };
    Precompiled = class extends Normalizer {
      /**
       * Create a new instance of Precompiled normalizer.
       * @param {Object} config The configuration object.
       * @param {any} config.precompiled_charsmap Precompiled chars mapping.
       */
      constructor(config) {
        super(config);
        this.charsmap = config.precompiled_charsmap;
      }
      /**
       * Normalizes the given text by applying the precompiled charsmap.
       * @param {string} text The text to normalize.
       * @returns {string} The normalized text.
       */
      normalize(text) {
        text = text.replace(/[\u0001-\u0008\u000B\u000E-\u001F\u007F\u008F\u009F]/gm, "");
        text = text.replace(/[\u0009\u000A\u000C\u000D\u1680\u200B\u200C\u200E\u200F\u2028\u2029\u2581\uFEFF\uFFFD]/gm, " ");
        if (text.includes("\uFF5E")) {
          const parts = text.split("\uFF5E");
          text = parts.map((part) => part.normalize("NFKC")).join("\uFF5E");
        } else {
          text = text.normalize("NFKC");
        }
        return text;
      }
    };
    PreTokenizerSequence = class extends PreTokenizer {
      /**
       * Creates an instance of PreTokenizerSequence.
       * @param {Object} config The configuration object for the pre-tokenizer sequence.
       * @param {Object[]} config.pretokenizers An array of pre-tokenizer configurations.
       */
      constructor(config) {
        super();
        this.tokenizers = config.pretokenizers.map((x) => PreTokenizer.fromConfig(x));
      }
      /**
       * Applies each pre-tokenizer in the sequence to the input text in turn.
       * @param {string} text The text to pre-tokenize.
       * @param {Object} [options] Additional options for the pre-tokenization logic.
       * @returns {string[]} The pre-tokenized text.
       */
      pre_tokenize_text(text, options) {
        return this.tokenizers.reduce((preTokenizedText, tokenizer) => {
          return tokenizer.pre_tokenize(preTokenizedText, options);
        }, [text]);
      }
    };
    WhitespacePreTokenizer = class extends PreTokenizer {
      /**
       * Creates an instance of WhitespacePreTokenizer.
       * @param {Object} config The configuration object for the pre-tokenizer.
       */
      constructor(config) {
        super();
      }
      /**
       * Pre-tokenizes the input text by splitting it on word boundaries.
       * @param {string} text The text to be pre-tokenized.
       * @param {Object} [options] Additional options for the pre-tokenization logic.
       * @returns {string[]} An array of tokens produced by splitting the input text on whitespace.
       */
      pre_tokenize_text(text, options) {
        return text.match(/\w+|[^\w\s]+/g) || [];
      }
    };
    WhitespaceSplit = class extends PreTokenizer {
      /**
       * Creates an instance of WhitespaceSplit.
       * @param {Object} config The configuration object for the pre-tokenizer.
       */
      constructor(config) {
        super();
      }
      /**
       * Pre-tokenizes the input text by splitting it on whitespace characters.
       * @param {string} text The text to be pre-tokenized.
       * @param {Object} [options] Additional options for the pre-tokenization logic.
       * @returns {string[]} An array of tokens produced by splitting the input text on whitespace.
       */
      pre_tokenize_text(text, options) {
        return whitespace_split(text);
      }
    };
    ReplacePreTokenizer = class extends PreTokenizer {
      /**
       * @param {Object} config The configuration options for the pre-tokenizer.
       * @param {Object} config.pattern The pattern used to split the text. Can be a string or a regex object.
       * @param {string} config.content What to replace the pattern with.
       */
      constructor(config) {
        super();
        this.config = config;
        this.pattern = createPattern(this.config.pattern);
        this.content = this.config.content;
      }
      /**
       * Pre-tokenizes the input text by replacing certain characters.
       * @param {string} text The text to be pre-tokenized.
       * @param {Object} [options] Additional options for the pre-tokenization logic.
       * @returns {string[]} An array of tokens produced by replacing certain characters.
       */
      pre_tokenize_text(text, options) {
        if (this.pattern === null) {
          return [text];
        }
        return [text.replaceAll(this.pattern, this.config.content)];
      }
    };
    SPECIAL_TOKEN_ATTRIBUTES = [
      "bos_token",
      "eos_token",
      "unk_token",
      "sep_token",
      "pad_token",
      "cls_token",
      "mask_token"
      // additional_special_tokens (TODO)
    ];
    PreTrainedTokenizer = class extends Callable {
      return_token_type_ids = false;
      _default_chat_template = `{% for message in messages %}{{'<|im_start|>' + message['role'] + '
' + message['content'] + '<|im_end|>' + '
'}}{% endfor %}{% if add_generation_prompt %}{{ '<|im_start|>assistant
' }}{% endif %}`;
      /**
       * Create a new PreTrainedTokenizer instance.
       * @param {Object} tokenizerJSON The JSON of the tokenizer.
       * @param {Object} tokenizerConfig The config of the tokenizer.
       */
      constructor(tokenizerJSON, tokenizerConfig) {
        super();
        this._tokenizer_config = tokenizerConfig;
        this.normalizer = Normalizer.fromConfig(tokenizerJSON.normalizer);
        this.pre_tokenizer = PreTokenizer.fromConfig(tokenizerJSON.pre_tokenizer);
        this.model = TokenizerModel.fromConfig(tokenizerJSON.model, tokenizerConfig);
        this.post_processor = PostProcessor.fromConfig(tokenizerJSON.post_processor);
        this.decoder = Decoder.fromConfig(tokenizerJSON.decoder);
        this.special_tokens = [];
        this.all_special_ids = [];
        this.added_tokens = [];
        for (const addedToken of tokenizerJSON.added_tokens) {
          const token = new AddedToken(addedToken);
          this.added_tokens.push(token);
          this.model.tokens_to_ids.set(token.content, token.id);
          this.model.vocab[token.id] = token.content;
          if (token.special) {
            this.special_tokens.push(token.content);
            this.all_special_ids.push(token.id);
          }
        }
        this.additional_special_tokens = tokenizerConfig.additional_special_tokens ?? [];
        this.special_tokens.push(...this.additional_special_tokens);
        this.special_tokens = [...new Set(this.special_tokens)];
        if (this.decoder) {
          this.decoder.added_tokens = this.added_tokens;
          this.decoder.end_of_word_suffix = this.model.end_of_word_suffix;
        }
        this.added_tokens_regex = this.added_tokens.length > 0 ? new RegExp(
          this.added_tokens.map((x) => `${x.lstrip ? "\\s*" : ""}(${escapeRegExp(x.content)})${x.rstrip ? "\\s*" : ""}`).join("|")
        ) : null;
        this.mask_token = this.getToken("mask_token");
        this.mask_token_id = this.model.tokens_to_ids.get(this.mask_token);
        this.pad_token = this.getToken("pad_token", "eos_token");
        this.pad_token_id = this.model.tokens_to_ids.get(this.pad_token);
        this.sep_token = this.getToken("sep_token");
        this.sep_token_id = this.model.tokens_to_ids.get(this.sep_token);
        this.unk_token = this.getToken("unk_token");
        this.unk_token_id = this.model.tokens_to_ids.get(this.unk_token);
        this.model_max_length = tokenizerConfig.model_max_length;
        this.remove_space = tokenizerConfig.remove_space;
        this.clean_up_tokenization_spaces = tokenizerConfig.clean_up_tokenization_spaces ?? true;
        this.do_lowercase_and_remove_accent = tokenizerConfig.do_lowercase_and_remove_accent ?? false;
        this.padding_side = "right";
        this.legacy = false;
        this.chat_template = tokenizerConfig.chat_template ?? null;
        if (Array.isArray(this.chat_template)) {
          const chat_template = /* @__PURE__ */ Object.create(null);
          for (const { name, template } of this.chat_template) {
            if (typeof name !== "string" || typeof template !== "string") {
              throw new Error('Chat template must be a list of objects with "name" and "template" properties');
            }
            chat_template[name] = template;
          }
          this.chat_template = chat_template;
        }
        this._compiled_template_cache = /* @__PURE__ */ new Map();
      }
      /**
       * Returns the value of the first matching key in the tokenizer config object.
       * @param {...string} keys One or more keys to search for in the tokenizer config object.
       * @returns {string|null} The value associated with the first matching key, or null if no match is found.
       * @throws {Error} If an object is found for a matching key and its __type property is not "AddedToken".
       */
      getToken(...keys) {
        for (const key of keys) {
          const item = this._tokenizer_config[key];
          if (!item) continue;
          if (typeof item === "object") {
            if (item.__type === "AddedToken") {
              return item.content;
            } else {
              throw Error(`Unknown token: ${item}`);
            }
          } else {
            return item;
          }
        }
        return null;
      }
      /**
       * Loads a pre-trained tokenizer from the given `pretrained_model_name_or_path`. 
       * 
       * @param {string} pretrained_model_name_or_path The path to the pre-trained tokenizer.
       * @param {PretrainedTokenizerOptions} options Additional options for loading the tokenizer.
       * 
       * @throws {Error} Throws an error if the tokenizer.json or tokenizer_config.json files are not found in the `pretrained_model_name_or_path`.
       * @returns {Promise<PreTrainedTokenizer>} A new instance of the `PreTrainedTokenizer` class.
       */
      static async from_pretrained(pretrained_model_name_or_path, {
        progress_callback = null,
        config = null,
        cache_dir = null,
        local_files_only = false,
        revision = "main",
        legacy = null
      } = {}) {
        const info = await loadTokenizer(pretrained_model_name_or_path, {
          progress_callback,
          config,
          cache_dir,
          local_files_only,
          revision,
          legacy
        });
        return new this(...info);
      }
      /**
       * @typedef {number[]|number[][]|Tensor} BatchEncodingItem
       * 
       * @typedef {Object} BatchEncoding Holds the output of the tokenizer's call function.
       * @property {BatchEncodingItem} input_ids List of token ids to be fed to a model.
       * @property {BatchEncodingItem} attention_mask List of indices specifying which tokens should be attended to by the model.
       * @property {BatchEncodingItem} [token_type_ids] List of token type ids to be fed to a model.
       */
      /**
       * Encode/tokenize the given text(s).
       * @param {string|string[]} text The text to tokenize.
       * @param {Object} options An optional object containing the following properties:
       * @param {string|string[]} [options.text_pair=null] Optional second sequence to be encoded. If set, must be the same type as text.
       * @param {boolean|'max_length'} [options.padding=false] Whether to pad the input sequences.
       * @param {boolean} [options.add_special_tokens=true] Whether or not to add the special tokens associated with the corresponding model.
       * @param {boolean} [options.truncation=null] Whether to truncate the input sequences.
       * @param {number} [options.max_length=null] Maximum length of the returned list and optionally padding length.
       * @param {boolean} [options.return_tensor=true] Whether to return the results as Tensors or arrays.
       * @param {boolean} [options.return_token_type_ids=null] Whether to return the token type ids.
       * @returns {BatchEncoding} Object to be passed to the model.
       */
      _call(text, {
        text_pair = null,
        add_special_tokens = true,
        padding = false,
        truncation = null,
        max_length = null,
        return_tensor = true,
        // Different to HF
        return_token_type_ids = null
      } = {}) {
        const isBatched = Array.isArray(text);
        let encodedTokens;
        if (isBatched) {
          if (text.length === 0) {
            throw Error("text array must be non-empty");
          }
          if (text_pair !== null) {
            if (!Array.isArray(text_pair)) {
              throw Error("text_pair must also be an array");
            } else if (text.length !== text_pair.length) {
              throw Error("text and text_pair must have the same length");
            }
            encodedTokens = text.map(
              (t, i) => this._encode_plus(t, text_pair[i], { add_special_tokens, return_token_type_ids })
            );
          } else {
            encodedTokens = text.map((x) => this._encode_plus(x, null, { add_special_tokens, return_token_type_ids }));
          }
        } else {
          if (text === null || text === void 0) {
            throw Error("text may not be null or undefined");
          }
          if (Array.isArray(text_pair)) {
            throw Error("When specifying `text_pair`, since `text` is a string, `text_pair` must also be a string (i.e., not an array).");
          }
          encodedTokens = [this._encode_plus(text, text_pair, { add_special_tokens, return_token_type_ids })];
        }
        if (max_length === null) {
          if (padding === "max_length") {
            max_length = this.model_max_length;
          } else {
            max_length = max(encodedTokens.map((x) => x.input_ids.length))[0];
          }
        } else {
          if (!truncation) {
            console.warn(`Truncation was not explicitly activated but \`max_length\` is provided a specific value, please use \`truncation=true\` to explicitly truncate examples to max length.`);
          }
        }
        max_length = Math.min(max_length, this.model_max_length);
        if (padding || truncation) {
          for (let i = 0; i < encodedTokens.length; ++i) {
            if (encodedTokens[i].input_ids.length === max_length) {
              continue;
            } else if (encodedTokens[i].input_ids.length > max_length) {
              if (truncation) {
                truncateHelper(encodedTokens[i], max_length);
              }
            } else {
              if (padding) {
                padHelper(
                  encodedTokens[i],
                  max_length,
                  (key) => key === "input_ids" ? this.pad_token_id : 0,
                  this.padding_side
                );
              }
            }
          }
        }
        const result = {};
        if (return_tensor) {
          if (!(padding && truncation)) {
            if (encodedTokens.some((x) => {
              for (const key of Object.keys(x)) {
                if (x[key].length !== encodedTokens[0][key]?.length) {
                  return true;
                }
              }
              return false;
            })) {
              throw Error(
                "Unable to create tensor, you should probably activate truncation and/or padding with 'padding=true' and 'truncation=true' to have batched tensors with the same length."
              );
            }
          }
          const dims = [encodedTokens.length, encodedTokens[0].input_ids.length];
          for (const key of Object.keys(encodedTokens[0])) {
            result[key] = new Tensor(
              "int64",
              BigInt64Array.from(encodedTokens.flatMap((x) => x[key]).map(BigInt)),
              dims
            );
          }
        } else {
          for (const key of Object.keys(encodedTokens[0])) {
            result[key] = encodedTokens.map((x) => x[key]);
          }
          if (!isBatched) {
            for (const key of Object.keys(result)) {
              result[key] = result[key][0];
            }
          }
        }
        return (
          /** @type {BatchEncoding} */
          result
        );
      }
      /**
       * Encodes a single text using the preprocessor pipeline of the tokenizer.
       *
       * @param {string|null} text The text to encode.
       * @returns {string[]|null} The encoded tokens.
       */
      _encode_text(text) {
        if (text === null) return null;
        const sections = this.added_tokens_regex ? text.split(this.added_tokens_regex).filter((x) => x) : [text];
        const tokens = sections.map((x, section_index) => {
          const addedToken = this.added_tokens.find((t) => t.content === x);
          if (addedToken !== void 0) {
            return x;
          } else {
            if (this.remove_space === true) {
              x = x.trim().split(/\s+/).join(" ");
            }
            if (this.do_lowercase_and_remove_accent) {
              x = lowercase_and_remove_accent(x);
            }
            if (this.normalizer !== null) {
              x = this.normalizer(x);
            }
            if (x.length === 0) {
              return [];
            }
            const sectionTokens = this.pre_tokenizer !== null ? this.pre_tokenizer(x, {
              section_index
            }) : [x];
            const tokens2 = this.model(sectionTokens);
            return tokens2;
          }
        }).flat();
        return tokens;
      }
      /**
       * Encodes a single text or a pair of texts using the model's tokenizer.
       *
       * @param {string} text The text to encode.
       * @param {string|null} text_pair The optional second text to encode.
       * @param {Object} options An optional object containing the following properties:
       * @param {boolean} [options.add_special_tokens=true] Whether or not to add the special tokens associated with the corresponding model.
       * @param {boolean} [options.return_token_type_ids=null] Whether to return token_type_ids.
       * @returns {EncodingSingle} An object containing the encoded text.
       * @private
       */
      _encode_plus(text, text_pair = null, {
        add_special_tokens = true,
        return_token_type_ids = null
      } = {}) {
        const tokens = this._encode_text(text);
        const tokens2 = this._encode_text(text_pair);
        const combinedTokens = this.post_processor ? this.post_processor(tokens, tokens2, { add_special_tokens }) : { tokens: mergeArrays(tokens ?? [], tokens2 ?? []) };
        const input_ids = this.model.convert_tokens_to_ids(combinedTokens.tokens);
        const result = {
          input_ids,
          attention_mask: new Array(input_ids.length).fill(1)
        };
        if ((return_token_type_ids ?? this.return_token_type_ids) && combinedTokens.token_type_ids) {
          result.token_type_ids = combinedTokens.token_type_ids;
        }
        return result;
      }
      /**
       * Encodes a single text or a pair of texts using the model's tokenizer.
       *
       * @param {string} text The text to encode.
       * @param {string|null} text_pair The optional second text to encode.
       * @param {Object} options An optional object containing the following properties:
       * @param {boolean} [options.add_special_tokens=true] Whether or not to add the special tokens associated with the corresponding model.
       * @param {boolean} [options.return_token_type_ids=null] Whether to return token_type_ids.
       * @returns {number[]} An array of token IDs representing the encoded text(s).
       */
      encode(text, text_pair = null, {
        add_special_tokens = true,
        return_token_type_ids = null
      } = {}) {
        const { input_ids } = this._encode_plus(text, text_pair, {
          add_special_tokens,
          return_token_type_ids
        });
        return input_ids;
      }
      /**
       * Decode a batch of tokenized sequences.
       * @param {number[][]|Tensor} batch List/Tensor of tokenized input sequences.
       * @param {Object} decode_args (Optional) Object with decoding arguments.
       * @returns {string[]} List of decoded sequences.
       */
      batch_decode(batch, decode_args = {}) {
        if (batch instanceof Tensor) {
          batch = batch.tolist();
        }
        return batch.map((x) => this.decode(x, decode_args));
      }
      /**
       * Decodes a sequence of token IDs back to a string.
       *
       * @param {number[]|Tensor} token_ids List/Tensor of token IDs to decode.
       * @param {Object} [decode_args={}]
       * @param {boolean} [decode_args.skip_special_tokens=false] If true, special tokens are removed from the output string.
       * @param {boolean} [decode_args.clean_up_tokenization_spaces=true] If true, spaces before punctuations and abbreviated forms are removed.
       *
       * @returns {string} The decoded string.
       * @throws {Error} If `token_ids` is not a non-empty array of integers.
       */
      decode(token_ids, decode_args = {}) {
        if (token_ids instanceof Tensor) {
          token_ids = prepareTensorForDecode(token_ids);
        }
        if (!Array.isArray(token_ids) || token_ids.length === 0 || !isIntegralNumber(token_ids[0])) {
          throw Error("token_ids must be a non-empty array of integers.");
        }
        return this.decode_single(token_ids, decode_args);
      }
      /**
       * Decode a single list of token ids to a string.
       * @param {number[]} token_ids List of token ids to decode
       * @param {Object} decode_args Optional arguments for decoding
       * @param {boolean} [decode_args.skip_special_tokens=false] Whether to skip special tokens during decoding
       * @param {boolean} [decode_args.clean_up_tokenization_spaces=null] Whether to clean up tokenization spaces during decoding.
       * If null, the value is set to `this.decoder.cleanup` if it exists, falling back to `this.clean_up_tokenization_spaces` if it exists, falling back to `true`.
       * @returns {string} The decoded string
       */
      decode_single(token_ids, {
        skip_special_tokens = false,
        clean_up_tokenization_spaces = null
      }) {
        let tokens = this.model.convert_ids_to_tokens(token_ids);
        if (skip_special_tokens) {
          tokens = tokens.filter((x) => !this.special_tokens.includes(x));
        }
        let decoded = this.decoder ? this.decoder(tokens) : tokens.join(" ");
        if (this.decoder && this.decoder.end_of_word_suffix) {
          decoded = decoded.replaceAll(this.decoder.end_of_word_suffix, " ");
          if (skip_special_tokens) {
            decoded = decoded.trim();
          }
        }
        if (clean_up_tokenization_spaces ?? this.clean_up_tokenization_spaces) {
          decoded = clean_up_tokenization(decoded);
        }
        return decoded;
      }
      get default_chat_template() {
        if (!this._warned_about_chat_template) {
          console.warn(
            "No chat template is defined for this tokenizer - using a default chat template that implements the ChatML format. If the default is not appropriate for your model, please set `tokenizer.chat_template` to an appropriate template. See https://huggingface.co/docs/transformers/main/chat_templating for more information."
          );
          this._warned_about_chat_template = true;
        }
        return this._default_chat_template;
      }
      /**
       * Converts a list of message objects with `"role"` and `"content"` keys to a list of token
       * ids. This method is intended for use with chat models, and will read the tokenizer's chat_template attribute to
       * determine the format and control tokens to use when converting. When chat_template is None, it will fall back
       * to the default_chat_template specified at the class level.
       * 
       * See [here](https://huggingface.co/docs/transformers/chat_templating) for more information.
       * 
       * **Example:** Applying a chat template to a conversation.
       * 
       * ```javascript
       * import { AutoTokenizer } from "@xenova/transformers";
       * 
       * const tokenizer = await AutoTokenizer.from_pretrained("Xenova/mistral-tokenizer-v1");
       * 
       * const chat = [
       *   { "role": "user", "content": "Hello, how are you?" },
       *   { "role": "assistant", "content": "I'm doing great. How can I help you today?" },
       *   { "role": "user", "content": "I'd like to show off how chat templating works!" },
       * ]
       * 
       * const text = tokenizer.apply_chat_template(chat, { tokenize: false });
       * // "<s>[INST] Hello, how are you? [/INST]I'm doing great. How can I help you today?</s> [INST] I'd like to show off how chat templating works! [/INST]"
       * 
       * const input_ids = tokenizer.apply_chat_template(chat, { tokenize: true, return_tensor: false });
       * // [1, 733, 16289, 28793, 22557, 28725, 910, 460, 368, 28804, 733, 28748, 16289, 28793, 28737, 28742, 28719, 2548, 1598, 28723, 1602, 541, 315, 1316, 368, 3154, 28804, 2, 28705, 733, 16289, 28793, 315, 28742, 28715, 737, 298, 1347, 805, 910, 10706, 5752, 1077, 3791, 28808, 733, 28748, 16289, 28793]
       * ```
       * 
       * @param {Message[]} conversation A list of message objects with `"role"` and `"content"` keys.
       * @param {Object} options An optional object containing the following properties:
       * @param {string} [options.chat_template=null] A Jinja template to use for this conversion. If
       * this is not passed, the model's default chat template will be used instead.
       * @param {boolean} [options.add_generation_prompt=false] Whether to end the prompt with the token(s) that indicate
       * the start of an assistant message. This is useful when you want to generate a response from the model.
       * Note that this argument will be passed to the chat template, and so it must be supported in the
       * template for this argument to have any effect.
       * @param {boolean} [options.tokenize=true] Whether to tokenize the output. If false, the output will be a string.
       * @param {boolean} [options.padding=false] Whether to pad sequences to the maximum length. Has no effect if tokenize is false.
       * @param {boolean} [options.truncation=false] Whether to truncate sequences to the maximum length. Has no effect if tokenize is false.
       * @param {number} [options.max_length=null] Maximum length (in tokens) to use for padding or truncation. Has no effect if tokenize is false.
       * If not specified, the tokenizer's `max_length` attribute will be used as a default.
       * @param {boolean} [options.return_tensor=true] Whether to return the output as a Tensor or an Array. Has no effect if tokenize is false.
       * @param {Object} [options.tokenizer_kwargs={}] Additional options to pass to the tokenizer.
       * @returns {string | Tensor | number[]| number[][]} The tokenized output.
       */
      apply_chat_template(conversation, {
        chat_template = null,
        add_generation_prompt = false,
        tokenize: tokenize2 = true,
        padding = false,
        truncation = false,
        max_length = null,
        return_tensor = true,
        tokenizer_kwargs = {},
        ...kwargs
      } = {}) {
        if (this.chat_template && typeof this.chat_template === "object" || this.chat_template === null && this.default_chat_template && typeof this.default_chat_template === "object") {
          const template_dict = this.chat_template ?? this.default_chat_template;
          if (chat_template !== null && Object.hasOwn(template_dict, chat_template)) {
            chat_template = template_dict[chat_template];
          } else if (chat_template === null && "default" in template_dict) {
            chat_template = template_dict["default"];
          } else if (chat_template === null) {
            throw Error(
              `This model has multiple chat templates with no default specified! Please either pass a chat template or the name of the template you wish to use to the 'chat_template' argument. Available template names are ${Object.keys(template_dict).sort()}.`
            );
          }
        } else {
          chat_template ??= this.chat_template ?? this.default_chat_template;
        }
        if (typeof chat_template !== "string") {
          throw Error(`chat_template must be a string, but got ${typeof chat_template}`);
        }
        let compiledTemplate = this._compiled_template_cache.get(chat_template);
        if (compiledTemplate === void 0) {
          compiledTemplate = new Template(chat_template);
          this._compiled_template_cache.set(chat_template, compiledTemplate);
        }
        const special_tokens_map = /* @__PURE__ */ Object.create(null);
        for (const key of SPECIAL_TOKEN_ATTRIBUTES) {
          const value = this.getToken(key);
          if (value) {
            special_tokens_map[key] = value;
          }
        }
        const rendered = compiledTemplate.render({
          messages: conversation,
          add_generation_prompt,
          ...special_tokens_map,
          ...kwargs
        });
        if (tokenize2) {
          return this._call(rendered, {
            add_special_tokens: false,
            padding,
            truncation,
            max_length,
            return_tensor,
            ...tokenizer_kwargs
          }).input_ids;
        }
        return rendered;
      }
    };
    BertTokenizer = class extends PreTrainedTokenizer {
      return_token_type_ids = true;
    };
    AlbertTokenizer = class extends PreTrainedTokenizer {
      return_token_type_ids = true;
    };
    MobileBertTokenizer = class extends PreTrainedTokenizer {
      return_token_type_ids = true;
    };
    SqueezeBertTokenizer = class extends PreTrainedTokenizer {
      return_token_type_ids = true;
    };
    DebertaTokenizer = class extends PreTrainedTokenizer {
      return_token_type_ids = true;
    };
    DebertaV2Tokenizer = class extends PreTrainedTokenizer {
      return_token_type_ids = true;
    };
    HerbertTokenizer = class extends PreTrainedTokenizer {
      return_token_type_ids = true;
    };
    ConvBertTokenizer = class extends PreTrainedTokenizer {
      return_token_type_ids = true;
    };
    RoFormerTokenizer = class extends PreTrainedTokenizer {
      return_token_type_ids = true;
    };
    DistilBertTokenizer = class extends PreTrainedTokenizer {
    };
    CamembertTokenizer = class extends PreTrainedTokenizer {
    };
    XLMTokenizer = class extends PreTrainedTokenizer {
      return_token_type_ids = true;
      constructor(tokenizerJSON, tokenizerConfig) {
        super(tokenizerJSON, tokenizerConfig);
        console.warn('WARNING: `XLMTokenizer` is not yet supported by Hugging Face\'s "fast" tokenizers library. Therefore, you may experience slightly inaccurate results.');
      }
    };
    ElectraTokenizer = class extends PreTrainedTokenizer {
      return_token_type_ids = true;
    };
    T5Tokenizer = class extends PreTrainedTokenizer {
    };
    GPT2Tokenizer = class extends PreTrainedTokenizer {
      _default_chat_template = `{% for message in messages %}" "{{ message.content }}{{ eos_token }}" "{% endfor %}`;
    };
    BartTokenizer = class extends PreTrainedTokenizer {
    };
    MBartTokenizer = class extends PreTrainedTokenizer {
      constructor(tokenizerJSON, tokenizerConfig) {
        super(tokenizerJSON, tokenizerConfig);
        this.languageRegex = /^[a-z]{2}_[A-Z]{2}$/;
        this.language_codes = this.special_tokens.filter((x) => this.languageRegex.test(x));
        this.lang_to_token = (x) => x;
      }
      /**
       * Helper function to build translation inputs for an `MBartTokenizer`.
       * @param {string|string[]} raw_inputs The text to tokenize.
       * @param {Object} tokenizer_options Options to be sent to the tokenizer
       * @param {Object} generate_kwargs Generation options.
       * @returns {Object} Object to be passed to the model.
       */
      _build_translation_inputs(raw_inputs, tokenizer_options, generate_kwargs) {
        return _build_translation_inputs(this, raw_inputs, tokenizer_options, generate_kwargs);
      }
    };
    MBart50Tokenizer = class extends MBartTokenizer {
    };
    RobertaTokenizer = class extends PreTrainedTokenizer {
    };
    BloomTokenizer = class extends GPT2Tokenizer {
      // NOTE: `GPT2Tokenizer` to get the correct chat template
      constructor(tokenizerJSON, tokenizerConfig) {
        const splitChars = ".,!?\u2026\u3002\uFF0C\u3001\u0964\u06D4\u060C";
        const patternObject = tokenizerJSON.pre_tokenizer?.pretokenizers[0]?.pattern;
        if (patternObject && patternObject.Regex === ` ?[^(\\s|[${splitChars}])]+`) {
          patternObject.Regex = ` ?[^\\s${splitChars}]+`;
        }
        super(tokenizerJSON, tokenizerConfig);
      }
    };
    SPIECE_UNDERLINE = "\u2581";
    LlamaTokenizer = class extends PreTrainedTokenizer {
      _default_chat_template = `{% if messages[0]['role'] == 'system' %}{% set loop_messages = messages[1:] %}{% set system_message = messages[0]['content'] %}{% elif USE_DEFAULT_PROMPT == true and not '<<SYS>>' in messages[0]['content'] %}{% set loop_messages = messages %}{% set system_message = 'DEFAULT_SYSTEM_MESSAGE' %}{% else %}{% set loop_messages = messages %}{% set system_message = false %}{% endif %}{% for message in loop_messages %}{% if (message['role'] == 'user') != (loop.index0 % 2 == 0) %}{{ raise_exception('Conversation roles must alternate user/assistant/user/assistant/...') }}{% endif %}{% if loop.index0 == 0 and system_message != false %}{% set content = '<<SYS>>
' + system_message + '
<</SYS>>

' + message['content'] %}{% else %}{% set content = message['content'] %}{% endif %}{% if message['role'] == 'user' %}{{ bos_token + '[INST] ' + content.strip() + ' [/INST]' }}{% elif message['role'] == 'system' %}{{ '<<SYS>>
' + content.strip() + '
<</SYS>>

' }}{% elif message['role'] == 'assistant' %}{{ ' '  + content.strip() + ' ' + eos_token }}{% endif %}{% endfor %}`;
      DEFAULT_SYSTEM_PROMPT = "You are a helpful, respectful and honest assistant. Always answer as helpfully as possible, while being safe. Your answers should not include any harmful, unethical, racist, sexist, toxic, dangerous, or illegal content. Please ensure that your responses are socially unbiased and positive in nature.\n\nIf a question does not make any sense, or is not factually coherent, explain why instead of answering something not correct. If you don't know the answer to a question, please don't share false information.";
      constructor(tokenizerJSON, tokenizerConfig) {
        super(tokenizerJSON, tokenizerConfig);
        this.use_default_system_prompt = tokenizerConfig.use_default_system_prompt ?? false;
        this.legacy = tokenizerConfig.legacy ?? true;
        if (!this.legacy) {
          this.normalizer = null;
          this.pre_tokenizer = new MetaspacePreTokenizer({
            replacement: SPIECE_UNDERLINE,
            add_prefix_space: true,
            prepend_scheme: "first"
          });
        }
      }
      /**
       * Helper function to handle legacy encoding of SPM tokenizers.
       * Adapted from https://github.com/huggingface/transformers/blob/e6dcf8abd6f65bb4b6dfc1831b20d9ba49ce00e2/src/transformers/models/t5/tokenization_t5.py#L374-L387
       * @param {string} text The text to encode.
       * @returns {string[]} The encoded tokens.
       */
      _encode_text(text) {
        if (text === null) return null;
        if (this.legacy || text.length === 0) {
          return super._encode_text(text);
        }
        let tokens = super._encode_text(SPIECE_UNDERLINE + text.replaceAll(SPIECE_UNDERLINE, " "));
        if (tokens.length > 1 && tokens[0] === SPIECE_UNDERLINE && this.special_tokens.includes(tokens[1])) {
          tokens = tokens.slice(1);
        }
        return tokens;
      }
      get default_chat_template() {
        return super.default_chat_template.replaceAll("USE_DEFAULT_PROMPT", this.use_default_system_prompt ? "true" : "false").replaceAll("DEFAULT_SYSTEM_MESSAGE", this.DEFAULT_SYSTEM_PROMPT.replaceAll("\n", "\\n").replaceAll("'", "\\'"));
      }
    };
    CodeLlamaTokenizer = class extends LlamaTokenizer {
    };
    XLMRobertaTokenizer = class extends PreTrainedTokenizer {
    };
    MPNetTokenizer = class extends PreTrainedTokenizer {
    };
    FalconTokenizer = class extends PreTrainedTokenizer {
    };
    GPTNeoXTokenizer = class extends PreTrainedTokenizer {
    };
    EsmTokenizer = class extends PreTrainedTokenizer {
    };
    Qwen2Tokenizer = class extends PreTrainedTokenizer {
    };
    GemmaTokenizer = class extends PreTrainedTokenizer {
      _default_chat_template = "{% if messages[0]['role'] == 'system' %}{{ raise_exception('System role not supported') }}{% endif %}{% for message in messages %}{% if (message['role'] == 'user') != (loop.index0 % 2 == 0) %}{{ raise_exception('Conversation roles must alternate user/assistant/user/assistant/...') }}{% endif %}{% if (message['role'] == 'assistant') %}{% set role = 'model' %}{% else %}{% set role = message['role'] %}{% endif %}{{ '<start_of_turn>' + role + '\n' + message['content'] | trim + '<end_of_turn>\n' }}{% endfor %}{% if add_generation_prompt %}{{'<start_of_turn>model\n'}}{% endif %}";
    };
    Grok1Tokenizer = class extends PreTrainedTokenizer {
    };
    NllbTokenizer = class extends PreTrainedTokenizer {
      constructor(tokenizerJSON, tokenizerConfig) {
        super(tokenizerJSON, tokenizerConfig);
        this.languageRegex = /^[a-z]{3}_[A-Z][a-z]{3}$/;
        this.language_codes = this.special_tokens.filter((x) => this.languageRegex.test(x));
        this.lang_to_token = (x) => x;
      }
      /**
       * Helper function to build translation inputs for an `NllbTokenizer`.
       * @param {string|string[]} raw_inputs The text to tokenize.
       * @param {Object} tokenizer_options Options to be sent to the tokenizer
       * @param {Object} generate_kwargs Generation options.
       * @returns {Object} Object to be passed to the model.
       */
      _build_translation_inputs(raw_inputs, tokenizer_options, generate_kwargs) {
        return _build_translation_inputs(this, raw_inputs, tokenizer_options, generate_kwargs);
      }
    };
    M2M100Tokenizer = class extends PreTrainedTokenizer {
      constructor(tokenizerJSON, tokenizerConfig) {
        super(tokenizerJSON, tokenizerConfig);
        this.languageRegex = /^__[a-z]{2,3}__$/;
        this.language_codes = this.special_tokens.filter((x) => this.languageRegex.test(x)).map((x) => x.slice(2, -2));
        this.lang_to_token = (x) => `__${x}__`;
      }
      /**
       * Helper function to build translation inputs for an `M2M100Tokenizer`.
       * @param {string|string[]} raw_inputs The text to tokenize.
       * @param {Object} tokenizer_options Options to be sent to the tokenizer
       * @param {Object} generate_kwargs Generation options.
       * @returns {Object} Object to be passed to the model.
       */
      _build_translation_inputs(raw_inputs, tokenizer_options, generate_kwargs) {
        return _build_translation_inputs(this, raw_inputs, tokenizer_options, generate_kwargs);
      }
    };
    WHISPER_LANGUAGES = [
      ["en", "english"],
      ["zh", "chinese"],
      ["de", "german"],
      ["es", "spanish"],
      ["ru", "russian"],
      ["ko", "korean"],
      ["fr", "french"],
      ["ja", "japanese"],
      ["pt", "portuguese"],
      ["tr", "turkish"],
      ["pl", "polish"],
      ["ca", "catalan"],
      ["nl", "dutch"],
      ["ar", "arabic"],
      ["sv", "swedish"],
      ["it", "italian"],
      ["id", "indonesian"],
      ["hi", "hindi"],
      ["fi", "finnish"],
      ["vi", "vietnamese"],
      ["he", "hebrew"],
      ["uk", "ukrainian"],
      ["el", "greek"],
      ["ms", "malay"],
      ["cs", "czech"],
      ["ro", "romanian"],
      ["da", "danish"],
      ["hu", "hungarian"],
      ["ta", "tamil"],
      ["no", "norwegian"],
      ["th", "thai"],
      ["ur", "urdu"],
      ["hr", "croatian"],
      ["bg", "bulgarian"],
      ["lt", "lithuanian"],
      ["la", "latin"],
      ["mi", "maori"],
      ["ml", "malayalam"],
      ["cy", "welsh"],
      ["sk", "slovak"],
      ["te", "telugu"],
      ["fa", "persian"],
      ["lv", "latvian"],
      ["bn", "bengali"],
      ["sr", "serbian"],
      ["az", "azerbaijani"],
      ["sl", "slovenian"],
      ["kn", "kannada"],
      ["et", "estonian"],
      ["mk", "macedonian"],
      ["br", "breton"],
      ["eu", "basque"],
      ["is", "icelandic"],
      ["hy", "armenian"],
      ["ne", "nepali"],
      ["mn", "mongolian"],
      ["bs", "bosnian"],
      ["kk", "kazakh"],
      ["sq", "albanian"],
      ["sw", "swahili"],
      ["gl", "galician"],
      ["mr", "marathi"],
      ["pa", "punjabi"],
      ["si", "sinhala"],
      ["km", "khmer"],
      ["sn", "shona"],
      ["yo", "yoruba"],
      ["so", "somali"],
      ["af", "afrikaans"],
      ["oc", "occitan"],
      ["ka", "georgian"],
      ["be", "belarusian"],
      ["tg", "tajik"],
      ["sd", "sindhi"],
      ["gu", "gujarati"],
      ["am", "amharic"],
      ["yi", "yiddish"],
      ["lo", "lao"],
      ["uz", "uzbek"],
      ["fo", "faroese"],
      ["ht", "haitian creole"],
      ["ps", "pashto"],
      ["tk", "turkmen"],
      ["nn", "nynorsk"],
      ["mt", "maltese"],
      ["sa", "sanskrit"],
      ["lb", "luxembourgish"],
      ["my", "myanmar"],
      ["bo", "tibetan"],
      ["tl", "tagalog"],
      ["mg", "malagasy"],
      ["as", "assamese"],
      ["tt", "tatar"],
      ["haw", "hawaiian"],
      ["ln", "lingala"],
      ["ha", "hausa"],
      ["ba", "bashkir"],
      ["jw", "javanese"],
      ["su", "sundanese"]
    ];
    WHISPER_LANGUAGE_MAPPING = new Map(WHISPER_LANGUAGES);
    WHISPER_TO_LANGUAGE_CODE_MAPPING = new Map([
      ...WHISPER_LANGUAGES.map(([k, v]) => [v, k]),
      ...[
        ["burmese", "my"],
        ["valencian", "ca"],
        ["flemish", "nl"],
        ["haitian", "ht"],
        ["letzeburgesch", "lb"],
        ["pushto", "ps"],
        ["panjabi", "pa"],
        ["moldavian", "ro"],
        ["moldovan", "ro"],
        ["sinhalese", "si"],
        ["castilian", "es"]
      ]
    ]);
    WhisperTokenizer = class extends PreTrainedTokenizer {
      _default_chat_template = `{% for message in messages %}" "{{ message.content }}{{ eos_token }}" "{% endfor %}`;
      /**
       * Decodes automatic speech recognition (ASR) sequences.
       * @param {Array<{tokens: number[], token_timestamps?: number[], stride: number[]}>} sequences The sequences to decode.
       * @param {Object} options The options to use for decoding.
       * @returns {Array<string|{chunks?: undefined|Array<{language: string|null, timestamp: Array<number|null>, text: string}>}>} The decoded sequences.
       */
      _decode_asr(sequences, {
        return_timestamps = false,
        return_language = false,
        time_precision = null,
        force_full_sequences = true
      } = {}) {
        if (time_precision === null) {
          throw Error("Must specify time_precision");
        }
        let last_language = null;
        const returnWordTimestamps = return_timestamps === "word";
        function new_chunk() {
          return { "language": last_language, "timestamp": [null, null], "text": "" };
        }
        const chunks = [];
        let chunk = new_chunk();
        let time_offset = 0;
        const timestamp_begin = this.model.convert_tokens_to_ids(["<|notimestamps|>"])[0] + 1;
        let previous_tokens = [];
        let previous_token_timestamps = [];
        let skip = false;
        let right_stride_start = null;
        const all_special_ids = new Set(this.all_special_ids);
        for (const output of sequences) {
          const token_ids = output.tokens;
          const token_timestamps = returnWordTimestamps ? output.token_timestamps : null;
          let last_timestamp = null;
          let first_timestamp = timestamp_begin;
          if ("stride" in output) {
            const [chunk_len, stride_left, stride_right] = output.stride;
            time_offset -= stride_left;
            right_stride_start = chunk_len - stride_right;
            if (stride_left) {
              first_timestamp = stride_left / time_precision + timestamp_begin;
            }
            if (stride_right) {
              for (let i = token_ids.length - 1; i >= 0; --i) {
                const token = token_ids[i];
                if (token >= timestamp_begin) {
                  if (last_timestamp !== null && (token - timestamp_begin) * time_precision < right_stride_start) {
                    break;
                  }
                  last_timestamp = token;
                }
              }
            }
          }
          let current_tokens = [];
          let current_token_timestamps = [];
          for (let i = 0; i < token_ids.length; ++i) {
            const token = token_ids[i];
            if (all_special_ids.has(token)) {
              const text = this.decode([token]);
              const language = WHISPER_LANGUAGE_MAPPING.get(text.slice(2, -2));
              if (language !== void 0) {
                if (last_language !== null && language !== last_language && !return_timestamps) {
                  previous_tokens.push(current_tokens);
                  const resolved_tokens = this.findLongestCommonSequence(previous_tokens)[0];
                  const resolved_text = this.decode(resolved_tokens);
                  chunk.text = resolved_text;
                  chunks.push(chunk);
                  previous_tokens = [];
                  current_tokens = [];
                  chunk = new_chunk();
                }
                last_language = chunk.language = language;
              } else {
              }
            } else if (token >= timestamp_begin) {
              const time = (token - timestamp_begin) * time_precision + time_offset;
              const rounded_time = round(time, 2);
              if (last_timestamp !== null && token >= last_timestamp) {
                skip = true;
              } else if (skip || previous_tokens.length > 0 && token < first_timestamp) {
                skip = false;
              } else if (chunk.timestamp[0] === null) {
                chunk.timestamp[0] = rounded_time;
              } else {
                if (rounded_time === chunk.timestamp[0]) {
                } else {
                  chunk.timestamp[1] = rounded_time;
                  previous_tokens.push(current_tokens);
                  if (returnWordTimestamps) {
                    previous_token_timestamps.push(current_token_timestamps);
                  }
                  const [resolved_tokens, resolved_token_timestamps] = this.findLongestCommonSequence(
                    previous_tokens,
                    previous_token_timestamps
                  );
                  const resolved_text = this.decode(resolved_tokens);
                  chunk.text = resolved_text;
                  if (returnWordTimestamps) {
                    chunk.words = this.collateWordTimestamps(
                      resolved_tokens,
                      resolved_token_timestamps,
                      last_language
                    );
                  }
                  chunks.push(chunk);
                  previous_tokens = [];
                  current_tokens = [];
                  previous_token_timestamps = [];
                  current_token_timestamps = [];
                  chunk = new_chunk();
                }
              }
            } else {
              current_tokens.push(token);
              if (returnWordTimestamps) {
                let start_time = round(token_timestamps[i] + time_offset, 2);
                let end_time;
                if (i + 1 < token_timestamps.length) {
                  end_time = round(token_timestamps[i + 1] + time_offset, 2);
                } else {
                  end_time = null;
                }
                current_token_timestamps.push([start_time, end_time]);
              }
            }
          }
          if ("stride" in output) {
            const [chunk_len, stride_left, stride_right] = output.stride;
            time_offset += chunk_len - stride_right;
          }
          if (current_tokens.length > 0) {
            previous_tokens.push(current_tokens);
            if (returnWordTimestamps) {
              previous_token_timestamps.push(current_token_timestamps);
            }
          } else if (previous_tokens.every((p) => p.length === 0)) {
            chunk = new_chunk();
            previous_tokens = [];
            current_tokens = [];
            previous_token_timestamps = [];
            current_token_timestamps = [];
          }
        }
        if (previous_tokens.length > 0) {
          if (force_full_sequences && return_timestamps) {
            throw new Error(
              "Whisper did not predict an ending timestamp, which can happen if audio is cut off in the middle of a word. Also make sure WhisperTimeStampLogitsProcessor was used during generation."
            );
          }
          const [resolved_tokens, resolved_token_timestamps] = this.findLongestCommonSequence(previous_tokens, previous_token_timestamps);
          const resolved_text = this.decode(resolved_tokens);
          chunk.text = resolved_text;
          if (returnWordTimestamps) {
            chunk.words = this.collateWordTimestamps(
              resolved_tokens,
              resolved_token_timestamps,
              last_language
            );
          }
          chunks.push(chunk);
        }
        let optional = /* @__PURE__ */ Object.create(null);
        const full_text = chunks.map((chunk2) => chunk2.text).join("");
        if (return_timestamps || return_language) {
          for (let i = 0; i < chunks.length; ++i) {
            const chunk2 = chunks[i];
            if (!return_timestamps) {
              delete chunk2["timestamp"];
            }
            if (!return_language) {
              delete chunk2["language"];
            }
          }
          if (returnWordTimestamps) {
            const new_chunks = [];
            for (const chunk2 of chunks) {
              for (const word of chunk2.words) {
                new_chunks.push(word);
              }
            }
            optional = { "chunks": new_chunks };
          } else {
            optional = { "chunks": chunks };
          }
        }
        return [full_text, optional];
      }
      /**
       * Finds the longest common sequence among the provided sequences.
       * @param {number[][]} sequences An array of sequences of token ids to compare.
       * @returns {number[][]} The longest common sequence found.
       * @throws {Error} If there is a bug within the function.
       * @private
       */
      findLongestCommonSequence(sequences, token_timestamp_sequences = null) {
        let leftSequence = sequences[0];
        let leftLength = leftSequence.length;
        let totalSequence = [];
        const use_token_timestamp_sequences = Array.isArray(token_timestamp_sequences) && token_timestamp_sequences.length > 0;
        let total_token_timestamp_sequence = use_token_timestamp_sequences ? [] : null;
        let left_token_timestamp_sequence = use_token_timestamp_sequences ? token_timestamp_sequences[0] : null;
        for (let i = 1; i < sequences.length; ++i) {
          const rightSequence = sequences[i];
          let max2 = 0;
          let maxIndices = [leftLength, leftLength, 0, 0];
          const rightLength = rightSequence.length;
          for (let j = 1; j < leftLength + rightLength; ++j) {
            const eps = j / 1e4;
            const leftStart2 = Math.max(0, leftLength - j);
            const leftStop2 = Math.min(leftLength, leftLength + rightLength - j);
            const left = leftSequence.slice(leftStart2, leftStop2);
            const rightStart2 = Math.max(0, j - leftLength);
            const rightStop2 = Math.min(rightLength, j);
            const right = rightSequence.slice(rightStart2, rightStop2);
            if (left.length !== right.length) {
              throw new Error("There is a bug within whisper `decode_asr` function, please report it. Dropping to prevent bad inference.");
            }
            const matches = left.filter((elem, idx) => elem === right[idx]).length;
            const matching = matches / j + eps;
            if (matches > 1 && matching > max2) {
              max2 = matching;
              maxIndices = [leftStart2, leftStop2, rightStart2, rightStop2];
            }
          }
          const [leftStart, leftStop, rightStart, rightStop] = maxIndices;
          const leftMid = Math.floor((leftStop + leftStart) / 2);
          const rightMid = Math.floor((rightStop + rightStart) / 2);
          totalSequence.push(...leftSequence.slice(0, leftMid));
          leftSequence = rightSequence.slice(rightMid);
          leftLength = leftSequence.length;
          if (use_token_timestamp_sequences) {
            total_token_timestamp_sequence.push(...left_token_timestamp_sequence.slice(0, leftMid));
            left_token_timestamp_sequence = token_timestamp_sequences[i].slice(rightMid);
          }
        }
        totalSequence.push(...leftSequence);
        if (use_token_timestamp_sequences) {
          total_token_timestamp_sequence.push(...left_token_timestamp_sequence);
          return [totalSequence, total_token_timestamp_sequence];
        } else {
          return [totalSequence, []];
        }
      }
      /** @private */
      collateWordTimestamps(tokens, token_timestamps, language) {
        const [words, _, token_indices] = this.combineTokensIntoWords(tokens, language);
        const timings = [];
        for (let i = 0; i < words.length; ++i) {
          const indices = token_indices[i];
          timings.push({
            text: words[i],
            timestamp: [
              token_timestamps[indices.at(0)][0],
              token_timestamps[indices.at(-1)][1]
            ]
          });
        }
        return timings;
      }
      /**
       * Groups tokens by word. Returns a tuple containing a list of strings with the words,
       * and a list of `token_id` sequences with the tokens making up each word.
       * @param {number[]} tokens 
       * @param {string} [language] 
       * @param {string} prepend_punctionations 
       * @param {string} append_punctuations 
       * 
       * @private
       */
      combineTokensIntoWords(tokens, language, prepend_punctionations = `"'\u201C\xA1\xBF([{-`, append_punctuations = `"'.\u3002,\uFF0C!\uFF01?\uFF1F:\uFF1A\u201D)]}\u3001`) {
        language = language ?? "english";
        let words, word_tokens, token_indices;
        if (["chinese", "japanese", "thai", "lao", "myanmar"].includes(language)) {
          [words, word_tokens, token_indices] = this.splitTokensOnUnicode(tokens);
        } else {
          [words, word_tokens, token_indices] = this.splitTokensOnSpaces(tokens);
        }
        return this.mergePunctuations(words, word_tokens, token_indices, prepend_punctionations, append_punctuations);
      }
      /** @type {PreTrainedTokenizer['decode']} */
      decode(token_ids, decode_args) {
        let text;
        if (decode_args && decode_args.decode_with_timestamps) {
          if (token_ids instanceof Tensor) {
            token_ids = prepareTensorForDecode(token_ids);
          }
          text = this.decodeWithTimestamps(token_ids, decode_args);
        } else {
          text = super.decode(token_ids, decode_args);
        }
        return text;
      }
      /**
       * @param {number[]} token_ids List of token IDs to decode.
       * @param {Object} decode_args Optional arguments for decoding
       * @private
       */
      decodeWithTimestamps(token_ids, decode_args) {
        const time_precision = decode_args?.time_precision ?? 0.02;
        const timestamp_begin = Array.from(this.all_special_ids).at(-1) + 1;
        let outputs = [[]];
        for (const token of token_ids) {
          if (token >= timestamp_begin) {
            const timestamp = round((token - timestamp_begin) * time_precision, 2);
            outputs.push(`<|${timestamp}|>`);
            outputs.push([]);
          } else {
            outputs[outputs.length - 1].push(token);
          }
        }
        outputs = outputs.map(
          (s) => {
            if (typeof s === "string") {
              return s;
            } else {
              return super.decode(s, decode_args);
            }
          }
        );
        return outputs.join("");
      }
      /**
       * Combine tokens into words by splitting at any position where the tokens are decoded as valid unicode points.
       * @param {number[]} tokens 
       * @returns {*}
       * @private
       */
      splitTokensOnUnicode(tokens) {
        const decoded_full = this.decode(tokens, {
          // @ts-ignore
          decode_with_timestamps: true
        });
        const replacement_char = "\uFFFD";
        const words = [];
        const word_tokens = [];
        const token_indices = [];
        let current_tokens = [];
        let current_indices = [];
        let unicode_offset = 0;
        for (let token_idx = 0; token_idx < tokens.length; ++token_idx) {
          const token = tokens[token_idx];
          current_tokens.push(token);
          current_indices.push(token_idx);
          const decoded = this.decode(current_tokens, {
            // @ts-ignore
            decode_with_timestamps: true
          });
          if (!decoded.includes(replacement_char) || decoded_full[unicode_offset + decoded.indexOf(replacement_char)] === replacement_char) {
            words.push(decoded);
            word_tokens.push(current_tokens);
            token_indices.push(current_indices);
            current_tokens = [];
            current_indices = [];
            unicode_offset += decoded.length;
          }
        }
        return [words, word_tokens, token_indices];
      }
      /**
       * Combine tokens into words by splitting at whitespace and punctuation tokens.
       * @param {number[]} tokens 
       * @private
       */
      splitTokensOnSpaces(tokens) {
        const [subwords, subword_tokens_list, subword_indices_list] = this.splitTokensOnUnicode(tokens);
        const words = [];
        const word_tokens = [];
        const token_indices = [];
        const punctuationRegex = new RegExp(`^[${PUNCTUATION_REGEX}]$`, "gu");
        for (let i = 0; i < subwords.length; ++i) {
          const subword = subwords[i];
          const subword_tokens = subword_tokens_list[i];
          const subword_indices = subword_indices_list[i];
          const special = subword_tokens[0] >= this.model.tokens_to_ids.get("<|endoftext|>");
          const with_space = subword.startsWith(" ");
          const trimmed = subword.trim();
          const punctuation = punctuationRegex.test(trimmed);
          if (special || with_space || punctuation || words.length === 0) {
            words.push(subword);
            word_tokens.push(subword_tokens);
            token_indices.push(subword_indices);
          } else {
            const ix = words.length - 1;
            words[ix] += subword;
            word_tokens[ix].push(...subword_tokens);
            token_indices[ix].push(...subword_indices);
          }
        }
        return [words, word_tokens, token_indices];
      }
      /**
       * Merges punctuation tokens with neighboring words.
       * @param {string[]} words 
       * @param {number[][]} tokens 
       * @param {number[][]} indices 
       * @param {string} prepended 
       * @param {string} appended 
       * @private
       */
      mergePunctuations(words, tokens, indices, prepended, appended) {
        const newWords = structuredClone(words);
        const newTokens = structuredClone(tokens);
        const newIndices = structuredClone(indices);
        let i = newWords.length - 2;
        let j = newWords.length - 1;
        while (i >= 0) {
          if (newWords[i].startsWith(" ") && prepended.includes(newWords[i].trim())) {
            newWords[j] = newWords[i] + newWords[j];
            newTokens[j] = mergeArrays(newTokens[i], newTokens[j]);
            newIndices[j] = mergeArrays(newIndices[i], newIndices[j]);
            newWords[i] = "";
            newTokens[i] = [];
            newIndices[i] = [];
          } else {
            j = i;
          }
          --i;
        }
        i = 0;
        j = 1;
        while (j < newWords.length) {
          if (!newWords[i].endsWith(" ") && appended.includes(newWords[j])) {
            newWords[i] += newWords[j];
            newTokens[i] = mergeArrays(newTokens[i], newTokens[j]);
            newIndices[i] = mergeArrays(newIndices[i], newIndices[j]);
            newWords[j] = "";
            newTokens[j] = [];
            newIndices[j] = [];
          } else {
            i = j;
          }
          ++j;
        }
        return [
          newWords.filter((x) => x),
          newTokens.filter((x) => x.length > 0),
          newIndices.filter((x) => x.length > 0)
        ];
      }
      /**
       * Helper function to build translation inputs for a `WhisperTokenizer`,
       * depending on the language, task, and whether to predict timestamp tokens.
       * 
       * Used to override the prefix tokens appended to the start of the label sequence.
       * 
       * **Example: Get ids for a language**
       * ```javascript
       * // instantiate the tokenizer and set the prefix token to Spanish
       * const tokenizer = await WhisperTokenizer.from_pretrained('Xenova/whisper-tiny');
       * const forced_decoder_ids = tokenizer.get_decoder_prompt_ids({ language: 'spanish' });
       * // [(1, 50262), (2, 50363)]
       * ```
       * 
       * @param {Object} options Options to generate the decoder prompt.
       * @param {string} [options.language] The language of the transcription text.
       * The corresponding language id token is appended to the start of the sequence for multilingual
       * speech recognition and speech translation tasks, e.g. for "Spanish" the token "<|es|>" is appended
       * to the start of sequence.
       * @param {string} [options.task] Task identifier to append at the start of sequence (if any).
       * This should be used for mulitlingual fine-tuning, with "transcribe" for speech recognition and
       * "translate" for speech translation.
       * @param {boolean} [options.no_timestamps] Whether to add the <|notimestamps|> token at the start of the sequence.
       * @returns {number[][]} The decoder prompt ids.
       */
      get_decoder_prompt_ids({
        language = null,
        task = null,
        no_timestamps = true
      } = {}) {
        const forced_decoder_ids = [];
        if (language) {
          language = language.toLowerCase();
          let language_code = WHISPER_TO_LANGUAGE_CODE_MAPPING.get(language);
          if (language_code === void 0) {
            if (WHISPER_LANGUAGE_MAPPING.has(language)) {
              language_code = language;
            } else {
              const is_language_code = language.length === 2;
              const langs = is_language_code ? WHISPER_LANGUAGE_MAPPING.keys() : WHISPER_LANGUAGE_MAPPING.values();
              throw new Error(`Language "${language}" is not supported. Must be one of: ${JSON.stringify(langs)}`);
            }
          }
          const language_token_id = this.model.tokens_to_ids.get(`<|${language_code}|>`);
          if (language_token_id === void 0) {
            throw new Error(`Unable to find language "${language_code}" in model vocabulary. Please report this issue at https://github.com/xenova/transformers.js/issues/new/choose.`);
          }
          forced_decoder_ids.push(language_token_id);
        } else {
          forced_decoder_ids.push(null);
        }
        if (task) {
          task = task.toLowerCase();
          if (task !== "transcribe" && task !== "translate") {
            throw new Error(`Task "${task}" is not supported. Must be one of: ["transcribe", "translate"]`);
          }
          const task_token_id = this.model.tokens_to_ids.get(`<|${task}|>`);
          if (task_token_id === void 0) {
            throw new Error(`Unable to find task "${task}" in model vocabulary. Please report this issue at https://github.com/xenova/transformers.js/issues/new/choose.`);
          }
          forced_decoder_ids.push(task_token_id);
        } else {
          forced_decoder_ids.push(null);
        }
        if (no_timestamps) {
          const no_timestamps_id = this.model.tokens_to_ids.get(`<|notimestamps|>`);
          if (no_timestamps_id === void 0) {
            throw new Error('Unable to find "<|notimestamps|>" in model vocabulary. Please report this issue at https://github.com/xenova/transformers.js/issues/new/choose.');
          }
          forced_decoder_ids.push(no_timestamps_id);
        }
        return forced_decoder_ids.map((x, i) => [i + 1, x]).filter((x) => x[1] !== null);
      }
    };
    CodeGenTokenizer = class extends PreTrainedTokenizer {
    };
    CLIPTokenizer = class extends PreTrainedTokenizer {
    };
    SiglipTokenizer = class extends PreTrainedTokenizer {
    };
    MarianTokenizer = class extends PreTrainedTokenizer {
      /**
       * Create a new MarianTokenizer instance.
       * @param {Object} tokenizerJSON The JSON of the tokenizer.
       * @param {Object} tokenizerConfig The config of the tokenizer.
       */
      constructor(tokenizerJSON, tokenizerConfig) {
        super(tokenizerJSON, tokenizerConfig);
        this.languageRegex = /^(>>\w+<<)\s*/g;
        this.supported_language_codes = this.model.vocab.filter(
          (x) => this.languageRegex.test(x)
        );
        console.warn('WARNING: `MarianTokenizer` is not yet supported by Hugging Face\'s "fast" tokenizers library. Therefore, you may experience slightly inaccurate results.');
      }
      /**
       * Encodes a single text. Overriding this method is necessary since the language codes
       * must be removed before encoding with sentencepiece model.
       * @see https://github.com/huggingface/transformers/blob/12d51db243a00726a548a43cc333390ebae731e3/src/transformers/models/marian/tokenization_marian.py#L204-L213
       *
       * @param {string|null} text The text to encode.
       * @returns {Array} The encoded tokens.
       */
      _encode_text(text) {
        if (text === null) return null;
        const [matchInfo, ...remainder] = text.trim().split(this.languageRegex);
        if (remainder.length === 0) {
          return super._encode_text(matchInfo);
        } else if (remainder.length === 2) {
          const [language, text2] = remainder;
          if (!this.supported_language_codes.includes(language)) {
            console.warn(`Unsupported language code "${language}" detected, which may lead to unexpected behavior. Should be one of: ${JSON.stringify(this.supported_language_codes)}`);
          }
          return mergeArrays([language], super._encode_text(text2));
        }
      }
    };
    Wav2Vec2CTCTokenizer = class extends PreTrainedTokenizer {
    };
    BlenderbotTokenizer = class extends PreTrainedTokenizer {
      _default_chat_template = `{% for message in messages %}{% if message['role'] == 'user' %}{{ ' ' }}{% endif %}{{ message['content'] }}{% if not loop.last %}{{ '  ' }}{% endif %}{% endfor %}{{ eos_token }}`;
    };
    BlenderbotSmallTokenizer = class extends BlenderbotTokenizer {
    };
    SpeechT5Tokenizer = class extends PreTrainedTokenizer {
    };
    NougatTokenizer = class extends PreTrainedTokenizer {
    };
    VitsTokenizer = class extends PreTrainedTokenizer {
      constructor(tokenizerJSON, tokenizerConfig) {
        super(tokenizerJSON, tokenizerConfig);
        this.decoder = new VitsDecoder({});
      }
    };
    CohereTokenizer = class extends PreTrainedTokenizer {
    };
    AutoTokenizer = class {
      static TOKENIZER_CLASS_MAPPING = {
        T5Tokenizer,
        DistilBertTokenizer,
        CamembertTokenizer,
        DebertaTokenizer,
        DebertaV2Tokenizer,
        BertTokenizer,
        HerbertTokenizer,
        ConvBertTokenizer,
        RoFormerTokenizer,
        XLMTokenizer,
        ElectraTokenizer,
        MobileBertTokenizer,
        SqueezeBertTokenizer,
        AlbertTokenizer,
        GPT2Tokenizer,
        BartTokenizer,
        MBartTokenizer,
        MBart50Tokenizer,
        RobertaTokenizer,
        WhisperTokenizer,
        CodeGenTokenizer,
        CLIPTokenizer,
        SiglipTokenizer,
        MarianTokenizer,
        BloomTokenizer,
        NllbTokenizer,
        M2M100Tokenizer,
        LlamaTokenizer,
        CodeLlamaTokenizer,
        XLMRobertaTokenizer,
        MPNetTokenizer,
        FalconTokenizer,
        GPTNeoXTokenizer,
        EsmTokenizer,
        Wav2Vec2CTCTokenizer,
        BlenderbotTokenizer,
        BlenderbotSmallTokenizer,
        SpeechT5Tokenizer,
        NougatTokenizer,
        VitsTokenizer,
        Qwen2Tokenizer,
        GemmaTokenizer,
        Grok1Tokenizer,
        CohereTokenizer,
        // Base case:
        PreTrainedTokenizer
      };
      /**
       * Instantiate one of the tokenizer classes of the library from a pretrained model.
       * 
       * The tokenizer class to instantiate is selected based on the `tokenizer_class` property of the config object
       * (either passed as an argument or loaded from `pretrained_model_name_or_path` if possible)
       * 
       * @param {string} pretrained_model_name_or_path The name or path of the pretrained model. Can be either:
       * - A string, the *model id* of a pretrained tokenizer hosted inside a model repo on huggingface.co.
       *   Valid model ids can be located at the root-level, like `bert-base-uncased`, or namespaced under a
       *   user or organization name, like `dbmdz/bert-base-german-cased`.
       * - A path to a *directory* containing tokenizer files, e.g., `./my_model_directory/`.
       * @param {PretrainedTokenizerOptions} options Additional options for loading the tokenizer.
       * 
       * @returns {Promise<PreTrainedTokenizer>} A new instance of the PreTrainedTokenizer class.
       */
      static async from_pretrained(pretrained_model_name_or_path, {
        quantized = true,
        progress_callback = null,
        config = null,
        cache_dir = null,
        local_files_only = false,
        revision = "main",
        legacy = null
      } = {}) {
        const [tokenizerJSON, tokenizerConfig] = await loadTokenizer(pretrained_model_name_or_path, {
          quantized,
          progress_callback,
          config,
          cache_dir,
          local_files_only,
          revision,
          legacy
        });
        const tokenizerName = tokenizerConfig.tokenizer_class?.replace(/Fast$/, "") ?? "PreTrainedTokenizer";
        let cls = this.TOKENIZER_CLASS_MAPPING[tokenizerName];
        if (!cls) {
          console.warn(`Unknown tokenizer class "${tokenizerName}", attempting to construct from base class.`);
          cls = PreTrainedTokenizer;
        }
        return new cls(tokenizerJSON, tokenizerConfig);
      }
    };
  }
});

// node_modules/@xenova/transformers/src/configs.js
async function loadConfig(pretrained_model_name_or_path, options) {
  let info = await getModelJSON(pretrained_model_name_or_path, "config.json", true, options);
  return info;
}
var PretrainedConfig, AutoConfig;
var init_configs = __esm({
  "node_modules/@xenova/transformers/src/configs.js"() {
    init_hub();
    PretrainedConfig = class {
      // NOTE: Typo in original
      /**
       * Create a new PreTrainedTokenizer instance.
       * @param {Object} configJSON The JSON of the config.
       */
      constructor(configJSON) {
        this.model_type = null;
        this.is_encoder_decoder = false;
        Object.assign(this, configJSON);
      }
      /**
       * Loads a pre-trained config from the given `pretrained_model_name_or_path`. 
       * 
       * @param {string} pretrained_model_name_or_path The path to the pre-trained config.
       * @param {PretrainedOptions} options Additional options for loading the config.
       * @throws {Error} Throws an error if the config.json is not found in the `pretrained_model_name_or_path`.
       * 
       * @returns {Promise<PretrainedConfig>} A new instance of the `PretrainedConfig` class.
       */
      static async from_pretrained(pretrained_model_name_or_path, {
        progress_callback = null,
        config = null,
        cache_dir = null,
        local_files_only = false,
        revision = "main"
      } = {}) {
        let data = config ?? await loadConfig(pretrained_model_name_or_path, {
          progress_callback,
          config,
          cache_dir,
          local_files_only,
          revision
        });
        return new this(data);
      }
    };
    AutoConfig = class {
      /** @type {PretrainedConfig.from_pretrained} */
      static async from_pretrained(...args) {
        return PretrainedConfig.from_pretrained(...args);
      }
    };
  }
});

// node_modules/@xenova/transformers/src/utils/generation.js
var LogitsProcessorList, LogitsProcessor, ForceTokensLogitsProcessor, ForcedBOSTokenLogitsProcessor, ForcedEOSTokenLogitsProcessor, SuppressTokensAtBeginLogitsProcessor, WhisperTimeStampLogitsProcessor, NoRepeatNGramLogitsProcessor, RepetitionPenaltyLogitsProcessor, MinLengthLogitsProcessor, MinNewTokensLengthLogitsProcessor, NoBadWordsLogitsProcessor, GenerationConfig, Sampler, GreedySampler, MultinomialSampler, BeamSearchSampler;
var init_generation = __esm({
  "node_modules/@xenova/transformers/src/utils/generation.js"() {
    init_tensor();
    init_core();
    init_maths();
    LogitsProcessorList = class extends Callable {
      /**
       * Constructs a new instance of `LogitsProcessorList`.
       */
      constructor() {
        super();
        this.processors = [];
      }
      /**
       * Adds a new logits processor to the list.
       *
       * @param {LogitsProcessor} item The logits processor function to add.
       */
      push(item) {
        this.processors.push(item);
      }
      /**
       * Adds multiple logits processors to the list.
       *
       * @param {LogitsProcessor[]} items The logits processor functions to add.
       */
      extend(items) {
        this.processors.push(...items);
      }
      /**
       * Applies all logits processors in the list to a batch of logits, modifying them in-place.
       *
       * @param {number[]} input_ids The input IDs for the language model.
       * @param {number[][]} batchedLogits A 2D array of logits, where each row corresponds to a single
       *                                                input sequence in the batch.
       */
      _call(input_ids, batchedLogits) {
        for (let logits of batchedLogits) {
          this.processors.forEach(
            (func) => func(input_ids, logits)
          );
        }
      }
      [Symbol.iterator]() {
        return this.processors.values();
      }
    };
    LogitsProcessor = class extends Callable {
      /**
       * Apply the processor to the input logits.
       *
       * @abstract
       * @param {Array} input_ids The input ids.
       * @param {Tensor} logits The logits to process.
       * @throws {Error} Throws an error if `_call` is not implemented in the subclass.
       */
      _call(input_ids, logits) {
        throw Error("`_call` should be implemented in a subclass");
      }
    };
    ForceTokensLogitsProcessor = class extends LogitsProcessor {
      /**
       * Constructs a new instance of `ForceTokensLogitsProcessor`.
       * 
       * @param {Array} forced_decoder_ids The ids of tokens that should be forced.
       */
      constructor(forced_decoder_ids) {
        super();
        this.force_token_map = Object.fromEntries(forced_decoder_ids ?? []);
      }
      /**
       * Apply the processor to the input logits.
       *
       * @param {Array} input_ids The input ids.
       * @param {Tensor} logits The logits to process.
       * @returns {Tensor} The processed logits.
       */
      _call(input_ids, logits) {
        let map = this.force_token_map[input_ids.length];
        if (exists(map)) {
          logits.data.fill(-Infinity);
          logits.data[map] = 0;
        }
        return logits;
      }
    };
    ForcedBOSTokenLogitsProcessor = class extends LogitsProcessor {
      /**
       * Create a ForcedBOSTokenLogitsProcessor.
       * @param {number} bos_token_id The ID of the beginning-of-sequence token to be forced.
       */
      constructor(bos_token_id) {
        super();
        this.bos_token_id = bos_token_id;
      }
      /**
       * Apply the BOS token forcing to the logits.
       * @param {Array} input_ids The input IDs.
       * @param {Object} logits The logits.
       * @returns {Object} The logits with BOS token forcing.
       */
      _call(input_ids, logits) {
        if (input_ids.length === 1) {
          logits.data.fill(-Infinity);
          logits.data[this.bos_token_id] = 0;
        }
        return logits;
      }
    };
    ForcedEOSTokenLogitsProcessor = class extends LogitsProcessor {
      /**
       * Create a ForcedEOSTokenLogitsProcessor.
       * @param {number} max_length Max length of the sequence.
       * @param {number|number[]} forced_eos_token_id The ID of the end-of-sequence token to be forced.
       */
      constructor(max_length, forced_eos_token_id) {
        super();
        this.max_length = max_length;
        this.forced_eos_token_id = forced_eos_token_id;
      }
      /**
       * Apply the processor to input_ids and logits.
       * 
       * @param {number[]} input_ids The input ids.
       * @param {Tensor} logits The logits tensor.
       */
      _call(input_ids, logits) {
      }
    };
    SuppressTokensAtBeginLogitsProcessor = class extends LogitsProcessor {
      /**
       * Create a SuppressTokensAtBeginLogitsProcessor.
       * @param {number[]} begin_suppress_tokens The IDs of the tokens to suppress.
       * @param {number} begin_index The number of tokens to generate before suppressing tokens.
       */
      constructor(begin_suppress_tokens, begin_index) {
        super();
        this.begin_suppress_tokens = begin_suppress_tokens;
        this.begin_index = begin_index;
      }
      /**
       * Apply the BOS token forcing to the logits.
       * @param {Array} input_ids The input IDs.
       * @param {Object} logits The logits.
       * @returns {Object} The logits with BOS token forcing.
       */
      _call(input_ids, logits) {
        if (input_ids.length === this.begin_index) {
          for (let token_id of this.begin_suppress_tokens) {
            logits.data[token_id] = -Infinity;
          }
        }
        return logits;
      }
    };
    WhisperTimeStampLogitsProcessor = class extends LogitsProcessor {
      /**
       * Constructs a new WhisperTimeStampLogitsProcessor.
       * @param {Object} generate_config The config object passed to the `generate()` method of a transformer model.
       * @param {number} generate_config.eos_token_id The ID of the end-of-sequence token.
       * @param {number} generate_config.no_timestamps_token_id The ID of the token used to indicate that a token should not have a timestamp.
       * @param {number[][]} [generate_config.forced_decoder_ids] An array of two-element arrays representing decoder IDs that are forced to appear in the output. The second element of each array indicates whether the token is a timestamp.
       * @param {number} [generate_config.max_initial_timestamp_index] The maximum index at which an initial timestamp can appear.
       */
      constructor(generate_config) {
        super();
        this.eos_token_id = generate_config.eos_token_id;
        this.no_timestamps_token_id = generate_config.no_timestamps_token_id;
        this.timestamp_begin = this.no_timestamps_token_id + 1;
        this.begin_index = (generate_config.forced_decoder_ids || []).length + 2;
        if (generate_config.forced_decoder_ids.slice(-1)[0][1] === this.no_timestamps_token_id) {
          this.begin_index -= 1;
        }
        this.max_initial_timestamp_index = generate_config.max_initial_timestamp_index;
      }
      /**
       * Modify the logits to handle timestamp tokens.
       * @param {Array} input_ids The input sequence of tokens.
       * @param {Tensor} logits The logits output by the model.
       * @returns {Tensor} The modified logits.
       */
      _call(input_ids, logits) {
        const logitsData = (
          /** @type {Float32Array} */
          logits.data
        );
        logitsData[this.no_timestamps_token_id] = -Infinity;
        if (input_ids.length === this.begin_index - 1) {
          logitsData.fill(-Infinity);
          logitsData[this.timestamp_begin] = 0;
          return logits;
        }
        const seq = input_ids.slice(this.begin_index);
        const last_was_timestamp = seq.length >= 1 && seq[seq.length - 1] >= this.timestamp_begin;
        const penultimate_was_timestamp = seq.length < 2 || seq[seq.length - 2] >= this.timestamp_begin;
        if (last_was_timestamp) {
          if (penultimate_was_timestamp) {
            logitsData.subarray(this.timestamp_begin).fill(-Infinity);
          } else {
            logitsData.subarray(0, this.eos_token_id).fill(-Infinity);
          }
        }
        if (input_ids.length === this.begin_index && this.max_initial_timestamp_index !== null) {
          const last_allowed = this.timestamp_begin + this.max_initial_timestamp_index;
          logitsData.subarray(last_allowed + 1).fill(-Infinity);
        }
        const logprobs = log_softmax(logitsData);
        const timestamp_logprob = Math.log(logprobs.subarray(this.timestamp_begin).map(Math.exp).reduce((a, b) => a + b));
        const max_text_token_logprob = max(logprobs.subarray(0, this.timestamp_begin))[0];
        if (timestamp_logprob > max_text_token_logprob) {
          logitsData.subarray(0, this.timestamp_begin).fill(-Infinity);
        }
        return logits;
      }
    };
    NoRepeatNGramLogitsProcessor = class extends LogitsProcessor {
      /**
       * Create a NoRepeatNGramLogitsProcessor.
       * @param {number} no_repeat_ngram_size The no-repeat-ngram size. All ngrams of this size can only occur once.
       */
      constructor(no_repeat_ngram_size) {
        super();
        this.no_repeat_ngram_size = no_repeat_ngram_size;
      }
      /**
       * Generate n-grams from a sequence of token ids.
       * @param {number[]} prevInputIds List of previous input ids
       * @returns {Map<string, number[]>} Map of generated n-grams
       */
      getNgrams(prevInputIds) {
        const curLen = prevInputIds.length;
        const ngrams = [];
        for (let j = 0; j < curLen + 1 - this.no_repeat_ngram_size; ++j) {
          const ngram = [];
          for (let k = 0; k < this.no_repeat_ngram_size; ++k) {
            ngram.push(prevInputIds[j + k]);
          }
          ngrams.push(ngram);
        }
        const generatedNgram = /* @__PURE__ */ new Map();
        for (const ngram of ngrams) {
          const prevNgram = ngram.slice(0, ngram.length - 1);
          const prevNgramKey = JSON.stringify(prevNgram);
          const prevNgramValue = generatedNgram.get(prevNgramKey) ?? [];
          prevNgramValue.push(ngram[ngram.length - 1]);
          generatedNgram.set(prevNgramKey, prevNgramValue);
        }
        return generatedNgram;
      }
      /**
       * Generate n-grams from a sequence of token ids.
       * @param {Map<string, number[]>} bannedNgrams Map of banned n-grams
       * @param {number[]} prevInputIds List of previous input ids
       * @returns {number[]} Map of generated n-grams
       */
      getGeneratedNgrams(bannedNgrams, prevInputIds) {
        const ngramIdx = prevInputIds.slice(prevInputIds.length + 1 - this.no_repeat_ngram_size, prevInputIds.length);
        const banned = bannedNgrams.get(JSON.stringify(ngramIdx)) ?? [];
        return banned;
      }
      /**
       * Calculate banned n-gram tokens
       * @param {number[]} prevInputIds List of previous input ids
       * @returns {number[]} Map of generated n-grams
       */
      calcBannedNgramTokens(prevInputIds) {
        const bannedTokens = [];
        if (prevInputIds.length + 1 < this.no_repeat_ngram_size) {
          return bannedTokens;
        } else {
          const generatedNgrams = this.getNgrams(prevInputIds);
          const bannedTokens2 = this.getGeneratedNgrams(generatedNgrams, prevInputIds);
          return bannedTokens2;
        }
      }
      /**
       * Apply the no-repeat-ngram processor to the logits.
       * @param {Array} input_ids The input IDs.
       * @param {Object} logits The logits.
       * @returns {Object} The logits with no-repeat-ngram processing.
       */
      _call(input_ids, logits) {
        const bannedTokens = this.calcBannedNgramTokens(input_ids);
        for (const token of bannedTokens) {
          logits.data[token] = -Infinity;
        }
        return logits;
      }
    };
    RepetitionPenaltyLogitsProcessor = class extends LogitsProcessor {
      /**
       * Create a RepetitionPenaltyLogitsProcessor.
       * @param {number} penalty The penalty to apply for repeated tokens.
       */
      constructor(penalty) {
        super();
        this.penalty = penalty;
      }
      /**
       * Apply the repetition penalty to the logits.
       * @param {Array} input_ids The input IDs.
       * @param {Object} logits The logits.
       * @returns {Object} The logits with repetition penalty processing.
       */
      _call(input_ids, logits) {
        for (const input_id of input_ids) {
          if (logits.data[input_id] < 0) {
            logits.data[input_id] *= this.penalty;
          } else {
            logits.data[input_id] /= this.penalty;
          }
        }
        return logits;
      }
    };
    MinLengthLogitsProcessor = class extends LogitsProcessor {
      /**
       * Create a MinLengthLogitsProcessor.
       * @param {number} min_length The minimum length below which the score of `eos_token_id` is set to negative infinity.
       * @param {number|number[]} eos_token_id The ID/IDs of the end-of-sequence token.
       */
      constructor(min_length, eos_token_id) {
        super();
        this.min_length = min_length;
        this.eos_token_id = Array.isArray(eos_token_id) ? eos_token_id : [eos_token_id];
      }
      /**
       * Apply logit processor.
       * @param {Array} input_ids The input IDs.
       * @param {Object} logits The logits.
       * @returns {Object} The processed logits.
       */
      _call(input_ids, logits) {
        if (input_ids.length < this.min_length) {
          for (const eos_token of this.eos_token_id) {
            logits.data[eos_token] = -Infinity;
          }
        }
        return logits;
      }
    };
    MinNewTokensLengthLogitsProcessor = class extends LogitsProcessor {
      /**
       * Create a MinNewTokensLengthLogitsProcessor.
       * @param {number} prompt_length_to_skip The input tokens length.
       * @param {number} min_new_tokens The minimum *new* tokens length below which the score of `eos_token_id` is set to negative infinity.
       * @param {number|number[]} eos_token_id The ID/IDs of the end-of-sequence token.
       */
      constructor(prompt_length_to_skip, min_new_tokens, eos_token_id) {
        super();
        this.prompt_length_to_skip = prompt_length_to_skip;
        this.min_new_tokens = min_new_tokens;
        this.eos_token_id = Array.isArray(eos_token_id) ? eos_token_id : [eos_token_id];
      }
      /**
       * Apply logit processor.
       * @param {Array} input_ids The input IDs.
       * @param {Object} logits The logits.
       * @returns {Object} The processed logits.
       */
      _call(input_ids, logits) {
        const new_tokens_length = input_ids.length - this.prompt_length_to_skip;
        if (new_tokens_length < this.min_new_tokens) {
          for (const eos_token of this.eos_token_id) {
            logits.data[eos_token] = -Infinity;
          }
        }
        return logits;
      }
    };
    NoBadWordsLogitsProcessor = class extends LogitsProcessor {
      /**
       * Create a `NoBadWordsLogitsProcessor`.
       * @param {number[][]} bad_words_ids List of list of token ids that are not allowed to be generated.
       * @param {number|number[]} eos_token_id The id of the *end-of-sequence* token. Optionally, use a list to set multiple *end-of-sequence* tokens.
       */
      constructor(bad_words_ids, eos_token_id) {
        super();
        this.bad_words_ids = bad_words_ids;
        this.eos_token_id = Array.isArray(eos_token_id) ? eos_token_id : [eos_token_id];
      }
      /**
       * Apply logit processor.
       * @param {Array} input_ids The input IDs.
       * @param {Object} logits The logits.
       * @returns {Object} The processed logits.
       */
      _call(input_ids, logits) {
        for (const bad_word_ids of this.bad_words_ids) {
          let mark = true;
          for (let i = 1; i <= bad_word_ids.length - 1 && bad_word_ids.length < input_ids.length; ++i) {
            if (bad_word_ids.at(-i - 1) !== input_ids.at(-i)) {
              mark = false;
              break;
            }
          }
          if (mark) {
            logits.data[bad_word_ids.at(-1)] = -Infinity;
          }
        }
        return logits;
      }
    };
    GenerationConfig = /** @type {any} */
    class {
      /**
       * Create a new GenerationConfig object.
       * @param {GenerationConfigType} kwargs 
       */
      constructor(kwargs = {}) {
        this.max_length = kwargs.max_length ?? 20;
        this.max_new_tokens = kwargs.max_new_tokens ?? null;
        this.min_length = kwargs.min_length ?? 0;
        this.min_new_tokens = kwargs.min_new_tokens ?? null;
        this.early_stopping = kwargs.early_stopping ?? false;
        this.max_time = kwargs.max_time ?? null;
        this.do_sample = kwargs.do_sample ?? false;
        this.num_beams = kwargs.num_beams ?? 1;
        this.num_beam_groups = kwargs.num_beam_groups ?? 1;
        this.penalty_alpha = kwargs.penalty_alpha ?? null;
        this.use_cache = kwargs.use_cache ?? true;
        this.temperature = kwargs.temperature ?? 1;
        this.top_k = kwargs.top_k ?? 50;
        this.top_p = kwargs.top_p ?? 1;
        this.typical_p = kwargs.typical_p ?? 1;
        this.epsilon_cutoff = kwargs.epsilon_cutoff ?? 0;
        this.eta_cutoff = kwargs.eta_cutoff ?? 0;
        this.diversity_penalty = kwargs.diversity_penalty ?? 0;
        this.repetition_penalty = kwargs.repetition_penalty ?? 1;
        this.encoder_repetition_penalty = kwargs.encoder_repetition_penalty ?? 1;
        this.length_penalty = kwargs.length_penalty ?? 1;
        this.no_repeat_ngram_size = kwargs.no_repeat_ngram_size ?? 0;
        this.bad_words_ids = kwargs.bad_words_ids ?? null;
        this.force_words_ids = kwargs.force_words_ids ?? null;
        this.renormalize_logits = kwargs.renormalize_logits ?? false;
        this.constraints = kwargs.constraints ?? null;
        this.forced_bos_token_id = kwargs.forced_bos_token_id ?? null;
        this.forced_eos_token_id = kwargs.forced_eos_token_id ?? null;
        this.remove_invalid_values = kwargs.remove_invalid_values ?? false;
        this.exponential_decay_length_penalty = kwargs.exponential_decay_length_penalty ?? null;
        this.suppress_tokens = kwargs.suppress_tokens ?? null;
        this.begin_suppress_tokens = kwargs.begin_suppress_tokens ?? null;
        this.forced_decoder_ids = kwargs.forced_decoder_ids ?? null;
        this.num_return_sequences = kwargs.num_return_sequences ?? 1;
        this.output_attentions = kwargs.output_attentions ?? false;
        this.output_hidden_states = kwargs.output_hidden_states ?? false;
        this.output_scores = kwargs.output_scores ?? false;
        this.return_dict_in_generate = kwargs.return_dict_in_generate ?? false;
        this.pad_token_id = kwargs.pad_token_id ?? null;
        this.bos_token_id = kwargs.bos_token_id ?? null;
        this.eos_token_id = kwargs.eos_token_id ?? null;
        this.encoder_no_repeat_ngram_size = kwargs.encoder_no_repeat_ngram_size ?? 0;
        this.decoder_start_token_id = kwargs.decoder_start_token_id ?? null;
        this.generation_kwargs = kwargs.generation_kwargs ?? {};
      }
    };
    Sampler = class extends Callable {
      /**
       * Creates a new Sampler object with the specified generation config.
       * @param {GenerationConfigType} generation_config The generation config.
       */
      constructor(generation_config) {
        super();
        this.generation_config = generation_config;
      }
      /**
       * Executes the sampler, using the specified logits.
       * @param {Tensor} logits
       * @param {number} index
       * @returns {void}
       */
      _call(logits, index = -1) {
        return this.sample(logits, index);
      }
      /**
       * Abstract method for sampling the logits.
       * @param {Tensor} logits
       * @param {number} index
       * @throws {Error}
       */
      sample(logits, index) {
        throw Error("sample should be implemented in subclasses.");
      }
      /**
       * Returns the specified logits as an array, with temperature applied.
       * @param {Tensor} logits
       * @param {number} index
       * @returns {Float32Array}
       */
      getLogits(logits, index) {
        let vocabSize = logits.dims.at(-1);
        let logs = (
          /** @type {Float32Array} */
          logits.data
        );
        if (index === -1) {
          logs = logs.slice(-vocabSize);
        } else {
          let startIndex = index * vocabSize;
          logs = logs.slice(startIndex, startIndex + vocabSize);
        }
        if (this.generation_config.temperature > 0) {
          logs = logs.map((x) => x / this.generation_config.temperature);
        }
        return logs;
      }
      /**
       * Selects an item randomly based on the specified probabilities.
       * @param {Array} probabilities An array of probabilities to use for selection.
       * @returns {number} The index of the selected item.
       */
      randomSelect(probabilities) {
        let sumProbabilities = probabilities.reduce((acc, curr) => acc + curr, 0);
        let r = Math.random() * sumProbabilities;
        for (let i = 0; i < probabilities.length; ++i) {
          r -= probabilities[i];
          if (r <= 0) {
            return i;
          }
        }
        return 0;
      }
      /**
       * Returns a Sampler object based on the specified options.
       * @param {GenerationConfigType} generation_config An object containing options for the sampler.
       * @returns {Sampler} A Sampler object.
       */
      static getSampler(generation_config) {
        if (generation_config.do_sample) {
          return new MultinomialSampler(generation_config);
        } else if (generation_config.num_beams > 1) {
          return new BeamSearchSampler(generation_config);
        } else {
          if (generation_config.num_return_sequences > 1) {
            throw Error(`num_return_sequences has to be 1 when doing greedy search, but is ${generation_config.num_return_sequences}.`);
          }
          return new GreedySampler(generation_config);
        }
      }
    };
    GreedySampler = class extends Sampler {
      /**
       * Sample the maximum probability of a given logits tensor.
       * @param {Tensor} logits
       * @param {number} [index=-1]
       * @returns {Array} An array with a single tuple, containing the index of the maximum value and a meaningless score (since this is a greedy search).
       */
      sample(logits, index = -1) {
        let logs = this.getLogits(logits, index);
        let argmax = max(logs)[1];
        return [
          [argmax, 0]
        ];
      }
    };
    MultinomialSampler = class extends Sampler {
      /**
       * Sample from the logits.
       * @param {Tensor} logits
       * @param {number} index
       * @returns {Array}
       */
      sample(logits, index = -1) {
        let k = logits.dims.at(-1);
        if (this.generation_config.top_k > 0) {
          k = Math.min(this.generation_config.top_k, k);
        }
        const logs = this.getLogits(logits, index);
        const topLogits = getTopItems(logs, k);
        const probabilities = softmax(topLogits.map((x) => x[1]));
        return Array.from({ length: this.generation_config.num_beams }, () => {
          const sampledIndex = this.randomSelect(probabilities);
          return [
            topLogits[sampledIndex][0],
            // token id
            Math.log(probabilities[sampledIndex])
            // score
          ];
        });
      }
    };
    BeamSearchSampler = class extends Sampler {
      /**
       * Sample from the logits.
       * @param {Tensor} logits
       * @param {number} index
       * @returns {Array}
       */
      sample(logits, index = -1) {
        let k = logits.dims.at(-1);
        if (this.generation_config.top_k > 0) {
          k = Math.min(this.generation_config.top_k, k);
        }
        const logs = this.getLogits(logits, index);
        const topLogits = getTopItems(logs, k);
        const probabilities = softmax(topLogits.map((x) => x[1]));
        return Array.from({ length: this.generation_config.num_beams }, (_, i) => {
          return [
            topLogits[i][0],
            // token id
            Math.log(probabilities[i])
            // score
          ];
        });
      }
    };
  }
});

// node_modules/@xenova/transformers/src/models.js
async function constructSession(pretrained_model_name_or_path, fileName, options) {
  let modelFileName = `onnx/${fileName}${options.quantized ? "_quantized" : ""}.onnx`;
  let buffer = await getModelFile(pretrained_model_name_or_path, modelFileName, true, options);
  try {
    return await InferenceSession.create(buffer, {
      executionProviders
    });
  } catch (err) {
    if (executionProviders.length === 1 && executionProviders[0] === "wasm") {
      throw err;
    }
    console.warn(err);
    console.warn(
      "Something went wrong during model construction (most likely a missing operation). Using `wasm` as a fallback. "
    );
    return await InferenceSession.create(buffer, {
      executionProviders: ["wasm"]
    });
  }
}
function validateInputs(session, inputs) {
  const checkedInputs = /* @__PURE__ */ Object.create(null);
  const missingInputs = [];
  for (const inputName of session.inputNames) {
    const tensor = inputs[inputName];
    if (!(tensor instanceof Tensor)) {
      missingInputs.push(inputName);
      continue;
    }
    checkedInputs[inputName] = env2.wasm.proxy ? tensor.clone() : tensor;
  }
  if (missingInputs.length > 0) {
    throw new Error(
      `An error occurred during model execution: "Missing the following inputs: ${missingInputs.join(", ")}.`
    );
  }
  const numInputsProvided = Object.keys(inputs).length;
  const numInputsNeeded = session.inputNames.length;
  if (numInputsProvided > numInputsNeeded) {
    let ignored = Object.keys(inputs).filter((inputName) => !session.inputNames.includes(inputName));
    console.warn(`WARNING: Too many inputs were provided (${numInputsProvided} > ${numInputsNeeded}). The following inputs will be ignored: "${ignored.join(", ")}".`);
  }
  return checkedInputs;
}
async function sessionRun(session, inputs) {
  const checkedInputs = validateInputs(session, inputs);
  try {
    let output = await session.run(checkedInputs);
    output = replaceTensors(output);
    return output;
  } catch (e) {
    console.error(`An error occurred during model execution: "${e}".`);
    console.error("Inputs given to model:", checkedInputs);
    throw e;
  }
}
function replaceTensors(obj) {
  for (let prop in obj) {
    if (obj[prop] instanceof ONNXTensor2) {
      obj[prop] = new Tensor(obj[prop]);
    } else if (typeof obj[prop] === "object") {
      replaceTensors(obj[prop]);
    }
  }
  return obj;
}
function toI64Tensor(items) {
  if (items instanceof Tensor) {
    return items;
  }
  if (items.length === 0) {
    throw Error("items must be non-empty");
  }
  if (Array.isArray(items[0])) {
    if (items.some((x) => x.length !== items[0].length)) {
      throw Error("Unable to create tensor, you should probably activate truncation and/or padding with 'padding=True' and/or 'truncation=True' to have batched tensors with the same length.");
    }
    return new Tensor(
      "int64",
      BigInt64Array.from(items.flat().map((x) => BigInt(x))),
      [items.length, items[0].length]
    );
  } else {
    return new Tensor(
      "int64",
      BigInt64Array.from(items.map((x) => BigInt(x))),
      [1, items.length]
    );
  }
}
function prepareAttentionMask(self2, tokens) {
  let pad_token_id = self2.config.pad_token_id ?? null;
  let eos_token_id = self2.config.eos_token_id ?? null;
  if (isIntegralNumber(eos_token_id)) {
    eos_token_id = [eos_token_id];
  }
  let is_pad_token_in_inputs = tokens.indexOf(pad_token_id) !== -1;
  let is_pad_token_not_equal_to_eos_token_id = eos_token_id === null || !eos_token_id.includes(pad_token_id);
  if (is_pad_token_in_inputs && is_pad_token_not_equal_to_eos_token_id) {
    let data = BigInt64Array.from(
      // Note: != so that int matches bigint
      // @ts-ignore
      tokens.data.map((x) => x != pad_token_id)
    );
    return new Tensor("int64", data, tokens.dims);
  } else {
    return ones_like(tokens);
  }
}
function preparePositionIds(session, feeds, use_cache_branch) {
  if (!session.inputNames.includes("position_ids")) return;
  const data = new BigInt64Array(feeds.attention_mask.data.length);
  for (let i = 0; i < feeds.attention_mask.dims[0]; ++i) {
    let start = i * feeds.attention_mask.dims[1];
    let sum = BigInt(0);
    for (let j = 0; j < feeds.attention_mask.dims[1]; ++j) {
      const index = start + j;
      if (feeds.attention_mask.data[index] === 0n) {
        data[index] = BigInt(1);
      } else {
        data[index] = sum;
        sum += feeds.attention_mask.data[index];
      }
    }
  }
  feeds.position_ids = new Tensor("int64", data, feeds.attention_mask.dims);
  if (use_cache_branch) {
    feeds.position_ids = feeds.position_ids.slice(null, -1).unsqueeze_(-1);
  }
}
function boolTensor(value) {
  return new Tensor("bool", [value], [1]);
}
async function seq2seqForward(self2, model_inputs) {
  let { encoder_outputs, past_key_values } = model_inputs;
  if (!encoder_outputs) {
    encoder_outputs = (await encoderForward(self2, model_inputs)).last_hidden_state;
  }
  let decoderFeeds = {
    input_ids: model_inputs.decoder_input_ids,
    encoder_hidden_states: encoder_outputs
  };
  const use_cache_branch = !!past_key_values;
  if (self2.decoder_merged_session.inputNames.includes("use_cache_branch")) {
    decoderFeeds.use_cache_branch = boolTensor(use_cache_branch);
  }
  if (self2.decoder_merged_session.inputNames.includes("encoder_attention_mask")) {
    decoderFeeds.encoder_attention_mask = model_inputs.attention_mask;
  }
  preparePositionIds(self2.decoder_merged_session, decoderFeeds, use_cache_branch);
  self2.addPastKeyValues(decoderFeeds, past_key_values);
  const decoderResults = await sessionRun(self2.decoder_merged_session, decoderFeeds);
  let logits = decoderResults.logits;
  past_key_values = self2.getPastKeyValues(decoderResults, past_key_values);
  const attns = self2.getAttentions(decoderResults);
  return new Seq2SeqLMOutput({ logits, past_key_values, encoder_outputs, ...attns });
}
function seq2seqStartBeams(self2, inputTokenIds, generation_config, numOutputTokens) {
  let beams = [];
  let beamId = 0;
  const requires_attention_mask = self2.requires_attention_mask ?? true;
  let decoder_input_ids = generation_config.decoder_input_ids ?? generation_config.decoder_start_token_id ?? generation_config.bos_token_id ?? generation_config.eos_token_id;
  if (decoder_input_ids instanceof Tensor) {
    decoder_input_ids = decoder_input_ids.tolist().flat();
  } else if (!Array.isArray(decoder_input_ids)) {
    decoder_input_ids = [decoder_input_ids];
  }
  for (let tokens of inputTokenIds) {
    tokens.dims = [1, ...tokens.dims];
    let start = {
      inputs: tokens,
      encoder_outputs: null,
      prev_model_outputs: null,
      output_token_ids: decoder_input_ids,
      done: false,
      score: 0,
      id: beamId++
      // assign unique id to beams
    };
    if (requires_attention_mask) {
      start.attention_mask = prepareAttentionMask(self2, tokens);
    }
    beams.push(start);
  }
  return beams;
}
async function seq2seqRunBeam(self2, beam) {
  const input_name = self2.main_input_name;
  let decoder_input_ids = beam.output_token_ids;
  if (beam.prev_model_outputs) {
    decoder_input_ids = decoder_input_ids.slice(-1);
  }
  let model_inputs = {
    [input_name]: beam.inputs,
    decoder_input_ids: toI64Tensor(decoder_input_ids),
    encoder_outputs: beam.encoder_outputs,
    past_key_values: beam.prev_model_outputs?.past_key_values
  };
  if (beam.attention_mask) {
    model_inputs.attention_mask = beam.attention_mask;
  }
  let output = await self2.forward(model_inputs);
  beam.prev_model_outputs = output;
  beam.encoder_outputs = output.encoder_outputs;
  return output;
}
function seq2seqUpdatebeam(beam, newTokenId) {
  beam.output_token_ids = [...beam.output_token_ids, newTokenId];
}
async function encoderForward(self2, model_inputs) {
  const encoderFeeds = /* @__PURE__ */ Object.create(null);
  for (const key of self2.session.inputNames) {
    encoderFeeds[key] = model_inputs[key];
  }
  if (self2.session.inputNames.includes("token_type_ids") && !encoderFeeds.token_type_ids) {
    encoderFeeds.token_type_ids = new Tensor(
      "int64",
      new BigInt64Array(encoderFeeds.input_ids.data.length),
      encoderFeeds.input_ids.dims
    );
  }
  return await sessionRun(self2.session, encoderFeeds);
}
async function decoderForward(self2, model_inputs) {
  let { input_ids, past_key_values, attention_mask } = model_inputs;
  let decoderFeeds = {
    input_ids,
    attention_mask: attention_mask ?? prepareAttentionMask(self2, input_ids)
  };
  const use_cache_branch = !!past_key_values;
  if (self2.session.inputNames.includes("use_cache_branch")) {
    decoderFeeds.use_cache_branch = boolTensor(use_cache_branch);
  }
  preparePositionIds(self2.session, decoderFeeds, use_cache_branch);
  self2.addPastKeyValues(decoderFeeds, past_key_values);
  let decoderResults = await sessionRun(self2.session, decoderFeeds);
  let logits = decoderResults.logits;
  past_key_values = self2.getPastKeyValues(decoderResults, past_key_values);
  return { logits, past_key_values };
}
function decoderStartBeams(self2, inputTokenIds, generation_config, numOutputTokens, inputs_attention_mask) {
  let beams = [];
  let beamId = 0;
  for (let tokens of inputTokenIds) {
    let output_token_ids = tokens.tolist().map(Number);
    tokens.dims = [1, ...tokens.dims];
    let attn_mask;
    if (inputs_attention_mask) {
      attn_mask = inputs_attention_mask[beamId];
      attn_mask.dims = [1, ...attn_mask.dims];
    } else {
      attn_mask = prepareAttentionMask(self2, tokens);
    }
    let start = {
      input: tokens,
      model_input_ids: tokens,
      attention_mask: attn_mask,
      prev_model_outputs: null,
      output_token_ids,
      num_output_tokens: numOutputTokens,
      done: false,
      score: 0,
      id: beamId++
      // assign unique id to beams
    };
    beams.push(start);
  }
  return beams;
}
async function decoderRunBeam(self2, beam) {
  let attnMaskData = new BigInt64Array(beam.output_token_ids.length).fill(1n);
  let model_inputs = {
    input_ids: beam.model_input_ids,
    attention_mask: new Tensor(
      "int64",
      attnMaskData,
      [1, attnMaskData.length]
    ),
    past_key_values: beam.prev_model_outputs?.past_key_values
  };
  let output = await self2.forward(model_inputs);
  beam.prev_model_outputs = output;
  return output;
}
function decoderUpdatebeam(beam, newTokenId) {
  beam.output_token_ids = [...beam.output_token_ids, newTokenId];
  beam.model_input_ids = new Tensor("int64", [BigInt(newTokenId)], [1, 1]);
}
var InferenceSession, ONNXTensor2, env2, MODEL_TYPES, MODEL_TYPE_MAPPING, MODEL_NAME_TO_CLASS_MAPPING, MODEL_CLASS_TO_NAME_MAPPING, PreTrainedModel, ModelOutput, BertPreTrainedModel, BertModel, BertForMaskedLM, BertForSequenceClassification, BertForTokenClassification, BertForQuestionAnswering, NomicBertPreTrainedModel, NomicBertModel, RoFormerPreTrainedModel, RoFormerModel, RoFormerForMaskedLM, RoFormerForSequenceClassification, RoFormerForTokenClassification, RoFormerForQuestionAnswering, ConvBertPreTrainedModel, ConvBertModel, ConvBertForMaskedLM, ConvBertForSequenceClassification, ConvBertForTokenClassification, ConvBertForQuestionAnswering, ElectraPreTrainedModel, ElectraModel, ElectraForMaskedLM, ElectraForSequenceClassification, ElectraForTokenClassification, ElectraForQuestionAnswering, CamembertPreTrainedModel, CamembertModel, CamembertForMaskedLM, CamembertForSequenceClassification, CamembertForTokenClassification, CamembertForQuestionAnswering, DebertaPreTrainedModel, DebertaModel, DebertaForMaskedLM, DebertaForSequenceClassification, DebertaForTokenClassification, DebertaForQuestionAnswering, DebertaV2PreTrainedModel, DebertaV2Model, DebertaV2ForMaskedLM, DebertaV2ForSequenceClassification, DebertaV2ForTokenClassification, DebertaV2ForQuestionAnswering, DistilBertPreTrainedModel, DistilBertModel, DistilBertForSequenceClassification, DistilBertForTokenClassification, DistilBertForQuestionAnswering, DistilBertForMaskedLM, EsmPreTrainedModel, EsmModel, EsmForMaskedLM, EsmForSequenceClassification, EsmForTokenClassification, MobileBertPreTrainedModel, MobileBertModel, MobileBertForMaskedLM, MobileBertForSequenceClassification, MobileBertForQuestionAnswering, MPNetPreTrainedModel, MPNetModel, MPNetForMaskedLM, MPNetForSequenceClassification, MPNetForTokenClassification, MPNetForQuestionAnswering, SqueezeBertPreTrainedModel, SqueezeBertModel, SqueezeBertForMaskedLM, SqueezeBertForSequenceClassification, SqueezeBertForQuestionAnswering, AlbertPreTrainedModel, AlbertModel, AlbertForSequenceClassification, AlbertForQuestionAnswering, AlbertForMaskedLM, T5PreTrainedModel, T5Model, T5ForConditionalGeneration, LongT5PreTrainedModel, LongT5Model, LongT5ForConditionalGeneration, MT5PreTrainedModel, MT5Model, MT5ForConditionalGeneration, BartPretrainedModel, BartModel, BartForConditionalGeneration, BartForSequenceClassification, MBartPreTrainedModel, MBartModel, MBartForConditionalGeneration, MBartForSequenceClassification, MBartForCausalLM, BlenderbotPreTrainedModel, BlenderbotModel, BlenderbotForConditionalGeneration, BlenderbotSmallPreTrainedModel, BlenderbotSmallModel, BlenderbotSmallForConditionalGeneration, RobertaPreTrainedModel, RobertaModel, RobertaForMaskedLM, RobertaForSequenceClassification, RobertaForTokenClassification, RobertaForQuestionAnswering, XLMPreTrainedModel, XLMModel, XLMWithLMHeadModel, XLMForSequenceClassification, XLMForTokenClassification, XLMForQuestionAnswering, XLMRobertaPreTrainedModel, XLMRobertaModel, XLMRobertaForMaskedLM, XLMRobertaForSequenceClassification, XLMRobertaForTokenClassification, XLMRobertaForQuestionAnswering, ASTPreTrainedModel, ASTModel, ASTForAudioClassification, WhisperPreTrainedModel, WhisperModel, WhisperForConditionalGeneration, VisionEncoderDecoderModel, CLIPPreTrainedModel, CLIPModel, CLIPTextModelWithProjection, CLIPVisionModelWithProjection, SiglipPreTrainedModel, SiglipModel, SiglipTextModel, SiglipVisionModel, ChineseCLIPPreTrainedModel, ChineseCLIPModel, CLIPSegPreTrainedModel, CLIPSegModel, CLIPSegForImageSegmentation, GPT2PreTrainedModel, GPT2Model, GPT2LMHeadModel, GPTNeoPreTrainedModel, GPTNeoModel, GPTNeoForCausalLM, GPTNeoXPreTrainedModel, GPTNeoXModel, GPTNeoXForCausalLM, GPTJPreTrainedModel, GPTJModel, GPTJForCausalLM, GPTBigCodePreTrainedModel, GPTBigCodeModel, GPTBigCodeForCausalLM, CodeGenPreTrainedModel, CodeGenModel, CodeGenForCausalLM, LlamaPreTrainedModel, LlamaModel, LlamaForCausalLM, Qwen2PreTrainedModel, Qwen2Model, Qwen2ForCausalLM, PhiPreTrainedModel, PhiModel, PhiForCausalLM, BloomPreTrainedModel, BloomModel, BloomForCausalLM, MptPreTrainedModel, MptModel, MptForCausalLM, OPTPreTrainedModel, OPTModel, OPTForCausalLM, ViTPreTrainedModel, ViTModel, ViTForImageClassification, FastViTPreTrainedModel, FastViTModel, FastViTForImageClassification, VitMattePreTrainedModel, VitMatteForImageMatting, MobileViTPreTrainedModel, MobileViTModel, MobileViTForImageClassification, MobileViTV2PreTrainedModel, MobileViTV2Model, MobileViTV2ForImageClassification, OwlViTPreTrainedModel, OwlViTModel, OwlViTForObjectDetection, Owlv2PreTrainedModel, Owlv2Model, Owlv2ForObjectDetection, BeitPreTrainedModel, BeitModel, BeitForImageClassification, DetrPreTrainedModel, DetrModel, DetrForObjectDetection, DetrForSegmentation, DetrObjectDetectionOutput, DetrSegmentationOutput, TableTransformerPreTrainedModel, TableTransformerModel, TableTransformerForObjectDetection, TableTransformerObjectDetectionOutput, DeiTPreTrainedModel, DeiTModel, DeiTForImageClassification, ResNetPreTrainedModel, ResNetModel, ResNetForImageClassification, SwinPreTrainedModel, SwinModel, SwinForImageClassification, Swin2SRPreTrainedModel, Swin2SRModel, Swin2SRForImageSuperResolution, DPTPreTrainedModel, DPTModel, DPTForDepthEstimation, DepthAnythingPreTrainedModel, DepthAnythingForDepthEstimation, GLPNPreTrainedModel, GLPNModel, GLPNForDepthEstimation, DonutSwinPreTrainedModel, DonutSwinModel, ConvNextPreTrainedModel, ConvNextModel, ConvNextForImageClassification, ConvNextV2PreTrainedModel, ConvNextV2Model, ConvNextV2ForImageClassification, Dinov2PreTrainedModel, Dinov2Model, Dinov2ForImageClassification, YolosPreTrainedModel, YolosModel, YolosForObjectDetection, YolosObjectDetectionOutput, SamPreTrainedModel, SamModel, SamImageSegmentationOutput, MarianPreTrainedModel, MarianModel, MarianMTModel, M2M100PreTrainedModel, M2M100Model, M2M100ForConditionalGeneration, Wav2Vec2PreTrainedModel, Wav2Vec2Model, Wav2Vec2ForCTC, Wav2Vec2ForSequenceClassification, Wav2Vec2ForAudioFrameClassification, UniSpeechPreTrainedModel, UniSpeechModel, UniSpeechForCTC, UniSpeechForSequenceClassification, UniSpeechSatPreTrainedModel, UniSpeechSatModel, UniSpeechSatForCTC, UniSpeechSatForSequenceClassification, UniSpeechSatForAudioFrameClassification, Wav2Vec2BertPreTrainedModel, Wav2Vec2BertModel, Wav2Vec2BertForCTC, Wav2Vec2BertForSequenceClassification, HubertModel, HubertForCTC, HubertForSequenceClassification, WavLMPreTrainedModel, WavLMModel, WavLMForCTC, WavLMForSequenceClassification, WavLMForXVector, WavLMForAudioFrameClassification, SpeechT5PreTrainedModel, SpeechT5ForSpeechToText, SpeechT5ForTextToSpeech, SpeechT5HifiGan, TrOCRPreTrainedModel, TrOCRForCausalLM, MistralPreTrainedModel, MistralModel, MistralForCausalLM, Starcoder2PreTrainedModel, Starcoder2Model, Starcoder2ForCausalLM, FalconPreTrainedModel, FalconModel, FalconForCausalLM, ClapPreTrainedModel, ClapModel, ClapTextModelWithProjection, ClapAudioModelWithProjection, VitsPreTrainedModel, VitsModel, SegformerPreTrainedModel, SegformerForImageClassification, SegformerForSemanticSegmentation, StableLmPreTrainedModel, StableLmForCausalLM, EfficientNetPreTrainedModel, EfficientNetModel, EfficientNetForImageClassification, PretrainedMixin, MODEL_MAPPING_NAMES_ENCODER_ONLY, MODEL_MAPPING_NAMES_ENCODER_DECODER, MODEL_MAPPING_NAMES_DECODER_ONLY, MODEL_FOR_SPEECH_SEQ_2_SEQ_MAPPING_NAMES, MODEL_FOR_TEXT_TO_SPECTROGRAM_MAPPING_NAMES, MODEL_FOR_TEXT_TO_WAVEFORM_MAPPING_NAMES, MODEL_FOR_SEQUENCE_CLASSIFICATION_MAPPING_NAMES, MODEL_FOR_TOKEN_CLASSIFICATION_MAPPING_NAMES, MODEL_FOR_SEQ_TO_SEQ_CAUSAL_LM_MAPPING_NAMES, MODEL_WITH_LM_HEAD_MAPPING_NAMES, MODEL_FOR_MASKED_LM_MAPPING_NAMES, MODEL_FOR_QUESTION_ANSWERING_MAPPING_NAMES, MODEL_FOR_VISION_2_SEQ_MAPPING_NAMES, MODEL_FOR_DOCUMENT_QUESTION_ANSWERING_MAPPING_NAMES, MODEL_FOR_IMAGE_CLASSIFICATION_MAPPING_NAMES, MODEL_FOR_OBJECT_DETECTION_MAPPING_NAMES, MODEL_FOR_ZERO_SHOT_OBJECT_DETECTION_MAPPING_NAMES, MODEL_FOR_IMAGE_SEGMENTATION_MAPPING_NAMES, MODEL_FOR_SEMANTIC_SEGMENTATION_MAPPING_NAMES, MODEL_FOR_MASK_GENERATION_MAPPING_NAMES, MODEL_FOR_CTC_MAPPING_NAMES, MODEL_FOR_AUDIO_CLASSIFICATION_MAPPING_NAMES, MODEL_FOR_AUDIO_XVECTOR_MAPPING_NAMES, MODEL_FOR_AUDIO_FRAME_CLASSIFICATION_MAPPING_NAMES, MODEL_FOR_IMAGE_MATTING_MAPPING_NAMES, MODEL_FOR_IMAGE_TO_IMAGE_MAPPING_NAMES, MODEL_FOR_DEPTH_ESTIMATION_MAPPING_NAMES, MODEL_FOR_IMAGE_FEATURE_EXTRACTION_MAPPING_NAMES, MODEL_CLASS_TYPE_MAPPING, CUSTOM_MAPPING, AutoModel, AutoModelForSequenceClassification, AutoModelForTokenClassification, AutoModelForSeq2SeqLM, AutoModelForSpeechSeq2Seq, AutoModelForTextToSpectrogram, AutoModelForTextToWaveform, AutoModelForCausalLM, AutoModelForMaskedLM, AutoModelForQuestionAnswering, AutoModelForVision2Seq, AutoModelForImageClassification, AutoModelForImageSegmentation, AutoModelForSemanticSegmentation, AutoModelForObjectDetection, AutoModelForZeroShotObjectDetection, AutoModelForCTC, AutoModelForAudioClassification, AutoModelForDocumentQuestionAnswering, AutoModelForImageToImage, AutoModelForDepthEstimation, AutoModelForImageFeatureExtraction, Seq2SeqLMOutput, SequenceClassifierOutput, XVectorOutput, TokenClassifierOutput, MaskedLMOutput, QuestionAnsweringModelOutput, CausalLMOutput, ImageMattingOutput, VitsModelOutput;
var init_models = __esm({
  "node_modules/@xenova/transformers/src/models.js"() {
    init_configs();
    init_core();
    init_hub();
    init_generation();
    init_tensor();
    init_onnx();
    init_transformers();
    ({ InferenceSession, Tensor: ONNXTensor2, env: env2 } = ONNX);
    MODEL_TYPES = {
      EncoderOnly: 0,
      EncoderDecoder: 1,
      Seq2Seq: 2,
      Vision2Seq: 3,
      DecoderOnly: 4,
      MaskGeneration: 5
    };
    MODEL_TYPE_MAPPING = /* @__PURE__ */ new Map();
    MODEL_NAME_TO_CLASS_MAPPING = /* @__PURE__ */ new Map();
    MODEL_CLASS_TO_NAME_MAPPING = /* @__PURE__ */ new Map();
    PreTrainedModel = class extends Callable {
      main_input_name = "input_ids";
      /**
       * Creates a new instance of the `PreTrainedModel` class.
       * @param {Object} config The model configuration.
       * @param {any} session session for the model.
       */
      constructor(config, session) {
        super();
        this.config = config;
        this.session = session;
        const modelName = MODEL_CLASS_TO_NAME_MAPPING.get(this.constructor);
        const modelType = MODEL_TYPE_MAPPING.get(modelName);
        this.can_generate = false;
        this._runBeam = null;
        this._getStartBeams = null;
        this._updateBeam = null;
        this._forward = null;
        if (modelType === MODEL_TYPES.DecoderOnly) {
          this.can_generate = true;
          this._runBeam = decoderRunBeam;
          this._getStartBeams = decoderStartBeams;
          this._updateBeam = decoderUpdatebeam;
          this._forward = decoderForward;
        } else if (modelType === MODEL_TYPES.Seq2Seq || modelType === MODEL_TYPES.Vision2Seq) {
          this.can_generate = true;
          this._runBeam = seq2seqRunBeam;
          this._getStartBeams = seq2seqStartBeams;
          this._updateBeam = seq2seqUpdatebeam;
          this._forward = seq2seqForward;
        } else if (modelType === MODEL_TYPES.EncoderDecoder) {
          this._forward = encoderForward;
        } else {
          this._forward = encoderForward;
        }
      }
      /**
      * Disposes of all the ONNX sessions that were created during inference.
      * @returns {Promise<unknown[]>} An array of promises, one for each ONNX session that is being disposed.
      * @todo Use https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/FinalizationRegistry
      */
      async dispose() {
        const promises = [];
        for (let key of Object.keys(this)) {
          const item = this[key];
          if (item instanceof InferenceSession) {
            promises.push(item.handler.dispose());
          }
        }
        return await Promise.all(promises);
      }
      /**
       * Instantiate one of the model classes of the library from a pretrained model.
       * 
       * The model class to instantiate is selected based on the `model_type` property of the config object
       * (either passed as an argument or loaded from `pretrained_model_name_or_path` if possible)
       * 
       * @param {string} pretrained_model_name_or_path The name or path of the pretrained model. Can be either:
       * - A string, the *model id* of a pretrained model hosted inside a model repo on huggingface.co.
       *   Valid model ids can be located at the root-level, like `bert-base-uncased`, or namespaced under a
       *   user or organization name, like `dbmdz/bert-base-german-cased`.
       * - A path to a *directory* containing model weights, e.g., `./my_model_directory/`.
       * @param {import('./utils/hub.js').PretrainedOptions} options Additional options for loading the model.
       * 
       * @returns {Promise<PreTrainedModel>} A new instance of the `PreTrainedModel` class.
       */
      static async from_pretrained(pretrained_model_name_or_path, {
        quantized = true,
        progress_callback = null,
        config = null,
        cache_dir = null,
        local_files_only = false,
        revision = "main",
        model_file_name = null
      } = {}) {
        let options = {
          quantized,
          progress_callback,
          config,
          cache_dir,
          local_files_only,
          revision,
          model_file_name
        };
        const modelName = MODEL_CLASS_TO_NAME_MAPPING.get(this);
        const modelType = MODEL_TYPE_MAPPING.get(modelName);
        let info;
        if (modelType === MODEL_TYPES.DecoderOnly) {
          info = await Promise.all([
            AutoConfig.from_pretrained(pretrained_model_name_or_path, options),
            constructSession(pretrained_model_name_or_path, options.model_file_name ?? "decoder_model_merged", options),
            getModelJSON(pretrained_model_name_or_path, "generation_config.json", false, options)
          ]);
        } else if (modelType === MODEL_TYPES.Seq2Seq || modelType === MODEL_TYPES.Vision2Seq) {
          info = await Promise.all([
            AutoConfig.from_pretrained(pretrained_model_name_or_path, options),
            constructSession(pretrained_model_name_or_path, "encoder_model", options),
            constructSession(pretrained_model_name_or_path, "decoder_model_merged", options),
            getModelJSON(pretrained_model_name_or_path, "generation_config.json", false, options)
          ]);
        } else if (modelType === MODEL_TYPES.MaskGeneration) {
          info = await Promise.all([
            AutoConfig.from_pretrained(pretrained_model_name_or_path, options),
            constructSession(pretrained_model_name_or_path, "vision_encoder", options),
            constructSession(pretrained_model_name_or_path, "prompt_encoder_mask_decoder", options)
          ]);
        } else if (modelType === MODEL_TYPES.EncoderDecoder) {
          info = await Promise.all([
            AutoConfig.from_pretrained(pretrained_model_name_or_path, options),
            constructSession(pretrained_model_name_or_path, "encoder_model", options),
            constructSession(pretrained_model_name_or_path, "decoder_model_merged", options)
          ]);
        } else {
          if (modelType !== MODEL_TYPES.EncoderOnly) {
            console.warn(`Model type for '${modelName ?? config?.model_type}' not found, assuming encoder-only architecture. Please report this at https://github.com/xenova/transformers.js/issues/new/choose.`);
          }
          info = await Promise.all([
            AutoConfig.from_pretrained(pretrained_model_name_or_path, options),
            constructSession(pretrained_model_name_or_path, options.model_file_name ?? "model", options)
          ]);
        }
        return new this(...info);
      }
      /**
       * Runs the model with the provided inputs
       * @param {Object} model_inputs Object containing input tensors
       * @returns {Promise<Object>} Object containing output tensors
       */
      async _call(model_inputs) {
        return await this.forward(model_inputs);
      }
      /**
       * Forward method for a pretrained model. If not overridden by a subclass, the correct forward method
       * will be chosen based on the model type.
       * @param {Object} model_inputs The input data to the model in the format specified in the ONNX model.
       * @returns {Promise<Object>} The output data from the model in the format specified in the ONNX model.
       * @throws {Error} This method must be implemented in subclasses.
       */
      async forward(model_inputs) {
        return await this._forward(this, model_inputs);
      }
      /**
       * @param {import('./utils/generation.js').GenerationConfigType} generation_config 
       * @param {number} input_ids_seq_length The starting sequence length for the input ids.
       * @returns {LogitsProcessorList}
       * @private
       */
      _get_logits_processor(generation_config, input_ids_seq_length, logits_processor = null) {
        const processors = new LogitsProcessorList();
        if (generation_config.repetition_penalty !== null && generation_config.repetition_penalty !== 1) {
          processors.push(new RepetitionPenaltyLogitsProcessor(generation_config.repetition_penalty));
        }
        if (generation_config.no_repeat_ngram_size !== null && generation_config.no_repeat_ngram_size > 0) {
          processors.push(new NoRepeatNGramLogitsProcessor(generation_config.no_repeat_ngram_size));
        }
        if (generation_config.bad_words_ids !== null) {
          processors.push(new NoBadWordsLogitsProcessor(generation_config.bad_words_ids, generation_config.eos_token_id));
        }
        if (generation_config.min_length !== null && generation_config.eos_token_id !== null && generation_config.min_length > 0) {
          processors.push(new MinLengthLogitsProcessor(generation_config.min_length, generation_config.eos_token_id));
        }
        if (generation_config.min_new_tokens !== null && generation_config.eos_token_id !== null && generation_config.min_new_tokens > 0) {
          processors.push(new MinNewTokensLengthLogitsProcessor(
            input_ids_seq_length,
            generation_config.min_new_tokens,
            generation_config.eos_token_id
          ));
        }
        if (generation_config.forced_bos_token_id !== null) {
          processors.push(new ForcedBOSTokenLogitsProcessor(generation_config.forced_bos_token_id));
        }
        if (generation_config.forced_eos_token_id !== null) {
          processors.push(new ForcedEOSTokenLogitsProcessor(
            generation_config.max_length,
            generation_config.forced_eos_token_id
          ));
        }
        if (generation_config.begin_suppress_tokens !== null) {
          let begin_index = input_ids_seq_length > 1 || generation_config.forced_bos_token_id === null ? input_ids_seq_length : input_ids_seq_length + 1;
          if (generation_config.forced_decoder_ids !== null) {
            begin_index += generation_config.forced_decoder_ids[generation_config.forced_decoder_ids.length - 1][0];
          }
          processors.push(new SuppressTokensAtBeginLogitsProcessor(generation_config.begin_suppress_tokens, begin_index));
        }
        if (generation_config.forced_decoder_ids !== null) {
          processors.push(new ForceTokensLogitsProcessor(generation_config.forced_decoder_ids));
        }
        if (logits_processor !== null) {
          processors.extend(logits_processor);
        }
        return processors;
      }
      /**
       * This function merges multiple generation configs together to form a final generation config to be used by the model for text generation.
       * It first creates an empty `GenerationConfig` object, then it applies the model's own `generation_config` property to it. Finally, if a `generation_config` object was passed in the arguments, it overwrites the corresponding properties in the final config with those of the passed config object.
       * @param {import('./utils/generation.js').GenerationConfigType} generation_config A `GenerationConfig` object containing generation parameters.
       * @returns {import('./utils/generation.js').GenerationConfigType} The final generation config object to be used by the model for text generation.
       */
      _get_generation_config(generation_config) {
        let gen_config = new GenerationConfig(this.config);
        if ("generation_config" in this) {
          Object.assign(gen_config, this.generation_config);
        }
        if (generation_config !== null) {
          Object.assign(gen_config, generation_config);
        }
        return gen_config;
      }
      /**
       * @typedef {import('./utils/maths.js').TypedArray} TypedArray
       */
      /**
       * @typedef {{ sequences: Tensor, decoder_attentions: Tensor, cross_attentions: Tensor }} EncoderDecoderOutput
       * @typedef {Object} DecoderOutput
       * 
       * Generates text based on the given inputs and generation configuration using the model.
       * @param {Tensor|Array|TypedArray} inputs An array of input token IDs.
       * @param {Object|GenerationConfig|null} generation_config The generation configuration to use. If null, default configuration will be used.
       * @param {Object|null} logits_processor An optional logits processor to use. If null, a new LogitsProcessorList instance will be created.
       * @param {Object} options options
       * @param {Object} [options.inputs_attention_mask=null] An optional attention mask for the inputs.
       * @returns {Promise<number[][]|EncoderDecoderOutput|DecoderOutput>} An array of generated output sequences, where each sequence is an array of token IDs.
       * @throws {Error} Throws an error if the inputs array is empty.
       */
      async generate(inputs, generation_config = null, logits_processor = null, {
        inputs_attention_mask = null
      } = {}) {
        if (!this.can_generate) {
          const modelName = MODEL_CLASS_TO_NAME_MAPPING.get(this.constructor);
          let errorMessage = `The current model class (${modelName}) is not compatible with \`.generate()\`, as it doesn't have a language model head.`;
          const modelType = this.config.model_type;
          const possibleInfo = MODEL_WITH_LM_HEAD_MAPPING_NAMES.get(modelType) ?? MODEL_FOR_SEQ_TO_SEQ_CAUSAL_LM_MAPPING_NAMES.get(modelType) ?? MODEL_FOR_SPEECH_SEQ_2_SEQ_MAPPING_NAMES.get(modelType) ?? MODEL_FOR_VISION_2_SEQ_MAPPING_NAMES.get(modelType);
          if (possibleInfo) {
            errorMessage += ` Please use the following class instead: '${possibleInfo[0]}'`;
          }
          throw Error(errorMessage);
        }
        if (!(inputs instanceof Tensor) && !isTypedArray(inputs) && !Array.isArray(inputs)) {
          throw Error(`\`inputs\` must be a Tensor, TypedArray, or Array, but is "${inputs.constructor.name}".`);
        }
        let input_ids_seq_length;
        if (this.config.is_encoder_decoder) {
          input_ids_seq_length = 0;
        } else {
          input_ids_seq_length = inputs instanceof Tensor ? inputs.dims.at(-1) : inputs.length;
          if (input_ids_seq_length === 0) {
            throw Error("Must supply a non-empty array of input token ids.");
          }
        }
        generation_config = this._get_generation_config(generation_config);
        logits_processor = logits_processor ?? new LogitsProcessorList();
        logits_processor = this._get_logits_processor(
          generation_config,
          input_ids_seq_length,
          logits_processor
        );
        let eos_token_ids = generation_config.eos_token_id;
        if (eos_token_ids !== null && !Array.isArray(eos_token_ids)) {
          eos_token_ids = [eos_token_ids];
        }
        let numOutputTokens = 1;
        const maxOutputTokens = numOutputTokens + (generation_config.max_new_tokens ?? Infinity);
        const useMaxLength = Number.isInteger(generation_config.max_length) && (generation_config.max_new_tokens ?? null) === null;
        let sampler = Sampler.getSampler(generation_config);
        let beams = this.getStartBeams(inputs, generation_config, numOutputTokens, inputs_attention_mask);
        while (beams.some((x) => !x.done) && numOutputTokens < maxOutputTokens) {
          let newest_beams = [];
          for (let beam of beams) {
            if (beam.done) {
              newest_beams.push(beam);
              continue;
            }
            if (useMaxLength && beam.output_token_ids.length >= generation_config.max_length) {
              beam.done = true;
              newest_beams.push(beam);
              continue;
            }
            let output = await this.runBeam(beam);
            if (generation_config.output_attentions) {
              this.addAttentionsToBeam(beam, output);
            }
            if (generation_config.output_scores) {
            }
            let logits = output.logits.slice(null, -1, null);
            logits_processor(beam.output_token_ids, logits);
            let sampledTokens = sampler(logits);
            for (let [newTokenId, logProb] of sampledTokens) {
              let newBeam = { ...beam };
              this.updateBeam(newBeam, newTokenId);
              newBeam.score += logProb;
              if (eos_token_ids && eos_token_ids.includes(newTokenId)) {
                newBeam.done = true;
              }
              newest_beams.push(newBeam);
            }
          }
          ++numOutputTokens;
          newest_beams = this.groupBeams(newest_beams).map(
            (group) => group.sort((a, b) => b.score - a.score).slice(0, generation_config.num_beams)
            // remove outside beam width
          );
          beams = newest_beams.flat();
          if (generation_config.callback_function) {
            generation_config.callback_function(beams);
          }
        }
        const groupedBeams = this.groupBeams(beams);
        const getFlattened = (key) => groupedBeams.map(
          (batch) => {
            if (generation_config.num_return_sequences > 1) {
              return batch.slice(0, generation_config.num_return_sequences).map((x) => x[key]);
            } else {
              return [batch[0][key]];
            }
          }
        ).flat();
        const sequences = getFlattened("output_token_ids");
        if (generation_config.return_dict_in_generate) {
          const decoder_attentions = getFlattened("decoder_attentions");
          const cross_attentions = getFlattened("cross_attentions");
          return {
            sequences,
            decoder_attentions,
            cross_attentions
          };
        } else {
          return sequences;
        }
      }
      /**
       * Helper function to add attentions to beam
       * @param {Object} beam 
       * @param {Object} output
       * @private 
       */
      addAttentionsToBeam(beam, output) {
        if (this.config.is_encoder_decoder) {
          if (!output.cross_attentions || output.cross_attentions.length === 0) {
            throw Error(
              "`output_attentions` is true, but the model did not produce cross-attentions. This is most likely because the model was not exported with `output_attentions=True`."
            );
          }
          if (!beam.cross_attentions) {
            beam.cross_attentions = [];
          }
          beam.cross_attentions.push(output.cross_attentions);
        }
        if (!output.decoder_attentions || output.decoder_attentions.length === 0) {
          throw Error(
            "`output_attentions` is true, but the model did not produce decoder-attentions. This is most likely because the model was not exported with `output_attentions=True`."
          );
        }
        if (!beam.decoder_attentions) {
          beam.decoder_attentions = [];
        }
        beam.decoder_attentions.push(output.decoder_attentions);
      }
      /**
       * Groups an array of beam objects by their ids.
       *
       * @param {Array} beams The array of beam objects to group.
       * @returns {Array} An array of arrays, where each inner array contains beam objects with the same id.
       */
      groupBeams(beams) {
        const groups = /* @__PURE__ */ Object.create(null);
        for (const obj of beams) {
          if (groups[obj.id] === void 0) {
            groups[obj.id] = [obj];
          } else {
            groups[obj.id].push(obj);
          }
        }
        return Object.values(groups);
      }
      /**
       * Returns an object containing past key values from the given decoder results object.
       *
       * @param {Object} decoderResults The decoder results object.
       * @param {Object} pastKeyValues The previous past key values.
       * @returns {Object} An object containing past key values.
       */
      getPastKeyValues(decoderResults, pastKeyValues) {
        const pkvs = /* @__PURE__ */ Object.create(null);
        for (const name in decoderResults) {
          if (name.startsWith("present")) {
            let newName = name.replace("present", "past_key_values");
            if (pastKeyValues && name.includes("encoder")) {
              pkvs[newName] = pastKeyValues[newName];
            } else {
              pkvs[newName] = decoderResults[name];
            }
          }
        }
        return pkvs;
      }
      /**
       * Returns an object containing attentions from the given decoder results object.
       *
       * @param {Object} decoderResults The decoder results object.
       * @returns {Object} An object containing attentions.
       */
      getAttentions(decoderResults) {
        const attns = /* @__PURE__ */ Object.create(null);
        for (const attnName of ["cross_attentions", "decoder_attentions"]) {
          const result = [];
          for (const name in decoderResults) {
            if (name.startsWith(attnName)) {
              const index = name.split(".").pop();
              result[index] = decoderResults[name];
            }
          }
          attns[attnName] = result;
        }
        return attns;
      }
      /**
       * Adds past key values to the decoder feeds object. If pastKeyValues is null, creates new tensors for past key values.
       *
       * @param {Object} decoderFeeds The decoder feeds object to add past key values to.
       * @param {Object} pastKeyValues An object containing past key values.
       */
      addPastKeyValues(decoderFeeds, pastKeyValues) {
        if (pastKeyValues) {
          Object.assign(decoderFeeds, pastKeyValues);
        } else {
          const batch_size = 1;
          if (this.config.is_encoder_decoder && (this.add_encoder_pkv ?? true)) {
            let encoder_dims = [batch_size, this.num_encoder_heads, 0, this.encoder_dim_kv];
            let decoder_dims = [batch_size, this.num_decoder_heads, 0, this.decoder_dim_kv];
            for (let i = 0; i < this.num_decoder_layers; ++i) {
              decoderFeeds[`past_key_values.${i}.encoder.key`] = new Tensor("float32", [], encoder_dims);
              decoderFeeds[`past_key_values.${i}.encoder.value`] = new Tensor("float32", [], encoder_dims);
              decoderFeeds[`past_key_values.${i}.decoder.key`] = new Tensor("float32", [], decoder_dims);
              decoderFeeds[`past_key_values.${i}.decoder.value`] = new Tensor("float32", [], decoder_dims);
            }
          } else if (this.config.model_type === "falcon") {
            let dims = [batch_size * this.num_heads, 0, this.dim_kv];
            for (let i = 0; i < this.num_layers; ++i) {
              decoderFeeds[`past_key_values.${i}.key`] = new Tensor("float32", [], dims);
              decoderFeeds[`past_key_values.${i}.value`] = new Tensor("float32", [], dims);
            }
          } else if (this.config.multi_query) {
            let dims = [batch_size * this.num_heads, 0, 2 * this.dim_kv];
            for (let i = 0; i < this.num_layers; ++i) {
              decoderFeeds[`past_key_values.${i}.key_value`] = new Tensor("float32", [], dims);
            }
          } else if (this.config.model_type === "bloom") {
            let keyDims = [batch_size * this.num_heads, this.dim_kv, 0];
            let valueDims = [batch_size * this.num_heads, 0, this.dim_kv];
            for (let i = 0; i < this.num_layers; ++i) {
              decoderFeeds[`past_key_values.${i}.key`] = new Tensor("float32", [], keyDims);
              decoderFeeds[`past_key_values.${i}.value`] = new Tensor("float32", [], valueDims);
            }
          } else {
            let dims = [batch_size, this.num_heads, 0, this.dim_kv];
            for (let i = 0; i < this.num_layers; ++i) {
              decoderFeeds[`past_key_values.${i}.key`] = new Tensor("float32", [], dims);
              decoderFeeds[`past_key_values.${i}.value`] = new Tensor("float32", [], dims);
            }
          }
        }
      }
      /**
       * Initializes and returns the beam for text generation task
       * @param {Tensor} inputTokenIds The input token ids.
       * @param {Object} generation_config The generation config.
       * @param {number} numOutputTokens The number of tokens to be generated.
       * @param {Tensor} inputs_attention_mask Optional input attention mask.
       * @returns {any} A Beam object representing the initialized beam.
       * @private
       */
      getStartBeams(inputTokenIds, generation_config, numOutputTokens, inputs_attention_mask) {
        return this._getStartBeams(this, inputTokenIds, generation_config, numOutputTokens, inputs_attention_mask);
      }
      /**
       * Runs a single step of the beam search generation algorithm.
       * @param {any} beam The current beam being generated.
       * @returns {Promise<any>} The updated beam after a single generation step.
       * @private
       */
      async runBeam(beam) {
        return await this._runBeam(this, beam);
      }
      /**
       * Update a beam with a new token ID.
       * @param {Object} beam The beam to update.
       * @param {number} newTokenId The new token ID to add to the beam's output.
       * @private
       */
      updateBeam(beam, newTokenId) {
        return this._updateBeam(beam, newTokenId);
      }
    };
    ModelOutput = class {
    };
    BertPreTrainedModel = class extends PreTrainedModel {
    };
    BertModel = class extends BertPreTrainedModel {
    };
    BertForMaskedLM = class extends BertPreTrainedModel {
      /**
       * Calls the model on new inputs.
       *
       * @param {Object} model_inputs The inputs to the model.
       * @returns {Promise<MaskedLMOutput>} An object containing the model's output logits for masked language modeling.
       */
      async _call(model_inputs) {
        return new MaskedLMOutput(await super._call(model_inputs));
      }
    };
    BertForSequenceClassification = class extends BertPreTrainedModel {
      /**
       * Calls the model on new inputs.
       *
       * @param {Object} model_inputs The inputs to the model.
       * @returns {Promise<SequenceClassifierOutput>} An object containing the model's output logits for sequence classification.
       */
      async _call(model_inputs) {
        return new SequenceClassifierOutput(await super._call(model_inputs));
      }
    };
    BertForTokenClassification = class extends BertPreTrainedModel {
      /**
       * Calls the model on new inputs.
       *
       * @param {Object} model_inputs The inputs to the model.
       * @returns {Promise<TokenClassifierOutput>} An object containing the model's output logits for token classification.
       */
      async _call(model_inputs) {
        return new TokenClassifierOutput(await super._call(model_inputs));
      }
    };
    BertForQuestionAnswering = class extends BertPreTrainedModel {
      /**
       * Calls the model on new inputs.
       *
       * @param {Object} model_inputs The inputs to the model.
       * @returns {Promise<QuestionAnsweringModelOutput>} An object containing the model's output logits for question answering.
       */
      async _call(model_inputs) {
        return new QuestionAnsweringModelOutput(await super._call(model_inputs));
      }
    };
    NomicBertPreTrainedModel = class extends PreTrainedModel {
    };
    NomicBertModel = class extends NomicBertPreTrainedModel {
    };
    RoFormerPreTrainedModel = class extends PreTrainedModel {
    };
    RoFormerModel = class extends RoFormerPreTrainedModel {
    };
    RoFormerForMaskedLM = class extends RoFormerPreTrainedModel {
      /**
       * Calls the model on new inputs.
       *
       * @param {Object} model_inputs The inputs to the model.
       * @returns {Promise<MaskedLMOutput>} An object containing the model's output logits for masked language modeling.
       */
      async _call(model_inputs) {
        return new MaskedLMOutput(await super._call(model_inputs));
      }
    };
    RoFormerForSequenceClassification = class extends RoFormerPreTrainedModel {
      /**
       * Calls the model on new inputs.
       *
       * @param {Object} model_inputs The inputs to the model.
       * @returns {Promise<SequenceClassifierOutput>} An object containing the model's output logits for sequence classification.
       */
      async _call(model_inputs) {
        return new SequenceClassifierOutput(await super._call(model_inputs));
      }
    };
    RoFormerForTokenClassification = class extends RoFormerPreTrainedModel {
      /**
       * Calls the model on new inputs.
       *
       * @param {Object} model_inputs The inputs to the model.
       * @returns {Promise<TokenClassifierOutput>} An object containing the model's output logits for token classification.
       */
      async _call(model_inputs) {
        return new TokenClassifierOutput(await super._call(model_inputs));
      }
    };
    RoFormerForQuestionAnswering = class extends RoFormerPreTrainedModel {
      /**
       * Calls the model on new inputs.
       *
       * @param {Object} model_inputs The inputs to the model.
       * @returns {Promise<QuestionAnsweringModelOutput>} An object containing the model's output logits for question answering.
       */
      async _call(model_inputs) {
        return new QuestionAnsweringModelOutput(await super._call(model_inputs));
      }
    };
    ConvBertPreTrainedModel = class extends PreTrainedModel {
    };
    ConvBertModel = class extends ConvBertPreTrainedModel {
    };
    ConvBertForMaskedLM = class extends ConvBertPreTrainedModel {
      /**
       * Calls the model on new inputs.
       *
       * @param {Object} model_inputs The inputs to the model.
       * @returns {Promise<MaskedLMOutput>} An object containing the model's output logits for masked language modeling.
       */
      async _call(model_inputs) {
        return new MaskedLMOutput(await super._call(model_inputs));
      }
    };
    ConvBertForSequenceClassification = class extends ConvBertPreTrainedModel {
      /**
       * Calls the model on new inputs.
       *
       * @param {Object} model_inputs The inputs to the model.
       * @returns {Promise<SequenceClassifierOutput>} An object containing the model's output logits for sequence classification.
       */
      async _call(model_inputs) {
        return new SequenceClassifierOutput(await super._call(model_inputs));
      }
    };
    ConvBertForTokenClassification = class extends ConvBertPreTrainedModel {
      /**
       * Calls the model on new inputs.
       *
       * @param {Object} model_inputs The inputs to the model.
       * @returns {Promise<TokenClassifierOutput>} An object containing the model's output logits for token classification.
       */
      async _call(model_inputs) {
        return new TokenClassifierOutput(await super._call(model_inputs));
      }
    };
    ConvBertForQuestionAnswering = class extends ConvBertPreTrainedModel {
      /**
       * Calls the model on new inputs.
       *
       * @param {Object} model_inputs The inputs to the model.
       * @returns {Promise<QuestionAnsweringModelOutput>} An object containing the model's output logits for question answering.
       */
      async _call(model_inputs) {
        return new QuestionAnsweringModelOutput(await super._call(model_inputs));
      }
    };
    ElectraPreTrainedModel = class extends PreTrainedModel {
    };
    ElectraModel = class extends ElectraPreTrainedModel {
    };
    ElectraForMaskedLM = class extends ElectraPreTrainedModel {
      /**
       * Calls the model on new inputs.
       *
       * @param {Object} model_inputs The inputs to the model.
       * @returns {Promise<MaskedLMOutput>} An object containing the model's output logits for masked language modeling.
       */
      async _call(model_inputs) {
        return new MaskedLMOutput(await super._call(model_inputs));
      }
    };
    ElectraForSequenceClassification = class extends ElectraPreTrainedModel {
      /**
       * Calls the model on new inputs.
       *
       * @param {Object} model_inputs The inputs to the model.
       * @returns {Promise<SequenceClassifierOutput>} An object containing the model's output logits for sequence classification.
       */
      async _call(model_inputs) {
        return new SequenceClassifierOutput(await super._call(model_inputs));
      }
    };
    ElectraForTokenClassification = class extends ElectraPreTrainedModel {
      /**
       * Calls the model on new inputs.
       *
       * @param {Object} model_inputs The inputs to the model.
       * @returns {Promise<TokenClassifierOutput>} An object containing the model's output logits for token classification.
       */
      async _call(model_inputs) {
        return new TokenClassifierOutput(await super._call(model_inputs));
      }
    };
    ElectraForQuestionAnswering = class extends ElectraPreTrainedModel {
      /**
       * Calls the model on new inputs.
       *
       * @param {Object} model_inputs The inputs to the model.
       * @returns {Promise<QuestionAnsweringModelOutput>} An object containing the model's output logits for question answering.
       */
      async _call(model_inputs) {
        return new QuestionAnsweringModelOutput(await super._call(model_inputs));
      }
    };
    CamembertPreTrainedModel = class extends PreTrainedModel {
    };
    CamembertModel = class extends CamembertPreTrainedModel {
    };
    CamembertForMaskedLM = class extends CamembertPreTrainedModel {
      /**
       * Calls the model on new inputs.
       *
       * @param {Object} model_inputs The inputs to the model.
       * @returns {Promise<MaskedLMOutput>} An object containing the model's output logits for masked language modeling.
       */
      async _call(model_inputs) {
        return new MaskedLMOutput(await super._call(model_inputs));
      }
    };
    CamembertForSequenceClassification = class extends CamembertPreTrainedModel {
      /**
       * Calls the model on new inputs.
       *
       * @param {Object} model_inputs The inputs to the model.
       * @returns {Promise<SequenceClassifierOutput>} An object containing the model's output logits for sequence classification.
       */
      async _call(model_inputs) {
        return new SequenceClassifierOutput(await super._call(model_inputs));
      }
    };
    CamembertForTokenClassification = class extends CamembertPreTrainedModel {
      /**
       * Calls the model on new inputs.
       *
       * @param {Object} model_inputs The inputs to the model.
       * @returns {Promise<TokenClassifierOutput>} An object containing the model's output logits for token classification.
       */
      async _call(model_inputs) {
        return new TokenClassifierOutput(await super._call(model_inputs));
      }
    };
    CamembertForQuestionAnswering = class extends CamembertPreTrainedModel {
      /**
       * Calls the model on new inputs.
       *
       * @param {Object} model_inputs The inputs to the model.
       * @returns {Promise<QuestionAnsweringModelOutput>} An object containing the model's output logits for question answering.
       */
      async _call(model_inputs) {
        return new QuestionAnsweringModelOutput(await super._call(model_inputs));
      }
    };
    DebertaPreTrainedModel = class extends PreTrainedModel {
    };
    DebertaModel = class extends DebertaPreTrainedModel {
    };
    DebertaForMaskedLM = class extends DebertaPreTrainedModel {
      /**
       * Calls the model on new inputs.
       *
       * @param {Object} model_inputs The inputs to the model.
       * @returns {Promise<MaskedLMOutput>} An object containing the model's output logits for masked language modeling.
       */
      async _call(model_inputs) {
        return new MaskedLMOutput(await super._call(model_inputs));
      }
    };
    DebertaForSequenceClassification = class extends DebertaPreTrainedModel {
      /**
       * Calls the model on new inputs.
       *
       * @param {Object} model_inputs The inputs to the model.
       * @returns {Promise<SequenceClassifierOutput>} An object containing the model's output logits for sequence classification.
       */
      async _call(model_inputs) {
        return new SequenceClassifierOutput(await super._call(model_inputs));
      }
    };
    DebertaForTokenClassification = class extends DebertaPreTrainedModel {
      /**
       * Calls the model on new inputs.
       *
       * @param {Object} model_inputs The inputs to the model.
       * @returns {Promise<TokenClassifierOutput>} An object containing the model's output logits for token classification.
       */
      async _call(model_inputs) {
        return new TokenClassifierOutput(await super._call(model_inputs));
      }
    };
    DebertaForQuestionAnswering = class extends DebertaPreTrainedModel {
      /**
       * Calls the model on new inputs.
       *
       * @param {Object} model_inputs The inputs to the model.
       * @returns {Promise<QuestionAnsweringModelOutput>} An object containing the model's output logits for question answering.
       */
      async _call(model_inputs) {
        return new QuestionAnsweringModelOutput(await super._call(model_inputs));
      }
    };
    DebertaV2PreTrainedModel = class extends PreTrainedModel {
    };
    DebertaV2Model = class extends DebertaV2PreTrainedModel {
    };
    DebertaV2ForMaskedLM = class extends DebertaV2PreTrainedModel {
      /**
       * Calls the model on new inputs.
       *
       * @param {Object} model_inputs The inputs to the model.
       * @returns {Promise<MaskedLMOutput>} An object containing the model's output logits for masked language modeling.
       */
      async _call(model_inputs) {
        return new MaskedLMOutput(await super._call(model_inputs));
      }
    };
    DebertaV2ForSequenceClassification = class extends DebertaV2PreTrainedModel {
      /**
       * Calls the model on new inputs.
       *
       * @param {Object} model_inputs The inputs to the model.
       * @returns {Promise<SequenceClassifierOutput>} An object containing the model's output logits for sequence classification.
       */
      async _call(model_inputs) {
        return new SequenceClassifierOutput(await super._call(model_inputs));
      }
    };
    DebertaV2ForTokenClassification = class extends DebertaV2PreTrainedModel {
      /**
       * Calls the model on new inputs.
       *
       * @param {Object} model_inputs The inputs to the model.
       * @returns {Promise<TokenClassifierOutput>} An object containing the model's output logits for token classification.
       */
      async _call(model_inputs) {
        return new TokenClassifierOutput(await super._call(model_inputs));
      }
    };
    DebertaV2ForQuestionAnswering = class extends DebertaV2PreTrainedModel {
      /**
       * Calls the model on new inputs.
       *
       * @param {Object} model_inputs The inputs to the model.
       * @returns {Promise<QuestionAnsweringModelOutput>} An object containing the model's output logits for question answering.
       */
      async _call(model_inputs) {
        return new QuestionAnsweringModelOutput(await super._call(model_inputs));
      }
    };
    DistilBertPreTrainedModel = class extends PreTrainedModel {
    };
    DistilBertModel = class extends DistilBertPreTrainedModel {
    };
    DistilBertForSequenceClassification = class extends DistilBertPreTrainedModel {
      /**
       * Calls the model on new inputs.
       *
       * @param {Object} model_inputs The inputs to the model.
       * @returns {Promise<SequenceClassifierOutput>} An object containing the model's output logits for sequence classification.
       */
      async _call(model_inputs) {
        return new SequenceClassifierOutput(await super._call(model_inputs));
      }
    };
    DistilBertForTokenClassification = class extends DistilBertPreTrainedModel {
      /**
       * Calls the model on new inputs.
       *
       * @param {Object} model_inputs The inputs to the model.
       * @returns {Promise<TokenClassifierOutput>} An object containing the model's output logits for token classification.
       */
      async _call(model_inputs) {
        return new TokenClassifierOutput(await super._call(model_inputs));
      }
    };
    DistilBertForQuestionAnswering = class extends DistilBertPreTrainedModel {
      /**
       * Calls the model on new inputs.
       *
       * @param {Object} model_inputs The inputs to the model.
       * @returns {Promise<QuestionAnsweringModelOutput>} An object containing the model's output logits for question answering.
       */
      async _call(model_inputs) {
        return new QuestionAnsweringModelOutput(await super._call(model_inputs));
      }
    };
    DistilBertForMaskedLM = class extends DistilBertPreTrainedModel {
      /**
       * Calls the model on new inputs.
       *
       * @param {Object} model_inputs The inputs to the model.
       * @returns {Promise<MaskedLMOutput>} returned object
       */
      async _call(model_inputs) {
        return new MaskedLMOutput(await super._call(model_inputs));
      }
    };
    EsmPreTrainedModel = class extends PreTrainedModel {
    };
    EsmModel = class extends EsmPreTrainedModel {
    };
    EsmForMaskedLM = class extends EsmPreTrainedModel {
      /**
       * Calls the model on new inputs.
       *
       * @param {Object} model_inputs The inputs to the model.
       * @returns {Promise<MaskedLMOutput>} An object containing the model's output logits for masked language modeling.
       */
      async _call(model_inputs) {
        return new MaskedLMOutput(await super._call(model_inputs));
      }
    };
    EsmForSequenceClassification = class extends EsmPreTrainedModel {
      /**
       * Calls the model on new inputs.
       *
       * @param {Object} model_inputs The inputs to the model.
       * @returns {Promise<SequenceClassifierOutput>} An object containing the model's output logits for sequence classification.
       */
      async _call(model_inputs) {
        return new SequenceClassifierOutput(await super._call(model_inputs));
      }
    };
    EsmForTokenClassification = class extends EsmPreTrainedModel {
      /**
       * Calls the model on new inputs.
       *
       * @param {Object} model_inputs The inputs to the model.
       * @returns {Promise<TokenClassifierOutput>} An object containing the model's output logits for token classification.
       */
      async _call(model_inputs) {
        return new TokenClassifierOutput(await super._call(model_inputs));
      }
    };
    MobileBertPreTrainedModel = class extends PreTrainedModel {
    };
    MobileBertModel = class extends MobileBertPreTrainedModel {
    };
    MobileBertForMaskedLM = class extends MobileBertPreTrainedModel {
      /**
       * Calls the model on new inputs.
       *
       * @param {Object} model_inputs The inputs to the model.
       * @returns {Promise<MaskedLMOutput>} returned object
       */
      async _call(model_inputs) {
        return new MaskedLMOutput(await super._call(model_inputs));
      }
    };
    MobileBertForSequenceClassification = class extends MobileBertPreTrainedModel {
      /**
       * Calls the model on new inputs.
       *
       * @param {Object} model_inputs The inputs to the model.
       * @returns {Promise<SequenceClassifierOutput>} returned object
       */
      async _call(model_inputs) {
        return new SequenceClassifierOutput(await super._call(model_inputs));
      }
    };
    MobileBertForQuestionAnswering = class extends MobileBertPreTrainedModel {
      /**
       * Calls the model on new inputs.
       *
       * @param {Object} model_inputs The inputs to the model.
       * @returns {Promise<QuestionAnsweringModelOutput>} returned object
       */
      async _call(model_inputs) {
        return new QuestionAnsweringModelOutput(await super._call(model_inputs));
      }
    };
    MPNetPreTrainedModel = class extends PreTrainedModel {
    };
    MPNetModel = class extends MPNetPreTrainedModel {
    };
    MPNetForMaskedLM = class extends MPNetPreTrainedModel {
      /**
       * Calls the model on new inputs.
       *
       * @param {Object} model_inputs The inputs to the model.
       * @returns {Promise<MaskedLMOutput>} An object containing the model's output logits for masked language modeling.
       */
      async _call(model_inputs) {
        return new MaskedLMOutput(await super._call(model_inputs));
      }
    };
    MPNetForSequenceClassification = class extends MPNetPreTrainedModel {
      /**
       * Calls the model on new inputs.
       *
       * @param {Object} model_inputs The inputs to the model.
       * @returns {Promise<SequenceClassifierOutput>} An object containing the model's output logits for sequence classification.
       */
      async _call(model_inputs) {
        return new SequenceClassifierOutput(await super._call(model_inputs));
      }
    };
    MPNetForTokenClassification = class extends MPNetPreTrainedModel {
      /**
       * Calls the model on new inputs.
       *
       * @param {Object} model_inputs The inputs to the model.
       * @returns {Promise<TokenClassifierOutput>} An object containing the model's output logits for token classification.
       */
      async _call(model_inputs) {
        return new TokenClassifierOutput(await super._call(model_inputs));
      }
    };
    MPNetForQuestionAnswering = class extends MPNetPreTrainedModel {
      /**
       * Calls the model on new inputs.
       *
       * @param {Object} model_inputs The inputs to the model.
       * @returns {Promise<QuestionAnsweringModelOutput>} An object containing the model's output logits for question answering.
       */
      async _call(model_inputs) {
        return new QuestionAnsweringModelOutput(await super._call(model_inputs));
      }
    };
    SqueezeBertPreTrainedModel = class extends PreTrainedModel {
    };
    SqueezeBertModel = class extends SqueezeBertPreTrainedModel {
    };
    SqueezeBertForMaskedLM = class extends SqueezeBertPreTrainedModel {
      /**
       * Calls the model on new inputs.
       *
       * @param {Object} model_inputs The inputs to the model.
       * @returns {Promise<MaskedLMOutput>} returned object
       */
      async _call(model_inputs) {
        return new MaskedLMOutput(await super._call(model_inputs));
      }
    };
    SqueezeBertForSequenceClassification = class extends SqueezeBertPreTrainedModel {
      /**
       * Calls the model on new inputs.
       *
       * @param {Object} model_inputs The inputs to the model.
       * @returns {Promise<SequenceClassifierOutput>} returned object
       */
      async _call(model_inputs) {
        return new SequenceClassifierOutput(await super._call(model_inputs));
      }
    };
    SqueezeBertForQuestionAnswering = class extends SqueezeBertPreTrainedModel {
      /**
       * Calls the model on new inputs.
       *
       * @param {Object} model_inputs The inputs to the model.
       * @returns {Promise<QuestionAnsweringModelOutput>} returned object
       */
      async _call(model_inputs) {
        return new QuestionAnsweringModelOutput(await super._call(model_inputs));
      }
    };
    AlbertPreTrainedModel = class extends PreTrainedModel {
    };
    AlbertModel = class extends AlbertPreTrainedModel {
    };
    AlbertForSequenceClassification = class extends AlbertPreTrainedModel {
      /**
       * Calls the model on new inputs.
       *
       * @param {Object} model_inputs The inputs to the model.
       * @returns {Promise<SequenceClassifierOutput>} returned object
       */
      async _call(model_inputs) {
        return new SequenceClassifierOutput(await super._call(model_inputs));
      }
    };
    AlbertForQuestionAnswering = class extends AlbertPreTrainedModel {
      /**
       * Calls the model on new inputs.
       *
       * @param {Object} model_inputs The inputs to the model.
       * @returns {Promise<QuestionAnsweringModelOutput>} returned object
       */
      async _call(model_inputs) {
        return new QuestionAnsweringModelOutput(await super._call(model_inputs));
      }
    };
    AlbertForMaskedLM = class extends AlbertPreTrainedModel {
      /**
       * Calls the model on new inputs.
       *
       * @param {Object} model_inputs The inputs to the model.
       * @returns {Promise<MaskedLMOutput>} returned object
       */
      async _call(model_inputs) {
        return new MaskedLMOutput(await super._call(model_inputs));
      }
    };
    T5PreTrainedModel = class extends PreTrainedModel {
    };
    T5Model = class extends T5PreTrainedModel {
    };
    T5ForConditionalGeneration = class extends T5PreTrainedModel {
      /**
       * Creates a new instance of the `T5ForConditionalGeneration` class.
       * @param {Object} config The model configuration.
       * @param {any} session session for the model.
       * @param {any} decoder_merged_session session for the decoder.
       * @param {GenerationConfig} generation_config The generation configuration.
       */
      constructor(config, session, decoder_merged_session, generation_config) {
        super(config, session);
        this.decoder_merged_session = decoder_merged_session;
        this.generation_config = generation_config;
        this.num_decoder_layers = this.config.num_decoder_layers;
        this.num_decoder_heads = this.config.num_heads;
        this.decoder_dim_kv = this.config.d_kv;
        this.num_encoder_layers = this.config.num_layers;
        this.num_encoder_heads = this.config.num_heads;
        this.encoder_dim_kv = this.config.d_kv;
      }
    };
    LongT5PreTrainedModel = class extends PreTrainedModel {
    };
    LongT5Model = class extends LongT5PreTrainedModel {
    };
    LongT5ForConditionalGeneration = class extends LongT5PreTrainedModel {
      /**
       * Creates a new instance of the `LongT5ForConditionalGeneration` class.
       * @param {Object} config The model configuration.
       * @param {any} session session for the model.
       * @param {any} decoder_merged_session session for the decoder.
       * @param {GenerationConfig} generation_config The generation configuration.
       */
      constructor(config, session, decoder_merged_session, generation_config) {
        super(config, session);
        this.decoder_merged_session = decoder_merged_session;
        this.generation_config = generation_config;
        this.num_decoder_layers = this.config.num_decoder_layers;
        this.num_decoder_heads = this.config.num_heads;
        this.decoder_dim_kv = this.config.d_kv;
        this.num_encoder_layers = this.config.num_layers;
        this.num_encoder_heads = this.config.num_heads;
        this.encoder_dim_kv = this.config.d_kv;
      }
    };
    MT5PreTrainedModel = class extends PreTrainedModel {
    };
    MT5Model = class extends MT5PreTrainedModel {
    };
    MT5ForConditionalGeneration = class extends MT5PreTrainedModel {
      /**
       * Creates a new instance of the `MT5ForConditionalGeneration` class.
       * @param {any} config The model configuration.
       * @param {any} session The ONNX session containing the encoder weights.
       * @param {any} decoder_merged_session The ONNX session containing the merged decoder weights.
       * @param {GenerationConfig} generation_config The generation configuration.
       */
      constructor(config, session, decoder_merged_session, generation_config) {
        super(config, session);
        this.decoder_merged_session = decoder_merged_session;
        this.generation_config = generation_config;
        this.num_decoder_layers = this.config.num_decoder_layers;
        this.num_decoder_heads = this.config.num_heads;
        this.decoder_dim_kv = this.config.d_kv;
        this.num_encoder_layers = this.config.num_layers;
        this.num_encoder_heads = this.config.num_heads;
        this.encoder_dim_kv = this.config.d_kv;
      }
    };
    BartPretrainedModel = class extends PreTrainedModel {
    };
    BartModel = class extends BartPretrainedModel {
    };
    BartForConditionalGeneration = class extends BartPretrainedModel {
      /**
       * Creates a new instance of the `BartForConditionalGeneration` class.
       * @param {Object} config The configuration object for the Bart model.
       * @param {Object} session The ONNX session used to execute the model.
       * @param {Object} decoder_merged_session The ONNX session used to execute the decoder.
       * @param {Object} generation_config The generation configuration object.
       */
      constructor(config, session, decoder_merged_session, generation_config) {
        super(config, session);
        this.decoder_merged_session = decoder_merged_session;
        this.generation_config = generation_config;
        this.num_decoder_layers = this.config.decoder_layers;
        this.num_decoder_heads = this.config.decoder_attention_heads;
        this.decoder_dim_kv = this.config.d_model / this.num_decoder_heads;
        this.num_encoder_layers = this.config.encoder_layers;
        this.num_encoder_heads = this.config.encoder_attention_heads;
        this.encoder_dim_kv = this.config.d_model / this.num_encoder_heads;
      }
    };
    BartForSequenceClassification = class extends BartPretrainedModel {
      /**
       * Calls the model on new inputs.
       *
       * @param {Object} model_inputs The inputs to the model.
       * @returns {Promise<SequenceClassifierOutput>} An object containing the model's output logits for sequence classification.
       */
      async _call(model_inputs) {
        return new SequenceClassifierOutput(await super._call(model_inputs));
      }
    };
    MBartPreTrainedModel = class extends PreTrainedModel {
    };
    MBartModel = class extends MBartPreTrainedModel {
    };
    MBartForConditionalGeneration = class extends MBartPreTrainedModel {
      /**
       * Creates a new instance of the `MBartForConditionalGeneration` class.
       * @param {Object} config The configuration object for the Bart model.
       * @param {Object} session The ONNX session used to execute the model.
       * @param {Object} decoder_merged_session The ONNX session used to execute the decoder.
       * @param {Object} generation_config The generation configuration object.
       */
      constructor(config, session, decoder_merged_session, generation_config) {
        super(config, session);
        this.decoder_merged_session = decoder_merged_session;
        this.generation_config = generation_config;
        this.num_decoder_layers = this.config.decoder_layers;
        this.num_decoder_heads = this.config.decoder_attention_heads;
        this.decoder_dim_kv = this.config.d_model / this.num_decoder_heads;
        this.num_encoder_layers = this.config.encoder_layers;
        this.num_encoder_heads = this.config.encoder_attention_heads;
        this.encoder_dim_kv = this.config.d_model / this.num_encoder_heads;
      }
    };
    MBartForSequenceClassification = class extends MBartPreTrainedModel {
      /**
       * Calls the model on new inputs.
       *
       * @param {Object} model_inputs The inputs to the model.
       * @returns {Promise<SequenceClassifierOutput>} An object containing the model's output logits for sequence classification.
       */
      async _call(model_inputs) {
        return new SequenceClassifierOutput(await super._call(model_inputs));
      }
    };
    MBartForCausalLM = class extends MBartPreTrainedModel {
      /**
       * Creates a new instance of the `MBartForCausalLM` class.
       * @param {Object} config Configuration object for the model.
       * @param {Object} decoder_merged_session ONNX Session object for the decoder.
       * @param {Object} generation_config Configuration object for the generation process.
       */
      constructor(config, decoder_merged_session, generation_config) {
        super(config, decoder_merged_session);
        this.generation_config = generation_config;
        this.num_decoder_layers = this.config.decoder_layers;
        this.num_decoder_heads = this.config.decoder_attention_heads;
        this.decoder_dim_kv = this.config.d_model / this.num_decoder_heads;
        this.num_encoder_layers = this.config.encoder_layers;
        this.num_encoder_heads = this.config.encoder_attention_heads;
        this.encoder_dim_kv = this.config.d_model / this.num_encoder_heads;
      }
    };
    BlenderbotPreTrainedModel = class extends PreTrainedModel {
    };
    BlenderbotModel = class extends BlenderbotPreTrainedModel {
    };
    BlenderbotForConditionalGeneration = class extends BlenderbotPreTrainedModel {
      /**
       * Creates a new instance of the `BlenderbotForConditionalGeneration` class.
       * @param {any} config The model configuration.
       * @param {any} session The ONNX session containing the encoder weights.
       * @param {any} decoder_merged_session The ONNX session containing the merged decoder weights.
       * @param {GenerationConfig} generation_config The generation configuration.
       */
      constructor(config, session, decoder_merged_session, generation_config) {
        super(config, session);
        this.decoder_merged_session = decoder_merged_session;
        this.generation_config = generation_config;
        this.num_decoder_layers = this.config.decoder_layers;
        this.num_decoder_heads = this.config.decoder_attention_heads;
        this.decoder_dim_kv = this.config.d_model / this.num_decoder_heads;
        this.num_encoder_layers = this.config.encoder_layers;
        this.num_encoder_heads = this.config.encoder_attention_heads;
        this.encoder_dim_kv = this.config.d_model / this.num_encoder_heads;
      }
    };
    BlenderbotSmallPreTrainedModel = class extends PreTrainedModel {
    };
    BlenderbotSmallModel = class extends BlenderbotSmallPreTrainedModel {
    };
    BlenderbotSmallForConditionalGeneration = class extends BlenderbotSmallPreTrainedModel {
      /**
       * Creates a new instance of the `BlenderbotForConditionalGeneration` class.
       * @param {any} config The model configuration.
       * @param {any} session The ONNX session containing the encoder weights.
       * @param {any} decoder_merged_session The ONNX session containing the merged decoder weights.
       * @param {GenerationConfig} generation_config The generation configuration.
       */
      constructor(config, session, decoder_merged_session, generation_config) {
        super(config, session);
        this.decoder_merged_session = decoder_merged_session;
        this.generation_config = generation_config;
        this.num_decoder_layers = this.config.decoder_layers;
        this.num_decoder_heads = this.config.decoder_attention_heads;
        this.decoder_dim_kv = this.config.d_model / this.num_decoder_heads;
        this.num_encoder_layers = this.config.encoder_layers;
        this.num_encoder_heads = this.config.encoder_attention_heads;
        this.encoder_dim_kv = this.config.d_model / this.num_encoder_heads;
      }
    };
    RobertaPreTrainedModel = class extends PreTrainedModel {
    };
    RobertaModel = class extends RobertaPreTrainedModel {
    };
    RobertaForMaskedLM = class extends RobertaPreTrainedModel {
      /**
       * Calls the model on new inputs.
       *
       * @param {Object} model_inputs The inputs to the model.
       * @returns {Promise<MaskedLMOutput>} returned object
       */
      async _call(model_inputs) {
        return new MaskedLMOutput(await super._call(model_inputs));
      }
    };
    RobertaForSequenceClassification = class extends RobertaPreTrainedModel {
      /**
       * Calls the model on new inputs.
       *
       * @param {Object} model_inputs The inputs to the model.
       * @returns {Promise<SequenceClassifierOutput>} returned object
       */
      async _call(model_inputs) {
        return new SequenceClassifierOutput(await super._call(model_inputs));
      }
    };
    RobertaForTokenClassification = class extends RobertaPreTrainedModel {
      /**
       * Calls the model on new inputs.
       *
       * @param {Object} model_inputs The inputs to the model.
       * @returns {Promise<TokenClassifierOutput>} An object containing the model's output logits for token classification.
       */
      async _call(model_inputs) {
        return new TokenClassifierOutput(await super._call(model_inputs));
      }
    };
    RobertaForQuestionAnswering = class extends RobertaPreTrainedModel {
      /**
       * Calls the model on new inputs.
       *
       * @param {Object} model_inputs The inputs to the model.
       * @returns {Promise<QuestionAnsweringModelOutput>} returned object
       */
      async _call(model_inputs) {
        return new QuestionAnsweringModelOutput(await super._call(model_inputs));
      }
    };
    XLMPreTrainedModel = class extends PreTrainedModel {
    };
    XLMModel = class extends XLMPreTrainedModel {
    };
    XLMWithLMHeadModel = class extends XLMPreTrainedModel {
      /**
       * Calls the model on new inputs.
       *
       * @param {Object} model_inputs The inputs to the model.
       * @returns {Promise<MaskedLMOutput>} returned object
       */
      async _call(model_inputs) {
        return new MaskedLMOutput(await super._call(model_inputs));
      }
    };
    XLMForSequenceClassification = class extends XLMPreTrainedModel {
      /**
       * Calls the model on new inputs.
       *
       * @param {Object} model_inputs The inputs to the model.
       * @returns {Promise<SequenceClassifierOutput>} returned object
       */
      async _call(model_inputs) {
        return new SequenceClassifierOutput(await super._call(model_inputs));
      }
    };
    XLMForTokenClassification = class extends XLMPreTrainedModel {
      /**
       * Calls the model on new inputs.
       *
       * @param {Object} model_inputs The inputs to the model.
       * @returns {Promise<TokenClassifierOutput>} An object containing the model's output logits for token classification.
       */
      async _call(model_inputs) {
        return new TokenClassifierOutput(await super._call(model_inputs));
      }
    };
    XLMForQuestionAnswering = class extends XLMPreTrainedModel {
      /**
       * Calls the model on new inputs.
       *
       * @param {Object} model_inputs The inputs to the model.
       * @returns {Promise<QuestionAnsweringModelOutput>} returned object
       */
      async _call(model_inputs) {
        return new QuestionAnsweringModelOutput(await super._call(model_inputs));
      }
    };
    XLMRobertaPreTrainedModel = class extends PreTrainedModel {
    };
    XLMRobertaModel = class extends XLMRobertaPreTrainedModel {
    };
    XLMRobertaForMaskedLM = class extends XLMRobertaPreTrainedModel {
      /**
       * Calls the model on new inputs.
       *
       * @param {Object} model_inputs The inputs to the model.
       * @returns {Promise<MaskedLMOutput>} returned object
       */
      async _call(model_inputs) {
        return new MaskedLMOutput(await super._call(model_inputs));
      }
    };
    XLMRobertaForSequenceClassification = class extends XLMRobertaPreTrainedModel {
      /**
       * Calls the model on new inputs.
       *
       * @param {Object} model_inputs The inputs to the model.
       * @returns {Promise<SequenceClassifierOutput>} returned object
       */
      async _call(model_inputs) {
        return new SequenceClassifierOutput(await super._call(model_inputs));
      }
    };
    XLMRobertaForTokenClassification = class extends XLMRobertaPreTrainedModel {
      /**
       * Calls the model on new inputs.
       *
       * @param {Object} model_inputs The inputs to the model.
       * @returns {Promise<TokenClassifierOutput>} An object containing the model's output logits for token classification.
       */
      async _call(model_inputs) {
        return new TokenClassifierOutput(await super._call(model_inputs));
      }
    };
    XLMRobertaForQuestionAnswering = class extends XLMRobertaPreTrainedModel {
      /**
       * Calls the model on new inputs.
       *
       * @param {Object} model_inputs The inputs to the model.
       * @returns {Promise<QuestionAnsweringModelOutput>} returned object
       */
      async _call(model_inputs) {
        return new QuestionAnsweringModelOutput(await super._call(model_inputs));
      }
    };
    ASTPreTrainedModel = class extends PreTrainedModel {
    };
    ASTModel = class extends ASTPreTrainedModel {
    };
    ASTForAudioClassification = class extends ASTPreTrainedModel {
    };
    WhisperPreTrainedModel = class extends PreTrainedModel {
    };
    WhisperModel = class extends WhisperPreTrainedModel {
    };
    WhisperForConditionalGeneration = class extends WhisperPreTrainedModel {
      requires_attention_mask = false;
      main_input_name = "input_features";
      /**
       * Creates a new instance of the `WhisperForConditionalGeneration` class.
       * @param {Object} config Configuration object for the model.
       * @param {Object} session ONNX Session object for the model.
       * @param {Object} decoder_merged_session ONNX Session object for the decoder.
       * @param {Object} generation_config Configuration object for the generation process.
       */
      constructor(config, session, decoder_merged_session, generation_config) {
        super(config, session);
        this.decoder_merged_session = decoder_merged_session;
        this.generation_config = generation_config;
        this.num_decoder_layers = this.config.decoder_layers;
        this.num_decoder_heads = this.config.decoder_attention_heads;
        this.decoder_dim_kv = this.config.d_model / this.num_decoder_heads;
        this.num_encoder_layers = this.config.encoder_layers;
        this.num_encoder_heads = this.config.encoder_attention_heads;
        this.encoder_dim_kv = this.config.d_model / this.num_encoder_heads;
      }
      /**
       * @typedef {Object} WhisperGenerationConfig
       * @extends GenerationConfig
       * @property {boolean} [return_timestamps=null] Whether to return the timestamps with the text. This enables the `WhisperTimestampsLogitsProcessor`.
       * @property {boolean} [return_token_timestamps=null] Whether to return token-level timestamps
       * with the text. This can be used with or without the `return_timestamps` option. To get word-level
       * timestamps, use the tokenizer to group the tokens into words.
       * @property {number} [num_frames=null]  The number of audio frames available in this chunk. This is only used generating word-level timestamps.
       */
      /**
       * Generates outputs based on input and generation configuration.
       * @param {Object} inputs Input data for the model.
       * @param {WhisperGenerationConfig} generation_config Configuration object for the generation process.
       * @param {Object} logits_processor Optional logits processor object.
       * @returns {Promise<Object>} Promise object represents the generated outputs.
       */
      async generate(inputs, generation_config = null, logits_processor = null) {
        generation_config = this._get_generation_config(generation_config);
        generation_config.return_timestamps ??= false;
        if (generation_config.return_timestamps) {
          logits_processor = [new WhisperTimeStampLogitsProcessor(generation_config)];
        }
        if (generation_config.return_token_timestamps) {
          generation_config.output_attentions = true;
          generation_config.return_dict_in_generate = true;
          if (generation_config.task === "translate") {
            console.warn("Token-level timestamps may not be reliable for task 'translate'.");
          }
          if (!generation_config.alignment_heads) {
            throw new Error(
              "Model generation config has no `alignment_heads`, token-level timestamps not available. See https://gist.github.com/hollance/42e32852f24243b748ae6bc1f985b13a on how to add this property to the generation config."
            );
          }
        }
        const outputs = await super.generate(inputs, generation_config, logits_processor);
        if (generation_config.return_token_timestamps && generation_config.alignment_heads) {
          outputs["token_timestamps"] = this._extract_token_timestamps(
            outputs,
            generation_config.alignment_heads,
            generation_config.num_frames
          );
        }
        return outputs;
      }
      /**
       * Calculates token-level timestamps using the encoder-decoder cross-attentions and
       * dynamic time-warping (DTW) to map each output token to a position in the input audio.
       * @param {Object} generate_outputs Outputs generated by the model
       * @param {Tensor[][][]} generate_outputs.cross_attentions The cross attentions output by the model
       * @param {Tensor[][][]} generate_outputs.decoder_attentions The decoder attentions output by the model
       * @param {number[][]} generate_outputs.sequences The sequences output by the model
       * @param {number[][]} alignment_heads Alignment heads of the model
       * @param {number} [num_frames=null] Number of frames in the input audio.
       * @param {number} [time_precision=0.02] Precision of the timestamps in seconds
       * @returns {Tensor} tensor containing the timestamps in seconds for each predicted token
       */
      _extract_token_timestamps(generate_outputs, alignment_heads, num_frames = null, time_precision = 0.02) {
        if (!generate_outputs.cross_attentions) {
          throw new Error(
            "Model outputs must contain cross attentions to extract timestamps. This is most likely because the model was not exported with `output_attentions=True`."
          );
        }
        let median_filter_width = this.config.median_filter_width;
        if (median_filter_width === void 0) {
          console.warn("Model config has no `median_filter_width`, using default value of 7.");
          median_filter_width = 7;
        }
        const batchedMatrices = generate_outputs.cross_attentions.map((batch) => {
          let cross_attentions = Array.from(
            { length: this.config.decoder_layers },
            (_, i) => cat(batch.map((x) => x[i]), 2)
          );
          let weights = stack(alignment_heads.map(([l, h]) => {
            return num_frames ? cross_attentions[l].slice(null, h, null, [0, num_frames]) : cross_attentions[l].slice(null, h);
          }));
          weights = weights.transpose(1, 0, 2, 3);
          let [std, calculatedMean] = std_mean(weights, -2, 0, true);
          let smoothedWeights = weights.clone();
          for (let a = 0; a < smoothedWeights.dims[0]; ++a) {
            let aTensor = smoothedWeights[a];
            for (let b = 0; b < aTensor.dims[0]; ++b) {
              let bTensor = aTensor[b];
              const stdTensor = std[a][b][0];
              const meanTensor = calculatedMean[a][b][0];
              for (let c = 0; c < bTensor.dims[0]; ++c) {
                let cTensor = bTensor[c];
                for (let d = 0; d < cTensor.data.length; ++d) {
                  cTensor.data[d] = (cTensor.data[d] - meanTensor.data[d]) / stdTensor.data[d];
                }
                cTensor.data.set(medianFilter(cTensor.data, median_filter_width));
              }
            }
          }
          const matrix = mean(smoothedWeights, 1);
          return matrix;
        });
        const timestampsShape = [generate_outputs.sequences.length, generate_outputs.sequences[0].length];
        const timestamps = new Tensor(
          "float32",
          new Float32Array(timestampsShape[0] * timestampsShape[1]),
          timestampsShape
        );
        for (let batch_idx = 0; batch_idx < timestampsShape[0]; ++batch_idx) {
          const matrix = batchedMatrices[batch_idx].neg().squeeze_(0);
          let [text_indices, time_indices] = dynamicTimeWarping(matrix);
          let diffs = Array.from({ length: text_indices.length - 1 }, (v, i) => text_indices[i + 1] - text_indices[i]);
          let jumps = mergeArrays([1], diffs).map((x) => !!x);
          let jump_times = [];
          for (let i = 0; i < jumps.length; ++i) {
            if (jumps[i]) {
              jump_times.push(time_indices[i] * time_precision);
            }
          }
          timestamps[batch_idx].data.set(jump_times, 1);
        }
        return timestamps;
      }
    };
    VisionEncoderDecoderModel = class extends PreTrainedModel {
      main_input_name = "pixel_values";
      /**
       * Creates a new instance of the `VisionEncoderDecoderModel` class.
       * @param {Object} config The configuration object specifying the hyperparameters and other model settings.
       * @param {Object} session The ONNX session containing the encoder model.
       * @param {any} decoder_merged_session The ONNX session containing the merged decoder model.
       * @param {Object} generation_config Configuration object for the generation process.
       */
      constructor(config, session, decoder_merged_session, generation_config) {
        super(config, session);
        this.decoder_merged_session = decoder_merged_session;
        this.generation_config = generation_config;
        const encoderConfig = this.config.encoder;
        const decoderConfig = this.config.decoder;
        const encoderModelType = encoderConfig.model_type;
        const encoderModel = MODEL_MAPPING_NAMES_ENCODER_ONLY.get(encoderModelType) ?? MODEL_MAPPING_NAMES_ENCODER_DECODER.get(encoderModelType);
        if (!encoderModel) {
          console.warn(`Model type for encoder '${encoderModelType}' not found, assuming encoder-only architecture. Please report this at https://github.com/xenova/transformers.js/issues/new/choose.`);
        }
        const decoderModel = MODEL_WITH_LM_HEAD_MAPPING_NAMES.get(decoderConfig.model_type);
        if (!decoderModel) {
          throw new Error(`Unable to construct \`VisionEncoderDecoder\` due to unsupported decoder: "${this.config.decoder.model_type}"`);
        }
        const decoderModelClass = decoderModel[1];
        const decoder = new decoderModelClass(decoderConfig, decoder_merged_session, generation_config);
        this.add_encoder_pkv = "num_decoder_layers" in decoder;
        if (this.add_encoder_pkv) {
          this.num_decoder_layers = decoder.num_decoder_layers;
          this.num_decoder_heads = decoder.num_decoder_heads;
          this.decoder_dim_kv = decoder.decoder_dim_kv;
          this.num_encoder_layers = decoder.num_encoder_layers;
          this.num_encoder_heads = decoder.num_encoder_heads;
          this.encoder_dim_kv = decoder.encoder_dim_kv;
        } else {
          this.num_layers = decoder.num_layers;
          this.num_heads = decoder.num_heads;
          this.dim_kv = decoder.dim_kv;
        }
      }
    };
    CLIPPreTrainedModel = class extends PreTrainedModel {
    };
    CLIPModel = class extends CLIPPreTrainedModel {
    };
    CLIPTextModelWithProjection = class extends CLIPPreTrainedModel {
      /** @type {PreTrainedModel.from_pretrained} */
      static async from_pretrained(pretrained_model_name_or_path, options = {}) {
        options.model_file_name ??= "text_model";
        return super.from_pretrained(pretrained_model_name_or_path, options);
      }
    };
    CLIPVisionModelWithProjection = class extends CLIPPreTrainedModel {
      /** @type {PreTrainedModel.from_pretrained} */
      static async from_pretrained(pretrained_model_name_or_path, options = {}) {
        options.model_file_name ??= "vision_model";
        return super.from_pretrained(pretrained_model_name_or_path, options);
      }
    };
    SiglipPreTrainedModel = class extends PreTrainedModel {
    };
    SiglipModel = class extends SiglipPreTrainedModel {
    };
    SiglipTextModel = class extends SiglipPreTrainedModel {
      /** @type {PreTrainedModel.from_pretrained} */
      static async from_pretrained(pretrained_model_name_or_path, options = {}) {
        options.model_file_name ??= "text_model";
        return super.from_pretrained(pretrained_model_name_or_path, options);
      }
    };
    SiglipVisionModel = class extends CLIPPreTrainedModel {
      /** @type {PreTrainedModel.from_pretrained} */
      static async from_pretrained(pretrained_model_name_or_path, options = {}) {
        options.model_file_name ??= "vision_model";
        return super.from_pretrained(pretrained_model_name_or_path, options);
      }
    };
    ChineseCLIPPreTrainedModel = class extends PreTrainedModel {
    };
    ChineseCLIPModel = class extends ChineseCLIPPreTrainedModel {
    };
    CLIPSegPreTrainedModel = class extends PreTrainedModel {
    };
    CLIPSegModel = class extends CLIPSegPreTrainedModel {
    };
    CLIPSegForImageSegmentation = class extends CLIPSegPreTrainedModel {
    };
    GPT2PreTrainedModel = class extends PreTrainedModel {
      /**
       * Creates a new instance of the `GPT2PreTrainedModel` class.
       * @param {Object} config The configuration of the model.
       * @param {any} session The ONNX session containing the model weights.
       * @param {GenerationConfig} generation_config The generation configuration.
       */
      constructor(config, session, generation_config) {
        super(config, session);
        this.generation_config = generation_config;
        this.config.pad_token_id = this.config.eos_token_id;
        this.num_heads = this.config.n_head;
        this.num_layers = this.config.n_layer;
        this.dim_kv = this.config.n_embd / this.num_heads;
      }
    };
    GPT2Model = class extends GPT2PreTrainedModel {
    };
    GPT2LMHeadModel = class extends GPT2PreTrainedModel {
    };
    GPTNeoPreTrainedModel = class extends PreTrainedModel {
      /**
       * Creates a new instance of the `GPTNeoPreTrainedModel` class.
       * @param {Object} config The configuration of the model.
       * @param {any} session The ONNX session containing the model weights.
       * @param {GenerationConfig} generation_config The generation configuration.
       */
      constructor(config, session, generation_config) {
        super(config, session);
        this.generation_config = generation_config;
        this.config.pad_token_id = this.config.eos_token_id;
        this.num_heads = this.config.num_heads;
        this.num_layers = this.config.num_layers;
        this.dim_kv = this.config.hidden_size / this.num_heads;
      }
    };
    GPTNeoModel = class extends GPTNeoPreTrainedModel {
    };
    GPTNeoForCausalLM = class extends GPTNeoPreTrainedModel {
    };
    GPTNeoXPreTrainedModel = class extends PreTrainedModel {
      /**
       * Creates a new instance of the `GPTNeoXPreTrainedModel` class.
       * @param {Object} config The configuration of the model.
       * @param {any} session The ONNX session containing the model weights.
       * @param {GenerationConfig} generation_config The generation configuration.
       */
      constructor(config, session, generation_config) {
        super(config, session);
        this.generation_config = generation_config;
        this.config.pad_token_id = this.config.eos_token_id;
        this.num_heads = this.config.num_attention_heads;
        this.num_layers = this.config.num_hidden_layers;
        this.dim_kv = this.config.hidden_size / this.num_heads;
      }
    };
    GPTNeoXModel = class extends GPTNeoXPreTrainedModel {
    };
    GPTNeoXForCausalLM = class extends GPTNeoXPreTrainedModel {
    };
    GPTJPreTrainedModel = class extends PreTrainedModel {
      /**
       * Creates a new instance of the `GPTJPreTrainedModel` class.
       * @param {Object} config The configuration of the model.
       * @param {any} session The ONNX session containing the model weights.
       * @param {GenerationConfig} generation_config The generation configuration.
       */
      constructor(config, session, generation_config) {
        super(config, session);
        this.generation_config = generation_config;
        this.config.pad_token_id = this.config.eos_token_id;
        this.num_heads = this.config.n_head;
        this.num_layers = this.config.n_layer;
        this.dim_kv = this.config.n_embd / this.num_heads;
      }
    };
    GPTJModel = class extends GPTJPreTrainedModel {
    };
    GPTJForCausalLM = class extends GPTJPreTrainedModel {
    };
    GPTBigCodePreTrainedModel = class extends PreTrainedModel {
      /**
       * Creates a new instance of the `GPTBigCodePreTrainedModel` class.
       * @param {Object} config The configuration of the model.
       * @param {any} session The ONNX session containing the model weights.
       * @param {GenerationConfig} generation_config The generation configuration.
       */
      constructor(config, session, generation_config) {
        super(config, session);
        this.generation_config = generation_config;
        this.config.pad_token_id = this.config.eos_token_id;
        this.num_heads = this.config.n_head;
        this.num_layers = this.config.n_layer;
        this.dim_kv = this.config.n_embd / this.num_heads;
      }
    };
    GPTBigCodeModel = class extends GPTBigCodePreTrainedModel {
    };
    GPTBigCodeForCausalLM = class extends GPTBigCodePreTrainedModel {
    };
    CodeGenPreTrainedModel = class extends PreTrainedModel {
      /**
       * Creates a new instance of the `CodeGenPreTrainedModel` class.
       * @param {Object} config The model configuration object.
       * @param {Object} session The ONNX session object.
       * @param {GenerationConfig} generation_config The generation configuration.
       */
      constructor(config, session, generation_config) {
        super(config, session);
        this.generation_config = generation_config;
        this.config.pad_token_id = this.config.eos_token_id;
        this.num_heads = this.config.n_head;
        this.num_layers = this.config.n_layer;
        this.dim_kv = this.config.n_embd / this.num_heads;
      }
    };
    CodeGenModel = class extends CodeGenPreTrainedModel {
    };
    CodeGenForCausalLM = class extends CodeGenPreTrainedModel {
    };
    LlamaPreTrainedModel = class extends PreTrainedModel {
      /**
       * Creates a new instance of the `LlamaPreTrainedModel` class.
       * @param {Object} config The model configuration object.
       * @param {Object} session The ONNX session object.
       * @param {GenerationConfig} generation_config The generation configuration.
       */
      constructor(config, session, generation_config) {
        super(config, session);
        this.generation_config = generation_config;
        this.config.pad_token_id = this.config.eos_token_id;
        this.num_heads = this.config.num_key_value_heads ?? this.config.num_attention_heads;
        this.num_layers = this.config.num_hidden_layers;
        this.dim_kv = this.config.hidden_size / this.config.num_attention_heads;
      }
    };
    LlamaModel = class extends LlamaPreTrainedModel {
    };
    LlamaForCausalLM = class extends LlamaPreTrainedModel {
    };
    Qwen2PreTrainedModel = class extends PreTrainedModel {
      /**
       * Creates a new instance of the `Qwen2PreTrainedModel` class.
       * @param {Object} config The model configuration object.
       * @param {Object} session The ONNX session object.
       * @param {GenerationConfig} generation_config The generation configuration.
       */
      constructor(config, session, generation_config) {
        super(config, session);
        this.generation_config = generation_config;
        this.config.pad_token_id = this.config.eos_token_id;
        this.num_heads = this.config.num_key_value_heads ?? this.config.num_attention_heads;
        this.num_layers = this.config.num_hidden_layers;
        this.dim_kv = this.config.hidden_size / this.config.num_attention_heads;
      }
    };
    Qwen2Model = class extends Qwen2PreTrainedModel {
    };
    Qwen2ForCausalLM = class extends Qwen2PreTrainedModel {
    };
    PhiPreTrainedModel = class extends PreTrainedModel {
      /**
       * Creates a new instance of the `PhiPreTrainedModel` class.
       * @param {Object} config The model configuration object.
       * @param {Object} session The ONNX session object.
       * @param {GenerationConfig} generation_config The generation configuration.
       */
      constructor(config, session, generation_config) {
        super(config, session);
        this.generation_config = generation_config;
        this.config.pad_token_id = this.config.eos_token_id;
        this.num_heads = this.config.num_attention_heads;
        this.num_layers = this.config.num_hidden_layers;
        this.dim_kv = this.config.hidden_size / this.num_heads;
      }
    };
    PhiModel = class extends PhiPreTrainedModel {
    };
    PhiForCausalLM = class extends PhiPreTrainedModel {
    };
    BloomPreTrainedModel = class extends PreTrainedModel {
      /**
       * Creates a new instance of the `BloomPreTrainedModel` class.
       * @param {Object} config The configuration of the model.
       * @param {any} session The ONNX session containing the model weights.
       * @param {GenerationConfig} generation_config The generation configuration.
       */
      constructor(config, session, generation_config) {
        super(config, session);
        this.generation_config = generation_config;
        this.config.pad_token_id = this.config.eos_token_id;
        this.num_heads = this.config.n_head;
        this.num_layers = this.config.n_layer;
        this.dim_kv = this.config.hidden_size / this.num_heads;
      }
    };
    BloomModel = class extends BloomPreTrainedModel {
    };
    BloomForCausalLM = class extends BloomPreTrainedModel {
    };
    MptPreTrainedModel = class extends PreTrainedModel {
      /**
       * Creates a new instance of the `MptPreTrainedModel` class.
       * @param {Object} config The model configuration object.
       * @param {Object} session The ONNX session object.
       * @param {GenerationConfig} generation_config The generation configuration.
       */
      constructor(config, session, generation_config) {
        super(config, session);
        this.generation_config = generation_config;
        this.config.pad_token_id = this.config.eos_token_id;
        this.num_heads = this.config.n_heads;
        this.num_layers = this.config.n_layers;
        this.dim_kv = this.config.d_model / this.num_heads;
      }
    };
    MptModel = class extends MptPreTrainedModel {
    };
    MptForCausalLM = class extends MptPreTrainedModel {
    };
    OPTPreTrainedModel = class extends PreTrainedModel {
      /**
       * Creates a new instance of the `OPTPreTrainedModel` class.
       * @param {Object} config The model configuration object.
       * @param {Object} session The ONNX session object.
       * @param {GenerationConfig} generation_config The generation configuration.
       */
      constructor(config, session, generation_config) {
        super(config, session);
        this.generation_config = generation_config;
        this.config.pad_token_id = this.config.eos_token_id;
        this.num_heads = this.config.num_attention_heads;
        this.num_layers = this.config.num_hidden_layers;
        this.dim_kv = this.config.hidden_size / this.num_heads;
      }
    };
    OPTModel = class extends OPTPreTrainedModel {
    };
    OPTForCausalLM = class extends OPTPreTrainedModel {
    };
    ViTPreTrainedModel = class extends PreTrainedModel {
    };
    ViTModel = class extends ViTPreTrainedModel {
    };
    ViTForImageClassification = class extends ViTPreTrainedModel {
      /**
       * @param {any} model_inputs
       */
      async _call(model_inputs) {
        return new SequenceClassifierOutput(await super._call(model_inputs));
      }
    };
    FastViTPreTrainedModel = class extends PreTrainedModel {
    };
    FastViTModel = class extends FastViTPreTrainedModel {
    };
    FastViTForImageClassification = class extends FastViTPreTrainedModel {
      /**
       * @param {any} model_inputs
       */
      async _call(model_inputs) {
        return new SequenceClassifierOutput(await super._call(model_inputs));
      }
    };
    VitMattePreTrainedModel = class extends PreTrainedModel {
    };
    VitMatteForImageMatting = class extends VitMattePreTrainedModel {
      /**
       * @param {any} model_inputs
       */
      async _call(model_inputs) {
        return new ImageMattingOutput(await super._call(model_inputs));
      }
    };
    MobileViTPreTrainedModel = class extends PreTrainedModel {
    };
    MobileViTModel = class extends MobileViTPreTrainedModel {
    };
    MobileViTForImageClassification = class extends MobileViTPreTrainedModel {
      /**
       * @param {any} model_inputs
       */
      async _call(model_inputs) {
        return new SequenceClassifierOutput(await super._call(model_inputs));
      }
    };
    MobileViTV2PreTrainedModel = class extends PreTrainedModel {
    };
    MobileViTV2Model = class extends MobileViTV2PreTrainedModel {
    };
    MobileViTV2ForImageClassification = class extends MobileViTV2PreTrainedModel {
      /**
       * @param {any} model_inputs
       */
      async _call(model_inputs) {
        return new SequenceClassifierOutput(await super._call(model_inputs));
      }
    };
    OwlViTPreTrainedModel = class extends PreTrainedModel {
    };
    OwlViTModel = class extends OwlViTPreTrainedModel {
    };
    OwlViTForObjectDetection = class extends OwlViTPreTrainedModel {
    };
    Owlv2PreTrainedModel = class extends PreTrainedModel {
    };
    Owlv2Model = class extends Owlv2PreTrainedModel {
    };
    Owlv2ForObjectDetection = class extends Owlv2PreTrainedModel {
    };
    BeitPreTrainedModel = class extends PreTrainedModel {
    };
    BeitModel = class extends BeitPreTrainedModel {
    };
    BeitForImageClassification = class extends BeitPreTrainedModel {
      /**
       * @param {any} model_inputs
       */
      async _call(model_inputs) {
        return new SequenceClassifierOutput(await super._call(model_inputs));
      }
    };
    DetrPreTrainedModel = class extends PreTrainedModel {
    };
    DetrModel = class extends DetrPreTrainedModel {
    };
    DetrForObjectDetection = class extends DetrPreTrainedModel {
      /**
       * @param {any} model_inputs
       */
      async _call(model_inputs) {
        return new DetrObjectDetectionOutput(await super._call(model_inputs));
      }
    };
    DetrForSegmentation = class extends DetrPreTrainedModel {
      /**
       * Runs the model with the provided inputs
       * @param {Object} model_inputs Model inputs
       * @returns {Promise<DetrSegmentationOutput>} Object containing segmentation outputs
       */
      async _call(model_inputs) {
        return new DetrSegmentationOutput(await super._call(model_inputs));
      }
    };
    DetrObjectDetectionOutput = class extends ModelOutput {
      /**
       * @param {Object} output The output of the model.
       * @param {Tensor} output.logits Classification logits (including no-object) for all queries.
       * @param {Tensor} output.pred_boxes Normalized boxes coordinates for all queries, represented as (center_x, center_y, width, height).
       * These values are normalized in [0, 1], relative to the size of each individual image in the batch (disregarding possible padding).
       */
      constructor({ logits, pred_boxes }) {
        super();
        this.logits = logits;
        this.pred_boxes = pred_boxes;
      }
    };
    DetrSegmentationOutput = class extends ModelOutput {
      /**
       * @param {Object} output The output of the model.
       * @param {Tensor} output.logits The output logits of the model.
       * @param {Tensor} output.pred_boxes Predicted boxes.
       * @param {Tensor} output.pred_masks Predicted masks.
       */
      constructor({ logits, pred_boxes, pred_masks }) {
        super();
        this.logits = logits;
        this.pred_boxes = pred_boxes;
        this.pred_masks = pred_masks;
      }
    };
    TableTransformerPreTrainedModel = class extends PreTrainedModel {
    };
    TableTransformerModel = class extends TableTransformerPreTrainedModel {
    };
    TableTransformerForObjectDetection = class extends TableTransformerPreTrainedModel {
      /**
       * @param {any} model_inputs
       */
      async _call(model_inputs) {
        return new TableTransformerObjectDetectionOutput(await super._call(model_inputs));
      }
    };
    TableTransformerObjectDetectionOutput = class extends DetrObjectDetectionOutput {
    };
    DeiTPreTrainedModel = class extends PreTrainedModel {
    };
    DeiTModel = class extends DeiTPreTrainedModel {
    };
    DeiTForImageClassification = class extends DeiTPreTrainedModel {
      /**
       * @param {any} model_inputs
       */
      async _call(model_inputs) {
        return new SequenceClassifierOutput(await super._call(model_inputs));
      }
    };
    ResNetPreTrainedModel = class extends PreTrainedModel {
    };
    ResNetModel = class extends ResNetPreTrainedModel {
    };
    ResNetForImageClassification = class extends ResNetPreTrainedModel {
      /**
       * @param {any} model_inputs
       */
      async _call(model_inputs) {
        return new SequenceClassifierOutput(await super._call(model_inputs));
      }
    };
    SwinPreTrainedModel = class extends PreTrainedModel {
    };
    SwinModel = class extends SwinPreTrainedModel {
    };
    SwinForImageClassification = class extends SwinPreTrainedModel {
      /**
       * @param {any} model_inputs
       */
      async _call(model_inputs) {
        return new SequenceClassifierOutput(await super._call(model_inputs));
      }
    };
    Swin2SRPreTrainedModel = class extends PreTrainedModel {
    };
    Swin2SRModel = class extends Swin2SRPreTrainedModel {
    };
    Swin2SRForImageSuperResolution = class extends Swin2SRPreTrainedModel {
    };
    DPTPreTrainedModel = class extends PreTrainedModel {
    };
    DPTModel = class extends DPTPreTrainedModel {
    };
    DPTForDepthEstimation = class extends DPTPreTrainedModel {
    };
    DepthAnythingPreTrainedModel = class extends PreTrainedModel {
    };
    DepthAnythingForDepthEstimation = class extends DepthAnythingPreTrainedModel {
    };
    GLPNPreTrainedModel = class extends PreTrainedModel {
    };
    GLPNModel = class extends GLPNPreTrainedModel {
    };
    GLPNForDepthEstimation = class extends GLPNPreTrainedModel {
    };
    DonutSwinPreTrainedModel = class extends PreTrainedModel {
    };
    DonutSwinModel = class extends DonutSwinPreTrainedModel {
    };
    ConvNextPreTrainedModel = class extends PreTrainedModel {
    };
    ConvNextModel = class extends ConvNextPreTrainedModel {
    };
    ConvNextForImageClassification = class extends ConvNextPreTrainedModel {
      /**
       * @param {any} model_inputs
       */
      async _call(model_inputs) {
        return new SequenceClassifierOutput(await super._call(model_inputs));
      }
    };
    ConvNextV2PreTrainedModel = class extends PreTrainedModel {
    };
    ConvNextV2Model = class extends ConvNextV2PreTrainedModel {
    };
    ConvNextV2ForImageClassification = class extends ConvNextV2PreTrainedModel {
      /**
       * @param {any} model_inputs
       */
      async _call(model_inputs) {
        return new SequenceClassifierOutput(await super._call(model_inputs));
      }
    };
    Dinov2PreTrainedModel = class extends PreTrainedModel {
    };
    Dinov2Model = class extends Dinov2PreTrainedModel {
    };
    Dinov2ForImageClassification = class extends Dinov2PreTrainedModel {
      /**
       * @param {any} model_inputs
       */
      async _call(model_inputs) {
        return new SequenceClassifierOutput(await super._call(model_inputs));
      }
    };
    YolosPreTrainedModel = class extends PreTrainedModel {
    };
    YolosModel = class extends YolosPreTrainedModel {
    };
    YolosForObjectDetection = class extends YolosPreTrainedModel {
      /**
       * @param {any} model_inputs
       */
      async _call(model_inputs) {
        return new YolosObjectDetectionOutput(await super._call(model_inputs));
      }
    };
    YolosObjectDetectionOutput = class extends ModelOutput {
      /**
       * @param {Object} output The output of the model.
       * @param {Tensor} output.logits Classification logits (including no-object) for all queries.
       * @param {Tensor} output.pred_boxes Normalized boxes coordinates for all queries, represented as (center_x, center_y, width, height).
       * These values are normalized in [0, 1], relative to the size of each individual image in the batch (disregarding possible padding).
       */
      constructor({ logits, pred_boxes }) {
        super();
        this.logits = logits;
        this.pred_boxes = pred_boxes;
      }
    };
    SamPreTrainedModel = class extends PreTrainedModel {
    };
    SamModel = class extends SamPreTrainedModel {
      /**
       * Creates a new instance of the `SamModel` class.
       * @param {Object} config The configuration object specifying the hyperparameters and other model settings.
       * @param {Object} vision_encoder The ONNX session containing the vision encoder model.
       * @param {any} prompt_encoder_mask_decoder The ONNX session containing the prompt encoder and mask decoder model.
       */
      constructor(config, vision_encoder, prompt_encoder_mask_decoder) {
        super(config, vision_encoder);
        this.prompt_encoder_mask_decoder = prompt_encoder_mask_decoder;
      }
      /**
       * Compute image embeddings and positional image embeddings, given the pixel values of an image.
       * @param {Object} model_inputs Object containing the model inputs.
       * @param {Tensor} model_inputs.pixel_values Pixel values obtained using a `SamProcessor`.
       * @returns {Promise<{ image_embeddings: Tensor, image_positional_embeddings: Tensor }>} The image embeddings and positional image embeddings.
       */
      async get_image_embeddings({ pixel_values }) {
        return await encoderForward(this, { pixel_values });
      }
      /**
       * @typedef {Object} SamModelInputs Object containing the model inputs.
       * @property {Tensor} pixel_values Pixel values as a Tensor with shape `(batch_size, num_channels, height, width)`.
       * These can be obtained using a `SamProcessor`.
       * @property {Tensor} input_points Input 2D spatial points with shape `(batch_size, num_points, 2)`.
       * This is used by the prompt encoder to encode the prompt.
       * @property {Tensor} [input_labels] Input labels for the points, as a Tensor of shape `(batch_size, point_batch_size, num_points)`.
       * This is used by the prompt encoder to encode the prompt. There are 4 types of labels:
       *  - `1`: the point is a point that contains the object of interest
       *  - `0`: the point is a point that does not contain the object of interest
       *  - `-1`: the point corresponds to the background
       *  - `-10`: the point is a padding point, thus should be ignored by the prompt encoder
       * @property {Tensor} [image_embeddings] Image embeddings used by the mask decoder.
       * @property {Tensor} [image_positional_embeddings] Image positional embeddings used by the mask decoder.
       */
      /**
       * @param {SamModelInputs} model_inputs Object containing the model inputs.
       * @returns {Promise<Object>} The output of the model.
       */
      async forward(model_inputs) {
        if (!model_inputs.image_embeddings || !model_inputs.image_positional_embeddings) {
          model_inputs = {
            ...model_inputs,
            ...await this.get_image_embeddings(model_inputs)
          };
        }
        if (!model_inputs.input_labels) {
          const shape = model_inputs.input_points.dims.slice(0, -1);
          const numElements = shape.reduce((a, b) => a * b, 1);
          model_inputs.input_labels = new Tensor(
            "int64",
            new BigInt64Array(numElements).fill(1n),
            shape
          );
        }
        return await sessionRun(this.prompt_encoder_mask_decoder, {
          input_points: model_inputs.input_points,
          input_labels: model_inputs.input_labels,
          image_embeddings: model_inputs.image_embeddings,
          image_positional_embeddings: model_inputs.image_positional_embeddings
        });
      }
      /**
       * Runs the model with the provided inputs
       * @param {Object} model_inputs Model inputs
       * @returns {Promise<SamImageSegmentationOutput>} Object containing segmentation outputs
       */
      async _call(model_inputs) {
        return new SamImageSegmentationOutput(await super._call(model_inputs));
      }
    };
    SamImageSegmentationOutput = class extends ModelOutput {
      /**
       * @param {Object} output The output of the model.
       * @param {Tensor} output.iou_scores The output logits of the model.
       * @param {Tensor} output.pred_masks Predicted boxes.
       */
      constructor({ iou_scores, pred_masks }) {
        super();
        this.iou_scores = iou_scores;
        this.pred_masks = pred_masks;
      }
    };
    MarianPreTrainedModel = class extends PreTrainedModel {
    };
    MarianModel = class extends MarianPreTrainedModel {
    };
    MarianMTModel = class extends MarianPreTrainedModel {
      /**
       * Creates a new instance of the `MarianMTModel` class.
      * @param {Object} config The model configuration object.
      * @param {Object} session The ONNX session object.
      * @param {any} decoder_merged_session 
      * @param {any} generation_config 
      */
      constructor(config, session, decoder_merged_session, generation_config) {
        super(config, session);
        this.decoder_merged_session = decoder_merged_session;
        this.generation_config = generation_config;
        this.num_decoder_layers = this.config.decoder_layers;
        this.num_decoder_heads = this.config.decoder_attention_heads;
        this.decoder_dim_kv = this.config.d_model / this.num_decoder_heads;
        this.num_encoder_layers = this.config.encoder_layers;
        this.num_encoder_heads = this.config.encoder_attention_heads;
        this.encoder_dim_kv = this.config.d_model / this.num_encoder_heads;
      }
    };
    M2M100PreTrainedModel = class extends PreTrainedModel {
    };
    M2M100Model = class extends M2M100PreTrainedModel {
    };
    M2M100ForConditionalGeneration = class extends M2M100PreTrainedModel {
      /**
       * Creates a new instance of the `M2M100ForConditionalGeneration` class.
      * @param {Object} config The model configuration object.
      * @param {Object} session The ONNX session object.
      * @param {any} decoder_merged_session 
      * @param {any} generation_config 
      */
      constructor(config, session, decoder_merged_session, generation_config) {
        super(config, session);
        this.decoder_merged_session = decoder_merged_session;
        this.generation_config = generation_config;
        this.num_decoder_layers = this.config.decoder_layers;
        this.num_decoder_heads = this.config.decoder_attention_heads;
        this.decoder_dim_kv = this.config.d_model / this.num_decoder_heads;
        this.num_encoder_layers = this.config.encoder_layers;
        this.num_encoder_heads = this.config.encoder_attention_heads;
        this.encoder_dim_kv = this.config.d_model / this.num_encoder_heads;
      }
    };
    Wav2Vec2PreTrainedModel = class extends PreTrainedModel {
    };
    Wav2Vec2Model = class extends Wav2Vec2PreTrainedModel {
    };
    Wav2Vec2ForCTC = class extends Wav2Vec2PreTrainedModel {
      /**
       * @param {Object} model_inputs
       * @param {Tensor} model_inputs.input_values Float values of input raw speech waveform.
       * @param {Tensor} model_inputs.attention_mask Mask to avoid performing convolution and attention on padding token indices. Mask values selected in [0, 1]
       */
      async _call(model_inputs) {
        return new CausalLMOutput(await super._call(model_inputs));
      }
    };
    Wav2Vec2ForSequenceClassification = class extends Wav2Vec2PreTrainedModel {
      /**
       * Calls the model on new inputs.
       * @param {Object} model_inputs The inputs to the model.
       * @returns {Promise<SequenceClassifierOutput>} An object containing the model's output logits for sequence classification.
       */
      async _call(model_inputs) {
        return new SequenceClassifierOutput(await super._call(model_inputs));
      }
    };
    Wav2Vec2ForAudioFrameClassification = class extends Wav2Vec2PreTrainedModel {
      /**
       * Calls the model on new inputs.
       * @param {Object} model_inputs The inputs to the model.
       * @returns {Promise<TokenClassifierOutput>} An object containing the model's output logits for sequence classification.
       */
      async _call(model_inputs) {
        return new TokenClassifierOutput(await super._call(model_inputs));
      }
    };
    UniSpeechPreTrainedModel = class extends PreTrainedModel {
    };
    UniSpeechModel = class extends UniSpeechPreTrainedModel {
    };
    UniSpeechForCTC = class extends UniSpeechPreTrainedModel {
      /**
       * @param {Object} model_inputs
       * @param {Tensor} model_inputs.input_values Float values of input raw speech waveform.
       * @param {Tensor} model_inputs.attention_mask Mask to avoid performing convolution and attention on padding token indices. Mask values selected in [0, 1]
       */
      async _call(model_inputs) {
        return new CausalLMOutput(await super._call(model_inputs));
      }
    };
    UniSpeechForSequenceClassification = class extends UniSpeechPreTrainedModel {
      /**
       * Calls the model on new inputs.
       * @param {Object} model_inputs The inputs to the model.
       * @returns {Promise<SequenceClassifierOutput>} An object containing the model's output logits for sequence classification.
       */
      async _call(model_inputs) {
        return new SequenceClassifierOutput(await super._call(model_inputs));
      }
    };
    UniSpeechSatPreTrainedModel = class extends PreTrainedModel {
    };
    UniSpeechSatModel = class extends UniSpeechSatPreTrainedModel {
    };
    UniSpeechSatForCTC = class extends UniSpeechSatPreTrainedModel {
      /**
       * @param {Object} model_inputs
       * @param {Tensor} model_inputs.input_values Float values of input raw speech waveform.
       * @param {Tensor} model_inputs.attention_mask Mask to avoid performing convolution and attention on padding token indices. Mask values selected in [0, 1]
       */
      async _call(model_inputs) {
        return new CausalLMOutput(await super._call(model_inputs));
      }
    };
    UniSpeechSatForSequenceClassification = class extends UniSpeechSatPreTrainedModel {
      /**
       * Calls the model on new inputs.
       * @param {Object} model_inputs The inputs to the model.
       * @returns {Promise<SequenceClassifierOutput>} An object containing the model's output logits for sequence classification.
       */
      async _call(model_inputs) {
        return new SequenceClassifierOutput(await super._call(model_inputs));
      }
    };
    UniSpeechSatForAudioFrameClassification = class extends UniSpeechSatPreTrainedModel {
      /**
       * Calls the model on new inputs.
       * @param {Object} model_inputs The inputs to the model.
       * @returns {Promise<TokenClassifierOutput>} An object containing the model's output logits for sequence classification.
       */
      async _call(model_inputs) {
        return new TokenClassifierOutput(await super._call(model_inputs));
      }
    };
    Wav2Vec2BertPreTrainedModel = class extends PreTrainedModel {
    };
    Wav2Vec2BertModel = class extends Wav2Vec2BertPreTrainedModel {
    };
    Wav2Vec2BertForCTC = class extends Wav2Vec2BertPreTrainedModel {
      /**
       * @param {Object} model_inputs
       * @param {Tensor} model_inputs.input_features Float values of input mel-spectrogram.
       * @param {Tensor} model_inputs.attention_mask Mask to avoid performing convolution and attention on padding token indices. Mask values selected in [0, 1]
       */
      async _call(model_inputs) {
        return new CausalLMOutput(await super._call(model_inputs));
      }
    };
    Wav2Vec2BertForSequenceClassification = class extends Wav2Vec2BertPreTrainedModel {
      /**
       * Calls the model on new inputs.
       * @param {Object} model_inputs The inputs to the model.
       * @returns {Promise<SequenceClassifierOutput>} An object containing the model's output logits for sequence classification.
       */
      async _call(model_inputs) {
        return new SequenceClassifierOutput(await super._call(model_inputs));
      }
    };
    HubertModel = class extends Wav2Vec2PreTrainedModel {
    };
    HubertForCTC = class extends Wav2Vec2PreTrainedModel {
      /**
       * @param {Object} model_inputs
       * @param {Tensor} model_inputs.input_values Float values of input raw speech waveform.
       * @param {Tensor} model_inputs.attention_mask Mask to avoid performing convolution and attention on padding token indices. Mask values selected in [0, 1]
       */
      async _call(model_inputs) {
        return new CausalLMOutput(await super._call(model_inputs));
      }
    };
    HubertForSequenceClassification = class extends Wav2Vec2PreTrainedModel {
      /**
       * Calls the model on new inputs.
       * @param {Object} model_inputs The inputs to the model.
       * @returns {Promise<SequenceClassifierOutput>} An object containing the model's output logits for sequence classification.
       */
      async _call(model_inputs) {
        return new SequenceClassifierOutput(await super._call(model_inputs));
      }
    };
    WavLMPreTrainedModel = class extends PreTrainedModel {
    };
    WavLMModel = class extends WavLMPreTrainedModel {
    };
    WavLMForCTC = class extends WavLMPreTrainedModel {
      /**
       * @param {Object} model_inputs
       * @param {Tensor} model_inputs.input_values Float values of input raw speech waveform.
       * @param {Tensor} model_inputs.attention_mask Mask to avoid performing convolution and attention on padding token indices. Mask values selected in [0, 1]
       */
      async _call(model_inputs) {
        return new CausalLMOutput(await super._call(model_inputs));
      }
    };
    WavLMForSequenceClassification = class extends WavLMPreTrainedModel {
      /**
       * Calls the model on new inputs.
       * @param {Object} model_inputs The inputs to the model.
       * @returns {Promise<SequenceClassifierOutput>} An object containing the model's output logits for sequence classification.
       */
      async _call(model_inputs) {
        return new SequenceClassifierOutput(await super._call(model_inputs));
      }
    };
    WavLMForXVector = class extends WavLMPreTrainedModel {
      /**
       * Calls the model on new inputs.
       * @param {Object} model_inputs The inputs to the model.
       * @returns {Promise<XVectorOutput>} An object containing the model's output logits and speaker embeddings.
       */
      async _call(model_inputs) {
        return new XVectorOutput(await super._call(model_inputs));
      }
    };
    WavLMForAudioFrameClassification = class extends WavLMPreTrainedModel {
      /**
       * Calls the model on new inputs.
       * @param {Object} model_inputs The inputs to the model.
       * @returns {Promise<TokenClassifierOutput>} An object containing the model's output logits for sequence classification.
       */
      async _call(model_inputs) {
        return new TokenClassifierOutput(await super._call(model_inputs));
      }
    };
    SpeechT5PreTrainedModel = class extends PreTrainedModel {
    };
    SpeechT5ForSpeechToText = class extends SpeechT5PreTrainedModel {
    };
    SpeechT5ForTextToSpeech = class extends SpeechT5PreTrainedModel {
      /**
       * Creates a new instance of the `SpeechT5ForTextToSpeech` class.
       * @param {Object} config The model configuration.
       * @param {any} session session for the model.
       * @param {any} decoder_merged_session session for the decoder.
       * @param {GenerationConfig} generation_config The generation configuration.
       */
      constructor(config, session, decoder_merged_session, generation_config) {
        super(config, session);
        this.decoder_merged_session = decoder_merged_session;
        this.generation_config = generation_config;
        this.num_decoder_layers = this.config.decoder_layers;
        this.num_decoder_heads = this.config.decoder_attention_heads;
        this.decoder_dim_kv = this.config.hidden_size / this.num_decoder_heads;
        this.num_encoder_layers = this.config.encoder_layers;
        this.num_encoder_heads = this.config.encoder_attention_heads;
        this.encoder_dim_kv = this.config.hidden_size / this.num_encoder_heads;
      }
      /**
       * @typedef {Object} SpeechOutput
       * @property {Tensor} [spectrogram] The predicted log-mel spectrogram of shape
       * `(output_sequence_length, config.num_mel_bins)`. Returned when no `vocoder` is provided
       * @property {Tensor} [waveform] The predicted waveform of shape `(num_frames,)`. Returned when a `vocoder` is provided.
       * @property {Tensor} [cross_attentions] The outputs of the decoder's cross-attention layers of shape
       * `(config.decoder_layers, config.decoder_attention_heads, output_sequence_length, input_sequence_length)`. returned when `output_cross_attentions` is `true`.
       */
      /**
       * Converts a sequence of input tokens into a sequence of mel spectrograms, which are subsequently turned into a speech waveform using a vocoder.
       * @param {Tensor} input_values Indices of input sequence tokens in the vocabulary.
       * @param {Tensor} speaker_embeddings Tensor containing the speaker embeddings.
       * @param {Object} options Optional parameters for generating speech.
       * @param {number} [options.threshold=0.5] The generated sequence ends when the predicted stop token probability exceeds this value.
       * @param {number} [options.minlenratio=0.0] Used to calculate the minimum required length for the output sequence.
       * @param {number} [options.maxlenratio=20.0] Used to calculate the maximum allowed length for the output sequence.
       * @param {Object} [options.vocoder=null] The vocoder that converts the mel spectrogram into a speech waveform. If `null`, the output is the mel spectrogram.
       * @param {boolean} [options.output_cross_attentions=false] Whether or not to return the attentions tensors of the decoder's cross-attention layers.
       * @returns {Promise<SpeechOutput>} A promise which resolves to an object containing the spectrogram, waveform, and cross-attention tensors.
       */
      async generate_speech(input_values, speaker_embeddings, {
        threshold = 0.5,
        minlenratio = 0,
        maxlenratio = 20,
        vocoder = null
        // output_cross_attentions = false, // TODO add
      } = {}) {
        const model_inputs = {
          input_ids: input_values
        };
        const { encoder_outputs, encoder_attention_mask } = await encoderForward(this, model_inputs);
        const r = encoder_outputs.dims[1] / this.config.reduction_factor;
        const maxlen = Math.floor(r * maxlenratio);
        const minlen = Math.floor(r * minlenratio);
        const num_mel_bins = this.config.num_mel_bins;
        let spectrogramParts = [];
        let past_key_values = null;
        let decoder_outputs = null;
        let idx = 0;
        while (true) {
          ++idx;
          const use_cache_branch = boolTensor(!!decoder_outputs);
          let output_sequence;
          if (decoder_outputs) {
            output_sequence = decoder_outputs.output_sequence_out;
          } else {
            output_sequence = new Tensor(
              "float32",
              new Float32Array(num_mel_bins),
              [1, 1, num_mel_bins]
            );
          }
          let decoderFeeds = {
            use_cache_branch,
            output_sequence,
            encoder_attention_mask,
            speaker_embeddings,
            encoder_hidden_states: encoder_outputs
          };
          this.addPastKeyValues(decoderFeeds, past_key_values);
          decoder_outputs = await sessionRun(this.decoder_merged_session, decoderFeeds);
          past_key_values = this.getPastKeyValues(decoder_outputs, past_key_values);
          const { prob, spectrum } = decoder_outputs;
          spectrogramParts.push(spectrum);
          if (idx >= minlen && // Finished when stop token or maximum length is reached.
          (Array.from(prob.data).filter((p) => p >= threshold).length > 0 || idx >= maxlen)) {
            break;
          }
        }
        const spectrogram2 = cat(spectrogramParts);
        const { waveform } = await sessionRun(vocoder.session, { spectrogram: spectrogram2 });
        return {
          spectrogram: spectrogram2,
          waveform
          // cross_attentions: null, // TODO add
        };
      }
    };
    SpeechT5HifiGan = class extends PreTrainedModel {
      main_input_name = "spectrogram";
    };
    TrOCRPreTrainedModel = class extends PreTrainedModel {
      /**
       * Creates a new instance of the `TrOCRPreTrainedModel` class.
       * @param {Object} config The configuration of the model.
       * @param {any} session The ONNX session containing the model weights.
       * @param {GenerationConfig} generation_config The generation configuration.
       */
      constructor(config, session, generation_config) {
        super(config, session);
        this.generation_config = generation_config;
        this.config.pad_token_id = this.config.eos_token_id;
        this.num_encoder_layers = this.num_decoder_layers = this.config.decoder_layers;
        this.num_encoder_heads = this.num_decoder_heads = this.config.decoder_attention_heads;
        this.encoder_dim_kv = this.decoder_dim_kv = this.config.d_model / this.num_decoder_heads;
      }
    };
    TrOCRForCausalLM = class extends TrOCRPreTrainedModel {
    };
    MistralPreTrainedModel = class extends PreTrainedModel {
      /**
       * Creates a new instance of the `MistralPreTrainedModel` class.
       * @param {Object} config The configuration of the model.
       * @param {any} session The ONNX session containing the model weights.
       * @param {GenerationConfig} generation_config The generation configuration.
       */
      constructor(config, session, generation_config) {
        super(config, session);
        this.generation_config = generation_config;
        this.config.pad_token_id = this.config.eos_token_id;
        this.num_heads = this.config.num_key_value_heads;
        this.num_layers = this.config.num_hidden_layers;
        this.dim_kv = this.config.hidden_size / this.config.num_attention_heads;
      }
    };
    MistralModel = class extends MistralPreTrainedModel {
    };
    MistralForCausalLM = class extends MistralPreTrainedModel {
    };
    Starcoder2PreTrainedModel = class extends PreTrainedModel {
      /**
       * Creates a new instance of the `Starcoder2PreTrainedModel` class.
       * @param {Object} config The configuration of the model.
       * @param {any} session The ONNX session containing the model weights.
       * @param {GenerationConfig} generation_config The generation configuration.
       */
      constructor(config, session, generation_config) {
        super(config, session);
        this.generation_config = generation_config;
        this.config.pad_token_id = this.config.eos_token_id;
        this.num_heads = this.config.num_key_value_heads;
        this.num_layers = this.config.num_hidden_layers;
        this.dim_kv = this.config.hidden_size / this.config.num_attention_heads;
      }
    };
    Starcoder2Model = class extends Starcoder2PreTrainedModel {
    };
    Starcoder2ForCausalLM = class extends Starcoder2PreTrainedModel {
    };
    FalconPreTrainedModel = class extends PreTrainedModel {
      /**
       * Creates a new instance of the `FalconPreTrainedModel` class.
       * @param {Object} config The configuration of the model.
       * @param {any} session The ONNX session containing the model weights.
       * @param {GenerationConfig} generation_config The generation configuration.
       */
      constructor(config, session, generation_config) {
        super(config, session);
        this.generation_config = generation_config;
        this.config.pad_token_id = this.config.eos_token_id;
        this.num_heads = this.config.num_attention_heads;
        this.num_layers = this.config.num_hidden_layers;
        this.dim_kv = this.config.hidden_size / this.config.num_attention_heads;
      }
    };
    FalconModel = class extends FalconPreTrainedModel {
    };
    FalconForCausalLM = class extends FalconPreTrainedModel {
    };
    ClapPreTrainedModel = class extends PreTrainedModel {
    };
    ClapModel = class extends ClapPreTrainedModel {
    };
    ClapTextModelWithProjection = class extends ClapPreTrainedModel {
      /** @type {PreTrainedModel.from_pretrained} */
      static async from_pretrained(pretrained_model_name_or_path, options = {}) {
        options.model_file_name ??= "text_model";
        return super.from_pretrained(pretrained_model_name_or_path, options);
      }
    };
    ClapAudioModelWithProjection = class extends ClapPreTrainedModel {
      /** @type {PreTrainedModel.from_pretrained} */
      static async from_pretrained(pretrained_model_name_or_path, options = {}) {
        options.model_file_name ??= "audio_model";
        return super.from_pretrained(pretrained_model_name_or_path, options);
      }
    };
    VitsPreTrainedModel = class extends PreTrainedModel {
    };
    VitsModel = class extends VitsPreTrainedModel {
      /**
       * Calls the model on new inputs.
       * @param {Object} model_inputs The inputs to the model.
       * @returns {Promise<VitsModelOutput>} The outputs for the VITS model.
       */
      async _call(model_inputs) {
        return new VitsModelOutput(await super._call(model_inputs));
      }
    };
    SegformerPreTrainedModel = class extends PreTrainedModel {
    };
    SegformerForImageClassification = class extends SegformerPreTrainedModel {
    };
    SegformerForSemanticSegmentation = class extends SegformerPreTrainedModel {
    };
    StableLmPreTrainedModel = class extends PreTrainedModel {
      /**
       * Creates a new instance of the `StableLmPreTrainedModel` class.
       * @param {Object} config The configuration of the model.
       * @param {any} session The ONNX session containing the model weights.
       * @param {GenerationConfig} generation_config The generation configuration.
       */
      constructor(config, session, generation_config) {
        super(config, session);
        this.generation_config = generation_config;
        this.config.pad_token_id = this.config.eos_token_id;
        this.num_heads = this.config.num_attention_heads;
        this.num_layers = this.config.num_hidden_layers;
        this.dim_kv = this.config.hidden_size / this.num_heads;
      }
    };
    StableLmForCausalLM = class extends StableLmPreTrainedModel {
    };
    EfficientNetPreTrainedModel = class extends PreTrainedModel {
    };
    EfficientNetModel = class extends EfficientNetPreTrainedModel {
    };
    EfficientNetForImageClassification = class extends EfficientNetPreTrainedModel {
      /**
       * @param {any} model_inputs
       */
      async _call(model_inputs) {
        return new SequenceClassifierOutput(await super._call(model_inputs));
      }
    };
    PretrainedMixin = class {
      /**
       * Mapping from model type to model class.
       * @type {Map<string, Object>[]}
       */
      static MODEL_CLASS_MAPPINGS = null;
      /**
       * Whether to attempt to instantiate the base class (`PretrainedModel`) if 
       * the model type is not found in the mapping.
       */
      static BASE_IF_FAIL = false;
      /** @type {PreTrainedModel.from_pretrained} */
      static async from_pretrained(pretrained_model_name_or_path, {
        quantized = true,
        progress_callback = null,
        config = null,
        cache_dir = null,
        local_files_only = false,
        revision = "main",
        model_file_name = null
      } = {}) {
        let options = {
          quantized,
          progress_callback,
          config,
          cache_dir,
          local_files_only,
          revision,
          model_file_name
        };
        config = await AutoConfig.from_pretrained(pretrained_model_name_or_path, options);
        if (!options.config) {
          options.config = config;
        }
        if (!this.MODEL_CLASS_MAPPINGS) {
          throw new Error("`MODEL_CLASS_MAPPINGS` not implemented for this type of `AutoClass`: " + this.name);
        }
        for (let MODEL_CLASS_MAPPING of this.MODEL_CLASS_MAPPINGS) {
          const modelInfo = MODEL_CLASS_MAPPING.get(config.model_type);
          if (!modelInfo) {
            continue;
          }
          return await modelInfo[1].from_pretrained(pretrained_model_name_or_path, options);
        }
        if (this.BASE_IF_FAIL) {
          console.warn(`Unknown model class "${config.model_type}", attempting to construct from base class.`);
          return await PreTrainedModel.from_pretrained(pretrained_model_name_or_path, options);
        } else {
          throw Error(`Unsupported model type: ${config.model_type}`);
        }
      }
    };
    MODEL_MAPPING_NAMES_ENCODER_ONLY = /* @__PURE__ */ new Map([
      ["bert", ["BertModel", BertModel]],
      ["nomic_bert", ["NomicBertModel", NomicBertModel]],
      ["roformer", ["RoFormerModel", RoFormerModel]],
      ["electra", ["ElectraModel", ElectraModel]],
      ["esm", ["EsmModel", EsmModel]],
      ["convbert", ["ConvBertModel", ConvBertModel]],
      ["camembert", ["CamembertModel", CamembertModel]],
      ["deberta", ["DebertaModel", DebertaModel]],
      ["deberta-v2", ["DebertaV2Model", DebertaV2Model]],
      ["mpnet", ["MPNetModel", MPNetModel]],
      ["albert", ["AlbertModel", AlbertModel]],
      ["distilbert", ["DistilBertModel", DistilBertModel]],
      ["roberta", ["RobertaModel", RobertaModel]],
      ["xlm", ["XLMModel", XLMModel]],
      ["xlm-roberta", ["XLMRobertaModel", XLMRobertaModel]],
      ["clap", ["ClapModel", ClapModel]],
      ["clip", ["CLIPModel", CLIPModel]],
      ["clipseg", ["CLIPSegModel", CLIPSegModel]],
      ["chinese_clip", ["ChineseCLIPModel", ChineseCLIPModel]],
      ["siglip", ["SiglipModel", SiglipModel]],
      ["mobilebert", ["MobileBertModel", MobileBertModel]],
      ["squeezebert", ["SqueezeBertModel", SqueezeBertModel]],
      ["wav2vec2", ["Wav2Vec2Model", Wav2Vec2Model]],
      ["wav2vec2-bert", ["Wav2Vec2BertModel", Wav2Vec2BertModel]],
      ["unispeech", ["UniSpeechModel", UniSpeechModel]],
      ["unispeech-sat", ["UniSpeechSatModel", UniSpeechSatModel]],
      ["hubert", ["HubertModel", HubertModel]],
      ["wavlm", ["WavLMModel", WavLMModel]],
      ["audio-spectrogram-transformer", ["ASTModel", ASTModel]],
      ["vits", ["VitsModel", VitsModel]],
      ["detr", ["DetrModel", DetrModel]],
      ["table-transformer", ["TableTransformerModel", TableTransformerModel]],
      ["vit", ["ViTModel", ViTModel]],
      ["fastvit", ["FastViTModel", FastViTModel]],
      ["mobilevit", ["MobileViTModel", MobileViTModel]],
      ["mobilevitv2", ["MobileViTV2Model", MobileViTV2Model]],
      ["owlvit", ["OwlViTModel", OwlViTModel]],
      ["owlv2", ["Owlv2Model", Owlv2Model]],
      ["beit", ["BeitModel", BeitModel]],
      ["deit", ["DeiTModel", DeiTModel]],
      ["convnext", ["ConvNextModel", ConvNextModel]],
      ["convnextv2", ["ConvNextV2Model", ConvNextV2Model]],
      ["dinov2", ["Dinov2Model", Dinov2Model]],
      ["resnet", ["ResNetModel", ResNetModel]],
      ["swin", ["SwinModel", SwinModel]],
      ["swin2sr", ["Swin2SRModel", Swin2SRModel]],
      ["donut-swin", ["DonutSwinModel", DonutSwinModel]],
      ["yolos", ["YolosModel", YolosModel]],
      ["dpt", ["DPTModel", DPTModel]],
      ["glpn", ["GLPNModel", GLPNModel]],
      ["hifigan", ["SpeechT5HifiGan", SpeechT5HifiGan]],
      ["efficientnet", ["EfficientNetModel", EfficientNetModel]]
    ]);
    MODEL_MAPPING_NAMES_ENCODER_DECODER = /* @__PURE__ */ new Map([
      ["t5", ["T5Model", T5Model]],
      ["longt5", ["LongT5Model", LongT5Model]],
      ["mt5", ["MT5Model", MT5Model]],
      ["bart", ["BartModel", BartModel]],
      ["mbart", ["MBartModel", MBartModel]],
      ["marian", ["MarianModel", MarianModel]],
      ["whisper", ["WhisperModel", WhisperModel]],
      ["m2m_100", ["M2M100Model", M2M100Model]],
      ["blenderbot", ["BlenderbotModel", BlenderbotModel]],
      ["blenderbot-small", ["BlenderbotSmallModel", BlenderbotSmallModel]]
    ]);
    MODEL_MAPPING_NAMES_DECODER_ONLY = /* @__PURE__ */ new Map([
      ["bloom", ["BloomModel", BloomModel]],
      ["gpt2", ["GPT2Model", GPT2Model]],
      ["gptj", ["GPTJModel", GPTJModel]],
      ["gpt_bigcode", ["GPTBigCodeModel", GPTBigCodeModel]],
      ["gpt_neo", ["GPTNeoModel", GPTNeoModel]],
      ["gpt_neox", ["GPTNeoXModel", GPTNeoXModel]],
      ["codegen", ["CodeGenModel", CodeGenModel]],
      ["llama", ["LlamaModel", LlamaModel]],
      ["qwen2", ["Qwen2Model", Qwen2Model]],
      ["phi", ["PhiModel", PhiModel]],
      ["mpt", ["MptModel", MptModel]],
      ["opt", ["OPTModel", OPTModel]],
      ["mistral", ["MistralModel", MistralModel]],
      ["starcoder2", ["Starcoder2Model", Starcoder2Model]],
      ["falcon", ["FalconModel", FalconModel]]
    ]);
    MODEL_FOR_SPEECH_SEQ_2_SEQ_MAPPING_NAMES = /* @__PURE__ */ new Map([
      ["speecht5", ["SpeechT5ForSpeechToText", SpeechT5ForSpeechToText]],
      ["whisper", ["WhisperForConditionalGeneration", WhisperForConditionalGeneration]]
    ]);
    MODEL_FOR_TEXT_TO_SPECTROGRAM_MAPPING_NAMES = /* @__PURE__ */ new Map([
      ["speecht5", ["SpeechT5ForTextToSpeech", SpeechT5ForTextToSpeech]]
    ]);
    MODEL_FOR_TEXT_TO_WAVEFORM_MAPPING_NAMES = /* @__PURE__ */ new Map([
      ["vits", ["VitsModel", VitsModel]]
    ]);
    MODEL_FOR_SEQUENCE_CLASSIFICATION_MAPPING_NAMES = /* @__PURE__ */ new Map([
      ["bert", ["BertForSequenceClassification", BertForSequenceClassification]],
      ["roformer", ["RoFormerForSequenceClassification", RoFormerForSequenceClassification]],
      ["electra", ["ElectraForSequenceClassification", ElectraForSequenceClassification]],
      ["esm", ["EsmForSequenceClassification", EsmForSequenceClassification]],
      ["convbert", ["ConvBertForSequenceClassification", ConvBertForSequenceClassification]],
      ["camembert", ["CamembertForSequenceClassification", CamembertForSequenceClassification]],
      ["deberta", ["DebertaForSequenceClassification", DebertaForSequenceClassification]],
      ["deberta-v2", ["DebertaV2ForSequenceClassification", DebertaV2ForSequenceClassification]],
      ["mpnet", ["MPNetForSequenceClassification", MPNetForSequenceClassification]],
      ["albert", ["AlbertForSequenceClassification", AlbertForSequenceClassification]],
      ["distilbert", ["DistilBertForSequenceClassification", DistilBertForSequenceClassification]],
      ["roberta", ["RobertaForSequenceClassification", RobertaForSequenceClassification]],
      ["xlm", ["XLMForSequenceClassification", XLMForSequenceClassification]],
      ["xlm-roberta", ["XLMRobertaForSequenceClassification", XLMRobertaForSequenceClassification]],
      ["bart", ["BartForSequenceClassification", BartForSequenceClassification]],
      ["mbart", ["MBartForSequenceClassification", MBartForSequenceClassification]],
      ["mobilebert", ["MobileBertForSequenceClassification", MobileBertForSequenceClassification]],
      ["squeezebert", ["SqueezeBertForSequenceClassification", SqueezeBertForSequenceClassification]]
    ]);
    MODEL_FOR_TOKEN_CLASSIFICATION_MAPPING_NAMES = /* @__PURE__ */ new Map([
      ["bert", ["BertForTokenClassification", BertForTokenClassification]],
      ["roformer", ["RoFormerForTokenClassification", RoFormerForTokenClassification]],
      ["electra", ["ElectraForTokenClassification", ElectraForTokenClassification]],
      ["esm", ["EsmForTokenClassification", EsmForTokenClassification]],
      ["convbert", ["ConvBertForTokenClassification", ConvBertForTokenClassification]],
      ["camembert", ["CamembertForTokenClassification", CamembertForTokenClassification]],
      ["deberta", ["DebertaForTokenClassification", DebertaForTokenClassification]],
      ["deberta-v2", ["DebertaV2ForTokenClassification", DebertaV2ForTokenClassification]],
      ["mpnet", ["MPNetForTokenClassification", MPNetForTokenClassification]],
      ["distilbert", ["DistilBertForTokenClassification", DistilBertForTokenClassification]],
      ["roberta", ["RobertaForTokenClassification", RobertaForTokenClassification]],
      ["xlm", ["XLMForTokenClassification", XLMForTokenClassification]],
      ["xlm-roberta", ["XLMRobertaForTokenClassification", XLMRobertaForTokenClassification]]
    ]);
    MODEL_FOR_SEQ_TO_SEQ_CAUSAL_LM_MAPPING_NAMES = /* @__PURE__ */ new Map([
      ["t5", ["T5ForConditionalGeneration", T5ForConditionalGeneration]],
      ["longt5", ["LongT5ForConditionalGeneration", LongT5ForConditionalGeneration]],
      ["mt5", ["MT5ForConditionalGeneration", MT5ForConditionalGeneration]],
      ["bart", ["BartForConditionalGeneration", BartForConditionalGeneration]],
      ["mbart", ["MBartForConditionalGeneration", MBartForConditionalGeneration]],
      ["marian", ["MarianMTModel", MarianMTModel]],
      ["m2m_100", ["M2M100ForConditionalGeneration", M2M100ForConditionalGeneration]],
      ["blenderbot", ["BlenderbotForConditionalGeneration", BlenderbotForConditionalGeneration]],
      ["blenderbot-small", ["BlenderbotSmallForConditionalGeneration", BlenderbotSmallForConditionalGeneration]]
    ]);
    MODEL_WITH_LM_HEAD_MAPPING_NAMES = /* @__PURE__ */ new Map([
      ["bloom", ["BloomForCausalLM", BloomForCausalLM]],
      ["gpt2", ["GPT2LMHeadModel", GPT2LMHeadModel]],
      ["gptj", ["GPTJForCausalLM", GPTJForCausalLM]],
      ["gpt_bigcode", ["GPTBigCodeForCausalLM", GPTBigCodeForCausalLM]],
      ["gpt_neo", ["GPTNeoForCausalLM", GPTNeoForCausalLM]],
      ["gpt_neox", ["GPTNeoXForCausalLM", GPTNeoXForCausalLM]],
      ["codegen", ["CodeGenForCausalLM", CodeGenForCausalLM]],
      ["llama", ["LlamaForCausalLM", LlamaForCausalLM]],
      ["qwen2", ["Qwen2ForCausalLM", Qwen2ForCausalLM]],
      ["phi", ["PhiForCausalLM", PhiForCausalLM]],
      ["mpt", ["MptForCausalLM", MptForCausalLM]],
      ["opt", ["OPTForCausalLM", OPTForCausalLM]],
      ["mbart", ["MBartForCausalLM", MBartForCausalLM]],
      ["mistral", ["MistralForCausalLM", MistralForCausalLM]],
      ["starcoder2", ["Starcoder2ForCausalLM", Starcoder2ForCausalLM]],
      ["falcon", ["FalconForCausalLM", FalconForCausalLM]],
      ["trocr", ["TrOCRForCausalLM", TrOCRForCausalLM]],
      ["stablelm", ["StableLmForCausalLM", StableLmForCausalLM]]
    ]);
    MODEL_FOR_MASKED_LM_MAPPING_NAMES = /* @__PURE__ */ new Map([
      ["bert", ["BertForMaskedLM", BertForMaskedLM]],
      ["roformer", ["RoFormerForMaskedLM", RoFormerForMaskedLM]],
      ["electra", ["ElectraForMaskedLM", ElectraForMaskedLM]],
      ["esm", ["EsmForMaskedLM", EsmForMaskedLM]],
      ["convbert", ["ConvBertForMaskedLM", ConvBertForMaskedLM]],
      ["camembert", ["CamembertForMaskedLM", CamembertForMaskedLM]],
      ["deberta", ["DebertaForMaskedLM", DebertaForMaskedLM]],
      ["deberta-v2", ["DebertaV2ForMaskedLM", DebertaV2ForMaskedLM]],
      ["mpnet", ["MPNetForMaskedLM", MPNetForMaskedLM]],
      ["albert", ["AlbertForMaskedLM", AlbertForMaskedLM]],
      ["distilbert", ["DistilBertForMaskedLM", DistilBertForMaskedLM]],
      ["roberta", ["RobertaForMaskedLM", RobertaForMaskedLM]],
      ["xlm", ["XLMWithLMHeadModel", XLMWithLMHeadModel]],
      ["xlm-roberta", ["XLMRobertaForMaskedLM", XLMRobertaForMaskedLM]],
      ["mobilebert", ["MobileBertForMaskedLM", MobileBertForMaskedLM]],
      ["squeezebert", ["SqueezeBertForMaskedLM", SqueezeBertForMaskedLM]]
    ]);
    MODEL_FOR_QUESTION_ANSWERING_MAPPING_NAMES = /* @__PURE__ */ new Map([
      ["bert", ["BertForQuestionAnswering", BertForQuestionAnswering]],
      ["roformer", ["RoFormerForQuestionAnswering", RoFormerForQuestionAnswering]],
      ["electra", ["ElectraForQuestionAnswering", ElectraForQuestionAnswering]],
      ["convbert", ["ConvBertForQuestionAnswering", ConvBertForQuestionAnswering]],
      ["camembert", ["CamembertForQuestionAnswering", CamembertForQuestionAnswering]],
      ["deberta", ["DebertaForQuestionAnswering", DebertaForQuestionAnswering]],
      ["deberta-v2", ["DebertaV2ForQuestionAnswering", DebertaV2ForQuestionAnswering]],
      ["mpnet", ["MPNetForQuestionAnswering", MPNetForQuestionAnswering]],
      ["albert", ["AlbertForQuestionAnswering", AlbertForQuestionAnswering]],
      ["distilbert", ["DistilBertForQuestionAnswering", DistilBertForQuestionAnswering]],
      ["roberta", ["RobertaForQuestionAnswering", RobertaForQuestionAnswering]],
      ["xlm", ["XLMForQuestionAnswering", XLMForQuestionAnswering]],
      ["xlm-roberta", ["XLMRobertaForQuestionAnswering", XLMRobertaForQuestionAnswering]],
      ["mobilebert", ["MobileBertForQuestionAnswering", MobileBertForQuestionAnswering]],
      ["squeezebert", ["SqueezeBertForQuestionAnswering", SqueezeBertForQuestionAnswering]]
    ]);
    MODEL_FOR_VISION_2_SEQ_MAPPING_NAMES = /* @__PURE__ */ new Map([
      ["vision-encoder-decoder", ["VisionEncoderDecoderModel", VisionEncoderDecoderModel]]
    ]);
    MODEL_FOR_DOCUMENT_QUESTION_ANSWERING_MAPPING_NAMES = /* @__PURE__ */ new Map([
      ["vision-encoder-decoder", ["VisionEncoderDecoderModel", VisionEncoderDecoderModel]]
    ]);
    MODEL_FOR_IMAGE_CLASSIFICATION_MAPPING_NAMES = /* @__PURE__ */ new Map([
      ["vit", ["ViTForImageClassification", ViTForImageClassification]],
      ["fastvit", ["FastViTForImageClassification", FastViTForImageClassification]],
      ["mobilevit", ["MobileViTForImageClassification", MobileViTForImageClassification]],
      ["mobilevitv2", ["MobileViTV2ForImageClassification", MobileViTV2ForImageClassification]],
      ["beit", ["BeitForImageClassification", BeitForImageClassification]],
      ["deit", ["DeiTForImageClassification", DeiTForImageClassification]],
      ["convnext", ["ConvNextForImageClassification", ConvNextForImageClassification]],
      ["convnextv2", ["ConvNextV2ForImageClassification", ConvNextV2ForImageClassification]],
      ["dinov2", ["Dinov2ForImageClassification", Dinov2ForImageClassification]],
      ["resnet", ["ResNetForImageClassification", ResNetForImageClassification]],
      ["swin", ["SwinForImageClassification", SwinForImageClassification]],
      ["segformer", ["SegformerForImageClassification", SegformerForImageClassification]],
      ["efficientnet", ["EfficientNetForImageClassification", EfficientNetForImageClassification]]
    ]);
    MODEL_FOR_OBJECT_DETECTION_MAPPING_NAMES = /* @__PURE__ */ new Map([
      ["detr", ["DetrForObjectDetection", DetrForObjectDetection]],
      ["table-transformer", ["TableTransformerForObjectDetection", TableTransformerForObjectDetection]],
      ["yolos", ["YolosForObjectDetection", YolosForObjectDetection]]
    ]);
    MODEL_FOR_ZERO_SHOT_OBJECT_DETECTION_MAPPING_NAMES = /* @__PURE__ */ new Map([
      ["owlvit", ["OwlViTForObjectDetection", OwlViTForObjectDetection]],
      ["owlv2", ["Owlv2ForObjectDetection", Owlv2ForObjectDetection]]
    ]);
    MODEL_FOR_IMAGE_SEGMENTATION_MAPPING_NAMES = /* @__PURE__ */ new Map([
      ["detr", ["DetrForSegmentation", DetrForSegmentation]],
      ["clipseg", ["CLIPSegForImageSegmentation", CLIPSegForImageSegmentation]]
    ]);
    MODEL_FOR_SEMANTIC_SEGMENTATION_MAPPING_NAMES = /* @__PURE__ */ new Map([
      ["segformer", ["SegformerForSemanticSegmentation", SegformerForSemanticSegmentation]]
    ]);
    MODEL_FOR_MASK_GENERATION_MAPPING_NAMES = /* @__PURE__ */ new Map([
      ["sam", ["SamModel", SamModel]]
    ]);
    MODEL_FOR_CTC_MAPPING_NAMES = /* @__PURE__ */ new Map([
      ["wav2vec2", ["Wav2Vec2ForCTC", Wav2Vec2ForCTC]],
      ["wav2vec2-bert", ["Wav2Vec2BertForCTC", Wav2Vec2BertForCTC]],
      ["unispeech", ["UniSpeechForCTC", UniSpeechForCTC]],
      ["unispeech-sat", ["UniSpeechSatForCTC", UniSpeechSatForCTC]],
      ["wavlm", ["WavLMForCTC", WavLMForCTC]],
      ["hubert", ["HubertForCTC", HubertForCTC]]
    ]);
    MODEL_FOR_AUDIO_CLASSIFICATION_MAPPING_NAMES = /* @__PURE__ */ new Map([
      ["wav2vec2", ["Wav2Vec2ForSequenceClassification", Wav2Vec2ForSequenceClassification]],
      ["wav2vec2-bert", ["Wav2Vec2BertForSequenceClassification", Wav2Vec2BertForSequenceClassification]],
      ["unispeech", ["UniSpeechForSequenceClassification", UniSpeechForSequenceClassification]],
      ["unispeech-sat", ["UniSpeechSatForSequenceClassification", UniSpeechSatForSequenceClassification]],
      ["wavlm", ["WavLMForSequenceClassification", WavLMForSequenceClassification]],
      ["hubert", ["HubertForSequenceClassification", HubertForSequenceClassification]],
      ["audio-spectrogram-transformer", ["ASTForAudioClassification", ASTForAudioClassification]]
    ]);
    MODEL_FOR_AUDIO_XVECTOR_MAPPING_NAMES = /* @__PURE__ */ new Map([
      ["wavlm", ["WavLMForXVector", WavLMForXVector]]
    ]);
    MODEL_FOR_AUDIO_FRAME_CLASSIFICATION_MAPPING_NAMES = /* @__PURE__ */ new Map([
      ["unispeech-sat", ["UniSpeechSatForAudioFrameClassification", UniSpeechSatForAudioFrameClassification]],
      ["wavlm", ["WavLMForAudioFrameClassification", WavLMForAudioFrameClassification]],
      ["wav2vec2", ["Wav2Vec2ForAudioFrameClassification", Wav2Vec2ForAudioFrameClassification]]
    ]);
    MODEL_FOR_IMAGE_MATTING_MAPPING_NAMES = /* @__PURE__ */ new Map([
      ["vitmatte", ["VitMatteForImageMatting", VitMatteForImageMatting]]
    ]);
    MODEL_FOR_IMAGE_TO_IMAGE_MAPPING_NAMES = /* @__PURE__ */ new Map([
      ["swin2sr", ["Swin2SRForImageSuperResolution", Swin2SRForImageSuperResolution]]
    ]);
    MODEL_FOR_DEPTH_ESTIMATION_MAPPING_NAMES = /* @__PURE__ */ new Map([
      ["dpt", ["DPTForDepthEstimation", DPTForDepthEstimation]],
      ["depth_anything", ["DepthAnythingForDepthEstimation", DepthAnythingForDepthEstimation]],
      ["glpn", ["GLPNForDepthEstimation", GLPNForDepthEstimation]]
    ]);
    MODEL_FOR_IMAGE_FEATURE_EXTRACTION_MAPPING_NAMES = /* @__PURE__ */ new Map([
      ["clip", ["CLIPVisionModelWithProjection", CLIPVisionModelWithProjection]],
      ["siglip", ["SiglipVisionModel", SiglipVisionModel]]
    ]);
    MODEL_CLASS_TYPE_MAPPING = [
      [MODEL_MAPPING_NAMES_ENCODER_ONLY, MODEL_TYPES.EncoderOnly],
      [MODEL_MAPPING_NAMES_ENCODER_DECODER, MODEL_TYPES.EncoderDecoder],
      [MODEL_MAPPING_NAMES_DECODER_ONLY, MODEL_TYPES.DecoderOnly],
      [MODEL_FOR_SEQUENCE_CLASSIFICATION_MAPPING_NAMES, MODEL_TYPES.EncoderOnly],
      [MODEL_FOR_TOKEN_CLASSIFICATION_MAPPING_NAMES, MODEL_TYPES.EncoderOnly],
      [MODEL_FOR_SEQ_TO_SEQ_CAUSAL_LM_MAPPING_NAMES, MODEL_TYPES.Seq2Seq],
      [MODEL_FOR_SPEECH_SEQ_2_SEQ_MAPPING_NAMES, MODEL_TYPES.Seq2Seq],
      [MODEL_WITH_LM_HEAD_MAPPING_NAMES, MODEL_TYPES.DecoderOnly],
      [MODEL_FOR_MASKED_LM_MAPPING_NAMES, MODEL_TYPES.EncoderOnly],
      [MODEL_FOR_QUESTION_ANSWERING_MAPPING_NAMES, MODEL_TYPES.EncoderOnly],
      [MODEL_FOR_VISION_2_SEQ_MAPPING_NAMES, MODEL_TYPES.Vision2Seq],
      [MODEL_FOR_IMAGE_CLASSIFICATION_MAPPING_NAMES, MODEL_TYPES.EncoderOnly],
      [MODEL_FOR_IMAGE_SEGMENTATION_MAPPING_NAMES, MODEL_TYPES.EncoderOnly],
      [MODEL_FOR_SEMANTIC_SEGMENTATION_MAPPING_NAMES, MODEL_TYPES.EncoderOnly],
      [MODEL_FOR_IMAGE_MATTING_MAPPING_NAMES, MODEL_TYPES.EncoderOnly],
      [MODEL_FOR_IMAGE_TO_IMAGE_MAPPING_NAMES, MODEL_TYPES.EncoderOnly],
      [MODEL_FOR_DEPTH_ESTIMATION_MAPPING_NAMES, MODEL_TYPES.EncoderOnly],
      [MODEL_FOR_OBJECT_DETECTION_MAPPING_NAMES, MODEL_TYPES.EncoderOnly],
      [MODEL_FOR_ZERO_SHOT_OBJECT_DETECTION_MAPPING_NAMES, MODEL_TYPES.EncoderOnly],
      [MODEL_FOR_MASK_GENERATION_MAPPING_NAMES, MODEL_TYPES.MaskGeneration],
      [MODEL_FOR_CTC_MAPPING_NAMES, MODEL_TYPES.EncoderOnly],
      [MODEL_FOR_AUDIO_CLASSIFICATION_MAPPING_NAMES, MODEL_TYPES.EncoderOnly],
      [MODEL_FOR_TEXT_TO_SPECTROGRAM_MAPPING_NAMES, MODEL_TYPES.Seq2Seq],
      [MODEL_FOR_TEXT_TO_WAVEFORM_MAPPING_NAMES, MODEL_TYPES.EncoderOnly],
      [MODEL_FOR_AUDIO_XVECTOR_MAPPING_NAMES, MODEL_TYPES.EncoderOnly],
      [MODEL_FOR_AUDIO_FRAME_CLASSIFICATION_MAPPING_NAMES, MODEL_TYPES.EncoderOnly],
      // Custom:
      [MODEL_FOR_IMAGE_FEATURE_EXTRACTION_MAPPING_NAMES, MODEL_TYPES.EncoderOnly]
    ];
    for (const [mappings, type] of MODEL_CLASS_TYPE_MAPPING) {
      for (const [name, model] of mappings.values()) {
        MODEL_TYPE_MAPPING.set(name, type);
        MODEL_CLASS_TO_NAME_MAPPING.set(model, name);
        MODEL_NAME_TO_CLASS_MAPPING.set(name, model);
      }
    }
    CUSTOM_MAPPING = [
      ["CLIPTextModelWithProjection", CLIPTextModelWithProjection, MODEL_TYPES.EncoderOnly],
      ["SiglipTextModel", SiglipTextModel, MODEL_TYPES.EncoderOnly],
      ["ClapTextModelWithProjection", ClapTextModelWithProjection, MODEL_TYPES.EncoderOnly],
      ["ClapAudioModelWithProjection", ClapAudioModelWithProjection, MODEL_TYPES.EncoderOnly]
    ];
    for (const [name, model, type] of CUSTOM_MAPPING) {
      MODEL_TYPE_MAPPING.set(name, type);
      MODEL_CLASS_TO_NAME_MAPPING.set(model, name);
      MODEL_NAME_TO_CLASS_MAPPING.set(name, model);
    }
    AutoModel = class extends PretrainedMixin {
      /** @type {Map<string, Object>[]} */
      // @ts-ignore
      static MODEL_CLASS_MAPPINGS = MODEL_CLASS_TYPE_MAPPING.map((x) => x[0]);
      static BASE_IF_FAIL = true;
    };
    AutoModelForSequenceClassification = class extends PretrainedMixin {
      static MODEL_CLASS_MAPPINGS = [MODEL_FOR_SEQUENCE_CLASSIFICATION_MAPPING_NAMES];
    };
    AutoModelForTokenClassification = class extends PretrainedMixin {
      static MODEL_CLASS_MAPPINGS = [MODEL_FOR_TOKEN_CLASSIFICATION_MAPPING_NAMES];
    };
    AutoModelForSeq2SeqLM = class extends PretrainedMixin {
      static MODEL_CLASS_MAPPINGS = [MODEL_FOR_SEQ_TO_SEQ_CAUSAL_LM_MAPPING_NAMES];
    };
    AutoModelForSpeechSeq2Seq = class extends PretrainedMixin {
      static MODEL_CLASS_MAPPINGS = [MODEL_FOR_SPEECH_SEQ_2_SEQ_MAPPING_NAMES];
    };
    AutoModelForTextToSpectrogram = class extends PretrainedMixin {
      static MODEL_CLASS_MAPPINGS = [MODEL_FOR_TEXT_TO_SPECTROGRAM_MAPPING_NAMES];
    };
    AutoModelForTextToWaveform = class extends PretrainedMixin {
      static MODEL_CLASS_MAPPINGS = [MODEL_FOR_TEXT_TO_WAVEFORM_MAPPING_NAMES];
    };
    AutoModelForCausalLM = class extends PretrainedMixin {
      static MODEL_CLASS_MAPPINGS = [MODEL_WITH_LM_HEAD_MAPPING_NAMES];
    };
    AutoModelForMaskedLM = class extends PretrainedMixin {
      static MODEL_CLASS_MAPPINGS = [MODEL_FOR_MASKED_LM_MAPPING_NAMES];
    };
    AutoModelForQuestionAnswering = class extends PretrainedMixin {
      static MODEL_CLASS_MAPPINGS = [MODEL_FOR_QUESTION_ANSWERING_MAPPING_NAMES];
    };
    AutoModelForVision2Seq = class extends PretrainedMixin {
      static MODEL_CLASS_MAPPINGS = [MODEL_FOR_VISION_2_SEQ_MAPPING_NAMES];
    };
    AutoModelForImageClassification = class extends PretrainedMixin {
      static MODEL_CLASS_MAPPINGS = [MODEL_FOR_IMAGE_CLASSIFICATION_MAPPING_NAMES];
    };
    AutoModelForImageSegmentation = class extends PretrainedMixin {
      static MODEL_CLASS_MAPPINGS = [MODEL_FOR_IMAGE_SEGMENTATION_MAPPING_NAMES];
    };
    AutoModelForSemanticSegmentation = class extends PretrainedMixin {
      static MODEL_CLASS_MAPPINGS = [MODEL_FOR_SEMANTIC_SEGMENTATION_MAPPING_NAMES];
    };
    AutoModelForObjectDetection = class extends PretrainedMixin {
      static MODEL_CLASS_MAPPINGS = [MODEL_FOR_OBJECT_DETECTION_MAPPING_NAMES];
    };
    AutoModelForZeroShotObjectDetection = class extends PretrainedMixin {
      static MODEL_CLASS_MAPPINGS = [MODEL_FOR_ZERO_SHOT_OBJECT_DETECTION_MAPPING_NAMES];
    };
    AutoModelForCTC = class extends PretrainedMixin {
      static MODEL_CLASS_MAPPINGS = [MODEL_FOR_CTC_MAPPING_NAMES];
    };
    AutoModelForAudioClassification = class extends PretrainedMixin {
      static MODEL_CLASS_MAPPINGS = [MODEL_FOR_AUDIO_CLASSIFICATION_MAPPING_NAMES];
    };
    AutoModelForDocumentQuestionAnswering = class extends PretrainedMixin {
      static MODEL_CLASS_MAPPINGS = [MODEL_FOR_DOCUMENT_QUESTION_ANSWERING_MAPPING_NAMES];
    };
    AutoModelForImageToImage = class extends PretrainedMixin {
      static MODEL_CLASS_MAPPINGS = [MODEL_FOR_IMAGE_TO_IMAGE_MAPPING_NAMES];
    };
    AutoModelForDepthEstimation = class extends PretrainedMixin {
      static MODEL_CLASS_MAPPINGS = [MODEL_FOR_DEPTH_ESTIMATION_MAPPING_NAMES];
    };
    AutoModelForImageFeatureExtraction = class extends PretrainedMixin {
      static MODEL_CLASS_MAPPINGS = [MODEL_FOR_IMAGE_FEATURE_EXTRACTION_MAPPING_NAMES];
    };
    Seq2SeqLMOutput = class extends ModelOutput {
      /**
       * @param {Object} output The output of the model.
       * @param {Tensor} output.logits The output logits of the model.
       * @param {Tensor} output.past_key_values An tensor of key/value pairs that represent the previous state of the model.
       * @param {Tensor} output.encoder_outputs The output of the encoder in a sequence-to-sequence model.
       * @param {Tensor} [output.decoder_attentions] Attentions weights of the decoder, after the attention softmax, used to compute the weighted average in the self-attention heads.
       * @param {Tensor} [output.cross_attentions] Attentions weights of the decoder's cross-attention layer, after the attention softmax, used to compute the weighted average in the cross-attention heads.
       */
      constructor({ logits, past_key_values, encoder_outputs, decoder_attentions = null, cross_attentions = null }) {
        super();
        this.logits = logits;
        this.past_key_values = past_key_values;
        this.encoder_outputs = encoder_outputs;
        this.decoder_attentions = decoder_attentions;
        this.cross_attentions = cross_attentions;
      }
    };
    SequenceClassifierOutput = class extends ModelOutput {
      /**
       * @param {Object} output The output of the model.
       * @param {Tensor} output.logits classification (or regression if config.num_labels==1) scores (before SoftMax).
       */
      constructor({ logits }) {
        super();
        this.logits = logits;
      }
    };
    XVectorOutput = class extends ModelOutput {
      /**
       * @param {Object} output The output of the model.
       * @param {Tensor} output.logits Classification hidden states before AMSoftmax, of shape `(batch_size, config.xvector_output_dim)`.
       * @param {Tensor} output.embeddings Utterance embeddings used for vector similarity-based retrieval, of shape `(batch_size, config.xvector_output_dim)`.
       */
      constructor({ logits, embeddings }) {
        super();
        this.logits = logits;
        this.embeddings = embeddings;
      }
    };
    TokenClassifierOutput = class extends ModelOutput {
      /**
       * @param {Object} output The output of the model.
       * @param {Tensor} output.logits Classification scores (before SoftMax).
       */
      constructor({ logits }) {
        super();
        this.logits = logits;
      }
    };
    MaskedLMOutput = class extends ModelOutput {
      /**
       * @param {Object} output The output of the model.
       * @param {Tensor} output.logits Prediction scores of the language modeling head (scores for each vocabulary token before SoftMax).
       */
      constructor({ logits }) {
        super();
        this.logits = logits;
      }
    };
    QuestionAnsweringModelOutput = class extends ModelOutput {
      /**
       * @param {Object} output The output of the model.
       * @param {Tensor} output.start_logits Span-start scores (before SoftMax).
       * @param {Tensor} output.end_logits Span-end scores (before SoftMax).
       */
      constructor({ start_logits, end_logits }) {
        super();
        this.start_logits = start_logits;
        this.end_logits = end_logits;
      }
    };
    CausalLMOutput = class extends ModelOutput {
      /**
       * @param {Object} output The output of the model.
       * @param {Tensor} output.logits Prediction scores of the language modeling head (scores for each vocabulary token before softmax).
       */
      constructor({ logits }) {
        super();
        this.logits = logits;
      }
    };
    ImageMattingOutput = class extends ModelOutput {
      /**
       * @param {Object} output The output of the model.
       * @param {Tensor} output.alphas Estimated alpha values, of shape `(batch_size, num_channels, height, width)`.
       */
      constructor({ alphas }) {
        super();
        this.alphas = alphas;
      }
    };
    VitsModelOutput = class extends ModelOutput {
      /**
       * @param {Object} output The output of the model.
       * @param {Tensor} output.waveform The final audio waveform predicted by the model, of shape `(batch_size, sequence_length)`.
       * @param {Tensor} output.spectrogram The log-mel spectrogram predicted at the output of the flow model.
       * This spectrogram is passed to the Hi-Fi GAN decoder model to obtain the final audio waveform.
       */
      constructor({ waveform, spectrogram: spectrogram2 }) {
        super();
        this.waveform = waveform;
        this.spectrogram = spectrogram2;
      }
    };
  }
});

// (disabled):node_modules/sharp/lib/index.js
var require_lib = __commonJS({
  "(disabled):node_modules/sharp/lib/index.js"() {
  }
});

// node_modules/@xenova/transformers/src/utils/image.js
var import_sharp, BROWSER_ENV, WEBWORKER_ENV, createCanvasFunction, ImageDataClass, loadImageFunction, RESAMPLING_MAPPING, CONTENT_TYPE_MAP, RawImage;
var init_image = __esm({
  "node_modules/@xenova/transformers/src/utils/image.js"() {
    init_hub();
    init_env();
    init_tensor();
    import_sharp = __toESM(require_lib(), 1);
    BROWSER_ENV = typeof self !== "undefined";
    WEBWORKER_ENV = BROWSER_ENV && self.constructor.name === "DedicatedWorkerGlobalScope";
    if (BROWSER_ENV) {
      createCanvasFunction = (width, height) => {
        if (!self.OffscreenCanvas) {
          throw new Error("OffscreenCanvas not supported by this browser.");
        }
        return new self.OffscreenCanvas(width, height);
      };
      loadImageFunction = self.createImageBitmap;
      ImageDataClass = self.ImageData;
    } else if (import_sharp.default) {
      loadImageFunction = async (img) => {
        const metadata = await img.metadata();
        const rawChannels = metadata.channels;
        let { data, info } = await img.rotate().raw().toBuffer({ resolveWithObject: true });
        const newImage = new RawImage(new Uint8ClampedArray(data), info.width, info.height, info.channels);
        if (rawChannels !== void 0 && rawChannels !== info.channels) {
          newImage.convert(rawChannels);
        }
        return newImage;
      };
    } else {
      throw new Error("Unable to load image processing library.");
    }
    RESAMPLING_MAPPING = {
      0: "nearest",
      1: "lanczos",
      2: "bilinear",
      3: "bicubic",
      4: "box",
      5: "hamming"
    };
    CONTENT_TYPE_MAP = /* @__PURE__ */ new Map([
      ["png", "image/png"],
      ["jpg", "image/jpeg"],
      ["jpeg", "image/jpeg"],
      ["gif", "image/gif"]
    ]);
    RawImage = class _RawImage {
      /**
       * Create a new `RawImage` object.
       * @param {Uint8ClampedArray|Uint8Array} data The pixel data.
       * @param {number} width The width of the image.
       * @param {number} height The height of the image.
       * @param {1|2|3|4} channels The number of channels.
       */
      constructor(data, width, height, channels) {
        this.data = data;
        this.width = width;
        this.height = height;
        this.channels = channels;
      }
      /** 
       * Returns the size of the image (width, height).
       * @returns {[number, number]} The size of the image (width, height).
       */
      get size() {
        return [this.width, this.height];
      }
      /**
       * Helper method for reading an image from a variety of input types.
       * @param {RawImage|string|URL} input 
       * @returns The image object.
       * 
       * **Example:** Read image from a URL.
       * ```javascript
       * let image = await RawImage.read('https://huggingface.co/datasets/Xenova/transformers.js-docs/resolve/main/football-match.jpg');
       * // RawImage {
       * //   "data": Uint8ClampedArray [ 25, 25, 25, 19, 19, 19, ... ],
       * //   "width": 800,
       * //   "height": 533,
       * //   "channels": 3
       * // }
       * ```
       */
      static async read(input) {
        if (input instanceof _RawImage) {
          return input;
        } else if (typeof input === "string" || input instanceof URL) {
          return await this.fromURL(input);
        } else {
          throw new Error(`Unsupported input type: ${typeof input}`);
        }
      }
      /**
       * Read an image from a URL or file path.
       * @param {string|URL} url The URL or file path to read the image from.
       * @returns {Promise<RawImage>} The image object.
       */
      static async fromURL(url2) {
        let response = await getFile(url2);
        if (response.status !== 200) {
          throw new Error(`Unable to read image from "${url2}" (${response.status} ${response.statusText})`);
        }
        let blob = await response.blob();
        return this.fromBlob(blob);
      }
      /**
       * Helper method to create a new Image from a blob.
       * @param {Blob} blob The blob to read the image from.
       * @returns {Promise<RawImage>} The image object.
       */
      static async fromBlob(blob) {
        if (BROWSER_ENV) {
          let img = await loadImageFunction(blob);
          const ctx = createCanvasFunction(img.width, img.height).getContext("2d");
          ctx.drawImage(img, 0, 0);
          return new this(ctx.getImageData(0, 0, img.width, img.height).data, img.width, img.height, 4);
        } else {
          let img = (0, import_sharp.default)(await blob.arrayBuffer());
          return await loadImageFunction(img);
        }
      }
      /**
       * Helper method to create a new Image from a tensor
       * @param {Tensor} tensor 
       */
      static fromTensor(tensor, channel_format = "CHW") {
        if (tensor.dims.length !== 3) {
          throw new Error(`Tensor should have 3 dimensions, but has ${tensor.dims.length} dimensions.`);
        }
        if (channel_format === "CHW") {
          tensor = tensor.transpose(1, 2, 0);
        } else if (channel_format === "HWC") {
        } else {
          throw new Error(`Unsupported channel format: ${channel_format}`);
        }
        if (!(tensor.data instanceof Uint8ClampedArray || tensor.data instanceof Uint8Array)) {
          throw new Error(`Unsupported tensor type: ${tensor.type}`);
        }
        switch (tensor.dims[2]) {
          case 1:
          case 2:
          case 3:
          case 4:
            return new _RawImage(tensor.data, tensor.dims[1], tensor.dims[0], tensor.dims[2]);
          default:
            throw new Error(`Unsupported number of channels: ${tensor.dims[2]}`);
        }
      }
      /**
       * Convert the image to grayscale format.
       * @returns {RawImage} `this` to support chaining.
       */
      grayscale() {
        if (this.channels === 1) {
          return this;
        }
        let newData = new Uint8ClampedArray(this.width * this.height * 1);
        switch (this.channels) {
          case 3:
          // rgb to grayscale
          case 4:
            for (let i = 0, offset = 0; i < this.data.length; i += this.channels) {
              const red = this.data[i];
              const green = this.data[i + 1];
              const blue = this.data[i + 2];
              newData[offset++] = Math.round(0.2989 * red + 0.587 * green + 0.114 * blue);
            }
            break;
          default:
            throw new Error(`Conversion failed due to unsupported number of channels: ${this.channels}`);
        }
        return this._update(newData, this.width, this.height, 1);
      }
      /**
       * Convert the image to RGB format.
       * @returns {RawImage} `this` to support chaining.
       */
      rgb() {
        if (this.channels === 3) {
          return this;
        }
        let newData = new Uint8ClampedArray(this.width * this.height * 3);
        switch (this.channels) {
          case 1:
            for (let i = 0, offset = 0; i < this.data.length; ++i) {
              newData[offset++] = this.data[i];
              newData[offset++] = this.data[i];
              newData[offset++] = this.data[i];
            }
            break;
          case 4:
            for (let i = 0, offset = 0; i < this.data.length; i += 4) {
              newData[offset++] = this.data[i];
              newData[offset++] = this.data[i + 1];
              newData[offset++] = this.data[i + 2];
            }
            break;
          default:
            throw new Error(`Conversion failed due to unsupported number of channels: ${this.channels}`);
        }
        return this._update(newData, this.width, this.height, 3);
      }
      /**
       * Convert the image to RGBA format.
       * @returns {RawImage} `this` to support chaining.
       */
      rgba() {
        if (this.channels === 4) {
          return this;
        }
        let newData = new Uint8ClampedArray(this.width * this.height * 4);
        switch (this.channels) {
          case 1:
            for (let i = 0, offset = 0; i < this.data.length; ++i) {
              newData[offset++] = this.data[i];
              newData[offset++] = this.data[i];
              newData[offset++] = this.data[i];
              newData[offset++] = 255;
            }
            break;
          case 3:
            for (let i = 0, offset = 0; i < this.data.length; i += 3) {
              newData[offset++] = this.data[i];
              newData[offset++] = this.data[i + 1];
              newData[offset++] = this.data[i + 2];
              newData[offset++] = 255;
            }
            break;
          default:
            throw new Error(`Conversion failed due to unsupported number of channels: ${this.channels}`);
        }
        return this._update(newData, this.width, this.height, 4);
      }
      /**
       * Resize the image to the given dimensions. This method uses the canvas API to perform the resizing.
       * @param {number} width The width of the new image.
       * @param {number} height The height of the new image.
       * @param {Object} options Additional options for resizing.
       * @param {0|1|2|3|4|5|string} [options.resample] The resampling method to use.
       * @returns {Promise<RawImage>} `this` to support chaining.
       */
      async resize(width, height, {
        resample = 2
      } = {}) {
        let resampleMethod = RESAMPLING_MAPPING[resample] ?? resample;
        if (BROWSER_ENV) {
          let numChannels = this.channels;
          let canvas = this.toCanvas();
          const ctx = createCanvasFunction(width, height).getContext("2d");
          ctx.drawImage(canvas, 0, 0, width, height);
          let resizedImage = new _RawImage(ctx.getImageData(0, 0, width, height).data, width, height, 4);
          return resizedImage.convert(numChannels);
        } else {
          let img = this.toSharp();
          switch (resampleMethod) {
            case "box":
            case "hamming":
              if (resampleMethod === "box" || resampleMethod === "hamming") {
                console.warn(`Resampling method ${resampleMethod} is not yet supported. Using bilinear instead.`);
                resampleMethod = "bilinear";
              }
            case "nearest":
            case "bilinear":
            case "bicubic":
              img = img.affine([width / this.width, 0, 0, height / this.height], {
                interpolator: resampleMethod
              });
              break;
            case "lanczos":
              img = img.resize({
                width,
                height,
                fit: "fill",
                kernel: "lanczos3"
                // PIL Lanczos uses a kernel size of 3 
              });
              break;
            default:
              throw new Error(`Resampling method ${resampleMethod} is not supported.`);
          }
          return await loadImageFunction(img);
        }
      }
      async pad([left, right, top, bottom]) {
        left = Math.max(left, 0);
        right = Math.max(right, 0);
        top = Math.max(top, 0);
        bottom = Math.max(bottom, 0);
        if (left === 0 && right === 0 && top === 0 && bottom === 0) {
          return this;
        }
        if (BROWSER_ENV) {
          let numChannels = this.channels;
          let canvas = this.toCanvas();
          let newWidth = this.width + left + right;
          let newHeight = this.height + top + bottom;
          const ctx = createCanvasFunction(newWidth, newHeight).getContext("2d");
          ctx.drawImage(
            canvas,
            0,
            0,
            this.width,
            this.height,
            left,
            top,
            newWidth,
            newHeight
          );
          let paddedImage = new _RawImage(
            ctx.getImageData(0, 0, newWidth, newHeight).data,
            newWidth,
            newHeight,
            4
          );
          return paddedImage.convert(numChannels);
        } else {
          let img = this.toSharp().extend({ left, right, top, bottom });
          return await loadImageFunction(img);
        }
      }
      async crop([x_min, y_min, x_max, y_max]) {
        x_min = Math.max(x_min, 0);
        y_min = Math.max(y_min, 0);
        x_max = Math.min(x_max, this.width - 1);
        y_max = Math.min(y_max, this.height - 1);
        if (x_min === 0 && y_min === 0 && x_max === this.width - 1 && y_max === this.height - 1) {
          return this;
        }
        const crop_width = x_max - x_min + 1;
        const crop_height = y_max - y_min + 1;
        if (BROWSER_ENV) {
          const numChannels = this.channels;
          const canvas = this.toCanvas();
          const ctx = createCanvasFunction(crop_width, crop_height).getContext("2d");
          ctx.drawImage(
            canvas,
            x_min,
            y_min,
            crop_width,
            crop_height,
            0,
            0,
            crop_width,
            crop_height
          );
          const resizedImage = new _RawImage(ctx.getImageData(0, 0, crop_width, crop_height).data, crop_width, crop_height, 4);
          return resizedImage.convert(numChannels);
        } else {
          const img = this.toSharp().extract({
            left: x_min,
            top: y_min,
            width: crop_width,
            height: crop_height
          });
          return await loadImageFunction(img);
        }
      }
      async center_crop(crop_width, crop_height) {
        if (this.width === crop_width && this.height === crop_height) {
          return this;
        }
        let width_offset = (this.width - crop_width) / 2;
        let height_offset = (this.height - crop_height) / 2;
        if (BROWSER_ENV) {
          let numChannels = this.channels;
          let canvas = this.toCanvas();
          const ctx = createCanvasFunction(crop_width, crop_height).getContext("2d");
          let sourceX = 0;
          let sourceY = 0;
          let destX = 0;
          let destY = 0;
          if (width_offset >= 0) {
            sourceX = width_offset;
          } else {
            destX = -width_offset;
          }
          if (height_offset >= 0) {
            sourceY = height_offset;
          } else {
            destY = -height_offset;
          }
          ctx.drawImage(
            canvas,
            sourceX,
            sourceY,
            crop_width,
            crop_height,
            destX,
            destY,
            crop_width,
            crop_height
          );
          let resizedImage = new _RawImage(ctx.getImageData(0, 0, crop_width, crop_height).data, crop_width, crop_height, 4);
          return resizedImage.convert(numChannels);
        } else {
          let img = this.toSharp();
          if (width_offset >= 0 && height_offset >= 0) {
            img = img.extract({
              left: Math.floor(width_offset),
              top: Math.floor(height_offset),
              width: crop_width,
              height: crop_height
            });
          } else if (width_offset <= 0 && height_offset <= 0) {
            let top = Math.floor(-height_offset);
            let left = Math.floor(-width_offset);
            img = img.extend({
              top,
              left,
              // Ensures the resulting image has the desired dimensions
              right: crop_width - this.width - left,
              bottom: crop_height - this.height - top
            });
          } else {
            let y_padding = [0, 0];
            let y_extract = 0;
            if (height_offset < 0) {
              y_padding[0] = Math.floor(-height_offset);
              y_padding[1] = crop_height - this.height - y_padding[0];
            } else {
              y_extract = Math.floor(height_offset);
            }
            let x_padding = [0, 0];
            let x_extract = 0;
            if (width_offset < 0) {
              x_padding[0] = Math.floor(-width_offset);
              x_padding[1] = crop_width - this.width - x_padding[0];
            } else {
              x_extract = Math.floor(width_offset);
            }
            img = img.extend({
              top: y_padding[0],
              bottom: y_padding[1],
              left: x_padding[0],
              right: x_padding[1]
            }).extract({
              left: x_extract,
              top: y_extract,
              width: crop_width,
              height: crop_height
            });
          }
          return await loadImageFunction(img);
        }
      }
      async toBlob(type = "image/png", quality = 1) {
        if (!BROWSER_ENV) {
          throw new Error("toBlob() is only supported in browser environments.");
        }
        const canvas = this.toCanvas();
        return await canvas.convertToBlob({ type, quality });
      }
      toTensor(channel_format = "CHW") {
        let tensor = new Tensor(
          "uint8",
          new Uint8Array(this.data),
          [this.height, this.width, this.channels]
        );
        if (channel_format === "HWC") {
        } else if (channel_format === "CHW") {
          tensor = tensor.permute(2, 0, 1);
        } else {
          throw new Error(`Unsupported channel format: ${channel_format}`);
        }
        return tensor;
      }
      toCanvas() {
        if (!BROWSER_ENV) {
          throw new Error("toCanvas() is only supported in browser environments.");
        }
        let cloned = this.clone().rgba();
        let clonedCanvas = createCanvasFunction(cloned.width, cloned.height);
        let data = new ImageDataClass(cloned.data, cloned.width, cloned.height);
        clonedCanvas.getContext("2d").putImageData(data, 0, 0);
        return clonedCanvas;
      }
      /**
       * Helper method to update the image data.
       * @param {Uint8ClampedArray} data The new image data.
       * @param {number} width The new width of the image.
       * @param {number} height The new height of the image.
       * @param {1|2|3|4|null} [channels] The new number of channels of the image.
       * @private
       */
      _update(data, width, height, channels = null) {
        this.data = data;
        this.width = width;
        this.height = height;
        if (channels !== null) {
          this.channels = channels;
        }
        return this;
      }
      /**
       * Clone the image
       * @returns {RawImage} The cloned image
       */
      clone() {
        return new _RawImage(this.data.slice(), this.width, this.height, this.channels);
      }
      /**
       * Helper method for converting image to have a certain number of channels
       * @param {number} numChannels The number of channels. Must be 1, 3, or 4.
       * @returns {RawImage} `this` to support chaining.
       */
      convert(numChannels) {
        if (this.channels === numChannels) return this;
        switch (numChannels) {
          case 1:
            this.grayscale();
            break;
          case 3:
            this.rgb();
            break;
          case 4:
            this.rgba();
            break;
          default:
            throw new Error(`Conversion failed due to unsupported number of channels: ${this.channels}`);
        }
        return this;
      }
      /**
       * Save the image to the given path.
       * @param {string} path The path to save the image to.
       */
      async save(path3) {
        if (BROWSER_ENV) {
          if (WEBWORKER_ENV) {
            throw new Error("Unable to save an image from a Web Worker.");
          }
          const extension = path3.split(".").pop().toLowerCase();
          const mime = CONTENT_TYPE_MAP.get(extension) ?? "image/png";
          const blob = await this.toBlob(mime);
          const dataURL = URL.createObjectURL(blob);
          const downloadLink = document.createElement("a");
          downloadLink.href = dataURL;
          downloadLink.download = path3;
          downloadLink.click();
          downloadLink.remove();
        } else if (!env.useFS) {
          throw new Error("Unable to save the image because filesystem is disabled in this environment.");
        } else {
          const img = this.toSharp();
          return await img.toFile(path3);
        }
      }
      toSharp() {
        if (BROWSER_ENV) {
          throw new Error("toSharp() is only supported in server-side environments.");
        }
        return (0, import_sharp.default)(this.data, {
          raw: {
            width: this.width,
            height: this.height,
            channels: this.channels
          }
        });
      }
    };
  }
});

// node_modules/@xenova/transformers/src/utils/audio.js
async function read_audio(url2, sampling_rate) {
  if (typeof AudioContext === "undefined") {
    throw Error(
      "Unable to load audio from path/URL since `AudioContext` is not available in your environment. Instead, audio data should be passed directly to the pipeline/processor. For more information and some example code, see https://huggingface.co/docs/transformers.js/guides/node-audio-processing."
    );
  }
  const response = await (await getFile(url2)).arrayBuffer();
  const audioCTX = new AudioContext({ sampleRate: sampling_rate });
  if (typeof sampling_rate === "undefined") {
    console.warn(`No sampling rate provided, using default of ${audioCTX.sampleRate}Hz.`);
  }
  const decoded = await audioCTX.decodeAudioData(response);
  let audio;
  if (decoded.numberOfChannels === 2) {
    const SCALING_FACTOR = Math.sqrt(2);
    const left = decoded.getChannelData(0);
    const right = decoded.getChannelData(1);
    audio = new Float32Array(left.length);
    for (let i = 0; i < decoded.length; ++i) {
      audio[i] = SCALING_FACTOR * (left[i] + right[i]) / 2;
    }
  } else {
    audio = decoded.getChannelData(0);
  }
  return audio;
}
function hanning(M) {
  if (M < 1) {
    return new Float64Array();
  }
  if (M === 1) {
    return new Float64Array([1]);
  }
  const denom = M - 1;
  const factor = Math.PI / denom;
  const cos_vals = new Float64Array(M);
  for (let i = 0; i < M; ++i) {
    const n = 2 * i - denom;
    cos_vals[i] = 0.5 + 0.5 * Math.cos(factor * n);
  }
  return cos_vals;
}
function hertz_to_mel(freq, mel_scale = "htk") {
  const fn = HERTZ_TO_MEL_MAPPING[mel_scale];
  if (!fn) {
    throw new Error('mel_scale should be one of "htk", "slaney" or "kaldi".');
  }
  return typeof freq === "number" ? fn(freq) : freq.map((x) => fn(x));
}
function mel_to_hertz(mels, mel_scale = "htk") {
  const fn = MEL_TO_HERTZ_MAPPING[mel_scale];
  if (!fn) {
    throw new Error('mel_scale should be one of "htk", "slaney" or "kaldi".');
  }
  return typeof mels === "number" ? fn(mels) : mels.map((x) => fn(x));
}
function _create_triangular_filter_bank(fft_freqs, filter_freqs) {
  const filter_diff = Float64Array.from(
    { length: filter_freqs.length - 1 },
    (_, i) => filter_freqs[i + 1] - filter_freqs[i]
  );
  const slopes = Array.from({
    length: fft_freqs.length
  }, () => new Array(filter_freqs.length));
  for (let j = 0; j < fft_freqs.length; ++j) {
    const slope = slopes[j];
    for (let i = 0; i < filter_freqs.length; ++i) {
      slope[i] = filter_freqs[i] - fft_freqs[j];
    }
  }
  const numFreqs = filter_freqs.length - 2;
  const ret = Array.from({ length: numFreqs }, () => new Array(fft_freqs.length));
  for (let j = 0; j < fft_freqs.length; ++j) {
    const slope = slopes[j];
    for (let i = 0; i < numFreqs; ++i) {
      const down = -slope[i] / filter_diff[i];
      const up = slope[i + 2] / filter_diff[i + 1];
      ret[i][j] = Math.max(0, Math.min(down, up));
    }
  }
  return ret;
}
function linspace(start, end, num) {
  const step = (end - start) / (num - 1);
  return Float64Array.from({ length: num }, (_, i) => start + step * i);
}
function mel_filter_bank(num_frequency_bins, num_mel_filters, min_frequency, max_frequency, sampling_rate, norm = null, mel_scale = "htk", triangularize_in_mel_space = false) {
  if (norm !== null && norm !== "slaney") {
    throw new Error('norm must be one of null or "slaney"');
  }
  const mel_min = hertz_to_mel(min_frequency, mel_scale);
  const mel_max = hertz_to_mel(max_frequency, mel_scale);
  const mel_freqs = linspace(mel_min, mel_max, num_mel_filters + 2);
  let filter_freqs = mel_to_hertz(mel_freqs, mel_scale);
  let fft_freqs;
  if (triangularize_in_mel_space) {
    const fft_bin_width = sampling_rate / (num_frequency_bins * 2);
    fft_freqs = hertz_to_mel(Float64Array.from({ length: num_frequency_bins }, (_, i) => i * fft_bin_width), mel_scale);
    filter_freqs = mel_freqs;
  } else {
    fft_freqs = linspace(0, Math.floor(sampling_rate / 2), num_frequency_bins);
  }
  const mel_filters = _create_triangular_filter_bank(fft_freqs, filter_freqs);
  if (norm !== null && norm === "slaney") {
    for (let i = 0; i < num_mel_filters; ++i) {
      const filter = mel_filters[i];
      const enorm = 2 / (filter_freqs[i + 2] - filter_freqs[i]);
      for (let j = 0; j < num_frequency_bins; ++j) {
        filter[j] *= enorm;
      }
    }
  }
  return mel_filters;
}
function padReflect(array, left, right) {
  const padded = new array.constructor(array.length + left + right);
  const w = array.length - 1;
  for (let i = 0; i < array.length; ++i) {
    padded[left + i] = array[i];
  }
  for (let i = 1; i <= left; ++i) {
    padded[left - i] = array[calculateReflectOffset(i, w)];
  }
  for (let i = 1; i <= right; ++i) {
    padded[w + left + i] = array[calculateReflectOffset(w - i, w)];
  }
  return padded;
}
function _db_conversion_helper(spectrogram2, factor, reference, min_value, db_range) {
  if (reference <= 0) {
    throw new Error("reference must be greater than zero");
  }
  if (min_value <= 0) {
    throw new Error("min_value must be greater than zero");
  }
  reference = Math.max(min_value, reference);
  const logReference = Math.log10(reference);
  for (let i = 0; i < spectrogram2.length; ++i) {
    spectrogram2[i] = factor * Math.log10(Math.max(min_value, spectrogram2[i]) - logReference);
  }
  if (db_range !== null) {
    if (db_range <= 0) {
      throw new Error("db_range must be greater than zero");
    }
    const maxValue = max(spectrogram2)[0] - db_range;
    for (let i = 0; i < spectrogram2.length; ++i) {
      spectrogram2[i] = Math.max(spectrogram2[i], maxValue);
    }
  }
  return spectrogram2;
}
function amplitude_to_db(spectrogram2, reference = 1, min_value = 1e-5, db_range = null) {
  return _db_conversion_helper(spectrogram2, 20, reference, min_value, db_range);
}
function power_to_db(spectrogram2, reference = 1, min_value = 1e-10, db_range = null) {
  return _db_conversion_helper(spectrogram2, 10, reference, min_value, db_range);
}
function spectrogram(waveform, window2, frame_length, hop_length, {
  fft_length = null,
  power = 1,
  center = true,
  pad_mode = "reflect",
  onesided = true,
  preemphasis = null,
  mel_filters = null,
  mel_floor = 1e-10,
  log_mel = null,
  reference = 1,
  min_value = 1e-10,
  db_range = null,
  remove_dc_offset = null,
  // Custom parameters for efficiency reasons
  max_num_frames = null,
  do_pad = true,
  transpose = false
} = {}) {
  const window_length = window2.length;
  if (fft_length === null) {
    fft_length = frame_length;
  }
  if (frame_length > fft_length) {
    throw Error(`frame_length (${frame_length}) may not be larger than fft_length (${fft_length})`);
  }
  if (window_length !== frame_length) {
    throw new Error(`Length of the window (${window_length}) must equal frame_length (${frame_length})`);
  }
  if (hop_length <= 0) {
    throw new Error("hop_length must be greater than zero");
  }
  if (power === null && mel_filters !== null) {
    throw new Error(
      "You have provided `mel_filters` but `power` is `None`. Mel spectrogram computation is not yet supported for complex-valued spectrogram. Specify `power` to fix this issue."
    );
  }
  if (center) {
    if (pad_mode !== "reflect") {
      throw new Error(`pad_mode="${pad_mode}" not implemented yet.`);
    }
    const half_window = Math.floor((fft_length - 1) / 2) + 1;
    waveform = padReflect(waveform, half_window, half_window);
  }
  const num_frames = Math.floor(1 + Math.floor((waveform.length - frame_length) / hop_length));
  const num_frequency_bins = onesided ? Math.floor(fft_length / 2) + 1 : fft_length;
  let d1 = num_frames;
  let d1Max = num_frames;
  if (max_num_frames !== null) {
    if (max_num_frames > num_frames) {
      if (do_pad) {
        d1Max = max_num_frames;
      }
    } else {
      d1Max = d1 = max_num_frames;
    }
  }
  const fft = new FFT(fft_length);
  const inputBuffer = new Float64Array(fft_length);
  const outputBuffer = new Float64Array(fft.outputBufferSize);
  const magnitudes = new Array(d1);
  for (let i = 0; i < d1; ++i) {
    const offset = i * hop_length;
    for (let j = 0; j < frame_length; ++j) {
      inputBuffer[j] = waveform[offset + j];
    }
    if (remove_dc_offset) {
      let sum = 0;
      for (let j = 0; j < frame_length; ++j) {
        sum += inputBuffer[j];
      }
      const mean2 = sum / frame_length;
      for (let j = 0; j < frame_length; ++j) {
        inputBuffer[j] -= mean2;
      }
    }
    if (preemphasis !== null) {
      for (let j = frame_length - 1; j >= 1; --j) {
        inputBuffer[j] -= preemphasis * inputBuffer[j - 1];
      }
      inputBuffer[0] *= 1 - preemphasis;
    }
    for (let j = 0; j < window2.length; ++j) {
      inputBuffer[j] *= window2[j];
    }
    fft.realTransform(outputBuffer, inputBuffer);
    const row = new Array(num_frequency_bins);
    for (let j = 0; j < row.length; ++j) {
      const j2 = j << 1;
      row[j] = outputBuffer[j2] ** 2 + outputBuffer[j2 + 1] ** 2;
    }
    magnitudes[i] = row;
  }
  if (power !== null && power !== 2) {
    const pow = 2 / power;
    for (let i = 0; i < magnitudes.length; ++i) {
      const magnitude = magnitudes[i];
      for (let j = 0; j < magnitude.length; ++j) {
        magnitude[j] **= pow;
      }
    }
  }
  const num_mel_filters = mel_filters.length;
  const mel_spec = new Float32Array(num_mel_filters * d1Max);
  const dims = transpose ? [d1Max, num_mel_filters] : [num_mel_filters, d1Max];
  for (let i = 0; i < num_mel_filters; ++i) {
    const filter = mel_filters[i];
    for (let j = 0; j < d1; ++j) {
      const magnitude = magnitudes[j];
      let sum = 0;
      for (let k = 0; k < num_frequency_bins; ++k) {
        sum += filter[k] * magnitude[k];
      }
      mel_spec[transpose ? j * num_mel_filters + i : i * d1 + j] = Math.max(mel_floor, sum);
    }
  }
  if (power !== null && log_mel !== null) {
    const o = Math.min(mel_spec.length, d1 * num_mel_filters);
    switch (log_mel) {
      case "log":
        for (let i = 0; i < o; ++i) {
          mel_spec[i] = Math.log(mel_spec[i]);
        }
        break;
      case "log10":
        for (let i = 0; i < o; ++i) {
          mel_spec[i] = Math.log10(mel_spec[i]);
        }
        break;
      case "dB":
        if (power === 1) {
          amplitude_to_db(mel_spec, reference, min_value, db_range);
        } else if (power === 2) {
          power_to_db(mel_spec, reference, min_value, db_range);
        } else {
          throw new Error(`Cannot use log_mel option '${log_mel}' with power ${power}`);
        }
        break;
      default:
        throw new Error(`log_mel must be one of null, 'log', 'log10' or 'dB'. Got '${log_mel}'`);
    }
  }
  return { data: mel_spec, dims };
}
function window_function(window_length, name, {
  periodic = true,
  frame_length = null,
  center = true
} = {}) {
  const length = periodic ? window_length + 1 : window_length;
  let window2;
  switch (name) {
    case "boxcar":
      window2 = new Float64Array(length).fill(1);
      break;
    case "hann":
    case "hann_window":
      window2 = hanning(length);
      break;
    case "povey":
      window2 = hanning(length).map((x) => Math.pow(x, 0.85));
      break;
    default:
      throw new Error(`Unknown window type ${name}.`);
  }
  if (periodic) {
    window2 = window2.subarray(0, window_length);
  }
  if (frame_length === null) {
    return window2;
  }
  if (window_length > frame_length) {
    throw new Error(`Length of the window (${window_length}) may not be larger than frame_length (${frame_length})`);
  }
  return window2;
}
var HERTZ_TO_MEL_MAPPING, MEL_TO_HERTZ_MAPPING;
var init_audio = __esm({
  "node_modules/@xenova/transformers/src/utils/audio.js"() {
    init_hub();
    init_maths();
    init_core();
    HERTZ_TO_MEL_MAPPING = {
      "htk": (freq) => 2595 * Math.log10(1 + freq / 700),
      "kaldi": (freq) => 1127 * Math.log(1 + freq / 700),
      "slaney": (freq, min_log_hertz = 1e3, min_log_mel = 15, logstep = 27 / Math.log(6.4)) => freq >= min_log_hertz ? min_log_mel + Math.log(freq / min_log_hertz) * logstep : 3 * freq / 200
    };
    MEL_TO_HERTZ_MAPPING = {
      "htk": (mels) => 700 * (10 ** (mels / 2595) - 1),
      "kaldi": (mels) => 700 * (Math.exp(mels / 1127) - 1),
      "slaney": (mels, min_log_hertz = 1e3, min_log_mel = 15, logstep = Math.log(6.4) / 27) => mels >= min_log_mel ? min_log_hertz * Math.exp(logstep * (mels - min_log_mel)) : 200 * mels / 3
    };
  }
});

// node_modules/@xenova/transformers/src/processors.js
function center_to_corners_format([centerX, centerY, width, height]) {
  return [
    centerX - width / 2,
    centerY - height / 2,
    centerX + width / 2,
    centerY + height / 2
  ];
}
function post_process_object_detection(outputs, threshold = 0.5, target_sizes = null, is_zero_shot = false) {
  const out_logits = outputs.logits;
  const out_bbox = outputs.pred_boxes;
  const [batch_size, num_boxes, num_classes] = out_logits.dims;
  if (target_sizes !== null && target_sizes.length !== batch_size) {
    throw Error("Make sure that you pass in as many target sizes as the batch dimension of the logits");
  }
  let toReturn = [];
  for (let i = 0; i < batch_size; ++i) {
    let target_size = target_sizes !== null ? target_sizes[i] : null;
    let info = {
      boxes: [],
      classes: [],
      scores: []
    };
    let logits = out_logits[i];
    let bbox = out_bbox[i];
    for (let j = 0; j < num_boxes; ++j) {
      let logit = logits[j];
      let indices = [];
      let probs;
      if (is_zero_shot) {
        probs = logit.sigmoid().data;
        for (let k = 0; k < probs.length; ++k) {
          if (probs[k] > threshold) {
            indices.push(k);
          }
        }
      } else {
        let maxIndex = max(logit.data)[1];
        if (maxIndex === num_classes - 1) {
          continue;
        }
        indices.push(maxIndex);
        probs = softmax(logit.data);
      }
      for (const index of indices) {
        let box = bbox[j].data;
        box = center_to_corners_format(box);
        if (target_size !== null) {
          box = box.map((x, i2) => x * target_size[(i2 + 1) % 2]);
        }
        info.boxes.push(box);
        info.classes.push(index);
        info.scores.push(probs[index]);
      }
    }
    toReturn.push(info);
  }
  return toReturn;
}
function validate_audio_inputs(audio, feature_extractor) {
  if (!(audio instanceof Float32Array || audio instanceof Float64Array)) {
    throw new Error(
      `${feature_extractor} expects input to be a Float32Array or a Float64Array, but got ${audio?.constructor?.name ?? typeof audio} instead. If using the feature extractor directly, remember to use \`read_audio(url, sampling_rate)\` to obtain the raw audio data of the file/url.`
    );
  }
}
function constraint_to_multiple_of(val, multiple, minVal = 0, maxVal = null) {
  const a = val / multiple;
  let x = bankers_round(a) * multiple;
  if (maxVal !== null && x > maxVal) {
    x = Math.floor(a) * multiple;
  }
  if (x < minVal) {
    x = Math.ceil(a) * multiple;
  }
  return x;
}
function enforce_size_divisibility([width, height], divisor) {
  return [
    Math.max(Math.floor(width / divisor), 1) * divisor,
    Math.max(Math.floor(height / divisor), 1) * divisor
  ];
}
var FeatureExtractor, ImageFeatureExtractor, SegformerFeatureExtractor, DPTFeatureExtractor, DPTImageProcessor, BitImageProcessor, GLPNFeatureExtractor, CLIPFeatureExtractor, ChineseCLIPFeatureExtractor, SiglipImageProcessor, ConvNextFeatureExtractor, ConvNextImageProcessor, ViTFeatureExtractor, ViTImageProcessor, EfficientNetImageProcessor, MobileViTFeatureExtractor, MobileViTImageProcessor, OwlViTFeatureExtractor, Owlv2ImageProcessor, DeiTFeatureExtractor, BeitFeatureExtractor, DonutFeatureExtractor, NougatImageProcessor, DetrFeatureExtractor, YolosFeatureExtractor, SamImageProcessor, Swin2SRImageProcessor, VitMatteImageProcessor, WhisperFeatureExtractor, Wav2Vec2FeatureExtractor, SeamlessM4TFeatureExtractor, ASTFeatureExtractor, ClapFeatureExtractor, SpeechT5FeatureExtractor, Processor, SamProcessor, WhisperProcessor, Wav2Vec2ProcessorWithLM, SpeechT5Processor, OwlViTProcessor, AutoProcessor;
var init_processors = __esm({
  "node_modules/@xenova/transformers/src/processors.js"() {
    init_core();
    init_hub();
    init_maths();
    init_tensor();
    init_image();
    init_audio();
    FeatureExtractor = class extends Callable {
      /**
       * Constructs a new FeatureExtractor instance.
       *
       * @param {Object} config The configuration for the feature extractor.
       */
      constructor(config) {
        super();
        this.config = config;
      }
    };
    ImageFeatureExtractor = class extends FeatureExtractor {
      /**
       * Constructs a new ImageFeatureExtractor instance.
       *
       * @param {Object} config The configuration for the feature extractor.
       * @param {number[]} config.image_mean The mean values for image normalization.
       * @param {number[]} config.image_std The standard deviation values for image normalization.
       * @param {boolean} config.do_rescale Whether to rescale the image pixel values to the [0,1] range.
       * @param {number} config.rescale_factor The factor to use for rescaling the image pixel values.
       * @param {boolean} config.do_normalize Whether to normalize the image pixel values.
       * @param {boolean} config.do_resize Whether to resize the image.
       * @param {number} config.resample What method to use for resampling.
       * @param {number|Object} config.size The size to resize the image to.
       * @param {boolean} [config.do_flip_channel_order=false] Whether to flip the color channels from RGB to BGR.
       * Can be overridden by the `do_flip_channel_order` parameter in the `preprocess` method.
       */
      constructor(config) {
        super(config);
        this.image_mean = this.config.image_mean ?? this.config.mean;
        this.image_std = this.config.image_std ?? this.config.std;
        this.resample = this.config.resample ?? 2;
        this.do_rescale = this.config.do_rescale ?? true;
        this.rescale_factor = this.config.rescale_factor ?? 1 / 255;
        this.do_normalize = this.config.do_normalize;
        this.do_resize = this.config.do_resize;
        this.do_thumbnail = this.config.do_thumbnail;
        this.size = this.config.size;
        this.size_divisibility = this.config.size_divisibility ?? this.config.size_divisor;
        this.do_center_crop = this.config.do_center_crop;
        this.crop_size = this.config.crop_size;
        this.do_convert_rgb = this.config.do_convert_rgb ?? true;
        this.do_crop_margin = this.config.do_crop_margin;
        this.pad_size = this.config.pad_size;
        this.do_pad = this.config.do_pad;
        if (this.do_pad && !this.pad_size && this.size && this.size.width !== void 0 && this.size.height !== void 0) {
          this.pad_size = this.size;
        }
        this.do_flip_channel_order = this.config.do_flip_channel_order ?? false;
      }
      /**
       * Resize the image to make a thumbnail. The image is resized so that no dimension is larger than any
       * corresponding dimension of the specified size.
       * @param {RawImage} image The image to be resized.
       * @param {{height:number, width:number}} size The size `{"height": h, "width": w}` to resize the image to.
       * @param {string | 0 | 1 | 2 | 3 | 4 | 5} [resample=2] The resampling filter to use.
       * @returns {Promise<RawImage>} The resized image.
       */
      async thumbnail(image, size, resample = 2) {
        const input_height = image.height;
        const input_width = image.width;
        const output_height = size.height;
        const output_width = size.width;
        let height = Math.min(input_height, output_height);
        let width = Math.min(input_width, output_width);
        if (height === input_height && width === input_width) {
          return image;
        }
        if (input_height > input_width) {
          width = Math.floor(input_width * height / input_height);
        } else if (input_width > input_height) {
          height = Math.floor(input_height * width / input_width);
        }
        return await image.resize(width, height, { resample });
      }
      /**
       * Crops the margin of the image. Gray pixels are considered margin (i.e., pixels with a value below the threshold).
       * @param {RawImage} image The image to be cropped.
       * @param {number} gray_threshold Value below which pixels are considered to be gray.
       * @returns {Promise<RawImage>} The cropped image.
       */
      async crop_margin(image, gray_threshold = 200) {
        const gray_image = image.clone().grayscale();
        const minValue = min(gray_image.data)[0];
        const maxValue = max(gray_image.data)[0];
        const diff = maxValue - minValue;
        if (diff === 0) {
          return image;
        }
        const threshold = gray_threshold / 255;
        let x_min = gray_image.width, y_min = gray_image.height, x_max = 0, y_max = 0;
        for (let j = 0; j < gray_image.height; ++j) {
          const row = j * gray_image.width;
          for (let i = 0; i < gray_image.width; ++i) {
            if ((gray_image.data[row + i] - minValue) / diff < threshold) {
              x_min = Math.min(x_min, i);
              y_min = Math.min(y_min, j);
              x_max = Math.max(x_max, i);
              y_max = Math.max(y_max, j);
            }
          }
        }
        image = await image.crop([x_min, y_min, x_max, y_max]);
        return image;
      }
      /**
       * Pad the image by a certain amount.
       * @param {Float32Array} pixelData The pixel data to pad.
       * @param {number[]} imgDims The dimensions of the image (height, width, channels).
       * @param {{width:number; height:number}|number} padSize The dimensions of the padded image.
       * @param {Object} options The options for padding.
       * @param {'constant'|'symmetric'} [options.mode='constant'] The type of padding to add.
       * @param {boolean} [options.center=false] Whether to center the image.
       * @param {number} [options.constant_values=0] The constant value to use for padding.
       * @returns {[Float32Array, number[]]} The padded pixel data and image dimensions.
       */
      pad_image(pixelData, imgDims, padSize, {
        mode = "constant",
        center = false,
        constant_values = 0
      } = {}) {
        const [imageHeight, imageWidth, imageChannels] = imgDims;
        let paddedImageWidth, paddedImageHeight;
        if (typeof padSize === "number") {
          paddedImageWidth = padSize;
          paddedImageHeight = padSize;
        } else {
          paddedImageWidth = padSize.width;
          paddedImageHeight = padSize.height;
        }
        if (paddedImageWidth !== imageWidth || paddedImageHeight !== imageHeight) {
          const paddedPixelData = new Float32Array(paddedImageWidth * paddedImageHeight * imageChannels);
          if (Array.isArray(constant_values)) {
            for (let i = 0; i < paddedPixelData.length; ++i) {
              paddedPixelData[i] = constant_values[i % imageChannels];
            }
          } else if (constant_values !== 0) {
            paddedPixelData.fill(constant_values);
          }
          const [left, top] = center ? [Math.floor((paddedImageWidth - imageWidth) / 2), Math.floor((paddedImageHeight - imageHeight) / 2)] : [0, 0];
          for (let i = 0; i < imageHeight; ++i) {
            const a = (i + top) * paddedImageWidth;
            const b = i * imageWidth;
            for (let j = 0; j < imageWidth; ++j) {
              const c = (a + j + left) * imageChannels;
              const d = (b + j) * imageChannels;
              for (let k = 0; k < imageChannels; ++k) {
                paddedPixelData[c + k] = pixelData[d + k];
              }
            }
          }
          if (mode === "symmetric") {
            if (center) {
              throw new Error("`center` padding is not supported when `mode` is set to `symmetric`.");
            }
            const h1 = imageHeight - 1;
            const w1 = imageWidth - 1;
            for (let i = 0; i < paddedImageHeight; ++i) {
              const a = i * paddedImageWidth;
              const b = calculateReflectOffset(i, h1) * imageWidth;
              for (let j = 0; j < paddedImageWidth; ++j) {
                if (i < imageHeight && j < imageWidth) continue;
                const c = (a + j) * imageChannels;
                const d = (b + calculateReflectOffset(j, w1)) * imageChannels;
                for (let k = 0; k < imageChannels; ++k) {
                  paddedPixelData[c + k] = pixelData[d + k];
                }
              }
            }
          }
          pixelData = paddedPixelData;
          imgDims = [paddedImageHeight, paddedImageWidth, imageChannels];
        }
        return [pixelData, imgDims];
      }
      /**
       * Rescale the image' pixel values by `this.rescale_factor`.
       * @param {Float32Array} pixelData The pixel data to rescale.
       * @returns {void}
       */
      rescale(pixelData) {
        for (let i = 0; i < pixelData.length; ++i) {
          pixelData[i] = this.rescale_factor * pixelData[i];
        }
      }
      /**
       * Find the target (width, height) dimension of the output image after
       * resizing given the input image and the desired size.
       * @param {RawImage} image The image to resize.
       * @param {any} size The size to use for resizing the image. 
       * @returns {[number, number]} The target (width, height) dimension of the output image after resizing.
       */
      get_resize_output_image_size(image, size) {
        const [srcWidth, srcHeight] = image.size;
        let shortest_edge;
        let longest_edge;
        if (this.do_thumbnail) {
          const { height, width } = size;
          shortest_edge = Math.min(height, width);
        } else if (Number.isInteger(size)) {
          shortest_edge = size;
          longest_edge = this.config.max_size ?? shortest_edge;
        } else if (size !== void 0) {
          shortest_edge = size.shortest_edge;
          longest_edge = size.longest_edge;
        }
        if (shortest_edge !== void 0 || longest_edge !== void 0) {
          const shortResizeFactor = shortest_edge === void 0 ? 1 : Math.max(shortest_edge / srcWidth, shortest_edge / srcHeight);
          const newWidth = srcWidth * shortResizeFactor;
          const newHeight = srcHeight * shortResizeFactor;
          const longResizeFactor = longest_edge === void 0 ? 1 : Math.min(longest_edge / newWidth, longest_edge / newHeight);
          let finalWidth = Math.floor(Number((newWidth * longResizeFactor).toFixed(2)));
          let finalHeight = Math.floor(Number((newHeight * longResizeFactor).toFixed(2)));
          if (this.size_divisibility !== void 0) {
            [finalWidth, finalHeight] = enforce_size_divisibility([finalWidth, finalHeight], this.size_divisibility);
          }
          return [finalWidth, finalHeight];
        } else if (size !== void 0 && size.width !== void 0 && size.height !== void 0) {
          let newWidth = size.width;
          let newHeight = size.height;
          if (this.config.keep_aspect_ratio && this.config.ensure_multiple_of) {
            let scale_height = newHeight / srcHeight;
            let scale_width = newWidth / srcWidth;
            if (Math.abs(1 - scale_width) < Math.abs(1 - scale_height)) {
              scale_height = scale_width;
            } else {
              scale_width = scale_height;
            }
            newHeight = constraint_to_multiple_of(scale_height * srcHeight, this.config.ensure_multiple_of);
            newWidth = constraint_to_multiple_of(scale_width * srcWidth, this.config.ensure_multiple_of);
          }
          return [newWidth, newHeight];
        } else if (this.size_divisibility !== void 0) {
          return enforce_size_divisibility([srcWidth, srcHeight], this.size_divisibility);
        } else {
          throw new Error(`Could not resize image due to unsupported \`this.size\` option in config: ${JSON.stringify(size)}`);
        }
      }
      /**
       * Resizes the image.
       * @param {RawImage} image The image to resize.
       * @returns {Promise<RawImage>} The resized image.
       */
      async resize(image) {
        const [newWidth, newHeight] = this.get_resize_output_image_size(image, this.size);
        return await image.resize(newWidth, newHeight, {
          resample: this.resample
        });
      }
      /**
       * @typedef {object} PreprocessedImage
       * @property {HeightWidth} original_size The original size of the image.
       * @property {HeightWidth} reshaped_input_size The reshaped input size of the image.
       * @property {Tensor} pixel_values The pixel values of the preprocessed image.
       */
      /**
       * Preprocesses the given image.
       *
       * @param {RawImage} image The image to preprocess.
       * @param {Object} overrides The overrides for the preprocessing options.
       * @returns {Promise<PreprocessedImage>} The preprocessed image.
       */
      async preprocess(image, {
        do_normalize = null,
        do_pad = null,
        do_convert_rgb = null,
        do_convert_grayscale = null,
        do_flip_channel_order = null
      } = {}) {
        if (this.do_crop_margin) {
          image = await this.crop_margin(image);
        }
        const [srcWidth, srcHeight] = image.size;
        if (do_convert_rgb ?? this.do_convert_rgb) {
          image = image.rgb();
        } else if (do_convert_grayscale) {
          image = image.grayscale();
        }
        if (this.do_resize) {
          image = await this.resize(image);
        }
        if (this.do_thumbnail) {
          image = await this.thumbnail(image, this.size, this.resample);
        }
        if (this.do_center_crop) {
          let crop_width;
          let crop_height;
          if (Number.isInteger(this.crop_size)) {
            crop_width = this.crop_size;
            crop_height = this.crop_size;
          } else {
            crop_width = this.crop_size.width;
            crop_height = this.crop_size.height;
          }
          image = await image.center_crop(crop_width, crop_height);
        }
        const reshaped_input_size = [image.height, image.width];
        let pixelData = Float32Array.from(image.data);
        let imgDims = [image.height, image.width, image.channels];
        if (this.do_rescale) {
          this.rescale(pixelData);
        }
        if (do_normalize ?? this.do_normalize) {
          let image_mean = this.image_mean;
          if (!Array.isArray(this.image_mean)) {
            image_mean = new Array(image.channels).fill(image_mean);
          }
          let image_std = this.image_std;
          if (!Array.isArray(this.image_std)) {
            image_std = new Array(image.channels).fill(image_mean);
          }
          if (image_mean.length !== image.channels || image_std.length !== image.channels) {
            throw new Error(`When set to arrays, the length of \`image_mean\` (${image_mean.length}) and \`image_std\` (${image_std.length}) must match the number of channels in the image (${image.channels}).`);
          }
          for (let i = 0; i < pixelData.length; i += image.channels) {
            for (let j = 0; j < image.channels; ++j) {
              pixelData[i + j] = (pixelData[i + j] - image_mean[j]) / image_std[j];
            }
          }
        }
        if (do_pad ?? this.do_pad) {
          if (this.pad_size) {
            const padded = this.pad_image(pixelData, [image.height, image.width, image.channels], this.pad_size);
            [pixelData, imgDims] = padded;
          } else if (this.size_divisibility) {
            const [paddedWidth, paddedHeight] = enforce_size_divisibility([imgDims[1], imgDims[0]], this.size_divisibility);
            [pixelData, imgDims] = this.pad_image(pixelData, imgDims, { width: paddedWidth, height: paddedHeight });
          }
        }
        if (do_flip_channel_order ?? this.do_flip_channel_order) {
          if (imgDims[2] !== 3) {
            throw new Error("Flipping channel order is only supported for RGB images.");
          }
          for (let i = 0; i < pixelData.length; i += 3) {
            const temp = pixelData[i];
            pixelData[i] = pixelData[i + 2];
            pixelData[i + 2] = temp;
          }
        }
        const pixel_values = new Tensor("float32", pixelData, imgDims).permute(2, 0, 1);
        return {
          original_size: [srcHeight, srcWidth],
          reshaped_input_size,
          pixel_values
        };
      }
      /**
       * Calls the feature extraction process on an array of images,
       * preprocesses each image, and concatenates the resulting
       * features into a single Tensor.
       * @param {RawImage[]} images The image(s) to extract features from.
       * @param {...any} args Additional arguments.
       * @returns {Promise<ImageFeatureExtractorResult>} An object containing the concatenated pixel values (and other metadata) of the preprocessed images.
       */
      async _call(images, ...args) {
        if (!Array.isArray(images)) {
          images = [images];
        }
        const imageData = await Promise.all(images.map((x) => this.preprocess(x)));
        const pixel_values = stack(imageData.map((x) => x.pixel_values), 0);
        return {
          pixel_values,
          // Original sizes of images
          original_sizes: imageData.map((x) => x.original_size),
          // Reshaped sizes of images, before padding or cropping
          reshaped_input_sizes: imageData.map((x) => x.reshaped_input_size)
        };
      }
    };
    SegformerFeatureExtractor = class extends ImageFeatureExtractor {
      /**
       * Converts the output of `SegformerForSemanticSegmentation` into semantic segmentation maps.
       * @param {*} outputs Raw outputs of the model.
       * @param {number[][]} [target_sizes=null] List of tuples corresponding to the requested final size
       * (height, width) of each prediction. If unset, predictions will not be resized.
       * @returns {{segmentation: Tensor; labels: number[]}[]} The semantic segmentation maps.
       */
      post_process_semantic_segmentation(outputs, target_sizes = null) {
        const logits = outputs.logits;
        const batch_size = logits.dims[0];
        if (target_sizes !== null && target_sizes.length !== batch_size) {
          throw Error("Make sure that you pass in as many target sizes as the batch dimension of the logits");
        }
        const toReturn = [];
        for (let i = 0; i < batch_size; ++i) {
          const target_size = target_sizes !== null ? target_sizes[i] : null;
          let data = logits[i];
          if (target_size !== null) {
            data = interpolate(data, target_size, "bilinear", false);
          }
          const [height, width] = target_size ?? data.dims.slice(-2);
          const segmentation = new Tensor(
            "int32",
            new Int32Array(height * width),
            [height, width]
          );
          const buffer = data[0].data;
          for (let j = 1; j < data.dims[0]; ++j) {
            const row = data[j].data;
            for (let k = 0; k < row.length; ++k) {
              if (row[k] > buffer[k]) {
                buffer[k] = row[k];
                segmentation.data[k] = j;
              }
            }
          }
          const hasLabel = new Array(data.dims[0]);
          const out = segmentation.data;
          for (let j = 0; j < out.length; ++j) {
            const index = out[j];
            hasLabel[index] = index;
          }
          const labels = hasLabel.filter((x) => x !== void 0);
          toReturn.push({ segmentation, labels });
        }
        return toReturn;
      }
    };
    DPTFeatureExtractor = class extends ImageFeatureExtractor {
    };
    DPTImageProcessor = class extends DPTFeatureExtractor {
    };
    BitImageProcessor = class extends ImageFeatureExtractor {
    };
    GLPNFeatureExtractor = class extends ImageFeatureExtractor {
    };
    CLIPFeatureExtractor = class extends ImageFeatureExtractor {
    };
    ChineseCLIPFeatureExtractor = class extends ImageFeatureExtractor {
    };
    SiglipImageProcessor = class extends ImageFeatureExtractor {
    };
    ConvNextFeatureExtractor = class extends ImageFeatureExtractor {
      constructor(config) {
        super(config);
        this.crop_pct = this.config.crop_pct ?? 224 / 256;
      }
      async resize(image) {
        const shortest_edge = this.size?.shortest_edge;
        if (shortest_edge === void 0) {
          throw new Error(`Size dictionary must contain 'shortest_edge' key.`);
        }
        if (shortest_edge < 384) {
          const resize_shortest_edge = Math.floor(shortest_edge / this.crop_pct);
          const [newWidth, newHeight] = this.get_resize_output_image_size(image, {
            shortest_edge: resize_shortest_edge
          });
          image = await image.resize(newWidth, newHeight, {
            resample: this.resample
          });
          image = await image.center_crop(shortest_edge, shortest_edge);
        } else {
          image = await image.resize(shortest_edge, shortest_edge, {
            resample: this.resample
          });
        }
        return image;
      }
    };
    ConvNextImageProcessor = class extends ConvNextFeatureExtractor {
    };
    ViTFeatureExtractor = class extends ImageFeatureExtractor {
    };
    ViTImageProcessor = class extends ImageFeatureExtractor {
    };
    EfficientNetImageProcessor = class extends ImageFeatureExtractor {
      constructor(config) {
        super(config);
        this.include_top = this.config.include_top ?? true;
        if (this.include_top) {
          this.image_std = this.image_std.map((x) => x * x);
        }
      }
    };
    MobileViTFeatureExtractor = class extends ImageFeatureExtractor {
    };
    MobileViTImageProcessor = class extends MobileViTFeatureExtractor {
    };
    OwlViTFeatureExtractor = class extends ImageFeatureExtractor {
      /** @type {post_process_object_detection} */
      post_process_object_detection(...args) {
        return post_process_object_detection(...args);
      }
    };
    Owlv2ImageProcessor = class extends OwlViTFeatureExtractor {
    };
    DeiTFeatureExtractor = class extends ImageFeatureExtractor {
    };
    BeitFeatureExtractor = class extends ImageFeatureExtractor {
    };
    DonutFeatureExtractor = class extends ImageFeatureExtractor {
      pad_image(pixelData, imgDims, padSize, options = {}) {
        const [imageHeight, imageWidth, imageChannels] = imgDims;
        let image_mean = this.image_mean;
        if (!Array.isArray(this.image_mean)) {
          image_mean = new Array(imageChannels).fill(image_mean);
        }
        let image_std = this.image_std;
        if (!Array.isArray(image_std)) {
          image_std = new Array(imageChannels).fill(image_mean);
        }
        const constant_values = image_mean.map((x, i) => -x / image_std[i]);
        return super.pad_image(pixelData, imgDims, padSize, {
          center: true,
          // Since normalization is done after padding, we need to use certain constant values to ensure the same behaviour is observed.
          // For more information, see https://github.com/huggingface/transformers/blob/main/src/transformers/models/donut/image_processing_donut.py#L433-L451
          constant_values,
          ...options
        });
      }
    };
    NougatImageProcessor = class extends DonutFeatureExtractor {
    };
    DetrFeatureExtractor = class extends ImageFeatureExtractor {
      /**
       * Calls the feature extraction process on an array of images, preprocesses
       * each image, and concatenates the resulting features into a single Tensor.
       * @param {RawImage[]} images The image(s) to extract features from.
       * @returns {Promise<DetrFeatureExtractorResult>} An object containing the concatenated pixel values of the preprocessed images.
       */
      async _call(images) {
        const result = await super._call(images);
        const maskSize = [result.pixel_values.dims[0], 64, 64];
        const pixel_mask = new Tensor(
          "int64",
          new BigInt64Array(maskSize.reduce((a, b) => a * b)).fill(1n),
          maskSize
        );
        return { ...result, pixel_mask };
      }
      /**
       * Post-processes the outputs of the model (for object detection).
       * @param {Object} outputs The outputs of the model that must be post-processed
       * @param {Tensor} outputs.logits The logits
       * @param {Tensor} outputs.pred_boxes The predicted boxes.
       * @return {Object[]} An array of objects containing the post-processed outputs.
       */
      /** @type {post_process_object_detection} */
      post_process_object_detection(...args) {
        return post_process_object_detection(...args);
      }
      /**
       * Binarize the given masks using `object_mask_threshold`, it returns the associated values of `masks`, `scores` and `labels`.
       * @param {Tensor} class_logits The class logits.
       * @param {Tensor} mask_logits The mask logits.
       * @param {number} object_mask_threshold A number between 0 and 1 used to binarize the masks.
       * @param {number} num_labels The number of labels.
       * @returns {[Tensor[], number[], number[]]} The binarized masks, the scores, and the labels.
       */
      remove_low_and_no_objects(class_logits, mask_logits, object_mask_threshold, num_labels) {
        let mask_probs_item = [];
        let pred_scores_item = [];
        let pred_labels_item = [];
        for (let j = 0; j < class_logits.dims[0]; ++j) {
          let cls = class_logits[j];
          let mask = mask_logits[j];
          let pred_label = max(cls.data)[1];
          if (pred_label === num_labels) {
            continue;
          }
          let scores = softmax(cls.data);
          let pred_score = scores[pred_label];
          if (pred_score > object_mask_threshold) {
            mask_probs_item.push(mask);
            pred_scores_item.push(pred_score);
            pred_labels_item.push(pred_label);
          }
        }
        return [mask_probs_item, pred_scores_item, pred_labels_item];
      }
      /**
       * Checks whether the segment is valid or not.
       * @param {Int32Array} mask_labels Labels for each pixel in the mask.
       * @param {Tensor[]} mask_probs Probabilities for each pixel in the masks.
       * @param {number} k The class id of the segment.
       * @param {number} mask_threshold The mask threshold.
       * @param {number} overlap_mask_area_threshold The overlap mask area threshold.
       * @returns {[boolean, number[]]} Whether the segment is valid or not, and the indices of the valid labels.
       */
      check_segment_validity(mask_labels, mask_probs, k, mask_threshold = 0.5, overlap_mask_area_threshold = 0.8) {
        let mask_k = [];
        let mask_k_area = 0;
        let original_area = 0;
        for (let i = 0; i < mask_labels.length; ++i) {
          if (mask_labels[i] === k) {
            mask_k.push(i);
            ++mask_k_area;
          }
          if (mask_probs[k].data[i] >= mask_threshold) {
            ++original_area;
          }
        }
        let mask_exists = mask_k_area > 0 && original_area > 0;
        if (mask_exists) {
          let area_ratio = mask_k_area / original_area;
          mask_exists = area_ratio > overlap_mask_area_threshold;
        }
        return [mask_exists, mask_k];
      }
      /**
       * Computes the segments.
       * @param {Tensor[]} mask_probs The mask probabilities.
       * @param {number[]} pred_scores The predicted scores.
       * @param {number[]} pred_labels The predicted labels.
       * @param {number} mask_threshold The mask threshold.
       * @param {number} overlap_mask_area_threshold The overlap mask area threshold.
       * @param {Set<number>} label_ids_to_fuse The label ids to fuse.
       * @param {number[]} target_size The target size of the image.
       * @returns {[Tensor, Array<{id: number, label_id: number, score: number}>]} The computed segments.
       */
      compute_segments(mask_probs, pred_scores, pred_labels, mask_threshold, overlap_mask_area_threshold, label_ids_to_fuse = null, target_size = null) {
        let [height, width] = target_size ?? mask_probs[0].dims;
        let segmentation = new Tensor(
          "int32",
          new Int32Array(height * width),
          [height, width]
        );
        let segments = [];
        if (target_size !== null) {
          for (let i = 0; i < mask_probs.length; ++i) {
            mask_probs[i] = interpolate(mask_probs[i], target_size, "bilinear", false);
          }
        }
        let mask_labels = new Int32Array(mask_probs[0].data.length);
        let bestScores = new Float32Array(mask_probs[0].data.length);
        for (let i = 0; i < mask_probs.length; ++i) {
          let score = pred_scores[i];
          for (let j = 0; j < mask_probs[i].data.length; ++j) {
            mask_probs[i].data[j] *= score;
            if (mask_probs[i].data[j] > bestScores[j]) {
              mask_labels[j] = i;
              bestScores[j] = mask_probs[i].data[j];
            }
          }
        }
        let current_segment_id = 0;
        for (let k = 0; k < pred_labels.length; ++k) {
          let pred_class = pred_labels[k];
          let [mask_exists, mask_k] = this.check_segment_validity(
            mask_labels,
            mask_probs,
            k,
            mask_threshold,
            overlap_mask_area_threshold
          );
          if (!mask_exists) {
            continue;
          }
          ++current_segment_id;
          for (let index of mask_k) {
            segmentation.data[index] = current_segment_id;
          }
          segments.push({
            id: current_segment_id,
            label_id: pred_class,
            // was_fused: should_fuse, TODO
            score: pred_scores[k]
          });
        }
        return [segmentation, segments];
      }
      /**
       * Post-process the model output to generate the final panoptic segmentation.
       * @param {*} outputs The model output to post process
       * @param {number} [threshold=0.5] The probability score threshold to keep predicted instance masks.
       * @param {number} [mask_threshold=0.5] Threshold to use when turning the predicted masks into binary values.
       * @param {number} [overlap_mask_area_threshold=0.8] The overlap mask area threshold to merge or discard small disconnected parts within each binary instance mask.
       * @param {Set<number>} [label_ids_to_fuse=null] The labels in this state will have all their instances be fused together.
       * @param {number[][]} [target_sizes=null] The target sizes to resize the masks to.
       * @returns {Array<{ segmentation: Tensor, segments_info: Array<{id: number, label_id: number, score: number}>}>}
       */
      post_process_panoptic_segmentation(outputs, threshold = 0.5, mask_threshold = 0.5, overlap_mask_area_threshold = 0.8, label_ids_to_fuse = null, target_sizes = null) {
        if (label_ids_to_fuse === null) {
          console.warn("`label_ids_to_fuse` unset. No instance will be fused.");
          label_ids_to_fuse = /* @__PURE__ */ new Set();
        }
        const class_queries_logits = outputs.logits;
        const masks_queries_logits = outputs.pred_masks;
        const mask_probs = masks_queries_logits.sigmoid();
        let [batch_size, num_queries, num_labels] = class_queries_logits.dims;
        num_labels -= 1;
        if (target_sizes !== null && target_sizes.length !== batch_size) {
          throw Error("Make sure that you pass in as many target sizes as the batch dimension of the logits");
        }
        let toReturn = [];
        for (let i = 0; i < batch_size; ++i) {
          let target_size = target_sizes !== null ? target_sizes[i] : null;
          let class_logits = class_queries_logits[i];
          let mask_logits = mask_probs[i];
          let [mask_probs_item, pred_scores_item, pred_labels_item] = this.remove_low_and_no_objects(class_logits, mask_logits, threshold, num_labels);
          if (pred_labels_item.length === 0) {
            let [height, width] = target_size ?? mask_logits.dims.slice(-2);
            let segmentation2 = new Tensor(
              "int32",
              new Int32Array(height * width).fill(-1),
              [height, width]
            );
            toReturn.push({
              segmentation: segmentation2,
              segments_info: []
            });
            continue;
          }
          let [segmentation, segments] = this.compute_segments(
            mask_probs_item,
            pred_scores_item,
            pred_labels_item,
            mask_threshold,
            overlap_mask_area_threshold,
            label_ids_to_fuse,
            target_size
          );
          toReturn.push({
            segmentation,
            segments_info: segments
          });
        }
        return toReturn;
      }
      post_process_instance_segmentation() {
        throw Error("Not implemented yet");
      }
    };
    YolosFeatureExtractor = class extends ImageFeatureExtractor {
      /** @type {post_process_object_detection} */
      post_process_object_detection(...args) {
        return post_process_object_detection(...args);
      }
    };
    SamImageProcessor = class extends ImageFeatureExtractor {
      /**
       * 
       * @param {any} input_points 
       * @param {HeightWidth[]} original_sizes 
       * @param {HeightWidth[]} reshaped_input_sizes 
       * @returns {Tensor}
       */
      reshape_input_points(input_points, original_sizes, reshaped_input_sizes) {
        input_points = structuredClone(input_points);
        let shape = calculateDimensions(input_points);
        if (shape.length === 3) {
          shape = [1, ...shape];
          input_points = [input_points];
        } else if (shape.length !== 4) {
          throw Error("The input_points must be a 4D tensor of shape `batch_size`, `point_batch_size`, `nb_points_per_image`, `2`.");
        }
        for (let i = 0; i < input_points.length; ++i) {
          let originalImageSize = original_sizes[i];
          let reshapedImageSize = reshaped_input_sizes[i];
          let resizeFactors = [
            reshapedImageSize[0] / originalImageSize[0],
            reshapedImageSize[1] / originalImageSize[1]
          ];
          for (let j = 0; j < input_points[i].length; ++j) {
            for (let k = 0; k < input_points[i][j].length; ++k) {
              for (let w = 0; w < input_points[i][j][k].length; ++w) {
                input_points[i][j][k][w] *= resizeFactors[w];
              }
            }
          }
        }
        return new Tensor(
          "float32",
          Float32Array.from(input_points.flat(Infinity)),
          shape
        );
      }
      /**
       * 
       * @param {any} input_labels 
       * @param {Tensor} input_points 
       * @returns {Tensor}
       */
      add_input_labels(input_labels, input_points) {
        let shape = calculateDimensions(input_labels);
        if (shape.length === 2) {
          shape = [1, ...shape];
          input_labels = [input_labels];
        } else if (shape.length !== 3) {
          throw Error("The input_points must be a 4D tensor of shape `batch_size`, `point_batch_size`, `nb_points_per_image`, `2`.");
        }
        if (shape.some((x, i) => x !== input_points.dims[i])) {
          throw Error(`The first ${shape.length} dimensions of 'input_points' and 'input_labels' must be the same.`);
        }
        return new Tensor(
          "int64",
          input_labels.flat(Infinity).map(BigInt),
          shape
        );
      }
      /**
       * @param {any[]} images The URL(s) of the image(s) to extract features from.
       * @param {any} [input_points] A 3D or 4D array, representing the input points provided by the user.
       * - 3D: `[point_batch_size, nb_points_per_image, 2]`. In this case, `batch_size` is assumed to be 1.
       * - 4D: `[batch_size, point_batch_size, nb_points_per_image, 2]`.
       * @param {any} [input_labels] A 2D or 3D array, representing the input labels for the points, used by the prompt encoder to encode the prompt.
       * - 2D: `[point_batch_size, nb_points_per_image]`. In this case, `batch_size` is assumed to be 1.
       * - 3D: `[batch_size, point_batch_size, nb_points_per_image]`.
       * @returns {Promise<SamImageProcessorResult>}
       */
      async _call(images, input_points = null, input_labels = null) {
        const processed = await super._call(images);
        if (input_points) {
          processed.input_points = this.reshape_input_points(
            input_points,
            processed.original_sizes,
            processed.reshaped_input_sizes
          );
        }
        if (input_labels) {
          if (!processed.input_points) {
            throw Error("`input_points` must be provided if `input_labels` are provided.");
          }
          processed.input_labels = this.add_input_labels(input_labels, processed.input_points);
        }
        return processed;
      }
      /**
       * Remove padding and upscale masks to the original image size.
       * @param {Tensor} masks Batched masks from the mask_decoder in (batch_size, num_channels, height, width) format.
       * @param {number[][]} original_sizes The original sizes of each image before it was resized to the model's expected input shape, in (height, width) format.
       * @param {number[][]} reshaped_input_sizes The size of each image as it is fed to the model, in (height, width) format. Used to remove padding.
       * @param {Object} options Optional parameters for post-processing.
       * @param {number} [options.mask_threshold] The threshold to use for binarizing the masks.
       * @param {boolean} [options.binarize] Whether to binarize the masks.
       * @param {Object} [options.pad_size] The target size the images were padded to before being passed to the model. If `null`, the target size is assumed to be the processor's `pad_size`.
       * @param {number} [options.pad_size.height] The height the images were padded to.
       * @param {number} [options.pad_size.width] The width the images were padded to.
       * @returns {Tensor[]} Batched masks in batch_size, num_channels, height, width) format, where (height, width) is given by original_size.
       */
      post_process_masks(masks, original_sizes, reshaped_input_sizes, {
        mask_threshold = 0,
        binarize = true,
        pad_size = null
      } = {}) {
        const output_masks = [];
        pad_size = pad_size ?? this.pad_size;
        const target_image_size = [pad_size.height, pad_size.width];
        for (let i = 0; i < original_sizes.length; ++i) {
          const original_size = original_sizes[i];
          const reshaped_input_size = reshaped_input_sizes[i];
          const mask = masks[i];
          const interpolated_masks = [];
          for (let j = 0; j < mask.dims[0]; ++j) {
            const m = mask[j];
            let interpolated_mask = interpolate(m, target_image_size, "bilinear", false);
            interpolated_mask = interpolated_mask.slice(null, [0, reshaped_input_size[0]], [0, reshaped_input_size[1]]);
            interpolated_mask = interpolate(interpolated_mask, original_size, "bilinear", false);
            if (binarize) {
              const binarizedMaskData = new Uint8Array(interpolated_mask.data.length);
              for (let i2 = 0; i2 < interpolated_mask.data.length; ++i2) {
                if (interpolated_mask.data[i2] > mask_threshold) {
                  binarizedMaskData[i2] = 1;
                }
              }
              interpolated_mask = new Tensor(
                "bool",
                binarizedMaskData,
                interpolated_mask.dims
              );
            }
            interpolated_masks.push(interpolated_mask);
          }
          output_masks.push(stack(interpolated_masks));
        }
        return output_masks;
      }
    };
    Swin2SRImageProcessor = class extends ImageFeatureExtractor {
      pad_image(pixelData, imgDims, padSize, options = {}) {
        const [imageHeight, imageWidth, imageChannels] = imgDims;
        return super.pad_image(pixelData, imgDims, {
          // NOTE: For Swin2SR models, the original python implementation adds padding even when the image's width/height is already
          // a multiple of `pad_size`. However, this is most likely a bug (PR: https://github.com/mv-lab/swin2sr/pull/19).
          // For this reason, we only add padding when the image's width/height is not a multiple of `pad_size`.
          width: imageWidth + (padSize - imageWidth % padSize) % padSize,
          height: imageHeight + (padSize - imageHeight % padSize) % padSize
        }, {
          mode: "symmetric",
          center: false,
          constant_values: -1,
          ...options
        });
      }
    };
    VitMatteImageProcessor = class extends ImageFeatureExtractor {
      /**
       * Calls the feature extraction process on an array of images, preprocesses
       * each image, and concatenates the resulting features into a single Tensor.
       * @param {RawImage[]} images The image(s) to extract features from.
       * @param {RawImage[]} trimaps The trimaps(s) to extract features from.
       * @returns {Promise<ImageFeatureExtractorResult>} An object containing the concatenated pixel values of the preprocessed images.
       */
      async _call(images, trimaps) {
        if (!Array.isArray(images)) {
          images = [images];
        }
        if (!Array.isArray(trimaps)) {
          trimaps = [trimaps];
        }
        const imageData = await Promise.all(images.map((x) => this.preprocess(x)));
        const trimapData = await Promise.all(trimaps.map((x) => this.preprocess(x, {
          do_normalize: false,
          do_convert_rgb: false,
          do_convert_grayscale: true
        })));
        const pixel_values = stack(imageData.map(
          // Concatenate images and trimaps
          (x, i) => cat([x.pixel_values, trimapData[i].pixel_values], 0)
        ), 0);
        return {
          pixel_values,
          // Original sizes of images
          original_sizes: imageData.map((x) => x.original_size),
          // Reshaped sizes of images, before padding or cropping
          reshaped_input_sizes: imageData.map((x) => x.reshaped_input_size)
        };
      }
    };
    WhisperFeatureExtractor = class extends FeatureExtractor {
      constructor(config) {
        super(config);
        this.config.mel_filters ??= mel_filter_bank(
          Math.floor(1 + this.config.n_fft / 2),
          // num_frequency_bins
          this.config.feature_size,
          // num_mel_filters
          0,
          // min_frequency
          8e3,
          // max_frequency
          this.config.sampling_rate,
          // sampling_rate
          "slaney",
          // norm
          "slaney"
          // mel_scale
        );
        this.window = window_function(this.config.n_fft, "hann");
      }
      /**
       * Computes the log-Mel spectrogram of the provided audio waveform.
       * @param {Float32Array|Float64Array} waveform The audio waveform to process.
       * @returns {{data: Float32Array, dims: number[]}} An object containing the log-Mel spectrogram data as a Float32Array and its dimensions as an array of numbers.
       */
      _extract_fbank_features(waveform) {
        const { data, dims } = spectrogram(
          waveform,
          this.window,
          // window
          this.config.n_fft,
          // frame_length
          this.config.hop_length,
          // hop_length
          {
            power: 2,
            mel_filters: this.config.mel_filters,
            log_mel: "log10",
            // Custom
            max_num_frames: this.config.nb_max_frames
            // 3000
          }
        );
        const maxValue = max(data)[0];
        for (let i = 0; i < data.length; ++i) {
          data[i] = (Math.max(data[i], maxValue - 8) + 4) / 4;
        }
        return { data, dims };
      }
      /**
       * Asynchronously extracts features from a given audio using the provided configuration.
       * @param {Float32Array|Float64Array} audio The audio data as a Float32Array/Float64Array.
       * @returns {Promise<{ input_features: Tensor }>} A Promise resolving to an object containing the extracted input features as a Tensor.
       */
      async _call(audio) {
        validate_audio_inputs(audio, "WhisperFeatureExtractor");
        let waveform;
        if (audio.length > this.config.n_samples) {
          console.warn(
            "Attempting to extract features for audio longer than 30 seconds. If using a pipeline to extract transcript from a long audio clip, remember to specify `chunk_length_s` and/or `stride_length_s`."
          );
          waveform = audio.slice(0, this.config.n_samples);
        } else {
          waveform = new Float32Array(this.config.n_samples);
          waveform.set(audio);
        }
        const { data, dims } = this._extract_fbank_features(waveform);
        return {
          input_features: new Tensor(
            "float32",
            data,
            [1, ...dims]
          )
        };
      }
    };
    Wav2Vec2FeatureExtractor = class extends FeatureExtractor {
      /**
       * @param {Float32Array} input_values 
       * @returns {Float32Array} 
       */
      _zero_mean_unit_var_norm(input_values) {
        const sum = input_values.reduce((a, b) => a + b, 0);
        const mean2 = sum / input_values.length;
        const variance = input_values.reduce((a, b) => a + (b - mean2) ** 2, 0) / input_values.length;
        return input_values.map((x) => (x - mean2) / Math.sqrt(variance + 1e-7));
      }
      /**
       * Asynchronously extracts features from a given audio using the provided configuration.
       * @param {Float32Array|Float64Array} audio The audio data as a Float32Array/Float64Array.
       * @returns {Promise<{ input_values: Tensor; attention_mask: Tensor }>} A Promise resolving to an object containing the extracted input features and attention mask as Tensors.
       */
      async _call(audio) {
        validate_audio_inputs(audio, "Wav2Vec2FeatureExtractor");
        if (audio instanceof Float64Array) {
          audio = new Float32Array(audio);
        }
        let input_values = audio;
        if (this.config.do_normalize) {
          input_values = this._zero_mean_unit_var_norm(input_values);
        }
        const shape = [1, input_values.length];
        return {
          input_values: new Tensor("float32", input_values, shape),
          attention_mask: new Tensor("int64", new BigInt64Array(input_values.length).fill(1n), shape)
        };
      }
    };
    SeamlessM4TFeatureExtractor = class extends FeatureExtractor {
      constructor(config) {
        super(config);
        const sampling_rate = this.config.sampling_rate;
        const mel_filters = mel_filter_bank(
          256,
          // num_frequency_bins
          this.config.num_mel_bins,
          // num_mel_filters
          20,
          // min_frequency
          Math.floor(sampling_rate / 2),
          // max_frequency
          sampling_rate,
          // sampling_rate
          null,
          // norm
          "kaldi",
          // mel_scale
          true
          // triangularize_in_mel_space
        );
        for (let i = 0; i < mel_filters.length; ++i) {
          mel_filters[i].push(0);
        }
        this.mel_filters = mel_filters;
        this.window = window_function(400, "povey", {
          periodic: false
        });
      }
      /**
       * Computes the log-Mel spectrogram of the provided audio waveform.
       * @param {Float32Array|Float64Array} waveform The audio waveform to process.
       * @param {number} max_length The maximum number of frames to return.
       * @returns {{data: Float32Array, dims: number[]}} An object containing the log-Mel spectrogram data as a Float32Array and its dimensions as an array of numbers.
       */
      _extract_fbank_features(waveform, max_length) {
        waveform = waveform.map((x) => x * 32768);
        return spectrogram(
          waveform,
          this.window,
          // window
          400,
          // frame_length
          160,
          // hop_length
          {
            fft_length: 512,
            power: 2,
            center: false,
            preemphasis: 0.97,
            mel_filters: this.mel_filters,
            log_mel: "log",
            mel_floor: 1192092955078125e-22,
            remove_dc_offset: true,
            // Custom
            max_num_frames: max_length,
            transpose: true
          }
        );
      }
      /**
       * Asynchronously extracts features from a given audio using the provided configuration.
       * @param {Float32Array|Float64Array} audio The audio data as a Float32Array/Float64Array.
       * @param {Object} options Optional parameters for feature extraction.
       * @param {boolean} [options.padding=true] Whether to pad the sequence to a multiple of `pad_to_multiple_of`.
       * @param {number} [options.pad_to_multiple_of=2] The number to pad the sequence to a multiple of.
       * @param {boolean} [options.do_normalize_per_mel_bins=true] Whether or not to zero-mean unit-variance normalize the input per mel-channel.
       * @param {boolean} [options.return_attention_mask=true] Whether to return the attention mask.
       * @returns {Promise<{ input_features: Tensor, attention_mask?: Tensor }>} A Promise resolving to an object containing the extracted input features and attention masks as Tensors.
       */
      async _call(audio, {
        padding = true,
        pad_to_multiple_of = 2,
        do_normalize_per_mel_bins = true,
        return_attention_mask = true
      } = {}) {
        validate_audio_inputs(audio, "SeamlessM4TFeatureExtractor");
        let features = this._extract_fbank_features(audio, this.config.max_length);
        if (do_normalize_per_mel_bins) {
          const [num_features, feature_size] = features.dims;
          for (let i = 0; i < feature_size; ++i) {
            let sum = 0;
            for (let j = 0; j < num_features; ++j) {
              sum += features.data[j * feature_size + i];
            }
            const mean2 = sum / num_features;
            let variance = 0;
            for (let j = 0; j < num_features; ++j) {
              variance += (features.data[j * feature_size + i] - mean2) ** 2;
            }
            variance /= num_features - 1;
            const std = Math.sqrt(variance + 1e-7);
            for (let j = 0; j < num_features; ++j) {
              const index = j * feature_size + i;
              features.data[index] = (features.data[index] - mean2) / std;
            }
          }
        }
        let padded_attention_mask;
        if (padding) {
          const [num_frames2, num_channels2] = features.dims;
          const pad_size = num_frames2 % pad_to_multiple_of;
          if (pad_size > 0) {
            const padded_data = new Float32Array(num_channels2 * (num_frames2 + pad_size));
            padded_data.set(features.data);
            padded_data.fill(this.config.padding_value, features.data.length);
            const numPaddedFrames = num_frames2 + pad_size;
            features = {
              data: padded_data,
              dims: [numPaddedFrames, num_channels2]
            };
            if (return_attention_mask) {
              padded_attention_mask = new Tensor(
                "int64",
                new BigInt64Array(numPaddedFrames),
                [1, numPaddedFrames]
              );
              padded_attention_mask.data.fill(1n, 0, num_frames2);
            }
          }
        }
        const [num_frames, num_channels] = features.dims;
        const stride = this.config.stride;
        const remainder = num_frames % stride;
        if (remainder !== 0) {
          throw new Error(`The number of frames (${num_frames}) must be a multiple of the stride (${stride}).`);
        }
        const input_features = new Tensor(
          "float32",
          features.data,
          features.dims
        ).view(
          1,
          Math.floor(num_frames / stride),
          num_channels * stride
        );
        const result = { input_features };
        if (return_attention_mask) {
          const reshapedNumFrames = input_features.dims[1];
          const attention_mask = new Tensor(
            "int64",
            new BigInt64Array(reshapedNumFrames),
            [1, reshapedNumFrames]
          );
          if (padded_attention_mask) {
            for (let i = 1, j = 0; i < num_frames; i += stride, ++j) {
              attention_mask.data[j] = padded_attention_mask.data[i];
            }
          } else {
            attention_mask.data.fill(1n);
          }
          result.attention_mask = attention_mask;
        }
        return result;
      }
    };
    ASTFeatureExtractor = class extends FeatureExtractor {
      constructor(config) {
        super(config);
        const sampling_rate = this.config.sampling_rate;
        const mel_filters = mel_filter_bank(
          256,
          // num_frequency_bins
          this.config.num_mel_bins,
          // num_mel_filters
          20,
          // min_frequency
          Math.floor(sampling_rate / 2),
          // max_frequency
          sampling_rate,
          // sampling_rate
          null,
          // norm
          "kaldi",
          // mel_scale
          true
          // triangularize_in_mel_space
        );
        for (let i = 0; i < mel_filters.length; ++i) {
          mel_filters[i].push(0);
        }
        this.mel_filters = mel_filters;
        this.window = window_function(400, "hann", {
          periodic: false
        });
        this.mean = this.config.mean;
        this.std = this.config.std;
      }
      /**
       * Computes the log-Mel spectrogram of the provided audio waveform.
       * @param {Float32Array|Float64Array} waveform The audio waveform to process.
       * @param {number} max_length The maximum number of frames to return.
       * @returns {{data: Float32Array, dims: number[]}} An object containing the log-Mel spectrogram data as a Float32Array and its dimensions as an array of numbers.
       */
      _extract_fbank_features(waveform, max_length) {
        return spectrogram(
          waveform,
          this.window,
          // window
          400,
          // frame_length
          160,
          // hop_length
          {
            fft_length: 512,
            power: 2,
            center: false,
            preemphasis: 0.97,
            mel_filters: this.mel_filters,
            log_mel: "log",
            mel_floor: 1192092955078125e-22,
            remove_dc_offset: true,
            // Custom
            max_num_frames: max_length,
            transpose: true
          }
        );
      }
      /**
       * Asynchronously extracts features from a given audio using the provided configuration.
       * @param {Float32Array|Float64Array} audio The audio data as a Float32Array/Float64Array.
       * @returns {Promise<{ input_values: Tensor }>} A Promise resolving to an object containing the extracted input features as a Tensor.
       */
      async _call(audio) {
        validate_audio_inputs(audio, "ASTFeatureExtractor");
        const features = this._extract_fbank_features(audio, this.config.max_length);
        if (this.config.do_normalize) {
          const denom = this.std * 2;
          for (let i = 0; i < features.data.length; ++i) {
            features.data[i] = (features.data[i] - this.mean) / denom;
          }
        }
        return {
          input_values: new Tensor(
            "float32",
            features.data,
            [1, ...features.dims]
          )
        };
      }
    };
    ClapFeatureExtractor = class extends FeatureExtractor {
      constructor(config) {
        super(config);
        this.mel_filters = mel_filter_bank(
          this.config.nb_frequency_bins,
          // num_frequency_bins
          this.config.feature_size,
          // num_mel_filters
          this.config.frequency_min,
          // min_frequency
          this.config.frequency_max,
          // max_frequency
          this.config.sampling_rate,
          // sampling_rate
          null,
          // norm
          "htk"
          // mel_scale
        );
        this.mel_filters_slaney = mel_filter_bank(
          this.config.nb_frequency_bins,
          // num_frequency_bins
          this.config.feature_size,
          // num_mel_filters
          this.config.frequency_min,
          // min_frequency
          this.config.frequency_max,
          // max_frequency
          this.config.sampling_rate,
          // sampling_rate
          "slaney",
          // norm
          "slaney"
          // mel_scale
        );
        this.window = window_function(this.config.fft_window_size, "hann");
      }
      /**
       * Extracts the mel spectrogram and prepares it for the mode based on the `truncation` and `padding` arguments.
       * 
       * Four different path are possible:
       *   - `truncation="fusion"` and the length of the waveform is greater than the max length: the mel spectrogram
       *     will be computed on the entire audio. 3 random crops and a dowsampled version of the full mel spectrogram
       *     are then stacked together. They will later be used for `feature_fusion`.
       *   - `truncation="rand_trunc"` and the length of the waveform is smaller than the max length: the audio is
       *     padded based on `padding`.
       *   - `truncation="fusion"` and the length of the waveform is smaller than the max length: the audio is padded
       *     based on `padding`, and is repeated `4` times.
       *   - `truncation="rand_trunc"` and the length of the waveform is greater than the max length: the mel
       *     spectrogram will be computed on a random crop of the waveform.
       * 
       * @param {Float32Array|Float64Array} waveform The input waveform.
       * @param {number} max_length The maximum length of the waveform.
       * @param {string} truncation The truncation strategy to use.
       * @param {string} padding The padding strategy to use.
       * @returns {{ data: Float32Array; dims: number[]; longer: boolean; }} An object containing the mel spectrogram data as a Float32Array, its dimensions as an array of numbers, and a boolean indicating whether the waveform was longer than the max length.
       */
      _get_input_mel(waveform, max_length, truncation, padding) {
        let input_mel;
        let longer = false;
        const diff = waveform.length - max_length;
        if (diff > 0) {
          if (truncation === "rand_trunc") {
            longer = true;
            const idx = Math.floor(Math.random() * (diff + 1));
            waveform = waveform.subarray(idx, idx + max_length);
            input_mel = this._extract_fbank_features(waveform, this.mel_filters_slaney, this.config.nb_max_samples);
            input_mel.dims = [1, ...input_mel.dims];
          } else {
            throw new Error(`Truncation strategy "${truncation}" not implemented`);
          }
        } else {
          if (diff < 0) {
            let padded = new Float64Array(max_length);
            padded.set(waveform);
            if (padding === "repeat") {
              for (let i = waveform.length; i < max_length; i += waveform.length) {
                padded.set(waveform.subarray(0, Math.min(waveform.length, max_length - i)), i);
              }
            } else if (padding === "repeatpad") {
              for (let i = waveform.length; i < -diff; i += waveform.length) {
                padded.set(waveform, i);
              }
            }
            waveform = padded;
          }
          if (truncation === "fusion") {
            throw new Error(`Truncation strategy "${truncation}" not implemented`);
          }
          input_mel = this._extract_fbank_features(waveform, this.mel_filters_slaney, this.config.nb_max_samples);
          input_mel.dims = [1, ...input_mel.dims];
        }
        return {
          ...input_mel,
          longer
        };
      }
      /**
       * Compute the log-mel spectrogram of the provided `waveform` using the Hann window.
       * In CLAP, two different filter banks are used depending on the truncation pattern:
       *  - `self.mel_filters`: they correspond to the default parameters of `torchaudio` which can be obtained from
       *    calling `torchaudio.transforms.MelSpectrogram().mel_scale.fb`. These filters are used when `truncation`
       *    is set to `"fusion"`.
       *  - `self.mel_filteres_slaney` : they correspond to the default parameters of `librosa` which used
       *    `librosa.filters.mel` when computing the mel spectrogram. These filters were only used in the original
       *    implementation when the truncation mode is not `"fusion"`.
       * 
       * @param {Float32Array|Float64Array} waveform The audio waveform to process.
       * @param {number[][]} mel_filters The mel filters to use.
       * @param {number} [max_length=null] The maximum number of frames to return.
       * @returns {{data: Float32Array, dims: number[]}} An object containing the log-Mel spectrogram data as a Float32Array and its dimensions as an array of numbers.
       */
      _extract_fbank_features(waveform, mel_filters, max_length = null) {
        return spectrogram(
          waveform,
          this.window,
          // window
          this.config.fft_window_size,
          // frame_length
          this.config.hop_length,
          // hop_length
          {
            power: 2,
            mel_filters,
            log_mel: "dB",
            // Custom
            max_num_frames: max_length,
            do_pad: false,
            transpose: true
          }
        );
      }
      /**
       * Asynchronously extracts features from a given audio using the provided configuration.
       * @param {Float32Array|Float64Array} audio The audio data as a Float32Array/Float64Array.
       * @returns {Promise<{ input_features: Tensor }>} A Promise resolving to an object containing the extracted input features as a Tensor.
       */
      async _call(audio, {
        max_length = null
      } = {}) {
        validate_audio_inputs(audio, "ClapFeatureExtractor");
        const padded_inputs = this._get_input_mel(
          audio,
          max_length ?? this.config.nb_max_samples,
          this.config.truncation,
          this.config.padding
        );
        return {
          input_features: new Tensor(
            "float32",
            padded_inputs.data,
            [1, ...padded_inputs.dims]
          )
        };
      }
    };
    SpeechT5FeatureExtractor = class extends FeatureExtractor {
    };
    Processor = class extends Callable {
      /**
       * Creates a new Processor with the given feature extractor.
       * @param {FeatureExtractor} feature_extractor The function used to extract features from the input.
       */
      constructor(feature_extractor) {
        super();
        this.feature_extractor = feature_extractor;
      }
      /**
       * Calls the feature_extractor function with the given input.
       * @param {any} input The input to extract features from.
       * @param {...any} args Additional arguments.
       * @returns {Promise<any>} A Promise that resolves with the extracted features.
       */
      async _call(input, ...args) {
        return await this.feature_extractor(input, ...args);
      }
    };
    SamProcessor = class extends Processor {
      /**
       * @borrows SamImageProcessor#_call as _call
       */
      async _call(...args) {
        return await this.feature_extractor(...args);
      }
      /**
       * @borrows SamImageProcessor#post_process_masks as post_process_masks
       */
      post_process_masks(...args) {
        return this.feature_extractor.post_process_masks(...args);
      }
      /**
       * @borrows SamImageProcessor#reshape_input_points as reshape_input_points
       */
      reshape_input_points(...args) {
        return this.feature_extractor.reshape_input_points(...args);
      }
    };
    WhisperProcessor = class extends Processor {
      /**
       * Calls the feature_extractor function with the given audio input.
       * @param {any} audio The audio input to extract features from.
       * @returns {Promise<any>} A Promise that resolves with the extracted features.
       */
      async _call(audio) {
        return await this.feature_extractor(audio);
      }
    };
    Wav2Vec2ProcessorWithLM = class extends Processor {
      /**
       * Calls the feature_extractor function with the given audio input.
       * @param {any} audio The audio input to extract features from.
       * @returns {Promise<any>} A Promise that resolves with the extracted features.
       */
      async _call(audio) {
        return await this.feature_extractor(audio);
      }
    };
    SpeechT5Processor = class extends Processor {
      /**
       * Calls the feature_extractor function with the given input.
       * @param {any} input The input to extract features from.
       * @returns {Promise<any>} A Promise that resolves with the extracted features.
       */
      async _call(input) {
        return await this.feature_extractor(input);
      }
    };
    OwlViTProcessor = class extends Processor {
    };
    AutoProcessor = class {
      static FEATURE_EXTRACTOR_CLASS_MAPPING = {
        ImageFeatureExtractor,
        WhisperFeatureExtractor,
        ViTFeatureExtractor,
        MobileViTFeatureExtractor,
        MobileViTImageProcessor,
        OwlViTFeatureExtractor,
        Owlv2ImageProcessor,
        CLIPFeatureExtractor,
        ChineseCLIPFeatureExtractor,
        SiglipImageProcessor,
        ConvNextFeatureExtractor,
        ConvNextImageProcessor,
        SegformerFeatureExtractor,
        BitImageProcessor,
        DPTImageProcessor,
        DPTFeatureExtractor,
        GLPNFeatureExtractor,
        BeitFeatureExtractor,
        DeiTFeatureExtractor,
        DetrFeatureExtractor,
        YolosFeatureExtractor,
        DonutFeatureExtractor,
        NougatImageProcessor,
        EfficientNetImageProcessor,
        ViTImageProcessor,
        VitMatteImageProcessor,
        SamImageProcessor,
        Swin2SRImageProcessor,
        Wav2Vec2FeatureExtractor,
        SeamlessM4TFeatureExtractor,
        SpeechT5FeatureExtractor,
        ASTFeatureExtractor,
        ClapFeatureExtractor
      };
      static PROCESSOR_CLASS_MAPPING = {
        WhisperProcessor,
        Wav2Vec2ProcessorWithLM,
        SamProcessor,
        SpeechT5Processor,
        OwlViTProcessor
      };
      /**
       * Instantiate one of the processor classes of the library from a pretrained model.
       * 
       * The processor class to instantiate is selected based on the `feature_extractor_type` property of the config object
       * (either passed as an argument or loaded from `pretrained_model_name_or_path` if possible)
       * 
       * @param {string} pretrained_model_name_or_path The name or path of the pretrained model. Can be either:
       * - A string, the *model id* of a pretrained processor hosted inside a model repo on huggingface.co.
       *   Valid model ids can be located at the root-level, like `bert-base-uncased`, or namespaced under a
       *   user or organization name, like `dbmdz/bert-base-german-cased`.
       * - A path to a *directory* containing processor files, e.g., `./my_model_directory/`.
       * @param {import('./utils/hub.js').PretrainedOptions} options Additional options for loading the processor.
       * 
       * @returns {Promise<Processor>} A new instance of the Processor class.
       */
      static async from_pretrained(pretrained_model_name_or_path, {
        progress_callback = null,
        config = null,
        cache_dir = null,
        local_files_only = false,
        revision = "main"
      } = {}) {
        let preprocessorConfig = config ?? await getModelJSON(pretrained_model_name_or_path, "preprocessor_config.json", true, {
          progress_callback,
          config,
          cache_dir,
          local_files_only,
          revision
        });
        let key = preprocessorConfig.feature_extractor_type ?? preprocessorConfig.image_processor_type;
        let feature_extractor_class = this.FEATURE_EXTRACTOR_CLASS_MAPPING[key];
        if (!feature_extractor_class) {
          if (preprocessorConfig.size !== void 0) {
            console.warn(`Feature extractor type "${key}" not found, assuming ImageFeatureExtractor due to size parameter in config.`);
            feature_extractor_class = ImageFeatureExtractor;
          } else {
            throw new Error(`Unknown Feature Extractor type: ${key}`);
          }
        }
        let processor_class = this.PROCESSOR_CLASS_MAPPING[preprocessorConfig.processor_class] ?? Processor;
        let feature_extractor = new feature_extractor_class(preprocessorConfig);
        return new processor_class(feature_extractor);
      }
    };
  }
});

// node_modules/@xenova/transformers/src/pipelines.js
async function prepareImages(images) {
  if (!Array.isArray(images)) {
    images = [images];
  }
  return await Promise.all(images.map((x) => RawImage.read(x)));
}
async function prepareAudios(audios, sampling_rate) {
  if (!Array.isArray(audios)) {
    audios = [audios];
  }
  return await Promise.all(audios.map((x) => {
    if (typeof x === "string" || x instanceof URL) {
      return read_audio(x, sampling_rate);
    } else if (x instanceof Float64Array) {
      return new Float32Array(x);
    }
    return x;
  }));
}
function get_bounding_box(box, asInteger) {
  if (asInteger) {
    box = box.map((x) => x | 0);
  }
  const [xmin, ymin, xmax, ymax] = box;
  return { xmin, ymin, xmax, ymax };
}
function isChat(x) {
  return Array.isArray(x) && x.every((x2) => "role" in x2 && "content" in x2);
}
var Pipeline, TextClassificationPipeline, TokenClassificationPipeline, QuestionAnsweringPipeline, FillMaskPipeline, Text2TextGenerationPipeline, SummarizationPipeline, TranslationPipeline, TextGenerationPipeline, ZeroShotClassificationPipeline, FeatureExtractionPipeline, ImageFeatureExtractionPipeline, AudioClassificationPipeline, ZeroShotAudioClassificationPipeline, AutomaticSpeechRecognitionPipeline, ImageToTextPipeline, ImageClassificationPipeline, ImageSegmentationPipeline, ZeroShotImageClassificationPipeline, ObjectDetectionPipeline, ZeroShotObjectDetectionPipeline, DocumentQuestionAnsweringPipeline, TextToAudioPipeline, ImageToImagePipeline, DepthEstimationPipeline, SUPPORTED_TASKS, TASK_ALIASES;
var init_pipelines = __esm({
  "node_modules/@xenova/transformers/src/pipelines.js"() {
    init_tokenizers();
    init_models();
    init_processors();
    init_core();
    init_maths();
    init_audio();
    init_tensor();
    init_image();
    Pipeline = class extends Callable {
      /**
       * Create a new Pipeline.
       * @param {Object} options An object containing the following properties:
       * @param {string} [options.task] The task of the pipeline. Useful for specifying subtasks.
       * @param {PreTrainedModel} [options.model] The model used by the pipeline.
       * @param {PreTrainedTokenizer} [options.tokenizer=null] The tokenizer used by the pipeline (if any).
       * @param {Processor} [options.processor=null] The processor used by the pipeline (if any).
       */
      constructor({ task, model, tokenizer = null, processor = null }) {
        super();
        this.task = task;
        this.model = model;
        this.tokenizer = tokenizer;
        this.processor = processor;
      }
      /** @type {DisposeType} */
      async dispose() {
        await this.model.dispose();
      }
    };
    TextClassificationPipeline = class extends /** @type {new (options: TextPipelineConstructorArgs) => TextClassificationPipelineType} */
    Pipeline {
      /**
       * Create a new TextClassificationPipeline.
       * @param {TextPipelineConstructorArgs} options An object used to instantiate the pipeline.
       */
      constructor(options) {
        super(options);
      }
      /** @type {TextClassificationPipelineCallback} */
      async _call(texts, {
        topk = 1
      } = {}) {
        const model_inputs = this.tokenizer(texts, {
          padding: true,
          truncation: true
        });
        const outputs = await this.model(model_inputs);
        const function_to_apply = this.model.config.problem_type === "multi_label_classification" ? (batch) => batch.sigmoid().data : (batch) => softmax(batch.data);
        const id2label = this.model.config.id2label;
        const toReturn = [];
        for (const batch of outputs.logits) {
          const output = function_to_apply(batch);
          const scores = getTopItems(output, topk);
          const vals = scores.map((x) => ({
            label: id2label[x[0]],
            score: x[1]
          }));
          if (topk === 1) {
            toReturn.push(...vals);
          } else {
            toReturn.push(vals);
          }
        }
        return Array.isArray(texts) || topk === 1 ? (
          /** @type {TextClassificationOutput} */
          toReturn
        ) : (
          /** @type {TextClassificationOutput[]} */
          toReturn[0]
        );
      }
    };
    TokenClassificationPipeline = class extends /** @type {new (options: TextPipelineConstructorArgs) => TokenClassificationPipelineType} */
    Pipeline {
      /**
       * Create a new TokenClassificationPipeline.
       * @param {TextPipelineConstructorArgs} options An object used to instantiate the pipeline.
       */
      constructor(options) {
        super(options);
      }
      /** @type {TokenClassificationPipelineCallback} */
      async _call(texts, {
        ignore_labels = ["O"]
      } = {}) {
        const isBatched = Array.isArray(texts);
        const model_inputs = this.tokenizer(isBatched ? texts : [texts], {
          padding: true,
          truncation: true
        });
        const outputs = await this.model(model_inputs);
        const logits = outputs.logits;
        const id2label = this.model.config.id2label;
        const toReturn = [];
        for (let i = 0; i < logits.dims[0]; ++i) {
          const ids = model_inputs.input_ids[i];
          const batch = logits[i];
          const tokens = [];
          for (let j = 0; j < batch.dims[0]; ++j) {
            const tokenData = batch[j];
            const topScoreIndex = max(tokenData.data)[1];
            const entity = id2label ? id2label[topScoreIndex] : `LABEL_${topScoreIndex}`;
            if (ignore_labels.includes(entity)) {
              continue;
            }
            const word = this.tokenizer.decode([ids[j].item()], { skip_special_tokens: true });
            if (word === "") {
              continue;
            }
            const scores = softmax(tokenData.data);
            tokens.push({
              entity,
              score: scores[topScoreIndex],
              index: j,
              word,
              // TODO: null for now, but will add
              start: null,
              end: null
            });
          }
          toReturn.push(tokens);
        }
        return isBatched ? toReturn : toReturn[0];
      }
    };
    QuestionAnsweringPipeline = class extends /** @type {new (options: TextPipelineConstructorArgs) => QuestionAnsweringPipelineType} */
    Pipeline {
      /**
       * Create a new QuestionAnsweringPipeline.
       * @param {TextPipelineConstructorArgs} options An object used to instantiate the pipeline.
       */
      constructor(options) {
        super(options);
      }
      /** @type {QuestionAnsweringPipelineCallback} */
      async _call(question, context, {
        topk = 1
      } = {}) {
        const inputs = this.tokenizer(question, {
          text_pair: context,
          padding: true,
          truncation: true
        });
        const output = await this.model(inputs);
        const toReturn = [];
        for (let j = 0; j < output.start_logits.dims[0]; ++j) {
          const ids = inputs.input_ids[j];
          const sepIndex = ids.indexOf(this.tokenizer.sep_token_id);
          const s1 = Array.from(softmax(output.start_logits[j].data)).map((x, i) => [x, i]).filter((x) => x[1] > sepIndex);
          const e1 = Array.from(softmax(output.end_logits[j].data)).map((x, i) => [x, i]).filter((x) => x[1] > sepIndex);
          const options = product(s1, e1).filter((x) => x[0][1] <= x[1][1]).map((x) => [x[0][1], x[1][1], x[0][0] * x[1][0]]).sort((a, b) => b[2] - a[2]);
          for (let k = 0; k < Math.min(options.length, topk); ++k) {
            const [start, end, score] = options[k];
            const answer_tokens = [...ids].slice(start, end + 1);
            const answer = this.tokenizer.decode(answer_tokens, {
              skip_special_tokens: true
            });
            toReturn.push({
              answer,
              score
            });
          }
        }
        return topk === 1 ? toReturn[0] : toReturn;
      }
    };
    FillMaskPipeline = class extends /** @type {new (options: TextPipelineConstructorArgs) => FillMaskPipelineType} */
    Pipeline {
      /**
       * Create a new FillMaskPipeline.
       * @param {TextPipelineConstructorArgs} options An object used to instantiate the pipeline.
       */
      constructor(options) {
        super(options);
      }
      /** @type {FillMaskPipelineCallback} */
      async _call(texts, {
        topk = 5
      } = {}) {
        const model_inputs = this.tokenizer(texts, {
          padding: true,
          truncation: true
        });
        const outputs = await this.model(model_inputs);
        const toReturn = [];
        for (let i = 0; i < model_inputs.input_ids.dims[0]; ++i) {
          const ids = model_inputs.input_ids[i];
          const mask_token_index = ids.indexOf(this.tokenizer.mask_token_id);
          if (mask_token_index === -1) {
            throw Error(`Mask token (${this.tokenizer.mask_token}) not found in text.`);
          }
          const logits = outputs.logits[i];
          const itemLogits = logits[mask_token_index];
          const scores = getTopItems(softmax(itemLogits.data), topk);
          toReturn.push(scores.map((x) => {
            const sequence = [...ids];
            sequence[mask_token_index] = x[0];
            return {
              score: x[1],
              token: x[0],
              token_str: this.tokenizer.model.vocab[x[0]],
              sequence: this.tokenizer.decode(sequence, { skip_special_tokens: true })
            };
          }));
        }
        return Array.isArray(texts) ? toReturn : toReturn[0];
      }
    };
    Text2TextGenerationPipeline = class extends /** @type {new (options: TextPipelineConstructorArgs) => Text2TextGenerationPipelineType} */
    Pipeline {
      /** @type {'generated_text'} */
      _key = "generated_text";
      /**
       * Create a new Text2TextGenerationPipeline.
       * @param {TextPipelineConstructorArgs} options An object used to instantiate the pipeline.
       */
      constructor(options) {
        super(options);
      }
      /** @type {Text2TextGenerationPipelineCallback} */
      async _call(texts, generate_kwargs = {}) {
        if (!Array.isArray(texts)) {
          texts = [texts];
        }
        if (this.model.config.prefix) {
          texts = texts.map((x) => this.model.config.prefix + x);
        }
        const task_specific_params = this.model.config.task_specific_params;
        if (task_specific_params && task_specific_params[this.task]) {
          if (task_specific_params[this.task].prefix) {
            texts = texts.map((x) => task_specific_params[this.task].prefix + x);
          }
        }
        const tokenizer = this.tokenizer;
        const tokenizer_options = {
          padding: true,
          truncation: true
        };
        let input_ids;
        if (this instanceof TranslationPipeline && "_build_translation_inputs" in tokenizer) {
          input_ids = tokenizer._build_translation_inputs(texts, tokenizer_options, generate_kwargs).input_ids;
        } else {
          input_ids = tokenizer(texts, tokenizer_options).input_ids;
        }
        const outputTokenIds = await this.model.generate(input_ids, generate_kwargs);
        return tokenizer.batch_decode(outputTokenIds, {
          skip_special_tokens: true
        }).map((text) => ({ [this._key]: text }));
      }
    };
    SummarizationPipeline = class extends /** @type {new (options: TextPipelineConstructorArgs) => SummarizationPipelineType} */
    /** @type {any} */
    Text2TextGenerationPipeline {
      /** @type {'summary_text'} */
      _key = "summary_text";
      /**
       * Create a new SummarizationPipeline.
       * @param {TextPipelineConstructorArgs} options An object used to instantiate the pipeline.
       */
      constructor(options) {
        super(options);
      }
    };
    TranslationPipeline = class extends /** @type {new (options: TextPipelineConstructorArgs) => TranslationPipelineType} */
    /** @type {any} */
    Text2TextGenerationPipeline {
      /** @type {'translation_text'} */
      _key = "translation_text";
      /**
       * Create a new TranslationPipeline.
       * @param {TextPipelineConstructorArgs} options An object used to instantiate the pipeline.
       */
      constructor(options) {
        super(options);
      }
    };
    TextGenerationPipeline = class extends /** @type {new (options: TextPipelineConstructorArgs) => TextGenerationPipelineType} */
    Pipeline {
      /**
       * Create a new TextGenerationPipeline.
       * @param {TextPipelineConstructorArgs} options An object used to instantiate the pipeline.
       */
      constructor(options) {
        super(options);
      }
      /** @type {TextGenerationPipelineCallback} */
      async _call(texts, generate_kwargs = {}) {
        let isBatched = false;
        let isChatInput = false;
        let inputs;
        if (typeof texts === "string") {
          inputs = texts = [texts];
        } else if (Array.isArray(texts) && texts.every((x) => typeof x === "string")) {
          isBatched = true;
          inputs = /** @type {string[]} */
          texts;
        } else {
          if (isChat(texts)) {
            texts = [
              /** @type {Chat} */
              texts
            ];
          } else if (Array.isArray(texts) && texts.every(isChat)) {
            isBatched = true;
          } else {
            throw new Error("Input must be a string, an array of strings, a Chat, or an array of Chats");
          }
          isChatInput = true;
          inputs = /** @type {string[]} */
          /** @type {Chat[]} */
          texts.map(
            (x) => this.tokenizer.apply_chat_template(x, {
              tokenize: false,
              add_generation_prompt: true
            })
          );
        }
        const add_special_tokens = generate_kwargs.add_special_tokens ?? false;
        const return_full_text = isChatInput ? false : generate_kwargs.return_full_text ?? true;
        this.tokenizer.padding_side = "left";
        const { input_ids, attention_mask } = this.tokenizer(inputs, {
          add_special_tokens,
          padding: true,
          truncation: true
        });
        const outputTokenIds = await this.model.generate(input_ids, generate_kwargs, null, {
          inputs_attention_mask: attention_mask
        });
        let decoded = this.tokenizer.batch_decode(outputTokenIds, {
          skip_special_tokens: true
        });
        let promptLengths;
        if (!return_full_text && input_ids.dims.at(-1) > 0) {
          promptLengths = this.tokenizer.batch_decode(input_ids, {
            skip_special_tokens: true
          }).map((x) => x.length);
        }
        const toReturn = Array.from({ length: texts.length }, (_) => []);
        for (let i = 0; i < decoded.length; ++i) {
          const textIndex = Math.floor(i / outputTokenIds.length * texts.length);
          if (promptLengths) {
            decoded[i] = decoded[i].slice(promptLengths[textIndex]);
          }
          toReturn[textIndex].push({
            generated_text: isChatInput ? [
              .../** @type {Chat[]} */
              texts[textIndex],
              { role: "assistant", content: decoded[i] }
            ] : decoded[i]
          });
        }
        return !isBatched && toReturn.length === 1 ? toReturn[0] : toReturn;
      }
    };
    ZeroShotClassificationPipeline = class extends /** @type {new (options: TextPipelineConstructorArgs) => ZeroShotClassificationPipelineType} */
    Pipeline {
      /**
       * Create a new ZeroShotClassificationPipeline.
       * @param {TextPipelineConstructorArgs} options An object used to instantiate the pipeline.
       */
      constructor(options) {
        super(options);
        this.label2id = Object.fromEntries(
          Object.entries(
            /** @type {any} */
            this.model.config.label2id
          ).map(
            ([k, v]) => [k.toLowerCase(), v]
          )
        );
        this.entailment_id = this.label2id["entailment"];
        if (this.entailment_id === void 0) {
          console.warn("Could not find 'entailment' in label2id mapping. Using 2 as entailment_id.");
          this.entailment_id = 2;
        }
        this.contradiction_id = this.label2id["contradiction"] ?? this.label2id["not_entailment"];
        if (this.contradiction_id === void 0) {
          console.warn("Could not find 'contradiction' in label2id mapping. Using 0 as contradiction_id.");
          this.contradiction_id = 0;
        }
      }
      /** @type {ZeroShotClassificationPipelineCallback} */
      async _call(texts, candidate_labels, {
        hypothesis_template = "This example is {}.",
        multi_label = false
      } = {}) {
        const isBatched = Array.isArray(texts);
        if (!isBatched) {
          texts = [
            /** @type {string} */
            texts
          ];
        }
        if (!Array.isArray(candidate_labels)) {
          candidate_labels = [candidate_labels];
        }
        const hypotheses = candidate_labels.map(
          (x) => hypothesis_template.replace("{}", x)
        );
        const softmaxEach = multi_label || candidate_labels.length === 1;
        const toReturn = [];
        for (const premise of texts) {
          const entails_logits = [];
          for (const hypothesis of hypotheses) {
            const inputs = this.tokenizer(premise, {
              text_pair: hypothesis,
              padding: true,
              truncation: true
            });
            const outputs = await this.model(inputs);
            if (softmaxEach) {
              entails_logits.push([
                outputs.logits.data[this.contradiction_id],
                outputs.logits.data[this.entailment_id]
              ]);
            } else {
              entails_logits.push(outputs.logits.data[this.entailment_id]);
            }
          }
          const scores = softmaxEach ? entails_logits.map((x) => softmax(x)[1]) : softmax(entails_logits);
          const scores_sorted = scores.map((x, i) => [x, i]).sort((a, b) => b[0] - a[0]);
          toReturn.push({
            sequence: premise,
            labels: scores_sorted.map((x) => candidate_labels[x[1]]),
            scores: scores_sorted.map((x) => x[0])
          });
        }
        return isBatched ? toReturn : toReturn[0];
      }
    };
    FeatureExtractionPipeline = class extends /** @type {new (options: TextPipelineConstructorArgs) => FeatureExtractionPipelineType} */
    Pipeline {
      /**
       * Create a new FeatureExtractionPipeline.
       * @param {TextPipelineConstructorArgs} options An object used to instantiate the pipeline.
       */
      constructor(options) {
        super(options);
      }
      /** @type {FeatureExtractionPipelineCallback} */
      async _call(texts, {
        pooling = (
          /** @type {'none'} */
          "none"
        ),
        normalize = false,
        quantize = false,
        precision = (
          /** @type {'binary'} */
          "binary"
        )
      } = {}) {
        const model_inputs = this.tokenizer(texts, {
          padding: true,
          truncation: true
        });
        const outputs = await this.model(model_inputs);
        let result = outputs.last_hidden_state ?? outputs.logits ?? outputs.token_embeddings;
        if (pooling === "none") {
        } else if (pooling === "mean") {
          result = mean_pooling(result, model_inputs.attention_mask);
        } else if (pooling === "cls") {
          result = result.slice(null, 0);
        } else {
          throw Error(`Pooling method '${pooling}' not supported.`);
        }
        if (normalize) {
          result = result.normalize(2, -1);
        }
        if (quantize) {
          result = quantize_embeddings(result, precision);
        }
        return result;
      }
    };
    ImageFeatureExtractionPipeline = class extends /** @type {new (options: ImagePipelineConstructorArgs) => ImageFeatureExtractionPipelineType} */
    Pipeline {
      /**
       * Create a new ImageFeatureExtractionPipeline.
       * @param {ImagePipelineConstructorArgs} options An object used to instantiate the pipeline.
       */
      constructor(options) {
        super(options);
      }
      /** @type {ImageFeatureExtractionPipelineCallback} */
      async _call(images, {
        pool = null
      } = {}) {
        const preparedImages = await prepareImages(images);
        const { pixel_values } = await this.processor(preparedImages);
        const outputs = await this.model({ pixel_values });
        let result;
        if (pool) {
          if (!("pooler_output" in outputs)) {
            throw Error(`No pooled output was returned. Make sure the model has a 'pooler' layer when using the 'pool' option.`);
          }
          result = outputs.pooler_output;
        } else {
          result = outputs.last_hidden_state ?? outputs.logits ?? outputs.image_embeds;
        }
        return result;
      }
    };
    AudioClassificationPipeline = class extends /** @type {new (options: AudioPipelineConstructorArgs) => AudioClassificationPipelineType} */
    Pipeline {
      /**
       * Create a new AudioClassificationPipeline.
       * @param {AudioPipelineConstructorArgs} options An object used to instantiate the pipeline.
       */
      constructor(options) {
        super(options);
      }
      /** @type {AudioClassificationPipelineCallback} */
      async _call(audio, {
        topk = null
      } = {}) {
        const single = !Array.isArray(audio);
        const sampling_rate = this.processor.feature_extractor.config.sampling_rate;
        const preparedAudios = await prepareAudios(audio, sampling_rate);
        const id2label = this.model.config.id2label;
        const toReturn = [];
        for (const aud of preparedAudios) {
          const inputs = await this.processor(aud);
          const output = await this.model(inputs);
          const logits = output.logits[0];
          const scores = getTopItems(softmax(logits.data), topk);
          const vals = scores.map((x) => ({
            label: (
              /** @type {string} */
              id2label[x[0]]
            ),
            score: (
              /** @type {number} */
              x[1]
            )
          }));
          if (topk === 1) {
            toReturn.push(...vals);
          } else {
            toReturn.push(vals);
          }
        }
        return !single || topk === 1 ? (
          /** @type {AudioClassificationOutput} */
          toReturn
        ) : (
          /** @type {AudioClassificationOutput[]} */
          toReturn[0]
        );
      }
    };
    ZeroShotAudioClassificationPipeline = class extends /** @type {new (options: TextAudioPipelineConstructorArgs) => ZeroShotAudioClassificationPipelineType} */
    Pipeline {
      /**
       * Create a new ZeroShotAudioClassificationPipeline.
       * @param {TextAudioPipelineConstructorArgs} options An object used to instantiate the pipeline.
       */
      constructor(options) {
        super(options);
      }
      /** @type {ZeroShotAudioClassificationPipelineCallback} */
      async _call(audio, candidate_labels, {
        hypothesis_template = "This is a sound of {}."
      } = {}) {
        const single = !Array.isArray(audio);
        if (single) {
          audio = [
            /** @type {AudioInput} */
            audio
          ];
        }
        const texts = candidate_labels.map(
          (x) => hypothesis_template.replace("{}", x)
        );
        const text_inputs = this.tokenizer(texts, {
          padding: true,
          truncation: true
        });
        const sampling_rate = this.processor.feature_extractor.config.sampling_rate;
        const preparedAudios = await prepareAudios(audio, sampling_rate);
        const toReturn = [];
        for (const aud of preparedAudios) {
          const audio_inputs = await this.processor(aud);
          const output = await this.model({ ...text_inputs, ...audio_inputs });
          const probs = softmax(output.logits_per_audio.data);
          toReturn.push([...probs].map((x, i) => ({
            score: x,
            label: candidate_labels[i]
          })));
        }
        return single ? toReturn[0] : toReturn;
      }
    };
    AutomaticSpeechRecognitionPipeline = class extends /** @type {new (options: TextAudioPipelineConstructorArgs) => AutomaticSpeechRecognitionPipelineType} */
    Pipeline {
      /**
       * Create a new AutomaticSpeechRecognitionPipeline.
       * @param {TextAudioPipelineConstructorArgs} options An object used to instantiate the pipeline.
       */
      constructor(options) {
        super(options);
      }
      /** @type {AutomaticSpeechRecognitionPipelineCallback} */
      async _call(audio, kwargs = {}) {
        switch (this.model.config.model_type) {
          case "whisper":
            return this._call_whisper(audio, kwargs);
          case "wav2vec2":
          case "wav2vec2-bert":
          case "unispeech":
          case "unispeech-sat":
          case "hubert":
            return this._call_wav2vec2(audio, kwargs);
          default:
            throw new Error(`AutomaticSpeechRecognitionPipeline does not support model type '${this.model.config.model_type}'.`);
        }
      }
      /**
       * @type {AutomaticSpeechRecognitionPipelineCallback}
       * @private
       */
      async _call_wav2vec2(audio, kwargs = {}) {
        if (kwargs.language) {
          console.warn('`language` parameter is not yet supported for `wav2vec2` models, defaulting to "English".');
        }
        if (kwargs.task) {
          console.warn('`task` parameter is not yet supported for `wav2vec2` models, defaulting to "transcribe".');
        }
        const single = !Array.isArray(audio);
        if (single) {
          audio = [
            /** @type {AudioInput} */
            audio
          ];
        }
        const sampling_rate = this.processor.feature_extractor.config.sampling_rate;
        const preparedAudios = await prepareAudios(audio, sampling_rate);
        const toReturn = [];
        for (const aud of preparedAudios) {
          const inputs = await this.processor(aud);
          const output = await this.model(inputs);
          const logits = output.logits[0];
          const predicted_ids = [];
          for (const item of logits) {
            predicted_ids.push(max(item.data)[1]);
          }
          const predicted_sentences = this.tokenizer.decode(predicted_ids);
          toReturn.push({ text: predicted_sentences });
        }
        return single ? toReturn[0] : toReturn;
      }
      /**
       * @type {AutomaticSpeechRecognitionPipelineCallback}
       * @private
       */
      async _call_whisper(audio, kwargs = {}) {
        const return_timestamps = kwargs.return_timestamps ?? false;
        const chunk_length_s = kwargs.chunk_length_s ?? 0;
        const chunk_callback = kwargs.chunk_callback ?? null;
        const force_full_sequences = kwargs.force_full_sequences ?? false;
        let stride_length_s = kwargs.stride_length_s ?? null;
        if (return_timestamps === "word") {
          kwargs["return_token_timestamps"] = true;
        }
        const language = pop(kwargs, "language", null);
        const task = pop(kwargs, "task", null);
        if (language || task || return_timestamps) {
          if (kwargs.forced_decoder_ids) {
            throw new Error("Cannot specify `language`/`task`/`return_timestamps` and `forced_decoder_ids` at the same time.");
          }
          const decoder_prompt_ids = this.tokenizer.get_decoder_prompt_ids({ language, task, no_timestamps: !return_timestamps });
          if (decoder_prompt_ids.length > 0) {
            kwargs.forced_decoder_ids = decoder_prompt_ids;
          }
        }
        const single = !Array.isArray(audio);
        if (single) {
          audio = [
            /** @type {AudioInput} */
            audio
          ];
        }
        const time_precision = this.processor.feature_extractor.config.chunk_length / this.model.config.max_source_positions;
        const hop_length = this.processor.feature_extractor.config.hop_length;
        const sampling_rate = this.processor.feature_extractor.config.sampling_rate;
        const preparedAudios = await prepareAudios(audio, sampling_rate);
        const toReturn = [];
        for (const aud of preparedAudios) {
          let chunks = [];
          if (chunk_length_s > 0) {
            if (stride_length_s === null) {
              stride_length_s = chunk_length_s / 6;
            } else if (chunk_length_s <= stride_length_s) {
              throw Error("`chunk_length_s` must be larger than `stride_length_s`.");
            }
            const window2 = sampling_rate * chunk_length_s;
            const stride = sampling_rate * stride_length_s;
            const jump = window2 - 2 * stride;
            let offset = 0;
            while (offset < aud.length) {
              const subarr = aud.subarray(offset, offset + window2);
              const feature = await this.processor(subarr);
              const isFirst = offset === 0;
              const isLast = offset + jump >= aud.length;
              chunks.push({
                stride: [
                  subarr.length,
                  isFirst ? 0 : stride,
                  isLast ? 0 : stride
                ],
                input_features: feature.input_features,
                is_last: isLast
              });
              offset += jump;
            }
          } else {
            chunks = [{
              stride: [aud.length, 0, 0],
              input_features: (await this.processor(aud)).input_features,
              is_last: true
            }];
          }
          for (const chunk of chunks) {
            kwargs.num_frames = Math.floor(chunk.stride[0] / hop_length);
            const data = await this.model.generate(chunk.input_features, kwargs);
            if (return_timestamps === "word") {
              chunk.tokens = data.sequences[0];
              chunk.token_timestamps = data.token_timestamps.tolist()[0].map(
                (x) => round(x, 2)
              );
            } else {
              chunk.tokens = data[0];
            }
            chunk.stride = chunk.stride.map((x) => x / sampling_rate);
            if (chunk_callback !== null) {
              chunk_callback(chunk);
            }
          }
          const [full_text, optional] = this.tokenizer._decode_asr(chunks, {
            time_precision,
            return_timestamps,
            force_full_sequences
          });
          toReturn.push({ text: full_text, ...optional });
        }
        return single ? toReturn[0] : toReturn;
      }
    };
    ImageToTextPipeline = class extends /** @type {new (options: TextImagePipelineConstructorArgs) => ImageToTextPipelineType} */
    Pipeline {
      /**
       * Create a new ImageToTextPipeline.
       * @param {TextImagePipelineConstructorArgs} options An object used to instantiate the pipeline.
       */
      constructor(options) {
        super(options);
      }
      /** @type {ImageToTextPipelineCallback} */
      async _call(images, generate_kwargs = {}) {
        const isBatched = Array.isArray(images);
        const preparedImages = await prepareImages(images);
        const { pixel_values } = await this.processor(preparedImages);
        const toReturn = [];
        for (const batch of pixel_values) {
          batch.dims = [1, ...batch.dims];
          const output = await this.model.generate(batch, generate_kwargs);
          const decoded = this.tokenizer.batch_decode(output, {
            skip_special_tokens: true
          }).map((x) => ({ generated_text: x.trim() }));
          toReturn.push(decoded);
        }
        return isBatched ? toReturn : toReturn[0];
      }
    };
    ImageClassificationPipeline = class extends /** @type {new (options: ImagePipelineConstructorArgs) => ImageClassificationPipelineType} */
    Pipeline {
      /**
       * Create a new ImageClassificationPipeline.
       * @param {ImagePipelineConstructorArgs} options An object used to instantiate the pipeline.
       */
      constructor(options) {
        super(options);
      }
      /** @type {ImageClassificationPipelineCallback} */
      async _call(images, {
        topk = 1
      } = {}) {
        const isBatched = Array.isArray(images);
        const preparedImages = await prepareImages(images);
        const { pixel_values } = await this.processor(preparedImages);
        const output = await this.model({ pixel_values });
        const id2label = this.model.config.id2label;
        const toReturn = [];
        for (const batch of output.logits) {
          const scores = getTopItems(softmax(batch.data), topk);
          const vals = scores.map((x) => ({
            label: id2label[x[0]],
            score: x[1]
          }));
          if (topk === 1) {
            toReturn.push(...vals);
          } else {
            toReturn.push(vals);
          }
        }
        return isBatched || topk === 1 ? (
          /** @type {ImageClassificationOutput} */
          toReturn
        ) : (
          /** @type {ImageClassificationOutput[]} */
          toReturn[0]
        );
      }
    };
    ImageSegmentationPipeline = class extends /** @type {new (options: ImagePipelineConstructorArgs) => ImageSegmentationPipelineType} */
    Pipeline {
      /**
       * Create a new ImageSegmentationPipeline.
       * @param {ImagePipelineConstructorArgs} options An object used to instantiate the pipeline.
       */
      constructor(options) {
        super(options);
        this.subtasks_mapping = {
          // Mapping of subtasks to their corresponding post-processing function names.
          panoptic: "post_process_panoptic_segmentation",
          instance: "post_process_instance_segmentation",
          semantic: "post_process_semantic_segmentation"
        };
      }
      /** @type {ImageSegmentationPipelineCallback} */
      async _call(images, {
        threshold = 0.5,
        mask_threshold = 0.5,
        overlap_mask_area_threshold = 0.8,
        label_ids_to_fuse = null,
        target_sizes = null,
        subtask = null
      } = {}) {
        const isBatched = Array.isArray(images);
        if (isBatched && images.length !== 1) {
          throw Error("Image segmentation pipeline currently only supports a batch size of 1.");
        }
        const preparedImages = await prepareImages(images);
        const imageSizes = preparedImages.map((x) => [x.height, x.width]);
        const { pixel_values, pixel_mask } = await this.processor(preparedImages);
        const output = await this.model({ pixel_values, pixel_mask });
        let fn = null;
        if (subtask !== null) {
          fn = this.subtasks_mapping[subtask];
        } else {
          for (let [task, func] of Object.entries(this.subtasks_mapping)) {
            if (func in this.processor.feature_extractor) {
              fn = this.processor.feature_extractor[func].bind(this.processor.feature_extractor);
              subtask = task;
              break;
            }
          }
        }
        const id2label = this.model.config.id2label;
        const annotation = [];
        if (subtask === "panoptic" || subtask === "instance") {
          const processed = fn(
            output,
            threshold,
            mask_threshold,
            overlap_mask_area_threshold,
            label_ids_to_fuse,
            target_sizes ?? imageSizes
            // TODO FIX?
          )[0];
          const segmentation = processed.segmentation;
          for (const segment of processed.segments_info) {
            const maskData = new Uint8ClampedArray(segmentation.data.length);
            for (let i = 0; i < segmentation.data.length; ++i) {
              if (segmentation.data[i] === segment.id) {
                maskData[i] = 255;
              }
            }
            const mask = new RawImage(maskData, segmentation.dims[1], segmentation.dims[0], 1);
            annotation.push({
              score: segment.score,
              label: id2label[segment.label_id],
              mask
            });
          }
        } else if (subtask === "semantic") {
          const { segmentation, labels } = fn(output, target_sizes ?? imageSizes)[0];
          for (const label of labels) {
            const maskData = new Uint8ClampedArray(segmentation.data.length);
            for (let i = 0; i < segmentation.data.length; ++i) {
              if (segmentation.data[i] === label) {
                maskData[i] = 255;
              }
            }
            const mask = new RawImage(maskData, segmentation.dims[1], segmentation.dims[0], 1);
            annotation.push({
              score: null,
              label: id2label[label],
              mask
            });
          }
        } else {
          throw Error(`Subtask ${subtask} not supported.`);
        }
        return annotation;
      }
    };
    ZeroShotImageClassificationPipeline = class extends /** @type {new (options: TextImagePipelineConstructorArgs) => ZeroShotImageClassificationPipelineType} */
    Pipeline {
      /**
       * Create a new ZeroShotImageClassificationPipeline.
       * @param {TextImagePipelineConstructorArgs} options An object used to instantiate the pipeline.
       */
      constructor(options) {
        super(options);
      }
      /** @type {ZeroShotImageClassificationPipelineCallback} */
      async _call(images, candidate_labels, {
        hypothesis_template = "This is a photo of {}"
      } = {}) {
        const isBatched = Array.isArray(images);
        const preparedImages = await prepareImages(images);
        const texts = candidate_labels.map(
          (x) => hypothesis_template.replace("{}", x)
        );
        const text_inputs = this.tokenizer(texts, {
          padding: this.model.config.model_type === "siglip" ? "max_length" : true,
          truncation: true
        });
        const { pixel_values } = await this.processor(preparedImages);
        const output = await this.model({ ...text_inputs, pixel_values });
        const function_to_apply = this.model.config.model_type === "siglip" ? (batch) => batch.sigmoid().data : (batch) => softmax(batch.data);
        const toReturn = [];
        for (const batch of output.logits_per_image) {
          const probs = function_to_apply(batch);
          const result = [...probs].map((x, i) => ({
            score: x,
            label: candidate_labels[i]
          }));
          result.sort((a, b) => b.score - a.score);
          toReturn.push(result);
        }
        return isBatched ? toReturn : toReturn[0];
      }
    };
    ObjectDetectionPipeline = class extends /** @type {new (options: ImagePipelineConstructorArgs) => ObjectDetectionPipelineType} */
    Pipeline {
      /**
       * Create a new ObjectDetectionPipeline.
       * @param {ImagePipelineConstructorArgs} options An object used to instantiate the pipeline.
       */
      constructor(options) {
        super(options);
      }
      /** @type {ObjectDetectionPipelineCallback} */
      async _call(images, {
        threshold = 0.9,
        percentage = false
      } = {}) {
        const isBatched = Array.isArray(images);
        if (isBatched && images.length !== 1) {
          throw Error("Object detection pipeline currently only supports a batch size of 1.");
        }
        const preparedImages = await prepareImages(images);
        const imageSizes = percentage ? null : preparedImages.map((x) => [x.height, x.width]);
        const { pixel_values, pixel_mask } = await this.processor(preparedImages);
        const output = await this.model({ pixel_values, pixel_mask });
        const processed = this.processor.feature_extractor.post_process_object_detection(output, threshold, imageSizes);
        const id2label = this.model.config.id2label;
        const result = processed.map((batch) => batch.boxes.map((box, i) => ({
          score: batch.scores[i],
          label: id2label[batch.classes[i]],
          box: get_bounding_box(box, !percentage)
        })));
        return isBatched ? result : result[0];
      }
    };
    ZeroShotObjectDetectionPipeline = class extends /** @type {new (options: TextImagePipelineConstructorArgs) => ZeroShotObjectDetectionPipelineType} */
    Pipeline {
      /**
       * Create a new ZeroShotObjectDetectionPipeline.
       * @param {TextImagePipelineConstructorArgs} options An object used to instantiate the pipeline.
       */
      constructor(options) {
        super(options);
      }
      /** @type {ZeroShotObjectDetectionPipelineCallback} */
      async _call(images, candidate_labels, {
        threshold = 0.1,
        topk = null,
        percentage = false
      } = {}) {
        const isBatched = Array.isArray(images);
        const preparedImages = await prepareImages(images);
        const text_inputs = this.tokenizer(candidate_labels, {
          padding: true,
          truncation: true
        });
        const model_inputs = await this.processor(preparedImages);
        const toReturn = [];
        for (let i = 0; i < preparedImages.length; ++i) {
          const image = preparedImages[i];
          const imageSize = percentage ? null : [[image.height, image.width]];
          const pixel_values = model_inputs.pixel_values[i].unsqueeze_(0);
          const output = await this.model({ ...text_inputs, pixel_values });
          const processed = this.processor.feature_extractor.post_process_object_detection(output, threshold, imageSize, true)[0];
          let result = processed.boxes.map((box, i2) => ({
            score: processed.scores[i2],
            label: candidate_labels[processed.classes[i2]],
            box: get_bounding_box(box, !percentage)
          })).sort((a, b) => b.score - a.score);
          if (topk !== null) {
            result = result.slice(0, topk);
          }
          toReturn.push(result);
        }
        return isBatched ? toReturn : toReturn[0];
      }
    };
    DocumentQuestionAnsweringPipeline = class extends /** @type {new (options: TextImagePipelineConstructorArgs) => DocumentQuestionAnsweringPipelineType} */
    Pipeline {
      /**
       * Create a new DocumentQuestionAnsweringPipeline.
       * @param {TextImagePipelineConstructorArgs} options An object used to instantiate the pipeline.
       */
      constructor(options) {
        super(options);
      }
      /** @type {DocumentQuestionAnsweringPipelineCallback} */
      async _call(image, question, generate_kwargs = {}) {
        const preparedImage = (await prepareImages(image))[0];
        const { pixel_values } = await this.processor(preparedImage);
        const task_prompt = `<s_docvqa><s_question>${question}</s_question><s_answer>`;
        const decoder_input_ids = this.tokenizer(task_prompt, {
          add_special_tokens: false,
          padding: true,
          truncation: true
        }).input_ids;
        const output = await this.model.generate(
          pixel_values,
          {
            ...generate_kwargs,
            decoder_input_ids,
            max_length: this.model.config.decoder.max_position_embeddings
          }
        );
        const decoded = this.tokenizer.batch_decode(output)[0];
        const match = decoded.match(/<s_answer>(.*?)<\/s_answer>/);
        let answer = null;
        if (match && match.length >= 2) {
          answer = match[1].trim();
        }
        return [{ answer }];
      }
    };
    TextToAudioPipeline = class extends /** @type {new (options: TextToAudioPipelineConstructorArgs) => TextToAudioPipelineType} */
    Pipeline {
      DEFAULT_VOCODER_ID = "Xenova/speecht5_hifigan";
      /**
       * Create a new TextToAudioPipeline.
       * @param {TextToAudioPipelineConstructorArgs} options An object used to instantiate the pipeline.
       */
      constructor(options) {
        super(options);
        this.vocoder = options.vocoder ?? null;
      }
      /** @type {TextToAudioPipelineCallback} */
      async _call(text_inputs, {
        speaker_embeddings = null
      } = {}) {
        if (this.processor) {
          return this._call_text_to_spectrogram(text_inputs, { speaker_embeddings });
        } else {
          return this._call_text_to_waveform(text_inputs);
        }
      }
      async _call_text_to_waveform(text_inputs) {
        const inputs = this.tokenizer(text_inputs, {
          padding: true,
          truncation: true
        });
        const { waveform } = await this.model(inputs);
        const sampling_rate = this.model.config.sampling_rate;
        return {
          audio: waveform.data,
          sampling_rate
        };
      }
      async _call_text_to_spectrogram(text_inputs, { speaker_embeddings }) {
        if (!this.vocoder) {
          console.log("No vocoder specified, using default HifiGan vocoder.");
          this.vocoder = await AutoModel.from_pretrained(this.DEFAULT_VOCODER_ID, { quantized: false });
        }
        if (typeof speaker_embeddings === "string" || speaker_embeddings instanceof URL) {
          speaker_embeddings = new Float32Array(
            await (await fetch(speaker_embeddings)).arrayBuffer()
          );
        }
        if (speaker_embeddings instanceof Float32Array) {
          speaker_embeddings = new Tensor(
            "float32",
            speaker_embeddings,
            [1, speaker_embeddings.length]
          );
        } else if (!(speaker_embeddings instanceof Tensor)) {
          throw new Error("Speaker embeddings must be a `Tensor`, `Float32Array`, `string`, or `URL`.");
        }
        const { input_ids } = this.tokenizer(text_inputs, {
          padding: true,
          truncation: true
        });
        const { waveform } = await this.model.generate_speech(input_ids, speaker_embeddings, { vocoder: this.vocoder });
        const sampling_rate = this.processor.feature_extractor.config.sampling_rate;
        return {
          audio: waveform.data,
          sampling_rate
        };
      }
    };
    ImageToImagePipeline = class extends /** @type {new (options: ImagePipelineConstructorArgs) => ImageToImagePipelineType} */
    Pipeline {
      /**
       * Create a new ImageToImagePipeline.
       * @param {ImagePipelineConstructorArgs} options An object used to instantiate the pipeline.
       */
      constructor(options) {
        super(options);
      }
      /** @type {ImageToImagePipelineCallback} */
      async _call(images) {
        const preparedImages = await prepareImages(images);
        const inputs = await this.processor(preparedImages);
        const outputs = await this.model(inputs);
        const toReturn = [];
        for (const batch of outputs.reconstruction) {
          const output = batch.squeeze().clamp_(0, 1).mul_(255).round_().to("uint8");
          toReturn.push(RawImage.fromTensor(output));
        }
        return toReturn.length > 1 ? toReturn : toReturn[0];
      }
    };
    DepthEstimationPipeline = class extends /** @type {new (options: ImagePipelineConstructorArgs) => DepthEstimationPipelineType} */
    Pipeline {
      /**
       * Create a new DepthEstimationPipeline.
       * @param {ImagePipelineConstructorArgs} options An object used to instantiate the pipeline.
       */
      constructor(options) {
        super(options);
      }
      /** @type {DepthEstimationPipelineCallback} */
      async _call(images) {
        const preparedImages = await prepareImages(images);
        const inputs = await this.processor(preparedImages);
        const { predicted_depth } = await this.model(inputs);
        const toReturn = [];
        for (let i = 0; i < preparedImages.length; ++i) {
          const prediction = interpolate(predicted_depth[i], preparedImages[i].size.reverse(), "bilinear", false);
          const formatted = prediction.mul_(255 / max(prediction.data)[0]).to("uint8");
          toReturn.push({
            predicted_depth: predicted_depth[i],
            depth: RawImage.fromTensor(formatted)
          });
        }
        return toReturn.length > 1 ? toReturn : toReturn[0];
      }
    };
    SUPPORTED_TASKS = Object.freeze({
      "text-classification": {
        "tokenizer": AutoTokenizer,
        "pipeline": TextClassificationPipeline,
        "model": AutoModelForSequenceClassification,
        "default": {
          // TODO: replace with original
          // "model": "distilbert-base-uncased-finetuned-sst-2-english",
          "model": "Xenova/distilbert-base-uncased-finetuned-sst-2-english"
        },
        "type": "text"
      },
      "token-classification": {
        "tokenizer": AutoTokenizer,
        "pipeline": TokenClassificationPipeline,
        "model": AutoModelForTokenClassification,
        "default": {
          // TODO: replace with original
          // "model": "Davlan/bert-base-multilingual-cased-ner-hrl",
          "model": "Xenova/bert-base-multilingual-cased-ner-hrl"
        },
        "type": "text"
      },
      "question-answering": {
        "tokenizer": AutoTokenizer,
        "pipeline": QuestionAnsweringPipeline,
        "model": AutoModelForQuestionAnswering,
        "default": {
          // TODO: replace with original
          // "model": "distilbert-base-cased-distilled-squad",
          "model": "Xenova/distilbert-base-cased-distilled-squad"
        },
        "type": "text"
      },
      "fill-mask": {
        "tokenizer": AutoTokenizer,
        "pipeline": FillMaskPipeline,
        "model": AutoModelForMaskedLM,
        "default": {
          // TODO: replace with original
          // "model": "bert-base-uncased",
          "model": "Xenova/bert-base-uncased"
        },
        "type": "text"
      },
      "summarization": {
        "tokenizer": AutoTokenizer,
        "pipeline": SummarizationPipeline,
        "model": AutoModelForSeq2SeqLM,
        "default": {
          // TODO: replace with original
          // "model": "sshleifer/distilbart-cnn-6-6",
          "model": "Xenova/distilbart-cnn-6-6"
        },
        "type": "text"
      },
      "translation": {
        "tokenizer": AutoTokenizer,
        "pipeline": TranslationPipeline,
        "model": AutoModelForSeq2SeqLM,
        "default": {
          // TODO: replace with original
          // "model": "t5-small",
          "model": "Xenova/t5-small"
        },
        "type": "text"
      },
      "text2text-generation": {
        "tokenizer": AutoTokenizer,
        "pipeline": Text2TextGenerationPipeline,
        "model": AutoModelForSeq2SeqLM,
        "default": {
          // TODO: replace with original
          // "model": "google/flan-t5-small",
          "model": "Xenova/flan-t5-small"
        },
        "type": "text"
      },
      "text-generation": {
        "tokenizer": AutoTokenizer,
        "pipeline": TextGenerationPipeline,
        "model": AutoModelForCausalLM,
        "default": {
          // TODO: replace with original
          // "model": "gpt2",
          "model": "Xenova/gpt2"
        },
        "type": "text"
      },
      "zero-shot-classification": {
        "tokenizer": AutoTokenizer,
        "pipeline": ZeroShotClassificationPipeline,
        "model": AutoModelForSequenceClassification,
        "default": {
          // TODO: replace with original
          // "model": "typeform/distilbert-base-uncased-mnli",
          "model": "Xenova/distilbert-base-uncased-mnli"
        },
        "type": "text"
      },
      "audio-classification": {
        "pipeline": AudioClassificationPipeline,
        "model": AutoModelForAudioClassification,
        "processor": AutoProcessor,
        "default": {
          // TODO: replace with original
          // "model": "superb/wav2vec2-base-superb-ks",
          "model": "Xenova/wav2vec2-base-superb-ks"
        },
        "type": "audio"
      },
      "zero-shot-audio-classification": {
        "tokenizer": AutoTokenizer,
        "pipeline": ZeroShotAudioClassificationPipeline,
        "model": AutoModel,
        "processor": AutoProcessor,
        "default": {
          // TODO: replace with original
          // "model": "laion/clap-htsat-fused",
          "model": "Xenova/clap-htsat-unfused"
        },
        "type": "multimodal"
      },
      "automatic-speech-recognition": {
        "tokenizer": AutoTokenizer,
        "pipeline": AutomaticSpeechRecognitionPipeline,
        "model": [AutoModelForSpeechSeq2Seq, AutoModelForCTC],
        "processor": AutoProcessor,
        "default": {
          // TODO: replace with original
          // "model": "openai/whisper-tiny.en",
          "model": "Xenova/whisper-tiny.en"
        },
        "type": "multimodal"
      },
      "text-to-audio": {
        "tokenizer": AutoTokenizer,
        "pipeline": TextToAudioPipeline,
        "model": [AutoModelForTextToWaveform, AutoModelForTextToSpectrogram],
        "processor": [
          AutoProcessor,
          /* Some don't use a processor */
          null
        ],
        "default": {
          // TODO: replace with original
          // "model": "microsoft/speecht5_tts",
          "model": "Xenova/speecht5_tts"
        },
        "type": "text"
      },
      "image-to-text": {
        "tokenizer": AutoTokenizer,
        "pipeline": ImageToTextPipeline,
        "model": AutoModelForVision2Seq,
        "processor": AutoProcessor,
        "default": {
          // TODO: replace with original
          // "model": "nlpconnect/vit-gpt2-image-captioning",
          "model": "Xenova/vit-gpt2-image-captioning"
        },
        "type": "multimodal"
      },
      "image-classification": {
        // no tokenizer
        "pipeline": ImageClassificationPipeline,
        "model": AutoModelForImageClassification,
        "processor": AutoProcessor,
        "default": {
          // TODO: replace with original
          // "model": "google/vit-base-patch16-224",
          "model": "Xenova/vit-base-patch16-224"
        },
        "type": "multimodal"
      },
      "image-segmentation": {
        // no tokenizer
        "pipeline": ImageSegmentationPipeline,
        "model": [AutoModelForImageSegmentation, AutoModelForSemanticSegmentation],
        "processor": AutoProcessor,
        "default": {
          // TODO: replace with original
          // "model": "facebook/detr-resnet-50-panoptic",
          "model": "Xenova/detr-resnet-50-panoptic"
        },
        "type": "multimodal"
      },
      "zero-shot-image-classification": {
        "tokenizer": AutoTokenizer,
        "pipeline": ZeroShotImageClassificationPipeline,
        "model": AutoModel,
        "processor": AutoProcessor,
        "default": {
          // TODO: replace with original
          // "model": "openai/clip-vit-base-patch32",
          "model": "Xenova/clip-vit-base-patch32"
        },
        "type": "multimodal"
      },
      "object-detection": {
        // no tokenizer
        "pipeline": ObjectDetectionPipeline,
        "model": AutoModelForObjectDetection,
        "processor": AutoProcessor,
        "default": {
          // TODO: replace with original
          // "model": "facebook/detr-resnet-50",
          "model": "Xenova/detr-resnet-50"
        },
        "type": "multimodal"
      },
      "zero-shot-object-detection": {
        "tokenizer": AutoTokenizer,
        "pipeline": ZeroShotObjectDetectionPipeline,
        "model": AutoModelForZeroShotObjectDetection,
        "processor": AutoProcessor,
        "default": {
          // TODO: replace with original
          // "model": "google/owlvit-base-patch32",
          "model": "Xenova/owlvit-base-patch32"
        },
        "type": "multimodal"
      },
      "document-question-answering": {
        "tokenizer": AutoTokenizer,
        "pipeline": DocumentQuestionAnsweringPipeline,
        "model": AutoModelForDocumentQuestionAnswering,
        "processor": AutoProcessor,
        "default": {
          // TODO: replace with original
          // "model": "naver-clova-ix/donut-base-finetuned-docvqa",
          "model": "Xenova/donut-base-finetuned-docvqa"
        },
        "type": "multimodal"
      },
      "image-to-image": {
        // no tokenizer
        "pipeline": ImageToImagePipeline,
        "model": AutoModelForImageToImage,
        "processor": AutoProcessor,
        "default": {
          // TODO: replace with original
          // "model": "caidas/swin2SR-classical-sr-x2-64",
          "model": "Xenova/swin2SR-classical-sr-x2-64"
        },
        "type": "image"
      },
      "depth-estimation": {
        // no tokenizer
        "pipeline": DepthEstimationPipeline,
        "model": AutoModelForDepthEstimation,
        "processor": AutoProcessor,
        "default": {
          // TODO: replace with original
          // "model": "Intel/dpt-large",
          "model": "Xenova/dpt-large"
        },
        "type": "image"
      },
      // This task serves as a useful interface for dealing with sentence-transformers (https://huggingface.co/sentence-transformers).
      "feature-extraction": {
        "tokenizer": AutoTokenizer,
        "pipeline": FeatureExtractionPipeline,
        "model": AutoModel,
        "default": {
          // TODO: replace with original
          // "model": "sentence-transformers/all-MiniLM-L6-v2",
          "model": "Xenova/all-MiniLM-L6-v2"
        },
        "type": "text"
      },
      "image-feature-extraction": {
        "processor": AutoProcessor,
        "pipeline": ImageFeatureExtractionPipeline,
        "model": [AutoModelForImageFeatureExtraction, AutoModel],
        "default": {
          // TODO: replace with original
          // "model": "google/vit-base-patch16-224",
          "model": "Xenova/vit-base-patch16-224-in21k"
        },
        "type": "image"
      }
    });
    TASK_ALIASES = Object.freeze({
      "sentiment-analysis": "text-classification",
      "ner": "token-classification",
      // "vqa": "visual-question-answering", // TODO: Add
      "asr": "automatic-speech-recognition",
      "text-to-speech": "text-to-audio",
      // Add for backwards compatibility
      "embeddings": "feature-extraction"
    });
  }
});

// node_modules/@xenova/transformers/src/transformers.js
var init_transformers = __esm({
  "node_modules/@xenova/transformers/src/transformers.js"() {
    init_pipelines();
    init_env();
    init_models();
    init_tokenizers();
    init_processors();
    init_configs();
    init_audio();
    init_image();
    init_tensor();
    init_maths();
  }
});

// node_modules/gliner/dist/index.mjs
import ort_CPU from "onnxruntime-web";
import ort_WEBGPU from "onnxruntime-web/webgpu";
import ort_WEBGL from "onnxruntime-web/webgl";
var __defProp2, __defNormalProp, __publicField, Model, SpanModel, TokenModel, WhitespaceTokenSplitter, Processor2, SpanProcessor, TokenProcessor, isNested, hasOverlapping, hasOverlappingNested, sigmoid, BaseDecoder, SpanDecoder, TokenDecoder, ONNX_WASM_CDN_URL, DEFAULT_WASM_PATHS, ONNXWebWrapper, Gliner;
var init_dist2 = __esm({
  "node_modules/gliner/dist/index.mjs"() {
    init_transformers();
    __defProp2 = Object.defineProperty;
    __defNormalProp = (obj, key, value) => key in obj ? __defProp2(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
    __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
    Model = class {
      constructor(config, processor, decoder, onnxWrapper) {
        this.config = config;
        this.processor = processor;
        this.decoder = decoder;
        this.onnxWrapper = onnxWrapper;
      }
      async initialize() {
        await this.onnxWrapper.init();
      }
    };
    SpanModel = class extends Model {
      prepareInputs(batch) {
        const batch_size = batch.inputsIds.length;
        const num_tokens = batch.inputsIds[0].length;
        const num_spans = batch.spanIdxs[0].length;
        const createTensor = (data, shape, tensorType = "int64") => {
          return new this.onnxWrapper.ort.Tensor(tensorType, data.flat(Infinity), shape);
        };
        let input_ids = createTensor(batch.inputsIds, [batch_size, num_tokens]);
        let attention_mask = createTensor(batch.attentionMasks, [batch_size, num_tokens]);
        let words_mask = createTensor(batch.wordsMasks, [batch_size, num_tokens]);
        let text_lengths = createTensor(batch.textLengths, [batch_size, 1]);
        let span_idx = createTensor(batch.spanIdxs, [batch_size, num_spans, 2]);
        let span_mask = createTensor(batch.spanMasks, [batch_size, num_spans], "bool");
        const feeds = {
          input_ids,
          attention_mask,
          words_mask,
          text_lengths,
          span_idx,
          span_mask
        };
        return feeds;
      }
      async inference(texts, entities, flatNer = false, threshold = 0.5, multiLabel = false) {
        let batch = this.processor.prepareBatch(texts, entities);
        let feeds = this.prepareInputs(batch);
        const results = await this.onnxWrapper.run(feeds);
        const modelOutput = results["logits"].data;
        const batchSize = batch.batchTokens.length;
        const inputLength = Math.max(...batch.textLengths);
        const maxWidth = this.config.max_width;
        const numEntities = entities.length;
        const batchIds = Array.from({ length: batchSize }, (_, i) => i);
        const decodedSpans = this.decoder.decode(
          batchSize,
          inputLength,
          maxWidth,
          numEntities,
          texts,
          batchIds,
          batch.batchWordsStartIdx,
          batch.batchWordsEndIdx,
          batch.idToClass,
          modelOutput,
          flatNer,
          threshold,
          multiLabel
        );
        return decodedSpans;
      }
      async inference_with_chunking(texts, entities, flatNer = false, threshold = 0.5, multiLabel = false, batch_size = 4, max_words = 512) {
        const {
          idToClass
        } = this.processor.createMappings(entities);
        let batchIds = [];
        let batchTokens = [];
        let batchWordsStartIdx = [];
        let batchWordsEndIdx = [];
        texts.forEach((text, id) => {
          let [tokens, wordsStartIdx, wordsEndIdx] = this.processor.tokenizeText(text);
          let num_sub_batches = Math.ceil(tokens.length / max_words);
          for (let i = 0; i < num_sub_batches; i++) {
            let start = i * max_words;
            let end = Math.min((i + 1) * max_words, tokens.length);
            batchIds.push(id);
            batchTokens.push(tokens.slice(start, end));
            batchWordsStartIdx.push(wordsStartIdx.slice(start, end));
            batchWordsEndIdx.push(wordsEndIdx.slice(start, end));
          }
        });
        let num_batches = Math.ceil(batchIds.length / batch_size);
        let finalDecodedSpans = [];
        for (let id = 0; id < texts.length; id++) {
          finalDecodedSpans.push([]);
        }
        for (let batch_id = 0; batch_id < num_batches; batch_id++) {
          let start = batch_id * batch_size;
          let end = Math.min((batch_id + 1) * batch_size, batchIds.length);
          let currBatchTokens = batchTokens.slice(start, end);
          let currBatchWordsStartIdx = batchWordsStartIdx.slice(start, end);
          let currBatchWordsEndIdx = batchWordsEndIdx.slice(start, end);
          let currBatchIds = batchIds.slice(start, end);
          let [inputTokens, textLengths, promptLengths] = this.processor.prepareTextInputs(currBatchTokens, entities);
          let [inputsIds, attentionMasks, wordsMasks] = this.processor.encodeInputs(inputTokens, promptLengths);
          inputsIds = this.processor.padArray(inputsIds);
          attentionMasks = this.processor.padArray(attentionMasks);
          wordsMasks = this.processor.padArray(wordsMasks);
          let { spanIdxs, spanMasks } = this.processor.prepareSpans(currBatchTokens, this.config["max_width"]);
          spanIdxs = this.processor.padArray(spanIdxs, 3);
          spanMasks = this.processor.padArray(spanMasks);
          let batch = {
            inputsIds,
            attentionMasks,
            wordsMasks,
            textLengths,
            spanIdxs,
            spanMasks,
            idToClass,
            batchTokens: currBatchTokens,
            batchWordsStartIdx: currBatchWordsStartIdx,
            batchWordsEndIdx: currBatchWordsEndIdx
          };
          let feeds = this.prepareInputs(batch);
          const results = await this.onnxWrapper.run(feeds);
          const modelOutput = results["logits"].data;
          const batchSize = batch.batchTokens.length;
          const inputLength = Math.max(...batch.textLengths);
          const maxWidth = this.config.max_width;
          const numEntities = entities.length;
          const decodedSpans = this.decoder.decode(
            batchSize,
            inputLength,
            maxWidth,
            numEntities,
            texts,
            currBatchIds,
            batch.batchWordsStartIdx,
            batch.batchWordsEndIdx,
            batch.idToClass,
            modelOutput,
            flatNer,
            threshold,
            multiLabel
          );
          for (let i = 0; i < currBatchIds.length; i++) {
            const originalTextId = currBatchIds[i];
            finalDecodedSpans[originalTextId].push(...decodedSpans[i]);
          }
        }
        return finalDecodedSpans;
      }
    };
    TokenModel = class extends Model {
      prepareInputs(batch) {
        const batch_size = batch.inputsIds.length;
        const num_tokens = batch.inputsIds[0].length;
        const createTensor = (data, shape, tensorType = "int64") => {
          return new this.onnxWrapper.ort.Tensor(tensorType, data.flat(Infinity), shape);
        };
        let input_ids = createTensor(batch.inputsIds, [batch_size, num_tokens]);
        let attention_mask = createTensor(batch.attentionMasks, [batch_size, num_tokens]);
        let words_mask = createTensor(batch.wordsMasks, [batch_size, num_tokens]);
        let text_lengths = createTensor(batch.textLengths, [batch_size, 1]);
        const feeds = {
          input_ids,
          attention_mask,
          words_mask,
          text_lengths
        };
        return feeds;
      }
      async inference(texts, entities, flatNer = false, threshold = 0.5, multiLabel = false) {
        let batch = this.processor.prepareBatch(texts, entities);
        let feeds = this.prepareInputs(batch);
        const results = await this.onnxWrapper.run(feeds);
        const modelOutput = results["logits"].data;
        const batchSize = batch.batchTokens.length;
        const inputLength = Math.max(...batch.textLengths);
        const numEntities = entities.length;
        const batchIds = Array.from({ length: batchSize }, (_, i) => i);
        const decodedSpans = this.decoder.decode(
          batchSize,
          inputLength,
          numEntities,
          texts,
          batchIds,
          batch.batchWordsStartIdx,
          batch.batchWordsEndIdx,
          batch.idToClass,
          modelOutput,
          flatNer,
          threshold,
          multiLabel
        );
        return decodedSpans;
      }
      async inference_with_chunking(texts, entities, flatNer = true, threshold = 0.5, multiLabel = false, batch_size = 4, max_words = 512) {
        const {
          idToClass
        } = this.processor.createMappings(entities);
        let batchIds = [];
        let batchTokens = [];
        let batchWordsStartIdx = [];
        let batchWordsEndIdx = [];
        texts.forEach((text, id) => {
          let [tokens, wordsStartIdx, wordsEndIdx] = this.processor.tokenizeText(text);
          let num_sub_batches = Math.ceil(tokens.length / max_words);
          for (let i = 0; i < num_sub_batches; i++) {
            let start = i * max_words;
            let end = Math.min((i + 1) * max_words, tokens.length);
            batchIds.push(id);
            batchTokens.push(tokens.slice(start, end));
            batchWordsStartIdx.push(wordsStartIdx.slice(start, end));
            batchWordsEndIdx.push(wordsEndIdx.slice(start, end));
          }
        });
        let num_batches = Math.ceil(batchIds.length / batch_size);
        let finalDecodedSpans = [];
        for (let id = 0; id < texts.length; id++) {
          finalDecodedSpans.push([]);
        }
        for (let batch_id = 0; batch_id < num_batches; batch_id++) {
          let start = batch_id * batch_size;
          let end = Math.min((batch_id + 1) * batch_size, batchIds.length);
          let currBatchTokens = batchTokens.slice(start, end);
          let currBatchWordsStartIdx = batchWordsStartIdx.slice(start, end);
          let currBatchWordsEndIdx = batchWordsEndIdx.slice(start, end);
          let currBatchIds = batchIds.slice(start, end);
          let [inputTokens, textLengths, promptLengths] = this.processor.prepareTextInputs(currBatchTokens, entities);
          let [inputsIds, attentionMasks, wordsMasks] = this.processor.encodeInputs(inputTokens, promptLengths);
          inputsIds = this.processor.padArray(inputsIds);
          attentionMasks = this.processor.padArray(attentionMasks);
          wordsMasks = this.processor.padArray(wordsMasks);
          let batch = {
            inputsIds,
            attentionMasks,
            wordsMasks,
            textLengths,
            idToClass,
            batchTokens: currBatchTokens,
            batchWordsStartIdx: currBatchWordsStartIdx,
            batchWordsEndIdx: currBatchWordsEndIdx
          };
          let feeds = this.prepareInputs(batch);
          const results = await this.onnxWrapper.run(feeds);
          const modelOutput = results["logits"].data;
          const batchSize = batch.batchTokens.length;
          const inputLength = Math.max(...batch.textLengths);
          const numEntities = entities.length;
          const decodedSpans = this.decoder.decode(
            batchSize,
            inputLength,
            numEntities,
            texts,
            currBatchIds,
            batch.batchWordsStartIdx,
            batch.batchWordsEndIdx,
            batch.idToClass,
            modelOutput,
            flatNer,
            threshold,
            multiLabel
          );
          for (let i = 0; i < currBatchIds.length; i++) {
            const originalTextId = currBatchIds[i];
            finalDecodedSpans[originalTextId].push(...decodedSpans[i]);
          }
        }
        return finalDecodedSpans;
      }
    };
    WhitespaceTokenSplitter = class {
      constructor() {
        __publicField(this, "whitespacePattern");
        this.whitespacePattern = /\w+(?:[-_]\w+)*|\S/g;
      }
      *call(text) {
        let match;
        while ((match = this.whitespacePattern.exec(text)) !== null) {
          yield [match[0], match.index, this.whitespacePattern.lastIndex];
        }
      }
    };
    Processor2 = class {
      constructor(config, tokenizer, wordsSplitter) {
        __publicField(this, "config");
        __publicField(this, "tokenizer");
        __publicField(this, "wordsSplitter");
        this.config = config;
        this.tokenizer = tokenizer;
        this.wordsSplitter = wordsSplitter;
      }
      tokenizeText(text) {
        let tokens = [];
        let wordsStartIdx = [];
        let wordsEndIdx = [];
        for (const [token, start, end] of this.wordsSplitter.call(text)) {
          tokens.push(token);
          wordsStartIdx.push(start);
          wordsEndIdx.push(end);
        }
        return [tokens, wordsStartIdx, wordsEndIdx];
      }
      batchTokenizeText(texts) {
        let batchTokens = [];
        let batchWordsStartIdx = [];
        let batchWordsEndIdx = [];
        for (const text of texts) {
          const [tokens, wordsStartIdx, wordsEndIdx] = this.tokenizeText(text);
          batchTokens.push(tokens);
          batchWordsStartIdx.push(wordsStartIdx);
          batchWordsEndIdx.push(wordsEndIdx);
        }
        return [batchTokens, batchWordsStartIdx, batchWordsEndIdx];
      }
      createMappings(classes) {
        const classToId = {};
        const idToClass = {};
        classes.forEach((className, index) => {
          const id = index + 1;
          classToId[className] = id;
          idToClass[id] = className;
        });
        return { classToId, idToClass };
      }
      prepareTextInputs(tokens, entities) {
        const inputTexts = [];
        const promptLengths = [];
        const textLengths = [];
        tokens.forEach((text) => {
          textLengths.push(text.length);
          let inputText = [];
          for (let ent of entities) {
            inputText.push("<<ENT>>");
            inputText.push(ent);
          }
          inputText.push("<<SEP>>");
          const promptLength = inputText.length;
          promptLengths.push(promptLength);
          inputText = inputText.concat(text);
          inputTexts.push(inputText);
        });
        return [inputTexts, textLengths, promptLengths];
      }
      encodeInputs(texts, promptLengths = null) {
        let wordsMasks = [];
        let inputsIds = [];
        let attentionMasks = [];
        for (let id = 0; id < texts.length; id++) {
          let promptLength = promptLengths ? promptLengths[id] : 0;
          let tokenizedInputs = texts[id];
          let wordsMask = [0];
          let inputIds = [1];
          let attentionMask = [1];
          let c = 1;
          tokenizedInputs.forEach((word, wordId) => {
            let wordTokens = this.tokenizer.encode(word).slice(1, -1);
            wordTokens.forEach((token, tokenId) => {
              attentionMask.push(1);
              if (wordId < promptLength) {
                wordsMask.push(0);
              } else if (tokenId === 0) {
                wordsMask.push(c);
                c++;
              } else {
                wordsMask.push(0);
              }
              inputIds.push(token);
            });
          });
          wordsMask.push(0);
          inputIds.push(this.tokenizer.sep_token_id);
          attentionMask.push(1);
          wordsMasks.push(wordsMask);
          inputsIds.push(inputIds);
          attentionMasks.push(attentionMask);
        }
        return [inputsIds, attentionMasks, wordsMasks];
      }
      padArray(arr, dimensions = 2) {
        if (dimensions < 2 || dimensions > 3) {
          throw new Error("Only 2D and 3D arrays are supported");
        }
        const maxLength = Math.max(...arr.map((subArr) => subArr.length));
        const finalDim = dimensions === 3 ? arr[0][0].length : 0;
        return arr.map((subArr) => {
          const padCount = maxLength - subArr.length;
          const padding = Array(padCount).fill(dimensions === 3 ? Array(finalDim).fill(0) : 0);
          return [...subArr, ...padding];
        });
      }
    };
    SpanProcessor = class extends Processor2 {
      constructor(config, tokenizer, wordsSplitter) {
        super(config, tokenizer, wordsSplitter);
      }
      prepareSpans(batchTokens, maxWidth = 12) {
        let spanIdxs = [];
        let spanMasks = [];
        batchTokens.forEach((tokens) => {
          let textLength = tokens.length;
          let spanIdx = [];
          let spanMask = [];
          for (let i = 0; i < textLength; i++) {
            for (let j = 0; j < maxWidth; j++) {
              let endIdx = Math.min(i + j, textLength - 1);
              spanIdx.push([i, endIdx]);
              spanMask.push(endIdx < textLength ? true : false);
            }
          }
          spanIdxs.push(spanIdx);
          spanMasks.push(spanMask);
        });
        return { spanIdxs, spanMasks };
      }
      prepareBatch(texts, entities) {
        const [batchTokens, batchWordsStartIdx, batchWordsEndIdx] = this.batchTokenizeText(texts);
        const { idToClass } = this.createMappings(entities);
        const [inputTokens, textLengths, promptLengths] = this.prepareTextInputs(batchTokens, entities);
        let [inputsIds, attentionMasks, wordsMasks] = this.encodeInputs(inputTokens, promptLengths);
        inputsIds = this.padArray(inputsIds);
        attentionMasks = this.padArray(attentionMasks);
        wordsMasks = this.padArray(wordsMasks);
        let { spanIdxs, spanMasks } = this.prepareSpans(batchTokens, this.config["max_width"]);
        spanIdxs = this.padArray(spanIdxs, 3);
        spanMasks = this.padArray(spanMasks);
        return {
          inputsIds,
          attentionMasks,
          wordsMasks,
          textLengths,
          spanIdxs,
          spanMasks,
          idToClass,
          batchTokens,
          batchWordsStartIdx,
          batchWordsEndIdx
        };
      }
    };
    TokenProcessor = class extends Processor2 {
      constructor(config, tokenizer, wordsSplitter) {
        super(config, tokenizer, wordsSplitter);
      }
      prepareBatch(texts, entities) {
        const [batchTokens, batchWordsStartIdx, batchWordsEndIdx] = this.batchTokenizeText(texts);
        const { idToClass } = this.createMappings(entities);
        const [inputTokens, textLengths, promptLengths] = this.prepareTextInputs(batchTokens, entities);
        let [inputsIds, attentionMasks, wordsMasks] = this.encodeInputs(inputTokens, promptLengths);
        inputsIds = this.padArray(inputsIds);
        attentionMasks = this.padArray(attentionMasks);
        wordsMasks = this.padArray(wordsMasks);
        return {
          inputsIds,
          attentionMasks,
          wordsMasks,
          textLengths,
          idToClass,
          batchTokens,
          batchWordsStartIdx,
          batchWordsEndIdx
        };
      }
    };
    isNested = (idx1, idx2) => {
      return idx1[0] <= idx2[0] && idx1[1] >= idx2[1] || idx2[0] <= idx1[0] && idx2[1] >= idx1[1];
    };
    hasOverlapping = (idx1, idx2, multiLabel = false) => {
      if (idx1.slice(0, 2).toString() === idx2.slice(0, 2).toString()) {
        return !multiLabel;
      }
      if (idx1[0] > idx2[1] || idx2[0] > idx1[1]) {
        return false;
      }
      return true;
    };
    hasOverlappingNested = (idx1, idx2, multiLabel = false) => {
      if (idx1.slice(0, 2).toString() === idx2.slice(0, 2).toString()) {
        return !multiLabel;
      }
      if (idx1[0] > idx2[1] || idx2[0] > idx1[1] || isNested(idx1, idx2)) {
        return false;
      }
      return true;
    };
    sigmoid = (x) => {
      return 1 / (1 + Math.exp(-x));
    };
    BaseDecoder = class _BaseDecoder {
      constructor(config) {
        __publicField(this, "config");
        if (new.target === _BaseDecoder) {
          throw new TypeError("Cannot instantiate an abstract class.");
        }
        this.config = config;
      }
      greedySearch(spans, flatNer = true, multiLabel = false) {
        const hasOv = flatNer ? (idx1, idx2) => hasOverlapping(idx1, idx2, multiLabel) : (idx1, idx2) => hasOverlappingNested(idx1, idx2, multiLabel);
        const newList = [];
        const spanProb = spans.slice().sort((a, b) => b[b.length - 1] - a[a.length - 1]);
        for (let i = 0; i < spanProb.length; i++) {
          const b = spanProb[i];
          let flag = false;
          for (const newSpan of newList) {
            if (hasOv(b.slice(1, 3), newSpan.slice(1, 3))) {
              flag = true;
              break;
            }
          }
          if (!flag) {
            newList.push(b);
          }
        }
        return newList.sort((a, b) => a[1] - b[1]);
      }
    };
    SpanDecoder = class extends BaseDecoder {
      decode(batchSize, inputLength, maxWidth, numEntities, texts, batchIds, batchWordsStartIdx, batchWordsEndIdx, idToClass, modelOutput, flatNer = false, threshold = 0.5, multiLabel = false) {
        const spans = [];
        for (let batch = 0; batch < batchSize; batch++) {
          spans.push([]);
        }
        const batchPadding = inputLength * maxWidth * numEntities;
        const startTokenPadding = maxWidth * numEntities;
        const endTokenPadding = numEntities * 1;
        modelOutput.forEach((value, id) => {
          let batch = Math.floor(id / batchPadding);
          let startToken = Math.floor(id / startTokenPadding) % inputLength;
          let endToken = startToken + Math.floor(id / endTokenPadding) % maxWidth;
          let entity = id % numEntities;
          let prob = sigmoid(value);
          if (prob >= threshold && startToken < batchWordsStartIdx[batch].length && endToken < batchWordsEndIdx[batch].length) {
            let globalBatch = batchIds[batch];
            let startIdx = batchWordsStartIdx[batch][startToken];
            let endIdx = batchWordsEndIdx[batch][endToken];
            let spanText = texts[globalBatch].slice(startIdx, endIdx);
            spans[batch].push([spanText, startIdx, endIdx, idToClass[entity + 1], prob]);
          }
        });
        const allSelectedSpans = [];
        spans.forEach((resI, id) => {
          const selectedSpans = this.greedySearch(resI, flatNer, multiLabel);
          allSelectedSpans.push(selectedSpans);
        });
        return allSelectedSpans;
      }
    };
    TokenDecoder = class extends BaseDecoder {
      decode(batchSize, inputLength, numEntities, texts, batchIds, batchWordsStartIdx, batchWordsEndIdx, idToClass, modelOutput, flatNer = false, threshold = 0.5, multiLabel = false) {
        const positionPadding = batchSize * inputLength * numEntities;
        const batchPadding = inputLength * numEntities;
        const tokenPadding = numEntities;
        let selectedStarts = [];
        let selectedEnds = [];
        let insideScore = [];
        for (let id = 0; id < batchSize; id++) {
          selectedStarts.push([]);
          selectedEnds.push([]);
          let batches = [];
          for (let j = 0; j < inputLength; j++) {
            let sequence = Array(numEntities).fill(0);
            batches.push(sequence);
          }
          insideScore.push(batches);
        }
        modelOutput.forEach((value, id) => {
          let position = Math.floor(id / positionPadding);
          let batch = Math.floor(id / batchPadding) % batchSize;
          let token = Math.floor(id / tokenPadding) % inputLength;
          let entity = id % numEntities;
          let prob = sigmoid(value);
          if (prob >= threshold && token < batchWordsEndIdx[batch].length) {
            if (position == 0) {
              selectedStarts[batch].push([token, entity]);
            } else if (position == 1) {
              selectedEnds[batch].push([token, entity]);
            }
          }
          if (position == 2) {
            insideScore[batch][token][entity] = prob;
          }
        });
        const spans = [];
        for (let batch = 0; batch < batchSize; batch++) {
          let batchSpans = [];
          for (let [start, clsSt] of selectedStarts[batch]) {
            for (let [end, clsEd] of selectedEnds[batch]) {
              if (end >= start && clsSt === clsEd) {
                const insideSpanScores = insideScore[batch].slice(start, end + 1).map((tokenScores) => tokenScores[clsSt]);
                if (insideSpanScores.some((score) => score < threshold)) continue;
                const spanScore = insideSpanScores.reduce((a, b) => a + b, 0) / insideSpanScores.length;
                let startIdx = batchWordsStartIdx[batch][start];
                let endIdx = batchWordsEndIdx[batch][end];
                let spanText = texts[batchIds[batch]].slice(startIdx, endIdx);
                batchSpans.push([spanText, startIdx, endIdx, idToClass[clsSt + 1], spanScore]);
              }
            }
          }
          spans.push(batchSpans);
        }
        const allSelectedSpans = [];
        spans.forEach((resI, id) => {
          const selectedSpans = this.greedySearch(resI, flatNer, multiLabel);
          allSelectedSpans.push(selectedSpans);
        });
        return allSelectedSpans;
      }
    };
    ONNX_WASM_CDN_URL = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.19.2/dist/";
    DEFAULT_WASM_PATHS = ONNX_WASM_CDN_URL;
    ONNXWebWrapper = class {
      constructor(settings) {
        this.settings = settings;
        __publicField(this, "ort", ort_CPU);
        __publicField(this, "session", null);
        const { executionProvider, wasmPaths = DEFAULT_WASM_PATHS } = settings;
        if (!executionProvider) {
          this.settings.executionProvider = "webgpu";
        }
        switch (this.settings.executionProvider) {
          case "cpu":
          case "wasm":
            break;
          case "webgpu":
            this.ort = ort_WEBGPU;
            break;
          case "webgl":
            this.ort = ort_WEBGL;
            break;
          default:
            throw new Error(`ONNXWrapper: Invalid execution provider: '${executionProvider}'`);
        }
        this.ort.env.wasm.wasmPaths = wasmPaths;
      }
      async init() {
        if (!this.session) {
          const { modelPath, executionProvider, fetchBinary, multiThread } = this.settings;
          if (executionProvider === "cpu" || executionProvider === "wasm") {
            if (fetchBinary) {
              const binaryURL = this.ort.env.wasm.wasmPaths + "ort-wasm-simd-threaded.wasm";
              const response = await fetch(binaryURL);
              const binary = await response.arrayBuffer();
              this.ort.env.wasm.wasmBinary = binary;
            }
            if (multiThread) {
              const maxPossibleThreads = navigator.hardwareConcurrency ?? 0;
              const maxThreads = Math.min(
                this.settings.maxThreads ?? maxPossibleThreads,
                maxPossibleThreads
              );
              this.ort.env.wasm.numThreads = maxThreads;
            }
          }
          this.session = await this.ort.InferenceSession.create(modelPath, {
            executionProviders: [executionProvider]
          });
        }
      }
      async run(feeds, options = {}) {
        if (!this.session) {
          throw new Error("ONNXWrapper: Session not initialized. Please call init() first.");
        }
        return await this.session.run(feeds, options);
      }
    };
    Gliner = class {
      constructor(config) {
        this.config = config;
        __publicField(this, "model", null);
        env.allowLocalModels = config.transformersSettings?.allowLocalModels ?? false;
        env.useBrowserCache = config.transformersSettings?.useBrowserCache ?? false;
        this.config = {
          ...config,
          maxWidth: config.maxWidth || 12,
          modelType: config.modelType || "span-level"
        };
      }
      async initialize() {
        const { tokenizerPath, onnxSettings, maxWidth } = this.config;
        const tokenizer = await AutoTokenizer.from_pretrained(tokenizerPath);
        const wordSplitter = new WhitespaceTokenSplitter();
        const onnxWrapper = new ONNXWebWrapper(onnxSettings);
        if (this.config.modelType == "span-level") {
          const processor = new SpanProcessor({ max_width: maxWidth }, tokenizer, wordSplitter);
          const decoder = new SpanDecoder({ max_width: maxWidth });
          this.model = new SpanModel({ max_width: maxWidth }, processor, decoder, onnxWrapper);
        } else {
          const processor = new TokenProcessor({ max_width: maxWidth }, tokenizer, wordSplitter);
          const decoder = new TokenDecoder({ max_width: maxWidth });
          this.model = new TokenModel({ max_width: maxWidth }, processor, decoder, onnxWrapper);
        }
        await this.model.initialize();
      }
      async inference({
        texts,
        entities,
        flatNer = true,
        threshold = 0.5,
        multiLabel = false
      }) {
        if (!this.model) {
          throw new Error("Model is not initialized. Call initialize() first.");
        }
        const result = await this.model.inference(texts, entities, flatNer, threshold, multiLabel);
        return this.mapRawResultToResponse(result);
      }
      async inference_with_chunking({
        texts,
        entities,
        flatNer = false,
        threshold = 0.5
      }) {
        if (!this.model) {
          throw new Error("Model is not initialized. Call initialize() first.");
        }
        const result = await this.model.inference_with_chunking(texts, entities, flatNer, threshold);
        return this.mapRawResultToResponse(result);
      }
      mapRawResultToResponse(rawResult) {
        const response = [];
        for (const individualResult of rawResult) {
          const entityResult = individualResult.map(
            ([spanText, start, end, label, score]) => ({
              spanText,
              start,
              end,
              label,
              score
            })
          );
          response.push(entityResult);
        }
        return response;
      }
    };
  }
});

// entry.js
var require_entry = __commonJS({
  "entry.js"() {
    init_dist2();
    var LABELS = [
      "person name",
      "address",
      "date of birth",
      "account number",
      "password",
      "email",
      "phone number"
    ];
    var THRESHOLD = 0.3;
    var WARM_RUNS = 20;
    function percentile(values, pct) {
      const s = [...values].sort((a, b) => a - b);
      const k = Math.max(0, Math.min(s.length - 1, Math.round(pct / 100 * (s.length - 1))));
      return s[k];
    }
    window.__glinerState = { model: null, backendUsed: null, coldLoadMs: null, initError: null };
    window.initGliner = async function initGliner(executionProvider) {
      const t0 = performance.now();
      try {
        const gliner = new Gliner({
          tokenizerPath: "onnx-community/gliner_multi_pii-v1",
          onnxSettings: {
            modelPath: "/models/model_int8.onnx",
            executionProvider,
            // "wasm" or "webgpu"
            wasmPaths: window.location.origin + "/node_modules/onnxruntime-web/dist/",
            multiThread: false
          },
          transformersSettings: {
            allowLocalModels: false,
            useBrowserCache: true
          },
          maxWidth: 12,
          modelType: "span-level"
        });
        await gliner.initialize();
        const t1 = performance.now();
        window.__glinerState.model = gliner;
        window.__glinerState.coldLoadMs = t1 - t0;
        window.__glinerState.backendUsed = executionProvider;
        return { ok: true, coldLoadMs: t1 - t0 };
      } catch (err) {
        window.__glinerState.initError = { message: String(err && err.message || err), stack: String(err && err.stack || "") };
        return { ok: false, error: window.__glinerState.initError };
      }
    };
    window.smokeTest = async function smokeTest(text) {
      const gliner = window.__glinerState.model;
      if (!gliner) throw new Error("gliner not initialized");
      const t0 = performance.now();
      const out = await gliner.inference({ texts: [text], entities: LABELS, threshold: THRESHOLD });
      const t1 = performance.now();
      return { ms: t1 - t0, spans: out[0] };
    };
    window.debugScores = async function debugScores(text, thresholdOverride) {
      const gliner = window.__glinerState.model;
      if (!gliner) throw new Error("gliner not initialized");
      const out = await gliner.inference({ texts: [text], entities: LABELS, threshold: thresholdOverride });
      return out[0];
    };
    window.runGlinerBench = async function runGlinerBench(fixtures) {
      const gliner = window.__glinerState.model;
      if (!gliner) throw new Error("gliner not initialized");
      const longest = fixtures.reduce((a, b) => b.text.length > a.text.length ? b : a);
      await gliner.inference({ texts: [longest.text], entities: LABELS, threshold: THRESHOLD });
      const results = [];
      for (const fx of fixtures) {
        const durations = [];
        let lastSpans = null;
        for (let i = 0; i < WARM_RUNS; i++) {
          const t0 = performance.now();
          const out = await gliner.inference({ texts: [fx.text], entities: LABELS, threshold: THRESHOLD });
          const t1 = performance.now();
          durations.push(t1 - t0);
          lastSpans = out[0];
        }
        const p50 = percentile(durations, 50);
        const p95 = percentile(durations, 95);
        const mean2 = durations.reduce((a, b) => a + b, 0) / durations.length;
        results.push({
          id: fx.id,
          text_len_chars: fx.text.length,
          warm_runs: WARM_RUNS,
          p50_ms: Math.round(p50 * 100) / 100,
          p95_ms: Math.round(p95 * 100) / 100,
          mean_ms: Math.round(mean2 * 100) / 100,
          min_ms: Math.round(Math.min(...durations) * 100) / 100,
          max_ms: Math.round(Math.max(...durations) * 100) / 100,
          spans: (lastSpans || []).map((s) => ({
            start: s.start,
            end: s.end,
            label: s.label,
            text: s.spanText,
            score: Math.round(s.score * 1e4) / 1e4
          }))
        });
      }
      return {
        backendUsed: window.__glinerState.backendUsed,
        coldLoadMs: window.__glinerState.coldLoadMs,
        results
      };
    };
  }
});
export default require_entry();
