// ── Traffic / visitor analytics ─────────────────────────────────
// Reads the gated /api/studio/admin/traffic/* endpoints. Mirrors the
// Stats view's structure (controls + summary cards + tables) and adds a
// per-day engaged/bounced chart, a notebook leaderboard, a paginated
// "recent visitors" table, and a per-session event timeline.

var TRAFFIC_PAGE = 40;

function tgFlag(cc) {
  if (!cc || cc.length !== 2 || cc === '??') return '🌐';
  var A = 0x1F1E6, base = 65;
  var u = cc.toUpperCase();
  try {
    return String.fromCodePoint(A + (u.charCodeAt(0) - base)) +
           String.fromCodePoint(A + (u.charCodeAt(1) - base));
  } catch (e) { return '🌐'; }
}
function tgGeo(r) {
  var bits = [];
  if (r.city) bits.push(r.city);
  if (r.region && !r.city) bits.push(r.region);
  if (r.country) bits.push(r.country);
  return bits.join(', ') || '—';
}
function tgPct(n, d) { return d > 0 ? Math.round((n / d) * 100) : 0; }

async function loadTraffic() {
  if (state.loading) return;
  state.loading = true;
  state.trafficDetail = null;
  renderLoader();
  try {
    var data = await api('/api/studio/admin/traffic/overview?days=' + encodeURIComponent(state.trafficDays));
    state.traffic = data;
    var t = data.totals || {};
    $('#stat-total').innerHTML = '<b>' + (t.sessions || 0).toLocaleString() + '</b> visitor' +
      ((t.sessions === 1) ? '' : 's') + ' / ' + data.days + 'd';
  } catch (e) {
    renderError(e.message); state.loading = false; return;
  }
  state.loading = false;
  // Reset + load the first page of sessions, then render once.
  state.trafficSessions = [];
  state.trafficBefore = 0;
  state.trafficDone = false;
  await loadTrafficSessions(true, true);
  renderTrafficView();
}

async function loadTrafficSessions(reset, silent) {
  if (state.trafficSessLoading) return;
  state.trafficSessLoading = true;
  if (reset) { state.trafficSessions = []; state.trafficBefore = 0; state.trafficDone = false; }
  try {
    var qs = '/api/studio/admin/traffic/sessions?days=' + encodeURIComponent(state.trafficDays) +
             '&limit=' + TRAFFIC_PAGE +
             (state.trafficBefore ? '&before=' + state.trafficBefore : '') +
             (state.trafficBots ? '&bots=1' : '') +
             (state.trafficQuery ? '&q=' + encodeURIComponent(state.trafficQuery) : '');
    var data = await api(qs);
    state.trafficSessions = state.trafficSessions.concat(data.sessions || []);
    state.trafficBefore = data.next_before || 0;
    state.trafficDone = !data.has_more;
  } catch (e) {
    if (!silent) renderError(e.message);
  }
  state.trafficSessLoading = false;
  if (!silent) renderTrafficView();
}

function tgChart(daily) {
  if (!daily || !daily.length) return '';
  var max = 1, i;
  for (i = 0; i < daily.length; i++) { if ((daily[i].sessions || 0) > max) max = daily[i].sessions; }
  var bars = '';
  for (i = 0; i < daily.length; i++) {
    var d = daily[i];
    var sess = d.sessions || 0, bnc = d.bounces || 0, eng = Math.max(0, sess - bnc);
    var hEng = Math.round((eng / max) * 100), hBnc = Math.round((bnc / max) * 100);
    var title = d.day + ' — ' + sess + ' visitors, ' + bnc + ' bounced, ' +
                (d.notebook_clicks || 0) + ' notebook clicks';
    bars += '<div class="tg-col" title="' + esc(title) + '">' +
              '<div class="tg-stack">' +
                '<div class="tg-seg bnc" style="height:' + hBnc + '%"></div>' +
                '<div class="tg-seg eng" style="height:' + hEng + '%"></div>' +
              '</div>' +
              '<div class="tg-xl">' + esc(d.day.slice(5)) + '</div>' +
            '</div>';
  }
  return '<div class="tg-chart-wrap">' +
           '<div class="tg-legend"><span><i class="dot eng"></i>engaged</span>' +
           '<span><i class="dot bnc"></i>bounced</span></div>' +
           '<div class="tg-chart">' + bars + '</div>' +
         '</div>';
}

function tgBarList(title, rows, labelFn, countFn) {
  var max = 1, i;
  for (i = 0; i < rows.length; i++) { var c = countFn(rows[i]); if (c > max) max = c; }
  var body = '';
  if (!rows.length) {
    body = '<tr><td colspan="2" style="text-align:center;color:var(--text-dim)">—</td></tr>';
  } else {
    for (i = 0; i < rows.length; i++) {
      var r = rows[i], n = countFn(r), w = Math.round((n / max) * 100);
      body += '<tr>' +
        '<td class="bar-cell"><div class="barfill" style="width:' + w + '%"></div>' +
          '<span>' + labelFn(r) + '</span></td>' +
        '<td class="num" style="text-align:right;color:var(--text)">' + n.toLocaleString() + '</td>' +
      '</tr>';
    }
  }
  return '<div class="tg-panel"><div class="tg-panel-h">' + esc(title) + '</div>' +
         '<table class="stats-table"><tbody>' + body + '</tbody></table></div>';
}

function renderTrafficView() {
  if (state.view !== 'traffic') return;
  if (state.trafficDetail) { renderTrafficDetail(); return; }

  var main = $('#main');
  var s = state.traffic;
  if (!s) { main.innerHTML = '<div class="empty-state">No traffic data yet.</div>'; return; }
  var t = s.totals || {};

  var controls =
    '<div class="stats-controls">' +
      '<label>Window ' +
        '<select id="tg-days">' +
          [1, 7, 14, 30, 60, 90].map(function (d) {
            return '<option value="' + d + '"' + (d === s.days ? ' selected' : '') + '>' +
              (d === 1 ? 'today' : d + ' days') + '</option>';
          }).join('') +
        '</select>' +
      '</label>' +
      '<span style="font-family:var(--font-mono);font-size:10px;color:var(--text-dim)">' +
        (t.bot_sessions || 0).toLocaleString() + ' bot/crawler sessions filtered out' +
      '</span>' +
    '</div>';

  var cards =
    '<div class="summary-cards">' +
      '<div class="scard"><div class="k">Visitors</div><div class="v gold">' + (t.sessions || 0).toLocaleString() + '</div><div class="sub">sessions, in window</div></div>' +
      '<div class="scard"><div class="k">Unique IPs</div><div class="v">' + (t.unique_ips || 0).toLocaleString() + '</div><div class="sub">distinct addresses</div></div>' +
      '<div class="scard"><div class="k">Logged-in users</div><div class="v">' + (t.logged_in_users || 0).toLocaleString() + '</div><div class="sub">identified visitors</div></div>' +
      '<div class="scard"><div class="k">Pageviews</div><div class="v">' + (t.pageviews || 0).toLocaleString() + '</div><div class="sub">' + (t.sessions ? (t.pageviews / t.sessions).toFixed(1) : '0') + ' per visit</div></div>' +
      '<div class="scard"><div class="k">Bounce rate</div><div class="v' + ((t.bounce_rate || 0) >= 0.7 ? ' gold' : '') + '">' + Math.round((t.bounce_rate || 0) * 100) + '%</div><div class="sub">' + (t.bounces || 0).toLocaleString() + ' bounced</div></div>' +
      '<div class="scard"><div class="k">Avg time on page</div><div class="v">' + fmtDur((t.avg_dwell_ms || 0) / 1000) + '</div><div class="sub">engaged time</div></div>' +
      '<div class="scard"><div class="k">Avg scroll depth</div><div class="v">' + (t.avg_scroll || 0) + '%</div><div class="sub">how far they get</div></div>' +
      '<div class="scard"><div class="k">Notebook clicks</div><div class="v gold">' + (t.notebook_clicks || 0).toLocaleString() + '</div><div class="sub">Colab opens</div></div>' +
    '</div>';

  var chart = tgChart(s.daily);

  var lists =
    '<div class="tg-grid">' +
      tgBarList('Top pages', s.pages || [],
        function (r) { return esc(r.path || '/'); },
        function (r) { return r.views || 0; }) +
      tgBarList('Top referrers', s.referrers || [],
        function (r) { return esc(r.referrer || '(direct)'); },
        function (r) { return r.sessions || 0; }) +
      tgBarList('Top countries', s.countries || [],
        function (r) { return tgFlag(r.country) + ' ' + esc(r.country || '??'); },
        function (r) { return r.sessions || 0; }) +
    '</div>';

  // Notebook leaderboard (full width).
  var nbRows = '';
  var nbs = s.notebooks || [];
  if (!nbs.length) {
    nbRows = '<tr><td colspan="3" style="text-align:center;color:var(--text-dim)">no notebook clicks yet</td></tr>';
  } else {
    for (var k = 0; k < nbs.length; k++) {
      nbRows += '<tr><td style="text-align:left;color:var(--gold)">' + esc(nbs[k].notebook) + '</td>' +
        '<td>' + (nbs[k].clicks || 0) + '</td>' +
        '<td>' + (nbs[k].sessions || 0) + '</td></tr>';
    }
  }
  var nbTable =
    '<div class="tg-panel" style="margin-bottom:20px"><div class="tg-panel-h">Notebook clicks — which one they opened</div>' +
      '<table class="stats-table"><thead><tr><th style="text-align:left">Notebook</th><th>Clicks</th><th>Visitors</th></tr></thead>' +
      '<tbody>' + nbRows + '</tbody></table></div>';

  main.innerHTML = controls + cards + chart + lists + nbTable + renderTrafficSessions();

  var daysSel = $('#tg-days');
  if (daysSel) daysSel.onchange = function () {
    state.trafficDays = parseInt(daysSel.value, 10) || 7;
    loadTraffic();
  };
  wireTrafficSessions();
}

function renderTrafficSessions() {
  var rows = '';
  var list = state.trafficSessions || [];
  if (!list.length) {
    rows = '<tr><td colspan="9" style="text-align:center;color:var(--text-dim);padding:24px">no visitors recorded</td></tr>';
  } else {
    for (var i = 0; i < list.length; i++) {
      var v = list[i];
      var who = v.email
        ? '<span class="who">' + esc(v.email) + '</span>'
        : '<span class="who anon">anon</span>';
      var badge = v.is_bot
        ? '<span class="tg-badge bot">bot</span>'
        : (v.bounced ? '<span class="tg-badge bounce">bounce</span>' : '<span class="tg-badge ok">engaged</span>');
      var nb = v.notebook_clicks > 0
        ? '<span class="tg-nb">' + esc(v.last_notebook || ('x' + v.notebook_clicks)) + '</span>'
        : '<span style="color:var(--text-muted)">—</span>';
      rows += '<tr data-sid="' + esc(v.session_id) + '">' +
        '<td>' + fmtDate(v.last_seen) + '</td>' +
        '<td>' + tgFlag(v.country) + ' ' + esc(tgGeo(v)) + '</td>' +
        '<td class="ip">' + esc(v.ip || '—') + '</td>' +
        '<td>' + who + '</td>' +
        '<td>' + esc(v.device || '—') + '</td>' +
        '<td class="num">' + (v.pageviews || 0) + '</td>' +
        '<td class="num">' + (v.max_scroll || 0) + '%</td>' +
        '<td class="num">' + fmtDur((v.dwell_ms || 0) / 1000) + '</td>' +
        '<td>' + nb + ' ' + badge + '</td>' +
      '</tr>';
    }
  }
  var more = (!state.trafficDone && list.length)
    ? '<button class="tg-loadmore" id="tg-more">Load more visitors</button>'
    : '';
  return '<div class="tg-sessions-wrap">' +
    '<div class="tg-sessions-h">' +
      '<div class="t">Recent visitors</div>' +
      '<div class="grow"></div>' +
      '<input id="tg-search" type="text" placeholder="filter ip / email / city…" value="' + esc(state.trafficQuery || '') + '">' +
      '<label><input type="checkbox" id="tg-bots"' + (state.trafficBots ? ' checked' : '') + '> show bots</label>' +
    '</div>' +
    '<div style="overflow-x:auto"><table class="tg-sessions">' +
      '<thead><tr><th>Last seen</th><th>Location</th><th>IP</th><th>Visitor</th><th>Device</th>' +
        '<th style="text-align:right">Pages</th><th style="text-align:right">Scroll</th>' +
        '<th style="text-align:right">Time</th><th>Notebook / status</th></tr></thead>' +
      '<tbody>' + rows + '</tbody>' +
    '</table></div>' + more +
  '</div>';
}

function wireTrafficSessions() {
  var trs = document.querySelectorAll('.tg-sessions tbody tr[data-sid]');
  for (var i = 0; i < trs.length; i++) {
    (function (tr) { tr.onclick = function () { openTrafficSession(tr.getAttribute('data-sid')); }; })(trs[i]);
  }
  var more = $('#tg-more');
  if (more) more.onclick = function () { loadTrafficSessions(false, false); };
  var bots = $('#tg-bots');
  if (bots) bots.onchange = function () {
    state.trafficBots = bots.checked;
    loadTrafficSessions(true, false);
  };
  var search = $('#tg-search');
  if (search) {
    search.oninput = function () {
      clearTimeout(state.trafficSearchTimer);
      state.trafficSearchTimer = setTimeout(function () {
        state.trafficQuery = search.value.trim();
        loadTrafficSessions(true, false);
      }, 300);
    };
  }
}

async function openTrafficSession(sid) {
  state.loading = true;
  renderLoader();
  try {
    var data = await api('/api/studio/admin/traffic/session?id=' + encodeURIComponent(sid));
    state.trafficDetail = data;
  } catch (e) { renderError(e.message); state.loading = false; return; }
  state.loading = false;
  renderTrafficDetail();
}

function tgEventRow(ev) {
  var cls = 'tg-ev ' + esc(ev.event || '');
  var lab = '', meta = '';
  if (ev.event === 'pageview') {
    lab = 'Viewed <b>' + esc(ev.path || '/') + '</b>';
    if (ev.referrer) meta = 'from ' + esc(ev.referrer);
  } else if (ev.event === 'notebook') {
    lab = 'Opened notebook <b>' + esc(ev.notebook || '') + '</b>';
    if (ev.href) meta = '<a href="' + esc(ev.href) + '" target="_blank" rel="noopener">' + esc(ev.href) + '</a>';
  } else if (ev.event === 'click') {
    lab = 'Clicked “' + esc(ev.target || '') + '”';
    if (ev.href) meta = '<a href="' + esc(ev.href) + '" target="_blank" rel="noopener">' + esc(ev.href) + '</a>';
  } else if (ev.event === 'exit') {
    lab = 'Left the page';
    var parts = [];
    if (ev.scroll_pct != null) parts.push(ev.scroll_pct + '% scrolled');
    if (ev.dwell_ms != null) parts.push(fmtDur(ev.dwell_ms / 1000) + ' on page');
    meta = parts.join(' · ');
  } else {
    lab = esc(ev.event || 'event');
  }
  return '<div class="' + cls + '">' +
    '<div class="lab">' + lab + '</div>' +
    (meta ? '<div class="meta">' + meta + '</div>' : '') +
    '<div class="ts">' + fmtDate(ev.created_at) + '</div>' +
  '</div>';
}

function renderTrafficDetail() {
  if (state.view !== 'traffic') return;
  var main = $('#main');
  var d = state.trafficDetail || {};
  var v = d.session;
  if (!v) { main.innerHTML = '<div class="empty-state">Session not found.</div>'; return; }

  var status = v.is_bot
    ? '<span class="tg-badge bot">bot</span>'
    : (v.bounced ? '<span class="tg-badge bounce">bounce</span>' : '<span class="tg-badge ok">engaged</span>');

  var head =
    '<div class="tg-detail-head">' +
      '<div class="top">' +
        '<span style="font-size:20px">' + tgFlag(v.country) + '</span>' +
        '<span class="geo">' + esc(tgGeo(v)) + '</span>' + status +
        (v.notebook_clicks > 0 ? '<span class="tg-badge ok" style="border-color:var(--gold);color:var(--gold)">' + v.notebook_clicks + ' notebook click' + (v.notebook_clicks === 1 ? '' : 's') + '</span>' : '') +
      '</div>' +
      '<div class="kv">' +
        '<div><div class="k">IP address</div><div class="v">' + esc(v.ip || '—') + '</div></div>' +
        '<div><div class="k">Visitor</div><div class="v">' + (v.email ? esc(v.email) : 'anonymous') + '</div></div>' +
        '<div><div class="k">ISP / network</div><div class="v">' + esc(v.isp || '—') + (v.asn ? ' (AS' + esc(v.asn) + ')' : '') + '</div></div>' +
        '<div><div class="k">Device</div><div class="v">' + esc(v.device || '—') + '</div></div>' +
        '<div><div class="k">Referrer</div><div class="v">' + esc(v.referrer || '(direct)') + '</div></div>' +
        '<div><div class="k">Pageviews</div><div class="v">' + (v.pageviews || 0) + '</div></div>' +
        '<div><div class="k">Max scroll</div><div class="v">' + (v.max_scroll || 0) + '%</div></div>' +
        '<div><div class="k">Time on site</div><div class="v">' + fmtDur((v.dwell_ms || 0) / 1000) + '</div></div>' +
        '<div><div class="k">First seen</div><div class="v">' + fmtDate(v.started) + '</div></div>' +
        '<div><div class="k">Last seen</div><div class="v">' + fmtDate(v.last_seen) + '</div></div>' +
        '<div style="grid-column:1/-1"><div class="k">User agent</div><div class="v" style="color:var(--text-dim)">' + esc(v.ua || '—') + '</div></div>' +
      '</div>' +
    '</div>';

  var evs = d.events || [];
  var timeline = '';
  if (!evs.length) {
    timeline = '<div class="empty-state">No events.</div>';
  } else {
    for (var i = 0; i < evs.length; i++) timeline += tgEventRow(evs[i]);
    timeline = '<div class="tg-timeline">' + timeline + '</div>';
  }

  main.innerHTML =
    '<div class="tg-detail-back" id="tg-back">← Back to traffic</div>' +
    head +
    '<div class="tg-panel-h" style="margin-bottom:10px">Activity timeline (' + evs.length + ' events)</div>' +
    timeline;

  var back = $('#tg-back');
  if (back) back.onclick = function () { state.trafficDetail = null; renderTrafficView(); };
}
