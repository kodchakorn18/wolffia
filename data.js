/* ============================================================
   data.js — one place for: where the numbers come from,
   how they are cleaned, and what is computed from them.
   Used by dashboard.js, system.js and history.js.
   ============================================================ */

const CONFIG = {
  sheetId: '1b-mKNEgtPI6Kokmx5v2GT12_ZkCequK5xW59_UDP0fY',
  gid: '554060351',
  refreshMs: 60000,          // re-read the sheet every 60 s
  staleMinutes: 30,          // older than this = logger considered offline
  csvUrl: ''                 // optional: a "Publish to web" CSV link
};

// Allow overriding without editing the file:  index.html?sheet=<id>&gid=<gid>
// or  index.html?csv=<published csv url>
(function readQuery() {
  const q = new URLSearchParams(location.search);
  if (q.get('sheet')) CONFIG.sheetId = q.get('sheet').trim();
  if (q.get('gid')) CONFIG.gid = q.get('gid').trim();
  if (q.get('csv')) CONFIG.csvUrl = q.get('csv').trim();
  if (q.get('refresh')) CONFIG.refreshMs = Math.max(10, +q.get('refresh')) * 1000;
})();

/* ---------- CSV ---------- */

function parseCSV(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false; }
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c !== '\r') cell += c;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/* ---------- dates ---------- */

// Handles 2026/4/29, 29/4/2026 and 4/29/2026 + "0:16:12" / "00:16"
function parseDateTime(dateStr, timeStr) {
  if (!dateStr) return null;
  const d = String(dateStr).trim();
  const t = String(timeStr || '').trim();
  let y, m, day;

  let mm = d.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
  if (mm) { y = +mm[1]; m = +mm[2]; day = +mm[3]; }
  else {
    mm = d.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
    if (!mm) { const p = new Date(d + ' ' + t); return isNaN(p) ? null : p; }
    y = +mm[3];
    // 29/4/2026 (day first) vs 4/29/2026 (month first)
    if (+mm[1] > 12) { day = +mm[1]; m = +mm[2]; }
    else if (+mm[2] > 12) { m = +mm[1]; day = +mm[2]; }
    else { day = +mm[1]; m = +mm[2]; }   // sheet default is day/month/year
  }
  const hms = t.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  return new Date(y, m - 1, day, hms ? +hms[1] : 0, hms ? +hms[2] : 0, hms && hms[3] ? +hms[3] : 0);
}

const pad = n => String(n).padStart(2, '0');
const fmtDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fmtTime = d => `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
const fmtStamp = d => `${fmtDate(d)} ${fmtTime(d)}`;
const fmtShort = d => `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
const toLocalInput = d => `${fmtDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

function ago(d) {
  const s = Math.max(0, (Date.now() - d.getTime()) / 1000);
  if (s < 90) return `${Math.round(s)} s ago`;
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  if (s < 172800) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

/* ---------- sheet -> records ---------- */

function sourceUrls() {
  if (CONFIG.csvUrl) return [CONFIG.csvUrl];
  const id = CONFIG.sheetId, gid = encodeURIComponent(CONFIG.gid);
  return [
    `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv&gid=${gid}&cachebust=${Date.now()}`,
    `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`
  ];
}

const norm = s => String(s || '').toLowerCase().replace(/₂/g, '2').replace(/[^a-z0-9]/g, '');

function findColumns(header) {
  const h = header.map(norm);
  const at = (...names) => {
    for (const n of names) { const i = h.findIndex(x => x === n || x.startsWith(n)); if (i >= 0) return i; }
    return -1;
  };
  return {
    date: at('date', 'วนท'),
    time: at('time', 'timestamp'),
    c1: at('co21ppm', 'co21', 'co2_1'),
    c2: at('co22ppm', 'co22', 'co2_2'),
    c3: at('co23ppm', 'co23', 'co2_3')
  };
}

function buildRecords(rows) {
  if (!rows.length) return [];
  let col = findColumns(rows[0]);
  let start = 1;
  if (col.c1 < 0 || col.c2 < 0 || col.c3 < 0) {          // no usable header -> assume A..E
    col = { date: 0, time: 1, c1: 2, c2: 3, c3: 4 };
    start = /\d/.test(rows[0][2] || '') ? 0 : 1;
  }
  const num = v => { const n = parseFloat(String(v).replace(/[^0-9.\-]/g, '')); return isFinite(n) ? n : NaN; };

  const out = [], seen = new Set();
  for (let i = start; i < rows.length; i++) {
    const r = rows[i];
    if (!r || r.length < 3) continue;
    const c1 = num(r[col.c1]), c2 = num(r[col.c2]), c3 = num(r[col.c3]);
    if (!isFinite(c1) || !isFinite(c2) || !isFinite(c3)) continue;
    if (c1 <= 0 && c2 <= 0 && c3 <= 0) continue;
    const t = parseDateTime(r[col.date], r[col.time]);
    if (!t || isNaN(t)) continue;
    const key = t.getTime();
    if (seen.has(key)) continue;                          // logger sometimes writes a row twice
    seen.add(key);
    out.push(record(t, c1, c2, c3));
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

function record(t, c1, c2, c3) {
  return {
    t, c1, c2, c3,
    reduced: c1 - c3,                                  // ppm removed by the whole train
    effW: c1 ? ((c1 - c2) / c1) * 100 : NaN,           // Wolffia stage
    effC: c2 ? ((c2 - c3) / c2) * 100 : NaN,           // CaO stage
    effO: c1 ? ((c1 - c3) / c1) * 100 : NaN            // overall
  };
}

/* ---------- store ---------- */

const Store = {
  rows: [],
  status: 'loading',        // loading | ok | error
  error: '',
  fetchedAt: null,
  listeners: [],

  onChange(fn) { this.listeners.push(fn); if (this.rows.length) fn(this); },
  emit() { this.listeners.forEach(fn => fn(this)); },

  async load() {
    let lastErr = '';
    for (const url of sourceUrls()) {
      try {
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) { lastErr = `HTTP ${res.status}`; continue; }
        const text = await res.text();
        if (/^\s*</.test(text)) { lastErr = 'The sheet returned a login page — set sharing to "Anyone with the link".'; continue; }
        const rows = buildRecords(parseCSV(text));
        if (!rows.length) { lastErr = 'The sheet was read but no CO₂ rows were found.'; continue; }
        this.rows = rows; this.status = 'ok'; this.error = ''; this.fetchedAt = new Date();
        this.emit();
        return rows;
      } catch (e) { lastErr = e.message || String(e); }
    }
    this.status = 'error';
    this.error = lastErr || 'Could not reach the sheet.';
    this.emit();
    return [];
  },

  loadCSVText(text) {
    const rows = buildRecords(parseCSV(text));
    if (!rows.length) { this.status = 'error'; this.error = 'No CO₂ rows found in that file.'; this.emit(); return; }
    this.rows = rows; this.status = 'ok'; this.error = ''; this.fetchedAt = new Date();
    this.emit();
  },

  start() { this.load(); setInterval(() => this.load(), CONFIG.refreshMs); },

  last() { return this.rows[this.rows.length - 1] || null; },
  isFresh() { const l = this.last(); return l ? (Date.now() - l.t) / 60000 < CONFIG.staleMinutes : false; }
};

/* ---------- selection / maths ---------- */

const inRange = (rows, from, to) => rows.filter(r => (!from || r.t >= from) && (!to || r.t <= to));

const mean = a => { const v = a.filter(isFinite); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : NaN; };

function stats(rows, key) {
  const v = rows.map(r => r[key]).filter(isFinite);
  if (!v.length) return { avg: NaN, min: NaN, max: NaN, n: 0 };
  return { avg: mean(v), min: Math.min(...v), max: Math.max(...v), n: v.length };
}

// Average into `max` buckets so a month of 10-minute samples still draws quickly.
function bucket(rows, max) {
  if (rows.length <= max) return rows;
  const size = Math.ceil(rows.length / max), out = [];
  for (let i = 0; i < rows.length; i += size) {
    const g = rows.slice(i, i + size);
    const avg = k => mean(g.map(r => r[k]));
    out.push({ t: g[Math.floor(g.length / 2)].t, c1: avg('c1'), c2: avg('c2'), c3: avg('c3'), reduced: avg('reduced'), effW: avg('effW'), effC: avg('effC'), effO: avg('effO') });
  }
  return out;
}

function movingAverage(arr, win) {
  if (win <= 1) return arr.slice();
  const out = [], half = Math.floor(win / 2);
  for (let i = 0; i < arr.length; i++) {
    const s = Math.max(0, i - half), e = Math.min(arr.length, i + half + 1);
    out.push(mean(arr.slice(s, e)));
  }
  return out;
}

// Least-squares fit -> y = a + b·x, plus prediction `ahead` steps past the end.
function trendLine(values, ahead) {
  const pts = values.map((y, x) => [x, y]).filter(p => isFinite(p[1]));
  if (pts.length < 2) return { line: values.map(() => null), slope: 0, r2: 0 };
  const n = pts.length;
  const sx = pts.reduce((s, p) => s + p[0], 0), sy = pts.reduce((s, p) => s + p[1], 0);
  const sxx = pts.reduce((s, p) => s + p[0] * p[0], 0), sxy = pts.reduce((s, p) => s + p[0] * p[1], 0);
  const b = (n * sxy - sx * sy) / (n * sxx - sx * sx || 1);
  const a = (sy - b * sx) / n;
  const ym = sy / n;
  const ssTot = pts.reduce((s, p) => s + (p[1] - ym) ** 2, 0);
  const ssRes = pts.reduce((s, p) => s + (p[1] - (a + b * p[0])) ** 2, 0);
  const line = [];
  for (let x = 0; x < values.length + ahead; x++) line.push(a + b * x);
  return { line, slope: b, r2: ssTot ? 1 - ssRes / ssTot : 0 };
}

// Group by calendar day -> one summary row per day.
function daily(rows) {
  const map = new Map();
  rows.forEach(r => {
    const k = fmtDate(r.t);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(r);
  });
  return [...map.entries()].map(([day, g]) => ({
    day, n: g.length, t: g[0].t,
    reduced: mean(g.map(r => r.reduced)),
    maxReduced: Math.max(...g.map(r => r.reduced)),
    minReduced: Math.min(...g.map(r => r.reduced)),
    effW: mean(g.map(r => r.effW)),
    effC: mean(g.map(r => r.effC)),
    effO: mean(g.map(r => r.effO))
  })).sort((a, b) => a.day.localeCompare(b.day));
}

/* ---------- output ---------- */

function downloadBlob(content, filename, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function toCSV(rows) {
  const head = ['Date', 'Time', 'CO2_1_ppm', 'CO2_2_ppm', 'CO2_3_ppm', 'CO2_reduced_ppm', 'Wolffia_efficiency_%', 'CaO_efficiency_%', 'Overall_efficiency_%'];
  const num = v => isFinite(v) ? (Math.round(v * 1000) / 1000) : '';
  const body = rows.map(r => [fmtDate(r.t), fmtTime(r.t), r.c1, r.c2, r.c3, num(r.reduced), num(r.effW), num(r.effC), num(r.effO)].join(','));
  return '\uFEFF' + [head.join(','), ...body].join('\n');
}

const n1 = v => isFinite(v) ? v.toFixed(1) : '—';
const n0 = v => isFinite(v) ? Math.round(v).toString() : '—';
const signed = v => isFinite(v) ? (v > 0 ? '+' : '') + v.toFixed(1) : '—';

/* ---------- shared chrome ---------- */

function paintStatus(el) {
  const l = Store.last();
  let cls = 'off', txt = 'no data';
  if (Store.status === 'error') { cls = 'off'; txt = 'sheet unreachable'; }
  else if (l) { cls = Store.isFresh() ? 'live' : 'stale'; txt = `last record ${ago(l.t)}`; }
  el.innerHTML = `<span class="dot ${cls}"></span>${txt}`;
}

function paintError(el) {
  if (!el) return;
  el.classList.toggle('show', Store.status === 'error');
  if (Store.status === 'error') {
    el.innerHTML = `<div><b>Can't read the Google Sheet.</b> ${Store.error}<br>
      <span class="hint">Open the sheet → Share → “Anyone with the link (Viewer)”, or File → Share → Publish to web → CSV and
      open this page as <code>?csv=&lt;published link&gt;</code>. You can also load a downloaded CSV with the button above.</span></div>`;
  }
}
