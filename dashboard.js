/* dashboard.js — the WOLFFIA page */

const $ = s => document.querySelector(s);
let range = { hours: 72, from: null, to: null };

/* ---------- range ---------- */

function currentRows() {
  const rows = Store.rows;
  if (!rows.length) return [];
  if (range.from || range.to) return inRange(rows, range.from, range.to);
  if (!range.hours) return rows;
  const end = rows[rows.length - 1].t;
  return inRange(rows, new Date(end.getTime() - range.hours * 3600000), null);
}

$('#quick').addEventListener('click', e => {
  const b = e.target.closest('button[data-h]');
  if (!b) return;
  [...$('#quick').children].forEach(x => x.classList.toggle('on', x === b));
  range = { hours: +b.dataset.h, from: null, to: null };
  $('#from').value = ''; $('#to').value = '';
  paint();
});

['#from', '#to'].forEach(sel => $(sel).addEventListener('change', () => {
  range.from = $('#from').value ? new Date($('#from').value) : null;
  range.to = $('#to').value ? new Date($('#to').value) : null;
  if (range.from || range.to) {
    range.hours = null;
    [...$('#quick').children].forEach(x => x.classList.remove('on'));
  }
  paint();
}));

$('#reload').onclick = () => { $('#reload').textContent = 'Reading…'; Store.load().then(() => $('#reload').textContent = 'Reload sheet'); };
$('#pick').onclick = () => $('#file').click();
$('#file').onchange = e => {
  const f = e.target.files[0];
  if (f) f.text().then(t => Store.loadCSVText(t));
};

/* ---------- charts ---------- */

const mount = $('#charts'), mountWide = $('#chartsWide');
const cards = [];

cards.push(createChartCard({
  mount, figure: 'Fig. 1', title: 'CO₂ by position', unit: 'ppm', kind: 'line',
  getRows: currentRows,
  series: [
    { key: 'c1', label: 'CO₂_1 inlet', color: '#f0a848' },
    { key: 'c2', label: 'CO₂_2 after Wolffia', color: '#57c9a3' },
    { key: 'c3', label: 'CO₂_3 after CaO', color: '#7fb2ff' }
  ],
  build(rows, st) {
    const b = bucket(rows, st.maxPoints);
    return {
      times: b.map(r => r.t),
      labels: b.map(r => fmtShort(r.t)),
      series: { c1: b.map(r => r.c1), c2: b.map(r => r.c2), c3: b.map(r => r.c3) }
    };
  }
}));

cards.push(createChartCard({
  mount, figure: 'Fig. 2', title: 'CO₂ reduced by the system', unit: 'ppm', kind: 'line',
  defaults: { fill: true, smooth: 5 },
  getRows: currentRows,
  series: [{ key: 'reduced', label: 'CO₂ reduced (1 − 3)', color: '#57c9a3' }],
  build(rows, st) {
    const b = bucket(rows, st.maxPoints);
    return { times: b.map(r => r.t), labels: b.map(r => fmtShort(r.t)), series: { reduced: b.map(r => r.reduced) } };
  }
}));

cards.push(createChartCard({
  mount, figure: 'Fig. 3', title: 'Capture efficiency by stage', unit: '%', kind: 'line',
  defaults: { smooth: 7 },
  getRows: currentRows,
  series: [
    { key: 'effW', label: 'Wolffia', color: '#57c9a3' },
    { key: 'effC', label: 'CaO', color: '#7fb2ff' },
    { key: 'effO', label: 'Overall', color: '#f0a848' }
  ],
  build(rows, st) {
    const b = bucket(rows, st.maxPoints);
    return {
      times: b.map(r => r.t), labels: b.map(r => fmtShort(r.t)),
      series: { effW: b.map(r => r.effW), effC: b.map(r => r.effC), effO: b.map(r => r.effO) }
    };
  }
}));

cards.push(createChartCard({
  mount: mountWide, figure: 'Fig. 4', title: 'Daily CO₂ reduction trend', unit: 'ppm / %', kind: 'line',
  defaults: { maxPoints: 400, points: true, trend: true },
  getRows: currentRows,
  futureFmt: t => fmtDate(t),
  series: [
    { key: 'reduced', label: 'Daily mean CO₂ reduced (ppm)', color: '#57c9a3', type: 'bar' },
    { key: 'effO', label: 'Daily mean overall efficiency (%)', color: '#f0a848' }
  ],
  build(rows) {
    const d = daily(rows);
    return {
      times: d.map(x => new Date(x.day + 'T00:00:00')),
      labels: d.map(x => x.day),
      series: { reduced: d.map(x => x.reduced), effO: d.map(x => x.effO) }
    };
  }
}));

/* ---------- painting ---------- */

function paint() {
  paintStatus($('#status'));
  paintError($('#banner'));
  $('#fetched').innerHTML = Store.fetchedAt
    ? `<b>${Store.rows.length}</b> records · read ${fmtTime(Store.fetchedAt)}` : '';

  const rows = currentRows();
  const last = Store.last();

  if (last) {
    $('#v1').textContent = n0(last.c1);
    $('#v2').textContent = n0(last.c2);
    $('#v3').textContent = n0(last.c3);
    $('#trainState').innerHTML = `<span class="dot ${Store.isFresh() ? 'live' : 'stale'}"></span>${fmtStamp(last.t)}`;
  }

  if (rows.length) {
    const s1 = stats(rows, 'c1'), s2 = stats(rows, 'c2'), s3 = stats(rows, 'c3');
    $('#a1').textContent = `avg ${n0(s1.avg)} ppm`;
    $('#a2').textContent = `avg ${n0(s2.avg)} ppm`;
    $('#a3').textContent = `avg ${n0(s3.avg)} ppm`;

    const w = stats(rows, 'effW'), c = stats(rows, 'effC'), o = stats(rows, 'effO'), red = stats(rows, 'reduced');

    $('#ew').innerHTML = `<span class="${w.avg >= 0 ? 'pos' : 'neg'}">${signed(w.avg)}%</span>`;
    $('#ec').innerHTML = `<span class="${c.avg >= 0 ? 'pos' : 'neg'}">${signed(c.avg)}%</span>`;

    if (last) $('#kReduced').innerHTML = `${n0(last.reduced)}<small>ppm now</small>`;
    $('#kReducedSub').textContent = `range mean ${n1(red.avg)} · min ${n0(red.min)} · max ${n0(red.max)} ppm`;

    setKPI('#kEffO', '#kEffOSub', o);
    setKPI('#kEffW', '#kEffWSub', w);
    setKPI('#kEffC', '#kEffCSub', c);

    $('#from').placeholder = '';
    if (!$('#from').value) $('#from').value = toLocalInput(rows[0].t);
    if (!$('#to').value) $('#to').value = toLocalInput(rows[rows.length - 1].t);
  }

  cards.forEach(c => c.render());
}

function setKPI(valSel, subSel, s) {
  const el = $(valSel);
  el.innerHTML = `<span class="${s.avg >= 0 ? 'pos' : 'neg'}">${n1(s.avg)}</span><small>%</small>`;
  $(subSel).textContent = `${s.n} samples · min ${n1(s.min)} · max ${n1(s.max)} %`;
}

Store.onChange(paint);
Store.start();
setInterval(() => paintStatus($('#status')), 15000);
