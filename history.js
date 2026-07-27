/* history.js — filter, sort, summarise, export */

const $ = s => document.querySelector(s);
let range = { hours: 0, from: null, to: null };
let sort = { key: 't', dir: -1 };      // newest first
let page = 0, pageSize = 100;

function filtered() {
  const rows = Store.rows;
  if (!rows.length) return [];
  let out;
  if (range.from || range.to) out = inRange(rows, range.from, range.to);
  else if (range.hours) out = inRange(rows, new Date(rows[rows.length - 1].t.getTime() - range.hours * 3600000), null);
  else out = rows.slice();
  const k = sort.key === 't2' ? 't' : sort.key;
  return out.sort((a, b) => {
    const av = k === 't' ? a.t.getTime() : a[k], bv = k === 't' ? b.t.getTime() : b[k];
    if (!isFinite(av)) return 1;
    if (!isFinite(bv)) return -1;
    return (av - bv) * sort.dir;
  });
}

/* controls */
$('#quick').addEventListener('click', e => {
  const b = e.target.closest('button[data-h]'); if (!b) return;
  [...$('#quick').children].forEach(x => x.classList.toggle('on', x === b));
  range = { hours: +b.dataset.h, from: null, to: null };
  $('#from').value = ''; $('#to').value = '';
  page = 0; paint();
});
['#from', '#to'].forEach(sel => $(sel).addEventListener('change', () => {
  range.from = $('#from').value ? new Date($('#from').value) : null;
  range.to = $('#to').value ? new Date($('#to').value) : null;
  if (range.from || range.to) { range.hours = null; [...$('#quick').children].forEach(x => x.classList.remove('on')); }
  page = 0; paint();
}));
$('#pageSize').addEventListener('change', e => { pageSize = +e.target.value; page = 0; paint(); });
$('#prev').onclick = () => { page = Math.max(0, page - 1); paint(); };
$('#next').onclick = () => { page++; paint(); };
$('#reload').onclick = () => { $('#reload').textContent = 'Reading…'; Store.load().then(() => $('#reload').textContent = 'Reload sheet'); };
$('#csv').onclick = () => {
  const rows = filtered();
  if (!rows.length) return;
  const tag = `${fmtDate(rows[0].t)}_${fmtDate(rows[rows.length - 1].t)}`;
  downloadBlob(toCSV(rows), `wolffia_co2_${tag}.csv`, 'text/csv;charset=utf-8');
};
document.querySelectorAll('#tbl thead th').forEach(th => th.onclick = () => {
  const k = th.dataset.k;
  sort = { key: k, dir: sort.key === k ? -sort.dir : (k === 't' || k === 't2' ? -1 : 1) };
  page = 0; paint();
});

/* chart */
const card = createChartCard({
  mount: $('#charts'), figure: 'Fig. H1', title: 'CO₂ history in the selected range', unit: 'ppm',
  defaults: { maxPoints: 600 },
  getRows: () => filtered().slice().sort((a, b) => a.t - b.t),
  series: [
    { key: 'c1', label: 'CO₂_1', color: '#f0a848' },
    { key: 'c2', label: 'CO₂_2', color: '#57c9a3' },
    { key: 'c3', label: 'CO₂_3', color: '#7fb2ff' },
    { key: 'reduced', label: 'Reduced', color: '#c2f5d8' }
  ],
  build(rows, st) {
    const b = bucket(rows, st.maxPoints);
    return {
      times: b.map(r => r.t), labels: b.map(r => fmtShort(r.t)),
      series: { c1: b.map(r => r.c1), c2: b.map(r => r.c2), c3: b.map(r => r.c3), reduced: b.map(r => r.reduced) }
    };
  }
});

/* render */
function paint() {
  paintStatus($('#status'));
  paintError($('#banner'));
  $('#fetched').innerHTML = Store.fetchedAt ? `<b>${Store.rows.length}</b> records · read ${fmtTime(Store.fetchedAt)}` : '';

  const rows = filtered();
  const byTime = rows.slice().sort((a, b) => a.t - b.t);

  // summary
  const red = stats(rows, 'reduced'), o = stats(rows, 'effO'), w = stats(rows, 'effW'), c = stats(rows, 'effC');
  $('#sCount').textContent = rows.length;
  $('#sSpan').textContent = rows.length ? `${fmtStamp(byTime[0].t)} → ${fmtStamp(byTime[byTime.length - 1].t)}` : '—';
  $('#sRed').innerHTML = `${n1(red.avg)}<small>ppm</small>`;
  $('#sRedSub').textContent = `min ${n0(red.min)} · max ${n0(red.max)} ppm`;
  $('#sEff').innerHTML = `<span class="${o.avg >= 0 ? 'pos' : 'neg'}">${n1(o.avg)}</span><small>%</small>`;
  $('#sEffSub').textContent = `min ${n1(o.min)} · max ${n1(o.max)} %`;
  $('#sStage').innerHTML = `<span class="${w.avg >= 0 ? 'pos' : 'neg'}" style="font-size:26px">${n1(w.avg)}</span>
    <small>/</small><span class="${c.avg >= 0 ? 'pos' : 'neg'}" style="font-size:26px">${n1(c.avg)}</span><small>%</small>`;

  if (rows.length) {
    if (!$('#from').value) $('#from').value = toLocalInput(byTime[0].t);
    if (!$('#to').value) $('#to').value = toLocalInput(byTime[byTime.length - 1].t);
  }

  // sort marks
  document.querySelectorAll('#tbl thead th').forEach(th => {
    const on = th.dataset.k === sort.key;
    th.innerHTML = th.textContent.replace(/[▲▼]\s*$/, '').trim() + (on ? ` <span class="sortmark">${sort.dir > 0 ? '▲' : '▼'}</span>` : '');
  });

  // page
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  page = Math.min(page, pages - 1);
  const slice = rows.slice(page * pageSize, page * pageSize + pageSize);
  const cell = (v, f) => `<td>${f(v)}</td>`;
  $('#tbody').innerHTML = slice.map(r => `<tr>
      <td>${fmtDate(r.t)}</td><td>${fmtTime(r.t)}</td>
      ${cell(r.c1, n0)}${cell(r.c2, n0)}${cell(r.c3, n0)}
      <td class="${r.reduced >= 0 ? 'pos' : 'neg'}">${n0(r.reduced)}</td>
      <td class="${r.effW >= 0 ? 'pos' : 'neg'}">${n1(r.effW)}</td>
      <td class="${r.effC >= 0 ? 'pos' : 'neg'}">${n1(r.effC)}</td>
      <td class="${r.effO >= 0 ? 'pos' : 'neg'}">${n1(r.effO)}</td>
    </tr>`).join('') || `<tr><td colspan="9" class="skeleton" style="text-align:center;padding:26px">No records in this range. Widen the dates above.</td></tr>`;

  const c1 = stats(rows, 'c1'), c2 = stats(rows, 'c2'), c3 = stats(rows, 'c3');
  $('#tfoot').innerHTML = rows.length ? `<td>Mean</td><td>${rows.length} rows</td>
      <td>${n0(c1.avg)}</td><td>${n0(c2.avg)}</td><td>${n0(c3.avg)}</td>
      <td>${n1(red.avg)}</td><td>${n1(w.avg)}</td><td>${n1(c.avg)}</td><td>${n1(o.avg)}</td>` : '';

  $('#pageInfo').textContent = `Page ${page + 1} of ${pages}`;
  $('#prev').disabled = page === 0;
  $('#next').disabled = page >= pages - 1;

  card.render();
}

Store.onChange(paint);
Store.start();
