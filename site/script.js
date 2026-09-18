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
