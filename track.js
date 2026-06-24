/* track.js — first-party visitor analytics for missinglink.build
 * ---------------------------------------------------------------------------
 * Tiny, dependency-free. Posts small JSON beacons to /api/ev. No cookies set,
 * no third parties, ~2KB. Captures: pageview, engaged time, max scroll depth,
 * meaningful clicks, and notebook-card clicks (the conversion that matters).
 *
 * Drop this file next to index.html and add, just before </body>:
 *     <script src="track.js" defer></script>
 * (It already loads after the page, so `defer` is belt-and-suspenders.)
 * --------------------------------------------------------------------------- */
(function () {
  "use strict";

  // Build marker — bump on each deploy so you can verify which version is live:
  //   fetch('track.js?cb='+Date.now(),{cache:'no-store'}).then(r=>r.text()).then(t=>console.log(t.match(/TRACK_BUILD = "[^"]+"/)[0]))
  var TRACK_BUILD = "2026-06-24-pointerdown-apex";
  try { if (window && window.console) console.debug("[track.js] build", TRACK_BUILD); } catch (e) {}

  // Absolute apex host, NOT a relative path. The marketing page is served from
  // www.missinglink.build, but the worker that owns /api/ev answers cleanly
  // only on the apex (missinglink.build). A relative "/api/ev" from the www
  // page hits www, which 301-redirects to the apex — and browsers downgrade a
  // redirected POST to GET, so the beacon arrived as a GET and the handler
  // rejected it 405. Posting straight to the apex avoids the redirect. This is
  // cross-origin, so the worker sets permissive CORS headers on /api/ev.
  var ENDPOINT = "https://missinglink.build/api/ev";
  var MAX_CLICKS = 30;               // per page, to bound abuse/noise

  // ---- ids -----------------------------------------------------------------
  // sid: per-tab session (sessionStorage). vid: returning visitor (localStorage).
  // Wrapped in try/catch — private mode / blocked storage must not throw.
  function rid(p) {
    return p + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
  function get(store, key, prefix) {
    try {
      var v = store.getItem(key);
      if (!v) { v = rid(prefix); store.setItem(key, v); }
      return v;
    } catch (e) { return rid(prefix); }
  }
  var sid = get(sessionStorage, "ml_sid", "s_");
  var vid = get(localStorage, "ml_vid", "v_");

  // ---- transport -----------------------------------------------------------
  // sendBeacon survives page unload; fetch+keepalive is the fallback. We send a
  // plain JSON string (text/plain) so there's never a CORS preflight; the
  // worker parses it with req.json() regardless of content-type.
  function send(obj) {
    obj.sid = sid; obj.vid = vid;
    var s = JSON.stringify(obj);
    try {
      if (navigator.sendBeacon && navigator.sendBeacon(ENDPOINT, s)) return;
    } catch (e) {}
    try {
      // No credentials: this is now cross-origin (www page → apex worker) and
      // the studio_token cookie wouldn't be sent cross-site regardless, so
      // including credentials only adds strict credentialed-CORS requirements
      // for no benefit. Logged-in attribution still works for same-origin
      // pages (e.g. studio.html on the apex); the landing page is anonymous.
      fetch(ENDPOINT, { method: "POST", body: s, keepalive: true });
    } catch (e) {}
  }

  // ---- context (sent on the initial pageview) ------------------------------
  function refHost() {
    try {
      if (!document.referrer) return "";
      var u = new URL(document.referrer);
      if (u.host === location.host) return "";   // internal nav = not a referrer
      return u.host;
    } catch (e) { return ""; }
  }
  function utm() {
    var out = {}, p = new URLSearchParams(location.search);
    ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "ref", "gclid", "fbclid"].forEach(function (k) {
      var v = p.get(k); if (v) out[k] = v.slice(0, 120);
    });
    return out;
  }
  function device() {
    return /Mobi|Android.*Mobile|iPhone/i.test(navigator.userAgent)
      ? "mobile"
      : /iPad|Tablet|Android/i.test(navigator.userAgent) ? "tablet" : "desktop";
  }

  // ---- pageview ------------------------------------------------------------
  send({
    e: "pageview",
    p: location.pathname,
    r: refHost(),
    dv: device(),
    u: Object.assign({ vp: window.innerWidth + "x" + window.innerHeight }, utm())
  });

  // ---- scroll depth --------------------------------------------------------
  var maxScroll = 0, ticking = false;
  function measureScroll() {
    var doc = document.documentElement;
    var h = (doc.scrollHeight || document.body.scrollHeight) - window.innerHeight;
    var pct = h > 0 ? Math.round(((window.scrollY || doc.scrollTop) / h) * 100) : 100;
    if (pct > maxScroll) maxScroll = Math.min(100, pct);
    ticking = false;
  }
  window.addEventListener("scroll", function () {
    if (!ticking) { ticking = true; requestAnimationFrame(measureScroll); }
  }, { passive: true });
  measureScroll();

  // ---- engaged time --------------------------------------------------------
  // Accumulate ms only while the tab is visible (so a backgrounded tab left
  // open for an hour doesn't read as an hour of attention).
  var engaged = 0, lastTick = Date.now(), visible = !document.hidden;
  function flushTime() {
    if (visible) { engaged += Date.now() - lastTick; }
    lastTick = Date.now();
  }

  // ---- clicks --------------------------------------------------------------
  var clickCount = 0, lastClickSig = "", lastClickAt = 0;

  function label(el) {
    if (el.getAttribute && el.getAttribute("data-track")) return el.getAttribute("data-track").slice(0, 80);
    var txt = (el.innerText || el.textContent || "").trim().replace(/\s+/g, " ");
    if (txt) return txt.slice(0, 80);
    if (el.getAttribute && el.getAttribute("aria-label")) return el.getAttribute("aria-label").slice(0, 80);
    var tag = (el.tagName || "el").toLowerCase();
    return tag + (el.id ? "#" + el.id : "") + (el.className && typeof el.className === "string" ? "." + el.className.split(" ")[0] : "");
  }

  function notebookName(card) {
    var h = card.querySelector && card.querySelector("h3");
    if (h && h.textContent) return h.textContent.trim().slice(0, 120);
    var t = label(card);
    return t.slice(0, 120);
  }

  // Notebook conversion capture. Returns true if `el` (or an ancestor) is a
  // notebook card/link and a beacon was sent. The conversion is the metric that
  // matters here, and clicking a notebook card navigates to Colab IMMEDIATELY —
  // a same-document unload that can cut off a beacon fired on the `click` event.
  // So we fire on `pointerdown` (and `touchstart`), which happen a beat BEFORE
  // the click completes and before navigation starts, guaranteeing the beacon
  // is away. A short dedupe stops pointerdown + the following click (or a
  // pointerdown immediately followed by touchstart on some devices) from
  // double-sending the same conversion.
  var lastNbSig = "", lastNbAt = 0;
  function maybeNotebook(startEl) {
    if (!startEl || !startEl.closest) return false;
    var el = startEl.closest("a, .hp-nb-card");
    if (!el) return false;
    var href = el.getAttribute ? (el.getAttribute("href") || "") : "";
    var isNotebook = el.classList && el.classList.contains("hp-nb-card");
    if (!isNotebook && href && (/colab\.research\.google\.com/i.test(href) || /\.ipynb($|\?)/i.test(href))) {
      isNotebook = true;
    }
    if (!isNotebook) return false;
    var card = (el.classList && el.classList.contains("hp-nb-card")) ? el : el.closest(".hp-nb-card") || el;
    var nb = notebookName(card);
    var sig = nb + "|" + href;
    var nowt = Date.now();
    if (sig === lastNbSig && nowt - lastNbAt < 1500) return true; // already sent for this interaction
    lastNbSig = sig; lastNbAt = nowt;
    send({ e: "notebook", p: location.pathname, nb: nb, h: href.slice(0, 512) });
    return true;
  }

  // Earliest reliable signals — fire the conversion before navigation begins.
  document.addEventListener("pointerdown", function (ev) { maybeNotebook(ev.target); }, true);
  document.addEventListener("touchstart", function (ev) { maybeNotebook(ev.target); }, { capture: true, passive: true });

  document.addEventListener("click", function (ev) {
    var t = ev.target;
    if (!t || !t.closest) return;
    var el = t.closest("a, button, [role=button], input[type=submit], .hp-chip, .hp-nb-card, [data-track]");
    if (!el) return;

    var href = el.getAttribute ? (el.getAttribute("href") || "") : "";

    // Notebook conversion — fallback if pointerdown didn't catch it (e.g.
    // keyboard activation). maybeNotebook's dedupe prevents a double-send when
    // pointerdown already fired.
    if (maybeNotebook(t)) return;

    // Generic meaningful click — capped + de-duped against rapid repeats.
    if (clickCount >= MAX_CLICKS) return;
    var sig = label(el) + "|" + href;
    var nowt = Date.now();
    if (sig === lastClickSig && nowt - lastClickAt < 800) return;
    lastClickSig = sig; lastClickAt = nowt;
    clickCount++;
    send({ e: "click", p: location.pathname, t: label(el), h: href.slice(0, 512) });
  }, true);

  // ---- exit (one per page) -------------------------------------------------
  // Sent on the first time the page is hidden or unloaded. Guarded so we emit a
  // single exit row per pageview (the server SUMs dwell across rows, so two
  // exits would double-count). Bounces — the whole point here — close the tab,
  // which reliably fires pagehide once.
  var sentExit = false;
  function sendExit() {
    if (sentExit) return;
    sentExit = true;
    flushTime();
    send({ e: "exit", p: location.pathname, sc: maxScroll, d: Math.min(engaged, 86400000) });
  }
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) { flushTime(); visible = false; sendExit(); }
    else { visible = true; lastTick = Date.now(); }
  });
  window.addEventListener("pagehide", sendExit);
  // Safari/iOS sometimes skips pagehide on real unload — belt-and-suspenders.
  window.addEventListener("beforeunload", sendExit);
})();
