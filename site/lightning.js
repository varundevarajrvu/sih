/* Dhristi — ambient WebGL lightning background.
 *
 * Translated from a React/Framer-Motion reference component into raw WebGL,
 * because this site has no build step and no framework by design. Every
 * documented value carries over 1:1: hue 220, xOffset 0, speed 1.6,
 * intensity 0.6, size 2 — the invocation values, not the component defaults.
 *
 * Uniform names are kept exactly as specified (iResolution, iTime, uHue,
 * uXOffset, uSpeed, uIntensity, uSize) so this stays diff-able against the
 * reference shader.
 *
 * TWO BEHAVIOURS THE REFERENCE DID NOT HAVE, both deliberate:
 *   - The loop pauses when the hero scrolls out of view. A continuous GPU
 *     shader you cannot see is pure battery drain, and this page is long.
 *   - prefers-reduced-motion stops the loop outright rather than slowing it:
 *     one frame is rendered so the hero is not empty, then rAF is never
 *     scheduled again.
 *
 * Failure is silent and total: no WebGL context, a shader that will not
 * compile, a lost context — all end with the canvas hidden and the hero
 * falling back to its flat background. An ambient decoration must never be
 * the reason a page about privacy fails to render.
 */

(function () {
  "use strict";

  var canvas = document.getElementById("hero-canvas");
  if (!canvas) return;

  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // --- invocation values (component defaults differ; these are the ones used)
  var HUE       = 220.0;
  var X_OFFSET  = 0.0;
  var SPEED     = 1.6;
  var INTENSITY = 0.6;
  var SIZE      = 2.0;

  var VERT = [
    "attribute vec2 aPosition;",
    "void main() { gl_Position = vec4(aPosition, 0.0, 1.0); }"
  ].join("\n");

  var FRAG = [
    "precision mediump float;",
    "uniform vec2  iResolution;",
    "uniform float iTime;",
    "uniform float uHue;",
    "uniform float uXOffset;",
    "uniform float uSpeed;",
    "uniform float uIntensity;",
    "uniform float uSize;",
    "",
    "#define OCTAVE_COUNT 10",
    "",
    "vec3 hsv2rgb(vec3 c) {",
    "  vec3 rgb = clamp(abs(mod(c.x * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);",
    "  return c.z * mix(vec3(1.0), rgb, c.y);",
    "}",
    "",
    "float hash11(float p) {",
    "  p = fract(p * 0.1031);",
    "  p *= p + 33.33;",
    "  p *= p + p;",
    "  return fract(p);",
    "}",
    "",
    "float hash12(vec2 p) {",
    "  vec3 p3 = fract(vec3(p.xyx) * 0.1031);",
    "  p3 += dot(p3, p3.yzx + 33.33);",
    "  return fract((p3.x + p3.y) * p3.z);",
    "}",
    "",
    "mat2 rotate2d(float theta) {",
    "  float c = cos(theta);",
    "  float s = sin(theta);",
    "  return mat2(c, -s, s, c);",
    "}",
    "",
    "float noise(vec2 p) {",
    "  vec2 ip = floor(p);",
    "  vec2 fp = fract(p);",
    "  float a = hash12(ip);",
    "  float b = hash12(ip + vec2(1.0, 0.0));",
    "  float c = hash12(ip + vec2(0.0, 1.0));",
    "  float d = hash12(ip + vec2(1.0, 1.0));",
    "  vec2 t = smoothstep(0.0, 1.0, fp);",
    "  return mix(mix(a, b, t.x), mix(c, d, t.x), t.y);",
    "}",
    "",
    "float fbm(vec2 p) {",
    "  float value = 0.0;",
    "  float amplitude = 0.5;",
    "  float frequency = 0.0;",
    "  for (int i = 0; i < OCTAVE_COUNT; ++i) {",
    "    value += amplitude * noise(p);",
    "    p = rotate2d(0.45) * p * 2.0;",
    "    amplitude *= 0.5;",
    "  }",
    "  return value;",
    "}",
    "",
    "void main() {",
    "  vec2 fragCoord = gl_FragCoord.xy;",
    "  vec2 uv = fragCoord / iResolution.xy;",
    "  uv = 2.0 * uv - 1.0;",
    "  uv.x *= iResolution.x / iResolution.y;",
    "  uv.x += uXOffset;",
    "",
    "  uv += 2.0 * fbm(uv * uSize + 0.8 * iTime * uSpeed) - 1.0;",
    "",
    "  float dist = abs(uv.x);",
    "  vec3 baseColor = hsv2rgb(vec3(uHue / 360.0, 0.7, 0.8));",
    "  vec3 col = baseColor * pow(mix(0.0, 0.07, hash11(iTime * uSpeed)) / dist, 1.0) * uIntensity;",
    "  col = pow(col, vec3(1.0));",
    "  gl_FragColor = vec4(col, 1.0);",
    "}"
  ].join("\n");

  function compile(gl, type, src) {
    var sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      gl.deleteShader(sh);
      return null;
    }
    return sh;
  }

  // Once this is set nothing may schedule another frame again. Without it, a
  // context loss hides the canvas but the IntersectionObserver happily calls
  // play() on the next scroll and spins rAF forever against a dead context —
  // invisible, and exactly the battery drain the pause logic exists to avoid.
  var dead = false;

  function fail() {
    dead = true;
    canvas.style.display = "none";
    document.documentElement.classList.add("no-shader");
  }

  var gl = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
  if (!gl) { fail(); return; }

  var vs = compile(gl, gl.VERTEX_SHADER, VERT);
  var fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) { fail(); return; }

  var prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { fail(); return; }
  gl.useProgram(prog);

  // Full-screen triangle pair.
  var buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
    -1, -1,  1, -1,  -1, 1,
    -1,  1,  1, -1,   1, 1
  ]), gl.STATIC_DRAW);
  var aPosition = gl.getAttribLocation(prog, "aPosition");
  gl.enableVertexAttribArray(aPosition);
  gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, 0, 0);

  var u = {
    iResolution: gl.getUniformLocation(prog, "iResolution"),
    iTime:       gl.getUniformLocation(prog, "iTime"),
    uHue:        gl.getUniformLocation(prog, "uHue"),
    uXOffset:    gl.getUniformLocation(prog, "uXOffset"),
    uSpeed:      gl.getUniformLocation(prog, "uSpeed"),
    uIntensity:  gl.getUniformLocation(prog, "uIntensity"),
    uSize:       gl.getUniformLocation(prog, "uSize")
  };

  gl.uniform1f(u.uHue, HUE);
  gl.uniform1f(u.uXOffset, X_OFFSET);
  gl.uniform1f(u.uSpeed, SPEED);
  gl.uniform1f(u.uIntensity, INTENSITY);
  gl.uniform1f(u.uSize, SIZE);

  // Capped DPR: at 2x on a wide hero this is a lot of fragment work for an
  // ambient background nobody is inspecting pixel-for-pixel.
  function resize() {
    var dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    var w = Math.max(1, Math.floor(canvas.clientWidth * dpr));
    var h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    gl.viewport(0, 0, canvas.width, canvas.height);
  }
  window.addEventListener("resize", resize);

  canvas.addEventListener("webglcontextlost", function (e) {
    e.preventDefault();
    running = false;
    fail();
  });

  var start = performance.now();
  var raf = null;
  var running = false;

  // Contrast verification hook. Text now sits over a MOVING background, which
  // no static contrast probe can cover — the bolt travels. This reads the real
  // drawing buffer immediately after a draw (so no preserveDrawingBuffer cost)
  // and reports the brightest pixel in a region, letting a test compute the
  // worst-case contrast the hero copy ever faces rather than the average one.
  var samplePending = null;

  function serviceSample() {
    if (!samplePending) return;
    var req = samplePending;
    samplePending = null;
    var x = Math.max(0, Math.floor(req.x));
    var y = Math.max(0, Math.floor(req.y));
    var w = Math.max(1, Math.min(Math.floor(req.w), canvas.width - x));
    var h = Math.max(1, Math.min(Math.floor(req.h), canvas.height - y));
    var px = new Uint8Array(w * h * 4);
    gl.readPixels(x, y, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    var maxLuma = 0, maxPixel = [0, 0, 0];
    for (var i = 0; i < px.length; i += 4) {
      // Relative luminance, sRGB-linearised — same formula the contrast probe
      // uses, so the two are directly comparable.
      var lin = function (v) {
        v /= 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      };
      var L = 0.2126 * lin(px[i]) + 0.7152 * lin(px[i + 1]) + 0.0722 * lin(px[i + 2]);
      if (L > maxLuma) { maxLuma = L; maxPixel = [px[i], px[i + 1], px[i + 2]]; }
    }
    req.resolve({ maxLuma: maxLuma, maxPixel: maxPixel });
  }

  function frame() {
    if (!running || dead) return;
    resize();
    // iResolution is refreshed every frame, not just at mount — the reference
    // is explicit about this and it is what keeps the aspect correction right
    // through a resize.
    gl.uniform2f(u.iResolution, canvas.width, canvas.height);
    gl.uniform1f(u.iTime, (performance.now() - start) / 1000);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    serviceSample();
    raf = requestAnimationFrame(frame);
  }

  function play() {
    if (running || reduced || dead) return;
    running = true;
    raf = requestAnimationFrame(frame);
  }
  function pause() {
    running = false;
    if (raf) { cancelAnimationFrame(raf); raf = null; }
  }

  // One static frame so the hero is never a flat void, then stop for good.
  if (reduced) {
    resize();
    gl.uniform2f(u.iResolution, canvas.width, canvas.height);
    gl.uniform1f(u.iTime, 0.0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    return;
  }

  // Pause when the hero is off-screen, and when the tab is hidden.
  var hero = document.querySelector(".hero");
  if (hero && "IntersectionObserver" in window) {
    new IntersectionObserver(function (entries) {
      if (entries[0].isIntersecting) play();
      else pause();
    }, { threshold: 0.01 }).observe(hero);
  } else {
    play();
  }

  document.addEventListener("visibilitychange", function () {
    if (document.hidden) pause();
    else if (hero && hero.getBoundingClientRect().bottom > 0) play();
  });

  // Exposed so the console-replay/debug can poke at it, and so a future
  // monochrome variant is a one-line change rather than an edit to the shader.
  window.__lightning = {
    setHue: function (h) { gl.useProgram(prog); gl.uniform1f(u.uHue, h); },
    setIntensity: function (i) { gl.useProgram(prog); gl.uniform1f(u.uIntensity, i); },
    pause: pause,
    play: play,
    isRunning: function () { return running; },
    // rect in CSS px relative to the canvas; resolves with the brightest pixel
    // drawn under it on the next rendered frame.
    sampleMaxLuma: function (rect) {
      return new Promise(function (resolve, reject) {
        if (!running || dead) { reject(new Error("shader not running")); return; }
        var sx = canvas.width / canvas.clientWidth;
        var sy = canvas.height / canvas.clientHeight;
        samplePending = {
          x: rect.x * sx,
          // WebGL's origin is bottom-left; CSS rects are top-left.
          y: (canvas.clientHeight - rect.y - rect.height) * sy,
          w: rect.width * sx,
          h: rect.height * sy,
          resolve: resolve
        };
      });
    }
  };
})();
