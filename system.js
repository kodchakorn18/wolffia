/* system.js — drives the live diagram */

const $ = s => document.querySelector(s);

const DEVICES = [
  { name: 'SCD41 ×3', role: 'CO₂ concentration · I²C', feed: 'co2' },
  { name: 'E-201-C ×2', role: 'pH probes · analog', feed: 'none' },
  { name: 'DS3231', role: 'Real-time clock', feed: 'time' },
  { name: 'ESP32', role: 'Read, filter, publish', feed: 'co2' },
  { name: 'microSD module', role: 'Buffer when offline · SPI', feed: 'link' },
  { name: 'DS18B20', role: 'Temperature · 1-Wire', feed: 'none' },
  { name: 'INA226', role: 'Power draw · I²C', feed: 'none' },
  { name: 'LM2596', role: '12 V → 5 V supply', feed: 'none' }
];

$('#devices').innerHTML = DEVICES.map((d, i) => `
  <div class="dev">
    <span class="dot" id="dev${i}"></span>
    <div><div class="d-name">${d.name}</div><div class="d-role">${d.role}</div></div>
    <div class="d-state" id="devs${i}">—</div>
  </div>`).join('');

/* view toggle */
$('#btnDiagram').onclick = () => { document.body.classList.remove('photo'); $('#btnDiagram').classList.add('on'); $('#btnPhoto').classList.remove('on'); };
$('#btnPhoto').onclick = () => { document.body.classList.add('photo'); $('#btnPhoto').classList.add('on'); $('#btnDiagram').classList.remove('on'); };

/* photoperiod */
const led = { on: 6, off: 18 };
function paintLED() {
  const h = new Date().getHours();
  const isOn = led.on < led.off ? (h >= led.on && h < led.off) : (h >= led.on || h < led.off);
  $('#onLabel').textContent = String(led.on).padStart(2, '0') + ':00';
  $('#offLabel').textContent = String(led.off).padStart(2, '0') + ':00';
  $('#lamp').setAttribute('class', isOn ? 'lamp-on' : 'lamp-off');
  $('#lampGlowEl').style.opacity = isOn ? 1 : 0;
  $('#lampLabel').textContent = isOn ? 'LED LAMP · ON' : 'LED LAMP · OFF';
  $('#ledState').innerHTML = isOn
    ? '<span class="dot live"></span>light phase · Wolffia fixing CO₂'
    : '<span class="dot stale"></span>dark phase · Wolffia respiring';
}
$('#ledOn').addEventListener('input', e => { led.on = +e.target.value; paintLED(); });
$('#ledOff').addEventListener('input', e => { led.off = +e.target.value; paintLED(); });

/* live values */
function paint() {
  paintStatus($('#status'));
  paintError($('#banner'));
  $('#fetched').innerHTML = Store.fetchedAt ? `<b>${Store.rows.length}</b> records · read ${fmtTime(Store.fetchedAt)}` : '';

  const last = Store.last();
  const fresh = Store.isFresh();
  const cls = Store.status === 'error' ? 'off' : (fresh ? 'live' : 'stale');
  const label = Store.status === 'error' ? 'offline' : (fresh ? 'live' : 'stale');

  ['1', '2', '3'].forEach(i => {
    $('#s' + i + 'val').textContent = last ? n0(last['c' + i]) : '—';
    $('#s' + i + 'box').setAttribute('class', 'box sensor-box ' + cls);
    $('#w' + i).setAttribute('class', 'wire' + (fresh ? ' live' : ''));
  });
  $('#wbus').setAttribute('class', 'wire' + (fresh ? ' live' : ''));
  $('#wcloud').setAttribute('class', 'wire' + (fresh ? ' live' : ''));

  const pipeColor = fresh ? '#6fbf9c' : '#55707c';
  ['#pipeA', '#pipeB', '#pipeC', '#pipeD'].forEach(s => $(s).style.stroke = pipeColor);

  $('#cloudNote').textContent = last ? 'last row ' + fmtStamp(last.t) : 'no rows';
  $('#loggerNote').textContent = fresh ? 'ESP32 · RTC · microSD · streaming' : 'ESP32 · RTC · microSD · buffering';

  if (last) {
    $('#nowStamp').textContent = fmtStamp(last.t) + ' · ' + ago(last.t);
    $('#nowEff').innerHTML = `<span class="${last.effO >= 0 ? 'pos' : 'neg'}">${n1(last.effO)}</span><small>%</small>`;
    $('#nowRed').textContent = `${n0(last.reduced)} ppm removed · ${n0(last.c1)} → ${n0(last.c3)} ppm`;
  }

  DEVICES.forEach((d, i) => {
    const dot = $('#dev' + i), st = $('#devs' + i);
    if (d.feed === 'none') { dot.className = 'dot'; st.textContent = 'not in this feed'; }
    else if (d.feed === 'link') { dot.className = 'dot ' + cls; st.textContent = fresh ? 'idle' : 'buffering'; }
    else if (d.feed === 'time') { dot.className = 'dot ' + cls; st.textContent = last ? fmtTime(last.t) : '—'; }
    else { dot.className = 'dot ' + cls; st.textContent = label; }
  });
}

paintLED();
setInterval(paintLED, 60000);
Store.onChange(paint);
Store.start();
setInterval(paint, 15000);
