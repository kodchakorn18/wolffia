/* ============================================================
   charts.js — one chart card, reused everywhere.
   Every card can be renamed, numbered, adjusted with sliders,
   given a trend line + forecast, and saved as a PNG figure.
   ============================================================ */

Chart.defaults.color = '#89a1ac';
Chart.defaults.font.family = "'IBM Plex Sans Thai', system-ui, sans-serif";
Chart.defaults.font.size = 11;
Chart.defaults.animation.duration = 350;
Chart.defaults.plugins.tooltip.backgroundColor = '#0d171c';
Chart.defaults.plugins.tooltip.borderColor = '#23414c';
Chart.defaults.plugins.tooltip.borderWidth = 1;
Chart.defaults.plugins.tooltip.padding = 10;

const GRID = 'rgba(255,255,255,.07)';

/**
 * createChartCard({
 *   mount, id, title, figure, unit, kind,
 *   series: [{ key, label, color, type }],
 *   build : (rows, state) => ({ times:Date[], labels:string[], series:{key:number[]} }),
 *   getRows: () => rows,
 *   defaults: { ...state overrides }
 * })
 */
function createChartCard(opts) {
  const state = Object.assign({
    smooth: 1, maxPoints: 400, ahead: 0, tension: .25, width: 2,
    grid: true, points: false, trend: false, legend: true, fill: false
  }, opts.defaults || {});

  const el = document.createElement('section');
  el.className = 'chart-card';
  el.innerHTML = `
    <div class="cc-head">
      <input class="fig-num" value="${opts.figure || ''}" aria-label="Figure number" title="Figure number">
      <input class="chart-title" value="${opts.title}" aria-label="Chart title" title="Click to rename">
      <div class="cc-actions">
        <button class="btn sm" data-act="tools">Adjust</button>
        <button class="btn sm" data-act="png">Save PNG</button>
      </div>
    </div>
    <div class="cc-tools">
      <div class="tool"><label>Smoothing <b class="v-smooth">off</b></label>
        <input type="range" class="r-smooth" min="1" max="49" step="2" value="${state.smooth}"></div>
      <div class="tool"><label>Points shown <b class="v-max">${state.maxPoints}</b></label>
        <input type="range" class="r-max" min="30" max="1500" step="10" value="${state.maxPoints}"></div>
      <div class="tool"><label>Forecast ahead <b class="v-ahead">off</b></label>
        <input type="range" class="r-ahead" min="0" max="150" step="1" value="${state.ahead}"></div>
      <div class="tool"><label>Line curve <b class="v-tension">${state.tension}</b></label>
        <input type="range" class="r-tension" min="0" max="0.6" step="0.05" value="${state.tension}"></div>
      <div class="tool"><label>Line weight <b class="v-width">${state.width}</b></label>
        <input type="range" class="r-width" min="1" max="5" step="0.5" value="${state.width}"></div>
      <div class="tool"><label>Y axis</label>
        <div class="checks">
          <input type="number" class="y-min" placeholder="min" style="width:74px">
          <input type="number" class="y-max" placeholder="max" style="width:74px">
        </div></div>
      <div class="tool" style="grid-column:1/-1"><label>Show</label>
        <div class="checks">
          <label><input type="checkbox" class="c-grid" ${state.grid ? 'checked' : ''}> Grid lines</label>
          <label><input type="checkbox" class="c-points" ${state.points ? 'checked' : ''}> Data points</label>
          <label><input type="checkbox" class="c-trend" ${state.trend ? 'checked' : ''}> Trend line</label>
          <label><input type="checkbox" class="c-legend" ${state.legend ? 'checked' : ''}> Legend</label>
          <label><input type="checkbox" class="c-fill" ${state.fill ? 'checked' : ''}> Fill area</label>
        </div></div>
    </div>
    <div class="cc-canvas"><canvas></canvas></div>
    <div class="cc-foot"><span class="hint cc-note"></span><span class="stamp cc-stamp"></span></div>`;
  opts.mount.appendChild(el);

  const q = s => el.querySelector(s);
  const canvas = q('canvas');
  const note = q('.cc-note'), stampEl = q('.cc-stamp');
  let chart = null, lastStep = 0;

  q('[data-act=tools]').onclick = () => q('.cc-tools').classList.toggle('open');
  q('[data-act=png]').onclick = () => savePNG();

  const bind = (sel, key, fmt) => {
    const input = q(sel);
    const out = q(sel.replace('.r-', '.v-'));
    const show = () => { if (out) out.textContent = fmt ? fmt(state[key]) : state[key]; };
    show();
    input.addEventListener('input', () => { state[key] = parseFloat(input.value); show(); render(); });
  };
  bind('.r-smooth', 'smooth', v => v <= 1 ? 'off' : v + ' pts');
  bind('.r-max', 'maxPoints');
  bind('.r-ahead', 'ahead', v => v < 1 ? 'off' : '+' + v + ' pts' + (lastStep ? ' ≈ ' + humanSpan(v * lastStep) : ''));
  bind('.r-tension', 'tension');
  bind('.r-width', 'width');

  [['.c-grid', 'grid'], ['.c-points', 'points'], ['.c-trend', 'trend'], ['.c-legend', 'legend'], ['.c-fill', 'fill']]
    .forEach(([sel, key]) => q(sel).addEventListener('change', e => { state[key] = e.target.checked; render(); }));
  q('.y-min').addEventListener('input', render);
  q('.y-max').addEventListener('input', render);

  function humanSpan(ms) {
    const h = ms / 3600000;
    if (h < 1) return Math.round(h * 60) + ' min';
    if (h < 48) return (Math.round(h * 10) / 10) + ' h';
    return (Math.round(h / 2.4) / 10) + ' d';
  }

  function render() {
    const rows = opts.getRows() || [];
    if (!rows.length) { note.textContent = 'No data in this range.'; if (chart) { chart.destroy(); chart = null; } return; }

    const built = opts.build(rows, state);
    const times = built.times || [];
    const labels = built.labels.slice();

    lastStep = times.length > 2 ? Math.max(1, (times[times.length - 1] - times[0]) / (times.length - 1)) : 0;
    const ahead = Math.round(state.ahead);
    if (ahead > 0 && times.length) {
      const last = times[times.length - 1];
      for (let i = 1; i <= ahead; i++) {
        const t = new Date(last.getTime() + lastStep * i);
        labels.push(opts.futureFmt ? opts.futureFmt(t) : fmtShort(t));
      }
    }

    const datasets = [];
    opts.series.forEach(s => {
      let v = built.series[s.key] || [];
      if (state.smooth > 1) v = movingAverage(v, Math.round(state.smooth));
      const padded = v.concat(new Array(ahead).fill(null));
      datasets.push({
        label: s.label,
        data: padded,
        type: s.type || opts.kind || 'line',
        borderColor: s.color,
        backgroundColor: s.type === 'bar' ? s.color + '99' : (state.fill ? s.color + '22' : s.color),
        borderWidth: s.type === 'bar' ? 0 : state.width,
        fill: s.type === 'bar' ? true : state.fill,
        tension: state.tension,
        pointRadius: state.points ? 2 : 0,
        pointHoverRadius: 4,
        spanGaps: true,
        order: 2
      });

      if (state.trend || ahead > 0) {
        const { line, r2, slope } = trendLine(v, ahead);
        datasets.push({
          label: `${s.label} · trend${ahead ? ' + forecast' : ''}`,
          data: line.slice(0, v.length + ahead),
          type: 'line',
          borderColor: s.color,
          borderDash: [6, 5],
          borderWidth: 1.6,
          pointRadius: 0,
          fill: false,
          tension: 0,
          order: 1
        });
        s._r2 = r2; s._slope = slope;
      }
    });

    const yMin = q('.y-min').value === '' ? undefined : +q('.y-min').value;
    const yMax = q('.y-max').value === '' ? undefined : +q('.y-max').value;

    const cfg = {
      type: opts.kind || 'line',
      data: { labels, datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: state.legend, labels: { boxWidth: 10, boxHeight: 10, usePointStyle: true, filter: i => !i.text.includes('trend') || state.trend || ahead > 0 } },
          tooltip: { callbacks: { label: c => `${c.dataset.label}: ${c.parsed.y === null ? '—' : (Math.round(c.parsed.y * 10) / 10)} ${opts.unit || ''}` } }
        },
        scales: {
          x: { grid: { display: state.grid, color: GRID }, ticks: { maxRotation: 0, autoSkipPadding: 24 } },
          y: {
            min: yMin, max: yMax,
            grid: { display: state.grid, color: GRID },
            title: { display: !!opts.unit, text: opts.unit, color: '#5d757f' }
          }
        }
      }
    };

    if (chart) { chart.data = cfg.data; chart.options = cfg.options; chart.update(); }
    else chart = new Chart(canvas.getContext('2d'), cfg);

    const trendInfo = state.trend || ahead > 0
      ? ' · trend ' + opts.series.map(s => `${s.label}: ${s._slope > 0 ? '↑' : '↓'} R²=${(s._r2 || 0).toFixed(2)}`).join(' · ')
      : '';
    note.textContent = `${built.labels.length} points${state.smooth > 1 ? `, ${Math.round(state.smooth)}-point average` : ''}${ahead ? `, forecast +${ahead}` : ''}${trendInfo}`;
    stampEl.textContent = times.length ? `${fmtStamp(times[0])} → ${fmtStamp(times[times.length - 1])}` : '';
  }

  function savePNG() {
    const scale = 2;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const out = document.createElement('canvas');
    out.width = w * scale; out.height = (h + 96) * scale;
    const g = out.getContext('2d');
    g.scale(scale, scale);
    g.fillStyle = '#0d171c'; g.fillRect(0, 0, w, h + 96);

    const fig = q('.fig-num').value.trim(), title = q('.chart-title').value.trim();
    g.fillStyle = '#e8f1f3';
    g.font = "600 16px 'Space Grotesk', sans-serif";
    g.fillText(`${fig ? fig + '  ' : ''}${title}`, 16, 30);
    g.fillStyle = '#5d757f';
    g.font = "11px 'IBM Plex Mono', monospace";
    g.fillText(stampEl.textContent, 16, 48);
    g.drawImage(canvas, 0, 60, w, h);
    g.fillStyle = '#5d757f';
    g.fillText(note.textContent.slice(0, 150), 16, h + 78);
    g.fillText('WOLFFIA · CO₂ capture monitoring · exported ' + fmtStamp(new Date()), 16, h + 92);

    out.toBlob(b => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b);
      a.download = `${(fig || 'chart').replace(/\W+/g, '_')}_${title.replace(/\W+/g, '_').slice(0, 40)}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    });
  }

  return { el, render, state };
}
