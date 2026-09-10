/* MissingLink product activity tracer v2.
   Interaction telemetry only: never sends arbitrary typed field text. */
(function(){
  'use strict';
  if (window.__mlActivityTracerV2) return;
  window.__mlActivityTracerV2 = true;

  const META = document.querySelector('meta[name="ml-design-version"]');
  const DESIGN_VERSION = (META && META.content) || document.documentElement.getAttribute('data-design-version') || 'unknown';
  // Always post directly to the apex Worker. A relative POST from www.missinglink.build
  // can be redirected to the apex and lose its method/body during navigation.
  const ENDPOINT = 'https://missinglink.build/api/activity';
  const MAX_BATCH = 24;
  const FLUSH_MS = 5000;
  const ACTIVE_WINDOW_MS = 60000;
  const HEARTBEAT_MS = 15000;
  const MAX_META_STRING = 240;

  function rid(prefix){
    try { return prefix + crypto.randomUUID(); }
    catch (_) { return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2,12); }
  }
  function stored(storage, key, prefix){
    try {
      let v = storage.getItem(key);
      if (!v) { v = rid(prefix); storage.setItem(key, v); }
      return v;
    } catch (_) { return rid(prefix); }
  }
  // Reuse the IDs already established by track.js so site_events and
  // product_activity describe the SAME anonymous visitor/session. This is what
  // lets the admin export join basic traffic with rich interaction telemetry.
  const SESSION_ID = stored(sessionStorage, 'ml_sid', 's_');
  const VISITOR_ID = stored(localStorage, 'ml_vid', 'v_');
  let queue = [];
  let flushing = false;
  let lastInteraction = Date.now();
  let totalActiveMs = 0;
  let maxScrollPct = 0;
  let clickWindow = [];
  const focusStarts = new WeakMap();
  const dirtyFields = new WeakSet();
  const sectionStarts = new Map();

  const trunc = (v, n=MAX_META_STRING) => String(v == null ? '' : v).replace(/\s+/g,' ').trim().slice(0,n);
  function safeMeta(meta){
    const out = {};
    if (!meta || typeof meta !== 'object') return out;
    Object.keys(meta).slice(0,24).forEach(k => {
      let v = meta[k];
      if (v == null || typeof v === 'boolean' || typeof v === 'number') out[k] = v;
      else if (Array.isArray(v)) out[k] = v.slice(0,12).map(x => typeof x === 'string' ? trunc(x,100) : x);
      else if (typeof v === 'string') out[k] = trunc(v);
    });
    return out;
  }
  function currentSurface(){
    try {
      const b = document.body;
      const declared = document.querySelector('meta[name="ml-surface"]');
      if (declared && declared.content) return trunc(declared.content,80);
      if (b && b.dataset && b.dataset.surface) return trunc(b.dataset.surface,80);
      if (b && b.classList.contains('mode-create')) return 'studio:create';
      if (b && b.classList.contains('mode-batch')) return 'studio:batch';
      if (b && b.classList.contains('mode-edit')) return 'studio:edit';
      if (b && b.classList.contains('mode-camera')) return 'studio:camera';
      const active = document.querySelector('.mode-btn.active');
      if (active) return 'studio:' + trunc(active.textContent,40).toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'');
      const p = (location.pathname || '/').replace(/^\/+|\/+$/g,'');
      if (!p || p === 'index.html') return 'marketing:home';
      return 'site:' + p.replace(/\.html$/i,'').replace(/[^a-z0-9]+/gi,'_').toLowerCase();
    } catch (_) {}
    return 'site';
  }
  function safePath(raw){
    try {
      const u = new URL(raw || location.href, location.href);
      return u.origin === location.origin ? u.pathname : u.origin + u.pathname;
    } catch (_) { return location.pathname; }
  }
  function targetName(el){
    if (!el) return '';
    const id = el.id ? '#' + el.id : '';
    if (id) return id.slice(0,120);
    const aria = el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('name'));
    if (aria) return trunc(aria,120);
    const cls = el.classList ? Array.from(el.classList).filter(c => !/^(active|open|selected|busy|loading|error|disabled|hidden)$/.test(c)).slice(0,3).join('.') : '';
    if (cls) return (el.tagName.toLowerCase() + '.' + cls).slice(0,120);
    const text = trunc(el.textContent,80);
    if (text && !/@/.test(text)) return text;
    return (el.tagName || 'element').toLowerCase();
  }
  function fieldName(el){
    if (!el) return '';
    return trunc(el.id || el.name || el.getAttribute('aria-label') || el.type || el.tagName,120);
  }
  function event(eventName, extra){
    const x = extra || {};
    const row = {
      event: trunc(eventName,80),
      surface: trunc(x.surface || currentSurface(),80),
      action: trunc(x.action || '',100),
      target: trunc(x.target || '',160),
      path: safePath(x.path || location.href),
      design_version: DESIGN_VERSION,
      session_id: SESSION_ID,
      visitor_id: VISITOR_ID,
      active_ms: Number.isFinite(x.active_ms) ? Math.max(0, Math.round(x.active_ms)) : 0,
      meta: safeMeta(x.meta || {})
    };
    queue.push(row);
    if (queue.length >= MAX_BATCH) flush(false);
  }
  window.mlActivityContext = function(){ return { session_id: SESSION_ID, visitor_id: VISITOR_ID, design_version: DESIGN_VERSION }; };
  window.mlTrackActivity = event;

  async function flush(finalFlush){
    if (flushing || !queue.length) return;
    const batch = queue.splice(0, MAX_BATCH);
    flushing = true;
    try {
      await fetch(ENDPOINT, {
        method: 'POST',
        // Include the Studio cookie only when already on the apex. On www the
        // request is cross-origin and anonymous attribution still works via vid.
        credentials: location.hostname === 'missinglink.build' ? 'include' : 'omit',
        keepalive: !!finalFlush,
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({events: batch})
      });
    } catch (_) {
      if (!finalFlush) queue = batch.concat(queue).slice(-200);
    } finally {
      flushing = false;
      if (!finalFlush && queue.length >= MAX_BATCH) setTimeout(() => flush(false), 25);
    }
  }
  setInterval(() => flush(false), FLUSH_MS);

  function markInteraction(){ lastInteraction = Date.now(); }
  ['pointerdown','keydown','wheel','touchstart'].forEach(t => addEventListener(t, markInteraction, {capture:true, passive:true}));
  addEventListener('scroll', function(){
    markInteraction();
    const d = document.documentElement;
    const denom = Math.max(1, d.scrollHeight - innerHeight);
    maxScrollPct = Math.max(maxScrollPct, Math.min(100, Math.round((scrollY / denom) * 100)));
  }, {passive:true});

  // Active-time heartbeat excludes long-idle/background tabs.
  setInterval(function(){
    if (!document.hidden && document.hasFocus() && Date.now() - lastInteraction < ACTIVE_WINDOW_MS) {
      totalActiveMs += HEARTBEAT_MS;
      event('active_heartbeat', {active_ms: HEARTBEAT_MS});
    }
  }, HEARTBEAT_MS);

  document.addEventListener('click', function(e){
    const el = e.target && e.target.closest ? e.target.closest('button,a,[role="button"],select,input[type="checkbox"],input[type="radio"],[data-action]') : null;
    if (!el) return;
    const target = targetName(el);
    const meta = { tag: (el.tagName || '').toLowerCase() };
    if (el.tagName === 'A') meta.href = safePath(el.href || el.getAttribute('href') || '');
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') meta.disabled = true;
    event('click', {action:'activate', target, meta});

    const now = Date.now();
    clickWindow = clickWindow.filter(x => now - x.at < 1600);
    clickWindow.push({target, at: now});
    const same = clickWindow.filter(x => x.target === target);
    if (same.length >= 3) {
      event('rage_click', {action:'repeat_activate', target, meta:{clicks:same.length, window_ms:1600}});
      clickWindow = clickWindow.filter(x => x.target !== target);
    }
  }, true);

  document.addEventListener('change', function(e){
    const el = e.target;
    if (!el || !el.matches || !el.matches('select,input')) return;
    const meta = { field: fieldName(el), type: trunc(el.type || el.tagName,40) };
    if (el.matches('select')) meta.value = trunc(el.value,120);
    else if (el.type === 'checkbox' || el.type === 'radio') meta.checked = !!el.checked;
    else if (el.type === 'range') meta.value = Number(el.value);
    // Never emit text/email/password/textarea values.
    event('control_change', {action:'change', target:fieldName(el), meta});
  }, true);

  document.addEventListener('input', function(e){
    const el = e.target;
    if (el && el.matches && el.matches('input,textarea')) dirtyFields.add(el);
  }, true);
  document.addEventListener('focusin', function(e){
    const el = e.target;
    if (el && el.matches && el.matches('input,textarea,select')) focusStarts.set(el, Date.now());
  }, true);
  document.addEventListener('focusout', function(e){
    const el = e.target;
    if (!el || !el.matches || !el.matches('input,textarea,select')) return;
    const started = focusStarts.get(el);
    if (!started) return;
    const ms = Date.now() - started;
    const meta = {field:fieldName(el), type:trunc(el.type || el.tagName,40), dirty:dirtyFields.has(el)};
    if (el.matches('textarea,input[type="text"],input[type="search"]')) meta.chars = String(el.value || '').length;
    event('field_dwell', {action:'focus', target:fieldName(el), active_ms:ms, meta});
    focusStarts.delete(el);
  }, true);

  function sectionLabel(el){
    const label = el.querySelector && el.querySelector('.sec-label,.history-modal-title,.gallery-modal-title,h1,h2,h3,[aria-label]');
    const t = label && (label.getAttribute && label.getAttribute('aria-label') || label.textContent);
    return trunc(t || el.id || (el.className && String(el.className).split(/\s+/)[0]) || 'section',100);
  }
  function endSection(el, reason){
    const rec = sectionStarts.get(el);
    if (!rec) return;
    sectionStarts.delete(el);
    const ms = Date.now() - rec.at;
    if (ms >= 1200) event('section_dwell', {action:'view', target:rec.label, active_ms:ms, meta:{reason:reason||'left'}});
  }
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(entries => entries.forEach(en => {
      if (en.isIntersecting && en.intersectionRatio >= .5 && !document.hidden) {
        if (!sectionStarts.has(en.target)) sectionStarts.set(en.target,{at:Date.now(),label:sectionLabel(en.target)});
      } else endSection(en.target,'left_view');
    }), {threshold:[0,.5]});
    document.querySelectorAll('[data-track-section], main section, .sec, .history-modal-panel, .share-dialog-panel, .profile-dialog-panel').forEach(el => io.observe(el));
  }

  // Runtime failures are high-signal confusion/friction events.
  addEventListener('error', function(e){
    event('js_error', {action:'runtime_error', target:safePath(e.filename || location.href), meta:{message:trunc(e.message,180), line:e.lineno||0, col:e.colno||0}});
  });
  addEventListener('unhandledrejection', function(e){
    event('js_error', {action:'unhandled_rejection', meta:{message:trunc(e.reason && (e.reason.message || e.reason),180)}});
  });

  // Track mutating API calls and failed reads without inspecting request bodies.
  const rawFetch = window.fetch.bind(window);
  window.fetch = async function(input, init){
    const started = performance.now();
    const method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    const path = safePath(url || location.href);
    if (path === ENDPOINT) return rawFetch(input, init);
    try {
      const resp = await rawFetch(input, init);
      const ms = Math.round(performance.now() - started);
      if (method !== 'GET' || resp.status >= 400) {
        event(resp.ok ? 'api_action' : 'api_error', {action:method, target:path, meta:{status:resp.status, duration_ms:ms}});
      }
      return resp;
    } catch (err) {
      const ms = Math.round(performance.now() - started);
      event('api_error', {action:method, target:path, meta:{status:0, duration_ms:ms, message:trunc(err && (err.message || err),160)}});
      throw err;
    }
  };

  // Surface visible error/toast messages generated by the UI. Text is capped and
  // only collected from elements explicitly styled/labelled as error state.
  if ('MutationObserver' in window) {
    const seen = new WeakSet();
    const mo = new MutationObserver(muts => {
      for (const m of muts) for (const n of m.addedNodes || []) {
        if (!n || n.nodeType !== 1) continue;
        const candidates = [];
        if (n.matches && n.matches('.notif-error,.error,.size-warn,[role="alert"]')) candidates.push(n);
        if (n.querySelectorAll) candidates.push(...n.querySelectorAll('.notif-error,.error,.size-warn,[role="alert"]'));
        candidates.slice(0,8).forEach(el => {
          if (seen.has(el)) return; seen.add(el);
          const txt = trunc(el.textContent,180);
          event('ui_error', {action:'shown', target:targetName(el), meta:{message:txt}});
        });
      }
    });
    mo.observe(document.body, {subtree:true, childList:true});
  }

  function finishSession(reason){
    sectionStarts.forEach((_, el) => endSection(el,reason));
    event('session_exit', {action:reason, meta:{active_ms_total:totalActiveMs, max_scroll_pct:maxScrollPct}});
    flush(true);
  }
  document.addEventListener('visibilitychange', function(){
    if (document.hidden) {
      sectionStarts.forEach((_, el) => endSection(el,'hidden'));
      flush(true);
    }
  });
  addEventListener('pagehide', function(){ finishSession('pagehide'); }, {capture:true});

  event('page_view', {action:'view', target:document.title, meta:{referrer:safePath(document.referrer || ''), viewport_w:innerWidth, viewport_h:innerHeight}});
})();
