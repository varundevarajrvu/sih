/* Dhristi showcase — progressive enhancement only.
   With this file absent the page is fully readable: the reveal animation is
   gated on the .js class set inline in <head>, the console replay is already
   fully rendered in the markup (this only re-plays it), and the ID-card
   reveal is a pure CSS checkbox toggle with no handler here at all. */

(function () {
  "use strict";

  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ------------------------------ MOBILE NAV ------------------------------ */
  var menuBtn   = document.getElementById("menuBtn");
  var menuClose = document.getElementById("menuClose");
  var mobileNav = document.getElementById("mobileNav");

  function setMenu(open) {
    if (!mobileNav || !menuBtn) return;
    mobileNav.hidden = !open;
    menuBtn.setAttribute("aria-expanded", String(open));
    document.body.style.overflow = open ? "hidden" : "";
    if (open) {
      var first = mobileNav.querySelector("a, button");
      if (first) first.focus();
    } else {
      menuBtn.focus();
    }
  }

  if (menuBtn)   menuBtn.addEventListener("click", function () { setMenu(true); });
  if (menuClose) menuClose.addEventListener("click", function () { setMenu(false); });
  if (mobileNav) {
    mobileNav.addEventListener("click", function (e) {
      if (e.target.closest("a")) setMenu(false);
    });
  }
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && mobileNav && !mobileNav.hidden) setMenu(false);
  });
  window.addEventListener("resize", function () {
    if (window.innerWidth > 767 && mobileNav && !mobileNav.hidden) setMenu(false);
  });

  /* ---------------------------- CONSOLE REPLAY ---------------------------- */
  /* The lines are in the markup and visible by default. Pressing Replay hides
     them and re-reveals them in sequence — so a visitor without JS, or with
     reduced motion, simply reads the finished log. */
  var body   = document.getElementById("terminal-body");
  var play   = document.getElementById("replay-play");
  var skip   = document.getElementById("replay-skip");
  var cursor = document.getElementById("term-cursor");

  if (body && play) {
    var lines = Array.prototype.slice.call(body.querySelectorAll(".term-line"));
    var timer = null;

    function finish() {
      if (timer) { clearTimeout(timer); timer = null; }
      lines.forEach(function (l) { l.classList.remove("is-pending"); });
      if (cursor) cursor.classList.add("is-hidden");
      if (skip) skip.hidden = true;
      play.disabled = false;
      play.textContent = "Replay ▸";
    }

    function run() {
      if (reduced) return;                 // nothing to animate
      play.disabled = true;
      play.textContent = "Replaying…";
      if (skip) skip.hidden = false;
      if (cursor) cursor.classList.remove("is-hidden");
      lines.forEach(function (l) { l.classList.add("is-pending"); });

      var i = 0;
      (function step() {
        if (i >= lines.length) { finish(); return; }
        lines[i].classList.remove("is-pending");
        // Dividers and blanks flash past; real log lines get a readable beat.
        var delay = lines[i].classList.contains("divider") ? 90 : 190;
        i++;
        timer = setTimeout(step, delay);
      })();
    }

    play.addEventListener("click", run);
    if (skip) skip.addEventListener("click", finish);
  }

  /* ------------------------------ LIVE PROOF ------------------------------ */
  /* Polls the local server's counts-only feed. Everything about this degrades
     to "offline": no server, a deployed page blocked by mixed content, a
     firewall — all land in the same place, a panel that plainly says it has
     nothing rather than inventing something. */
  (function liveProof() {
    var panel  = document.getElementById("live-panel");
    var rows   = document.getElementById("live-rows");
    var statusText = document.getElementById("live-status-text");
    if (!panel || !rows || !statusText) return;

    var ENDPOINT = "http://127.0.0.1:8000/recent";
    var FAST = 2000;    // polling while the section is on screen
    var SLOW = 15000;   // backed off after repeated failures
    var timer = null, inView = false, misses = 0, lastSeq = 0;

    function setState(cls, text) {
      panel.classList.remove("is-live", "is-waiting", "is-offline");
      panel.classList.add(cls);
      statusText.textContent = text;
    }

    function esc(s) {
      return String(s).replace(/[&<>"]/g, function (c) {
        return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
      });
    }

    function render(entries) {
      if (!entries.length) {
        rows.innerHTML = '<tr class="live-empty"><td colspan="7">' +
          "Connected — waiting for the first request. Run the agent loop." +
          "</td></tr>";
        return;
      }
      var html = entries.map(function (e) {
        var isNew = e.seq > lastSeq;
        var time = e.at.slice(11, 19);
        var types = e.regionTypes && e.regionTypes.length ? e.regionTypes.join(" · ") : "—";
        return '<tr class="' + (isNew ? "live-row-new" : "") + '">' +
          '<td><span class="live-seq">#' + esc(e.seq) + "</span> " + esc(time) + "</td>" +
          "<td>" + esc(e.domNodes) + "</td>" +
          "<td>" + esc(e.sensitiveNodes) + "</td>" +
          "<td>" + esc(e.redactedRegions) +
            ' <span class="dim">(' + esc(e.domSourced) + " dom + " + esc(e.visionSourced) + " vision)</span></td>" +
          '<td class="live-types">' + esc(types) + "</td>" +
          "<td>" + esc(e.action) + "</td>" +
          '<td class="live-pass">' + esc(e.leakCheck) + "</td>" +
          "</tr>";
      }).join("");
      rows.innerHTML = html;
      lastSeq = Math.max.apply(null, entries.map(function (e) { return e.seq; }));
    }

    function schedule() {
      if (timer) clearTimeout(timer);
      if (!inView) return;
      timer = setTimeout(poll, misses >= 3 ? SLOW : FAST);
    }

    function poll() {
      if (!inView) return;
      // AbortController keeps a hung request from stacking up behind the timer.
      var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
      var killer = setTimeout(function () { if (ctrl) ctrl.abort(); }, 1800);

      fetch(ENDPOINT, { signal: ctrl ? ctrl.signal : undefined, cache: "no-store" })
        .then(function (r) { if (!r.ok) throw new Error("bad status"); return r.json(); })
        .then(function (data) {
          clearTimeout(killer);
          misses = 0;
          var entries = (data && data.entries) || [];
          setState(entries.length ? "is-live" : "is-waiting",
            entries.length ? "Live — " + entries.length + " recent request" + (entries.length === 1 ? "" : "s")
                           : "Connected — no requests yet");
          render(entries);
          schedule();
        })
        .catch(function () {
          clearTimeout(killer);
          misses++;
          setState("is-offline", "Server not reachable at 127.0.0.1:8000 — start it to see live requests");
          if (misses === 1) {
            rows.innerHTML = '<tr class="live-empty"><td colspan="7">' +
              "This panel only fills in while the local server is running and the extension is " +
              "working. It has nothing to show otherwise, and does not pretend to." +
              "</td></tr>";
          }
          schedule();
        });
    }

    // Only poll while the section is actually on screen.
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (entries) {
        inView = entries[0].isIntersecting;
        if (inView) poll();
        else if (timer) { clearTimeout(timer); timer = null; }
      }, { threshold: 0.05 }).observe(panel);
    } else {
      inView = true;
      poll();
    }
  })();

  /* ----------------------------- SCROLL REVEAL ---------------------------- */
  var targets = document.querySelectorAll(".reveal");

  if (reduced || !("IntersectionObserver" in window)) {
    for (var i = 0; i < targets.length; i++) targets[i].classList.add("is-in");
    return;
  }

  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (!entry.isIntersecting) return;
      entry.target.classList.add("is-in");
      io.unobserve(entry.target);
    });
  }, { rootMargin: "0px 0px -10% 0px", threshold: 0.06 });

  targets.forEach(function (el) { io.observe(el); });
})();
