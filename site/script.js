/* ==========================================================================
   SIH 26171 showcase — progressive enhancement only.
   Every section this touches is already fully readable without this file.
   ========================================================================== */
(function () {
  'use strict';

  var reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  /* ---------------------------------------------------------------------
     Pipeline sequencer (§2) — highlights one stage at a time.
     Nothing is hidden; this only adds an "is-active" class + a readout.
     --------------------------------------------------------------------- */
  (function pipeline() {
    var wrap = document.getElementById('pipeline-nodes');
    var playBtn = document.getElementById('pipeline-play');
    var stepBtn = document.getElementById('pipeline-step');
    var readout = document.getElementById('pipeline-readout');
    if (!wrap || !playBtn || !readout) return;

    var nodes = Array.prototype.slice.call(wrap.querySelectorAll('.pipe-node'));
    if (!nodes.length) return;

    var index = -1;
    var timer = null;
    var STEP_MS = 2200;

    function messageFor(node) {
      var stage = node.getAttribute('data-stage') || '';
      var desc = node.querySelector('.pipe-desc');
      var text = desc ? desc.textContent.trim() : '';
      return 'Now — ' + stage.toUpperCase() + ': ' + text;
    }

    function setActive(i) {
      nodes.forEach(function (n) { n.classList.remove('is-active'); });
      index = ((i % nodes.length) + nodes.length) % nodes.length;
      var node = nodes[index];
      node.classList.add('is-active');
      readout.textContent = messageFor(node);
      node.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' });
    }

    function advance() { setActive(index + 1); }

    function play() {
      if (timer) return;
      playBtn.setAttribute('aria-pressed', 'true');
      playBtn.textContent = 'Pause';
      if (index === -1) advance();
      timer = window.setInterval(advance, STEP_MS);
    }

    function pause() {
      playBtn.setAttribute('aria-pressed', 'false');
      playBtn.textContent = 'Play sequence';
      if (timer) { window.clearInterval(timer); timer = null; }
    }

    playBtn.addEventListener('click', function () {
      if (timer) { pause(); } else { play(); }
    });

    if (stepBtn) {
      stepBtn.addEventListener('click', function () {
        pause();
        advance();
      });
    }
  }());

  /* ---------------------------------------------------------------------
     Console replay (§3) — stage-by-stage reveal of real log lines.
     Default state (before this ever runs) shows every line already;
     "Replay" re-plays it as a sequence, "Skip to end" jumps straight there.
     --------------------------------------------------------------------- */
  (function replay() {
    var body = document.getElementById('terminal-body');
    var playBtn = document.getElementById('replay-play');
    var skipBtn = document.getElementById('replay-skip');
    var cursor = document.getElementById('term-cursor');
    if (!body || !playBtn) return;

    var lines = Array.prototype.slice.call(body.querySelectorAll('.term-line'));
    if (!lines.length) return;

    var playing = false;
    var timers = [];

    function clearTimers() {
      timers.forEach(function (t) { window.clearTimeout(t); });
      timers = [];
    }

    function finish() {
      lines.forEach(function (l) { l.classList.remove('is-hidden'); });
      if (cursor) cursor.classList.add('is-hidden');
      playing = false;
      playBtn.disabled = false;
      playBtn.textContent = 'Replay ▶';
      if (skipBtn) skipBtn.hidden = true;
      clearTimers();
    }

    function run() {
      clearTimers();
      lines.forEach(function (l) { l.classList.add('is-hidden'); });
      if (cursor) cursor.classList.remove('is-hidden');
      playing = true;
      playBtn.disabled = true;
      playBtn.textContent = 'Replaying…';
      if (skipBtn) skipBtn.hidden = false;

      var delay = reduceMotion ? 0 : 90;
      lines.forEach(function (line, i) {
        var t = window.setTimeout(function () {
          line.classList.remove('is-hidden');
          body.scrollTop = body.scrollHeight;
          if (i === lines.length - 1) finish();
        }, delay * i);
        timers.push(t);
      });
    }

    playBtn.addEventListener('click', function () {
      if (!playing) run();
    });

    if (skipBtn) {
      skipBtn.addEventListener('click', finish);
    }
  }());
}());
