/* Nebenkosten – Strom, Gas, Wasser
   Web-App (PWA) ohne Server. Alle Daten bleiben auf dem Gerät (localStorage);
   Sicherung als Datei, z. B. in iCloud Drive. */
'use strict';

/* ---------- Grundlagen ---------- */
const TYPES = {
  strom:  { label: 'Strom',  unit: 'kWh', icon: '⚡', color: 'var(--strom)',  priceLabel: 'Arbeitspreis (ct/kWh)' },
  gas:    { label: 'Gas',    unit: 'm³',  icon: '🔥', color: 'var(--gas)',    priceLabel: 'Arbeitspreis (ct/kWh)' },
  wasser: { label: 'Wasser', unit: 'm³',  icon: '💧', color: 'var(--wasser)', priceLabel: 'Wasserpreis (€/m³)' },
};
const YEAR_COLORS = ['#94a3b8', '#0ea5e9', '#0f766e', '#f59e0b', '#a855f7'];
const STORE_KEY = 'nebenkosten-data-v1';
const CDN = {
  tesseract: 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js',
  pdfjs: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.379/build/pdf.min.mjs',
  pdfjsWorker: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.379/build/pdf.worker.min.mjs',
};

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtNum = (v, d = 0) => v == null || isNaN(v) ? '–' : Number(v).toLocaleString('de-DE', { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtEur = v => v == null || isNaN(v) ? '–' : Number(v).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
const numIn = v => v == null || isNaN(v) ? '' : String(Math.round(v * 10000) / 10000).replace('.', ',');
function parseDe(s) {
  if (s == null) return NaN;
  s = String(s).trim().replace(/\s/g, '').replace(/[€]/g, '');
  if (!s) return NaN;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  return parseFloat(s);
}

/* Datum als ISO-String 'JJJJ-MM-TT' */
const d2ms = s => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
const ms2d = ms => new Date(ms).toISOString().slice(0, 10);
const DAY = 86400000;
function todayISO() { const n = new Date(); return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`; }
const addDays = (iso, n) => ms2d(d2ms(iso) + n * DAY);
const addYears = (iso, n) => `${+iso.slice(0, 4) + n}${iso.slice(4)}`;
const daysBetween = (a, b) => Math.round((d2ms(b) - d2ms(a)) / DAY);
const monthDiff = (a, b) => (+b.slice(0, 4) - +a.slice(0, 4)) * 12 + (+b.slice(5, 7) - +a.slice(5, 7));
const deDate = iso => iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : '–';
function parseDeDate(s) {
  const m = String(s).match(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})/);
  if (!m) return null;
  let y = +m[3]; if (y < 100) y += 2000;
  return `${y}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
}
const MONTHS = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

/* ---------- Speicher ---------- */
const emptyDb = () => ({ version: 1, meters: [], tariffs: [], readings: [], bills: [], settings: { lastBackup: null, reminderTime: '09:00' } });
let db = loadDb();
function loadDb() {
  try { const d = JSON.parse(localStorage.getItem(STORE_KEY)); if (d && d.meters) return Object.assign(emptyDb(), d); } catch (e) { }
  return emptyDb();
}
function save() {
  db.settings.changedSinceBackup = true;
  localStorage.setItem(STORE_KEY, JSON.stringify(db));
  updateBadge();
}
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => { });

/* ---------- Datenlogik ---------- */
const meterById = id => db.meters.find(m => m.id === id);
const readingsOf = id => db.readings.filter(r => r.meterId === id).sort((a, b) => a.date.localeCompare(b.date));
const tariffsOf = id => db.tariffs.filter(t => t.meterId === id).sort((a, b) => a.validFrom.localeCompare(b.validFrom));
const billsOf = id => db.bills.filter(b => b.meterId === id).sort((a, b) => a.to.localeCompare(b.to));
function tariffAt(id, iso) { const ts = tariffsOf(id).filter(t => t.validFrom <= iso); return ts[ts.length - 1] || tariffsOf(id)[0] || null; }

/* Zählerstand an einem Tag – exakt oder linear zwischen zwei Ablesungen interpoliert */
function valueAt(id, iso) {
  const rs = readingsOf(id); if (!rs.length) return null;
  const t = d2ms(iso);
  for (let i = 0; i < rs.length; i++) {
    const ti = d2ms(rs[i].date);
    if (ti === t) { // letzte Ablesung dieses Tages
      let j = i; while (j + 1 < rs.length && rs[j + 1].date === rs[i].date) j++;
      return rs[j].value;
    }
    if (ti > t) {
      if (i === 0) return null;
      const a = rs[i - 1], ta = d2ms(a.date);
      return a.value + (rs[i].value - a.value) * (t - ta) / (ti - ta);
    }
  }
  return null;
}
/* Kosten je Zählereinheit (Gas: m³ → kWh über Brennwert × Zustandszahl) */
function unitCost(m, t) {
  if (!t) return null;
  const f = m.type === 'gas' ? (t.gasFactor || 10.5) : 1;
  return (t.workPrice || 0) * f + (t.extraPerUnit || 0);
}

function analyse(m) {
  const t = tariffAt(m.id, todayISO());
  const res = { meter: m, tariff: t };
  if (!t) { res.status = 'notariff'; return res; }
  const rs = readingsOf(m.id);
  let start = t.validFrom, v0 = valueAt(m.id, start), note = '';
  if (v0 == null) {
    const first = rs.find(r => r.date >= start);
    if (first && daysBetween(start, first.date) <= 62) { start = first.date; v0 = first.value; note = `Gemessen ab erster Ablesung (${deDate(start)})`; }
  }
  const last = rs.filter(r => r.date > start).pop();
  if (v0 == null || !last) { res.status = 'noreadings'; res.start = t.validFrom; return res; }
  const days = Math.max(1, daysBetween(start, last.date));
  const cons = last.value - v0;
  const uc = unitCost(m, t);
  const costToDate = cons * uc + (t.basePerYear || 0) * daysBetween(t.validFrom, last.date) / 365;
  const months = Math.min(12, Math.max(0, monthDiff(t.validFrom, todayISO()) + 1));
  const paidToDate = (t.advance || 0) * months;

  // Hochrechnung aufs Abrechnungsjahr: saisonal mit Vorjahresprofil, sonst linear
  let projCons = null, method = '';
  const lyS = addYears(start, -1), lyE = addYears(last.date, -1);
  const a = valueAt(m.id, lyS), b = valueAt(m.id, lyE), c = valueAt(m.id, addYears(start, 0));
  if (a != null && b != null && c != null && b - a > 0 && c - a > 0 && daysBetween(lyS, start) >= 360) {
    projCons = cons * (c - a) / (b - a); method = 'saisonal (Vorjahresverlauf)';
  } else if (days >= 14) {
    projCons = cons / days * 365; method = 'linear';
  }
  const projCost = projCons == null ? null : projCons * uc + (t.basePerYear || 0);
  const paidYear = (t.advance || 0) * 12;
  Object.assign(res, {
    status: 'ok', start, v0, last, cons, days, costToDate, paidToDate, months, projCons, projCost, paidYear,
    balanceNow: paidToDate - costToDate,
    balanceYear: projCost == null ? null : paidYear - projCost,
    suggested: projCost == null ? null : Math.ceil(projCost / 12), method, note,
  });
  return res;
}

function dueMeters() {
  const ym = todayISO().slice(0, 7);
  return db.meters.filter(m => !readingsOf(m.id).some(r => r.date.slice(0, 7) === ym));
}
function updateBadge() {
  const n = dueMeters().length;
  try { if (navigator.setAppBadge) n ? navigator.setAppBadge(n) : navigator.clearAppBadge(); } catch (e) { }
}

/* ---------- UI-Helfer ---------- */
let current = 'dash';
const state = { readMeter: null, statMeter: null, billMeter: null };
function toast(msg, ms = 2600) {
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t);
  setTimeout(() => t.remove(), ms);
}
function openSheet(html) {
  closeSheet();
  const bg = document.createElement('div'); bg.className = 'sheet-bg'; bg.id = 'sheetbg';
  bg.innerHTML = `<div class="sheet">${html}</div>`;
  bg.addEventListener('click', e => { if (e.target === bg) closeSheet(); });
  document.body.appendChild(bg);
  return $('.sheet', bg);
}
function closeSheet() { const s = $('#sheetbg'); if (s) s.remove(); }
function formData(el) { const o = {}; $$('[name]', el).forEach(i => o[i.name] = i.value); return o; }
function loadScript(src) {
  return new Promise((ok, fail) => {
    if ([...document.scripts].some(s => s.src === src)) return ok();
    const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => fail(new Error('Laden fehlgeschlagen – besteht eine Internetverbindung?'));
    document.head.appendChild(s);
  });
}
function meterSeg(selId, key) {
  if (db.meters.length < 2) return '';
  return `<div class="seg">${db.meters.map(m => `<button class="${m.id === selId ? 'on' : ''}" onclick="App.pick('${key}','${m.id}')">${TYPES[m.type].icon} ${esc(m.name)}</button>`).join('')}</div>`;
}
const typeIcon = m => `<div class="mtype t-${m.type}">${TYPES[m.type].icon}</div>`;
const noMeters = () => `<div class="card empty"><div class="e">🏠</div><h2>Noch keine Zähler</h2>
  <p class="muted">Lade eine Strom-, Gas- oder Wasserrechnung hoch – die App liest Tarif und Abschlag aus und legt den Zähler an. Oder lege ihn von Hand an.</p>
  <div class="btnrow"><button onclick="App.go('bills')">🧾 Rechnung hochladen</button><button class="secondary" onclick="App.editMeter()">Zähler anlegen</button></div>
  <div class="btnrow"><button class="ghost" onclick="App.demo()">Mit Beispieldaten ausprobieren</button></div></div>`;

/* ---------- Navigation ---------- */
const TITLES = { dash: 'Übersicht', read: 'Zähler ablesen', bills: 'Rechnungen', stats: 'Statistik', settings: 'Mehr' };
function go(v) {
  current = v;
  $$('#nav button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
  $('#title').textContent = TITLES[v];
  $('#subtitle').textContent = '';
  ({ dash: renderDash, read: renderRead, bills: renderBills, stats: renderStats, settings: renderSettings })[v]();
  window.scrollTo(0, 0);
}
$$('#nav button').forEach(b => b.addEventListener('click', () => go(b.dataset.v)));
function rerender() { go(current); }

/* ---------- Übersicht ---------- */
function renderDash() {
  const v = $('#view');
  const now = new Date();
  $('#subtitle').textContent = now.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  if (!db.meters.length) { v.innerHTML = noMeters(); return; }
  let html = '';
  const due = dueMeters();
  if (due.length) html += `<div class="banner"><span style="font-size:24px">📷</span><div style="flex:1"><b>Ablesen fällig</b><br><span class="small">${due.map(m => esc(m.name)).join(', ')} – noch keine Ablesung in diesem Monat.</span></div><button onclick="App.go('read')">Jetzt</button></div>`;
  const lb = db.settings.lastBackup;
  if (db.settings.changedSinceBackup && (!lb || daysBetween(lb.slice(0, 10), todayISO()) > 30))
    html += `<div class="banner"><span style="font-size:24px">☁️</span><div style="flex:1"><b>Sicherung empfohlen</b><br><span class="small">${lb ? 'Letzte Sicherung am ' + deDate(lb.slice(0, 10)) : 'Noch keine Sicherung'} – in iCloud Drive sichern.</span></div><button onclick="App.exportData()">Sichern</button></div>`;

  const an = db.meters.map(analyse);
  const ok = an.filter(a => a.status === 'ok' && a.balanceYear != null);
  if (ok.length) {
    const total = ok.reduce((s, a) => s + a.balanceYear, 0);
    const now2 = ok.reduce((s, a) => s + a.balanceNow, 0);
    html += `<div class="card"><div class="row between"><h2 style="margin:0">Prognose gesamt</h2>${pill(total)}</div>
      <div class="big" style="margin-top:6px;color:${total >= 0 ? 'var(--good)' : 'var(--bad)'}">${total >= 0 ? '+' : '−'}${fmtEur(Math.abs(total))}</div>
      <div class="muted small">erwartet zur nächsten Abrechnung · Stand heute ${now2 >= 0 ? 'Guthaben' : 'Rückstand'} ${fmtEur(Math.abs(now2))}</div></div>`;
  }
  html += an.map(dashCard).join('');
  v.innerHTML = html;
}
const pill = x => x >= 0 ? `<span class="pill good">Guthaben erwartet</span>` : `<span class="pill bad">Nachzahlung erwartet</span>`;
function dashCard(a) {
  const m = a.meter, T = TYPES[m.type];
  const head = `<div class="row" style="margin-bottom:10px">${typeIcon(m)}<div style="flex:1"><b>${esc(m.name)}</b><div class="muted small">${m.number ? 'Zähler ' + esc(m.number) : T.label}</div></div>${a.status === 'ok' && a.balanceYear != null ? pill(a.balanceYear) : ''}</div>`;
  if (a.status === 'notariff') return `<div class="card">${head}<p class="muted">Für diesen Zähler fehlt der Tarif (Arbeitspreis, Grundpreis, Abschlag).</p><div class="btnrow"><button onclick="App.go('bills')">Rechnung hochladen</button><button class="secondary" onclick="App.editTariff('${m.id}')">Tarif eintragen</button></div></div>`;
  if (a.status === 'noreadings') return `<div class="card">${head}<p class="muted">Abrechnungszeitraum seit ${deDate(a.start)}. Für den Verbrauch braucht die App einen Zählerstand zum Beginn und mindestens eine weitere Ablesung.</p><div class="btnrow"><button onclick="App.pick('readMeter','${m.id}');App.go('read')">📷 Ablesen</button></div></div>`;
  const maxV = Math.max(a.costToDate, a.paidToDate, 1);
  return `<div class="card">${head}
    <div class="grid2">
      <div class="stat"><div class="l">Verbrauch seit ${deDate(a.start)}</div><div class="v">${fmtNum(a.cons, a.cons < 100 ? 1 : 0)} ${T.unit}</div></div>
      <div class="stat"><div class="l">Letzte Ablesung</div><div class="v">${deDate(a.last.date)}</div></div>
      <div class="stat"><div class="l">Kosten bisher</div><div class="v">${fmtEur(a.costToDate)}</div></div>
      <div class="stat"><div class="l">Abschläge bezahlt (${a.months})</div><div class="v">${fmtEur(a.paidToDate)}</div></div>
    </div>
    <div class="bar" title="Kosten"><span style="width:${a.costToDate / maxV * 100}%;background:${T.color}"></span></div>
    <div class="bar" title="Abschläge"><span style="width:${a.paidToDate / maxV * 100}%;background:var(--accent)"></span></div>
    <div class="legend"><span><i style="background:${T.color}"></i>Kosten</span><span><i style="background:var(--accent)"></i>Abschläge</span></div>
    <h3>Stand heute</h3>
    <div class="row between"><span>${a.balanceNow >= 0 ? 'Guthaben' : 'Rückstand'}</span><b style="color:${a.balanceNow >= 0 ? 'var(--good)' : 'var(--bad)'}">${fmtEur(Math.abs(a.balanceNow))}</b></div>
    ${a.projCost != null ? `<h3>Prognose für 12 Monate</h3>
    <div class="row between small"><span>Verbrauch</span><span>${fmtNum(a.projCons)} ${T.unit}</span></div>
    <div class="row between small"><span>Kosten</span><span>${fmtEur(a.projCost)}</span></div>
    <div class="row between small"><span>Abschläge (12 × ${fmtEur(a.tariff.advance)})</span><span>${fmtEur(a.paidYear)}</span></div>
    <div class="row between" style="margin-top:6px"><b>${a.balanceYear >= 0 ? 'Guthaben' : 'Nachzahlung'}</b><b style="color:${a.balanceYear >= 0 ? 'var(--good)' : 'var(--bad)'}">${fmtEur(Math.abs(a.balanceYear))}</b></div>
    <div class="hint">Hochrechnung ${a.method}. Passender Abschlag: ca. ${fmtEur(a.suggested)} / Monat.${a.note ? ' ' + a.note + '.' : ''}</div>` : `<div class="hint">Für eine Prognose braucht es mindestens zwei Wochen Messzeitraum.</div>`}
  </div>`;
}

/* ---------- Ablesen ---------- */
let photo = null; // { img, crop }
function renderRead() {
  const v = $('#view');
  if (!db.meters.length) { v.innerHTML = noMeters(); return; }
  if (!meterById(state.readMeter)) state.readMeter = (dueMeters()[0] || db.meters[0]).id;
  const m = meterById(state.readMeter), T = TYPES[m.type];
  const rs = readingsOf(m.id), last = rs[rs.length - 1];
  v.innerHTML = `${meterSeg(m.id, 'readMeter')}
  <div class="card">
    <div class="row" style="margin-bottom:8px">${typeIcon(m)}<div><b>${esc(m.name)}</b><div class="muted small">${last ? `Letzter Stand ${fmtNum(last.value, 2)} ${T.unit} am ${deDate(last.date)}` : 'Noch keine Ablesung'}</div></div></div>
    <label class="btn block" style="margin:8px 0 0;color:#fff;font-size:16px" for="cam">📷 Zähler fotografieren</label>
    <input id="cam" type="file" accept="image/*" capture="environment" style="display:none" onchange="App.onPhoto(this)">
    <div id="photoArea"></div>
    <label>Zählerstand (${T.unit})</label>
    <input id="rval" inputmode="decimal" placeholder="z. B. 12345,6" autocomplete="off">
    <div id="rsugg"></div><div id="rwarn"></div>
    <label>Datum</label>
    <input id="rdate" type="date" value="${todayISO()}">
    <div class="btnrow"><button onclick="App.saveReading()">Speichern</button></div>
  </div>
  <div class="card"><h2>Bisherige Ablesungen</h2>
    ${rs.length ? `<table><tr><th>Datum</th><th>Stand</th><th>Verbrauch</th><th></th></tr>
    ${rs.slice().reverse().slice(0, 24).map((r, i, arr) => {
      const prev = arr[i + 1];
      return `<tr><td>${deDate(r.date)}${r.source === 'rechnung' ? ' 🧾' : r.source === 'kamera' ? ' 📷' : ''}</td><td>${fmtNum(r.value, 2)}</td><td>${prev ? '+' + fmtNum(r.value - prev.value, 1) : ''}</td><td><button class="ghost" onclick="App.delReading('${r.id}')">✕</button></td></tr>`;
    }).join('')}</table>` : '<p class="muted">Noch keine Werte.</p>'}
  </div>`;
  $('#rval').addEventListener('input', checkReading);
}
function checkReading() {
  const m = meterById(state.readMeter), val = parseDe($('#rval').value), date = $('#rdate').value;
  const prev = readingsOf(m.id).filter(r => r.date <= date).pop();
  let w = '';
  if (prev && !isNaN(val)) {
    if (val < prev.value) w = `Der Wert ist kleiner als der letzte Stand (${fmtNum(prev.value, 2)}). Bitte prüfen – oder wurde der Zähler getauscht?`;
    else {
      const rs = readingsOf(m.id), d = daysBetween(prev.date, date);
      if (rs.length >= 2 && d > 0) {
        const avg = (rs[rs.length - 1].value - rs[0].value) / Math.max(1, daysBetween(rs[0].date, rs[rs.length - 1].date));
        const now = (val - prev.value) / d;
        if (avg > 0 && now > avg * 4) w = `Ungewöhnlich hoher Verbrauch (${fmtNum(now, 1)} statt Ø ${fmtNum(avg, 1)} ${TYPES[m.type].unit}/Tag). Nachkommastellen richtig?`;
      }
    }
  }
  $('#rwarn').innerHTML = w ? `<div class="warn">⚠️ ${w}</div>` : '';
}
function onPhoto(input) {
  const f = input.files[0]; if (!f) return;
  const img = new Image();
  img.onload = () => { photo = { img, crop: null }; drawCrop(); recognize(); };
  img.src = URL.createObjectURL(f);
  input.value = '';
}
function drawCrop() {
  const area = $('#photoArea'); if (!area || !photo) return;
  if (!$('#cropc')) {
    area.innerHTML = `<div class="cropwrap"><canvas id="cropc"></canvas></div>
      <div class="hint">Tipp: Ziehe mit dem Finger einen Rahmen nur um die Ziffern – dann wird die Erkennung genauer.</div>
      <div class="btnrow"><button class="secondary" id="ocrbtn" onclick="App.recognize()">🔍 Ziffern erkennen</button></div>`;
    const c = $('#cropc');
    const scale = Math.min(1, 1400 / photo.img.width);
    c.width = Math.round(photo.img.width * scale); c.height = Math.round(photo.img.height * scale);
    let start = null;
    const pos = e => { const r = c.getBoundingClientRect(); return { x: (e.clientX - r.left) * c.width / r.width, y: (e.clientY - r.top) * c.height / r.height }; };
    c.addEventListener('pointerdown', e => { c.setPointerCapture(e.pointerId); start = pos(e); });
    c.addEventListener('pointermove', e => {
      if (!start) return; const p = pos(e);
      photo.crop = { x: Math.min(start.x, p.x), y: Math.min(start.y, p.y), w: Math.abs(p.x - start.x), h: Math.abs(p.y - start.y) };
      paint();
    });
    c.addEventListener('pointerup', () => { start = null; if (photo.crop && (photo.crop.w < 20 || photo.crop.h < 10)) photo.crop = null; paint(); if (photo.crop) recognize(); });
  }
  paint();
}
function paint() {
  const c = $('#cropc'); if (!c) return; const g = c.getContext('2d');
  g.drawImage(photo.img, 0, 0, c.width, c.height);
  const k = photo.crop;
  if (k) {
    g.fillStyle = 'rgba(0,0,0,.45)';
    g.fillRect(0, 0, c.width, k.y); g.fillRect(0, k.y + k.h, c.width, c.height - k.y - k.h);
    g.fillRect(0, k.y, k.x, k.h); g.fillRect(k.x + k.w, k.y, c.width - k.x - k.w, k.h);
    g.strokeStyle = '#2dd4bf'; g.lineWidth = 4; g.strokeRect(k.x, k.y, k.w, k.h);
  }
}
/* Bildaufbereitung: Ausschnitt, Graustufen, Schwellwert nach Otsu, ggf. invertieren */
function prepare(invertOverride) {
  const c = $('#cropc'), sx = photo.img.width / c.width;
  const k = photo.crop || { x: 0, y: 0, w: c.width, h: c.height };
  const targetH = Math.min(220, Math.max(90, k.h * sx));
  const scale = Math.min(targetH / (k.h * sx), 2000 / (k.w * sx), 3);
  const out = document.createElement('canvas');
  out.width = Math.max(1, Math.round(k.w * sx * scale)); out.height = Math.max(1, Math.round(k.h * sx * scale));
  const g = out.getContext('2d', { willReadFrequently: true });
  g.drawImage(photo.img, k.x * sx, k.y * sx, k.w * sx, k.h * sx, 0, 0, out.width, out.height);
  const id = g.getImageData(0, 0, out.width, out.height), d = id.data, hist = new Array(256).fill(0);
  for (let i = 0; i < d.length; i += 4) { const y = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000 | 0; d[i] = y; hist[y]++; }
  const total = d.length / 4; let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sB = 0, wB = 0, best = 0, thr = 128;
  for (let i = 0; i < 256; i++) { wB += hist[i]; if (!wB) continue; const wF = total - wB; if (!wF) break; sB += i * hist[i]; const mB = sB / wB, mF = (sum - sB) / wF, v = wB * wF * (mB - mF) ** 2; if (v > best) { best = v; thr = i; } }
  let dark = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < thr) dark++;
  const invert = invertOverride ?? (dark > total / 2); // überwiegend dunkel → helle Ziffern auf dunklem Grund
  for (let i = 0; i < d.length; i += 4) { let v = d[i] < thr ? 0 : 255; if (invert) v = 255 - v; d[i] = d[i + 1] = d[i + 2] = v; }
  g.putImageData(id, 0, 0);
  return { canvas: out, invert };
}
let ocrWorker = null;
async function digitWorker() {
  if (ocrWorker) return ocrWorker;
  await loadScript(CDN.tesseract);
  ocrWorker = await Tesseract.createWorker('eng');
  await ocrWorker.setParameters({ tessedit_char_whitelist: '0123456789', tessedit_pageseg_mode: '7' });
  return ocrWorker;
}
function digitsFrom(text) {
  const t = String(text).replace(/(\d)\s+(?=\d)/g, '$1');
  const all = t.match(/\d+/g) || [];
  return all.sort((a, b) => b.length - a.length)[0] || '';
}
async function recognize() {
  if (!photo || !$('#cropc')) return;
  const btn = $('#ocrbtn'); if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Erkenne…'; }
  try {
    const w = await digitWorker();
    const p1 = prepare();
    let r = await w.recognize(p1.canvas);
    let digits = digitsFrom(r.data.text), conf = r.data.confidence;
    if (digits.length < 4) {
      const p2 = prepare(!p1.invert); const r2 = await w.recognize(p2.canvas);
      const d2 = digitsFrom(r2.data.text);
      if (d2.length > digits.length) { digits = d2; conf = r2.data.confidence; }
    }
    if (!digits) { toast('Keine Ziffern erkannt – Rahmen enger um die Ziffern ziehen oder Wert eintippen.'); return; }
    offerCandidates(digits, conf);
  } catch (e) {
    toast('Texterkennung nicht möglich: ' + e.message, 4000);
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '🔍 Ziffern erkennen'; }
  }
}
/* Zähler haben oft 1–3 Nachkommastellen (rote Rollen). Vorschläge passend zum letzten Stand. */
function offerCandidates(digits, conf) {
  const m = meterById(state.readMeter), last = readingsOf(m.id).pop();
  const raw = parseInt(digits, 10), cands = [];
  for (let k = 0; k <= 3; k++) { const v = raw / 10 ** k; if (k === 0 || digits.length - k >= 3) cands.push(v); }
  let best = cands[0];
  if (last) {
    const days = Math.max(1, daysBetween(last.date, $('#rdate').value || todayISO()));
    const ok = cands.filter(v => v >= last.value && (v - last.value) / days < 500);
    if (ok.length) best = ok.reduce((a, b) => (Math.abs(a - last.value) < Math.abs(b - last.value) ? a : b));
  }
  $('#rval').value = numIn(best);
  $('#rsugg').innerHTML = `<div class="hint">Erkannt: <b>${esc(digits)}</b> (Sicherheit ${Math.round(conf)} %). Bitte prüfen und ggf. korrigieren.</div>
   <div class="btnrow">${[...new Set(cands)].map(v => `<button class="secondary" style="flex:0 0 auto;padding:7px 12px" onclick="document.getElementById('rval').value='${numIn(v)}';App.check()">${fmtNum(v, Math.max(0, String(v).split('.')[1]?.length || 0))}</button>`).join('')}</div>`;
  checkReading();
  photo.lastSource = 'kamera';
}
function saveReading() {
  const m = meterById(state.readMeter), value = parseDe($('#rval').value), date = $('#rdate').value;
  if (isNaN(value)) { toast('Bitte einen Zählerstand eingeben.'); return; }
  if (!date) { toast('Bitte ein Datum wählen.'); return; }
  db.readings.push({ id: uid(), meterId: m.id, date, value, source: photo?.lastSource || 'manuell' });
  save(); photo = null;
  toast(`${TYPES[m.type].label}: ${fmtNum(value, 2)} ${TYPES[m.type].unit} gespeichert`);
  const next = dueMeters()[0];
  if (next && next.id !== m.id) state.readMeter = next.id;
  renderRead();
}
function delReading(id) {
  if (!confirm('Diese Ablesung löschen?')) return;
  db.readings = db.readings.filter(r => r.id !== id); save(); renderRead();
}

/* ---------- Rechnungen ---------- */
function renderBills() {
  const v = $('#view');
  let html = `<div class="card"><h2>Abrechnung hochladen</h2>
    <p class="muted small" style="margin-top:0">PDF oder Foto deiner Strom-, Gas- oder Wasserabrechnung. Die Auswertung läuft komplett auf deinem iPhone, nichts wird hochgeladen.</p>
    <label class="btn block" style="margin:0;color:#fff;font-size:16px" for="billf">🧾 Datei oder Foto wählen</label>
    <input id="billf" type="file" accept="application/pdf,image/*" style="display:none" onchange="App.onBill(this)">
    <div id="billStatus"></div>
    <div class="btnrow"><button class="ghost" onclick="App.reviewBill({})">Werte von Hand eintragen</button></div></div>`;
  if (db.meters.length) {
    if (!meterById(state.billMeter)) state.billMeter = db.meters[0].id;
    const m = meterById(state.billMeter), T = TYPES[m.type], bs = billsOf(m.id), t = tariffAt(m.id, todayISO());
    html += meterSeg(m.id, 'billMeter');
    html += `<div class="card"><div class="row between"><h2 style="margin:0">Aktueller Tarif</h2><button class="ghost" onclick="App.editTariff('${m.id}')">${t ? 'Bearbeiten' : 'Eintragen'}</button></div>
      ${t ? `<div class="list small" style="margin-top:6px">
        <div class="row between"><span>Gültig ab</span><b>${deDate(t.validFrom)}</b></div>
        <div class="row between"><span>${m.type === 'wasser' ? 'Wasserpreis' : 'Arbeitspreis'}</span><b>${m.type === 'wasser' ? fmtEur(t.workPrice) + '/m³' : fmtNum(t.workPrice * 100, 2) + ' ct/kWh'}</b></div>
        ${m.type === 'wasser' && t.extraPerUnit ? `<div class="row between"><span>Abwasser</span><b>${fmtEur(t.extraPerUnit)}/m³</b></div>` : ''}
        ${m.type === 'gas' ? `<div class="row between"><span>Umrechnung</span><b>${fmtNum(t.gasFactor, 3)} kWh/m³</b></div>` : ''}
        <div class="row between"><span>Grundpreis</span><b>${fmtEur(t.basePerYear)}/Jahr</b></div>
        <div class="row between"><span>Abschlag</span><b>${fmtEur(t.advance)}/Monat</b></div></div>` : '<p class="muted">Noch kein Tarif.</p>'}</div>`;
    html += `<div class="card"><h2>Abrechnungen ${esc(m.name)}</h2>${bs.length ? `<table><tr><th>Zeitraum</th><th>Verbrauch</th><th>Kosten</th><th>Ergebnis</th><th></th></tr>
      ${bs.slice().reverse().map(b => `<tr><td>${deDate(b.from).slice(0, 6)}${b.from.slice(2, 4)}–${deDate(b.to)}</td><td>${fmtNum(b.consumption)} ${T.unit}</td><td>${fmtEur(b.cost)}</td>
      <td style="color:${(b.paid - b.cost) >= 0 ? 'var(--good)' : 'var(--bad)'}">${b.paid ? ((b.paid - b.cost) >= 0 ? '+' : '−') + fmtEur(Math.abs(b.paid - b.cost)) : '–'}</td>
      <td><button class="ghost" onclick="App.delBill('${b.id}')">✕</button></td></tr>`).join('')}</table>` : '<p class="muted">Noch keine Abrechnungen gespeichert.</p>'}</div>`;
  }
  v.innerHTML = html;
}
async function onBill(input) {
  const f = input.files[0]; if (!f) return; input.value = '';
  const st = $('#billStatus');
  const status = s => st.innerHTML = `<div class="hint row"><span class="spinner"></span> ${s}</div>`;
  try {
    let text = '';
    if (f.type === 'application/pdf' || /\.pdf$/i.test(f.name)) {
      status('PDF wird gelesen…');
      text = await pdfText(f);
      if (text.replace(/\s/g, '').length < 80) { status('PDF ist gescannt – Texterkennung läuft…'); text = await pdfOcr(f, status); }
    } else {
      status('Texterkennung läuft (beim ersten Mal wird das deutsche Sprachpaket geladen)…');
      text = await imageOcr(f, status);
    }
    st.innerHTML = '';
    const parsed = parseBill(text);
    parsed.raw = text;
    reviewBill(parsed);
  } catch (e) {
    st.innerHTML = `<div class="warn">⚠️ ${esc(e.message)}</div>`;
  }
}
async function pdfLib() {
  const lib = await import(CDN.pdfjs);
  lib.GlobalWorkerOptions.workerSrc = CDN.pdfjsWorker;
  return lib;
}
async function pdfText(file) {
  const lib = await pdfLib();
  const doc = await lib.getDocument({ data: await file.arrayBuffer() }).promise;
  let out = '';
  for (let p = 1; p <= Math.min(doc.numPages, 12); p++) {
    const tc = await (await doc.getPage(p)).getTextContent();
    let line = '';
    for (const it of tc.items) { line += it.str + (it.hasEOL ? '\n' : ' '); }
    out += line + '\n';
  }
  return out;
}
async function pdfOcr(file, status) {
  const lib = await pdfLib();
  const doc = await lib.getDocument({ data: await file.arrayBuffer() }).promise;
  await loadScript(CDN.tesseract);
  const w = await Tesseract.createWorker('deu');
  let out = '';
  for (let p = 1; p <= Math.min(doc.numPages, 4); p++) {
    status(`Seite ${p} von ${Math.min(doc.numPages, 4)} wird erkannt…`);
    const page = await doc.getPage(p), vp = page.getViewport({ scale: 2 });
    const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height;
    await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
    out += (await w.recognize(c)).data.text + '\n';
  }
  await w.terminate();
  return out;
}
async function imageOcr(file) {
  await loadScript(CDN.tesseract);
  const w = await Tesseract.createWorker('deu');
  const { data } = await w.recognize(file);
  await w.terminate();
  return data.text;
}

/* Erkennung typischer Angaben deutscher Versorgerabrechnungen */
const NUM = '(\\d{1,3}(?:\\.\\d{3})+(?:,\\d+)?|\\d+(?:,\\d+)?)';
function find(text, labels, after = '[^\\d\\n]{0,60}?', unit = '') {
  for (const l of labels) {
    const re = new RegExp(`(?:${l})${after}${NUM}\\s*${unit}`, 'i');
    const m = text.match(re); if (m) return { value: parseDe(m[1]), index: m.index, match: m[0] };
  }
  return null;
}
function parseBill(raw) {
  const text = raw.replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/m3\b|cbm\b|Kubikmeter/gi, 'm³');
  const low = text.toLowerCase();
  const r = {};
  const score = { strom: (low.match(/strom|kwh/g) || []).length, gas: (low.match(/erdgas|\bgas|brennwert|zustandszahl/g) || []).length * 2, wasser: (low.match(/trinkwasser|abwasser|schmutzwasser|wasser/g) || []).length * 2 };
  if (/brennwert|zustandszahl/.test(low)) score.gas += 10;
  r.type = Object.entries(score).sort((a, b) => b[1] - a[1])[0][0];
  const unitRe = r.type === 'strom' ? 'kWh' : 'm³';

  const per = text.match(/(\d{1,2}\.\d{1,2}\.\d{2,4})\s*(?:-|–|bis|\/)\s*(\d{1,2}\.\d{1,2}\.\d{2,4})/);
  if (per) { r.from = parseDeDate(per[1]); r.to = parseDeDate(per[2]); }
  const zn = text.match(/Z(?:ä|ae)hler(?:nummer|-?nr\.?)\s*:?\s*([A-Z0-9][A-Z0-9 \-]{4,22}[A-Z0-9])/i);
  if (zn) r.number = zn[1].trim();

  const cons = find(text, ['Verbrauch', 'Gesamtverbrauch', 'Menge'], '[^\\d\\n]{0,50}?', unitRe);
  if (cons) r.consumption = cons.value;
  if (r.type === 'gas') {
    const kwh = find(text, ['Verbrauch', 'Energiemenge', 'Gesamtverbrauch', 'thermische'], '[^\\n]{0,80}?', 'kWh');
    if (kwh) r.kwh = kwh.value;
    const bw = find(text, ['Brennwert'], '[^\\d\\n]{0,40}?'); const zz = find(text, ['Zustandszahl'], '[^\\d\\n]{0,40}?');
    if (bw && zz && bw.value > 8 && bw.value < 14 && zz.value > 0.8 && zz.value < 1.05) r.gasFactor = bw.value * zz.value;
    else if (r.kwh && r.consumption) r.gasFactor = r.kwh / r.consumption;
  }
  const endS = find(text, ['Zählerstand neu', 'neuer Zählerstand', 'Endstand', 'Ablesestand neu', 'Stand neu'], '[^\\d\\n]{0,40}?');
  if (endS) r.endReading = endS.value;
  const startS = find(text, ['Zählerstand alt', 'alter Zählerstand', 'Anfangsstand', 'Stand alt'], '[^\\d\\n]{0,40}?');
  if (startS) r.startReading = startS.value;

  if (r.type === 'wasser') {
    const wp = find(text, ['Wasserpreis', 'Mengenpreis', 'Verbrauchspreis', 'Trinkwasser'], '[^\\n]{0,60}?', '(?:€|EUR)?\\s*(?:\\/|je|pro)\\s*m³');
    if (wp) r.workPrice = wp.value;
    const ab = find(text, ['Abwasser', 'Schmutzwasser'], '[^\\n]{0,60}?', '(?:€|EUR)?\\s*(?:\\/|je|pro)\\s*m³');
    if (ab) r.extraPerUnit = ab.value;
  } else {
    const ap = find(text, ['Arbeitspreis', 'Verbrauchspreis', 'Energiepreis'], '[^\\n]{0,60}?', '(ct|Cent|€|EUR)?');
    if (ap) { const m = ap.match.match(/(ct|cent)\s*$/i); r.workPrice = (m || ap.value > 1.5) ? ap.value / 100 : ap.value; }
  }
  const gp = text.match(new RegExp(`(?:Grundpreis|Grundgebühr|Grundgebuehr|Zählermiete)[^\\d\\n]{0,60}?${NUM}\\s*(?:€|EUR)?\\s*(?:\\/|je|pro)?\\s*(Jahr|Monat|Tag|Mon|a\\b)?`, 'i'));
  if (gp) { let v = parseDe(gp[1]); const u = (gp[2] || '').toLowerCase(); if (u.startsWith('mon')) v *= 12; else if (u === 'tag') v *= 365; r.basePerYear = v; }

  const adv = find(text, ['neuer Abschlag', 'künftige[rn]? Abschlag', 'zukünftige[rn]? Abschlag', 'monatliche[rn]? Abschlag', 'Abschlagsbetrag', 'Abschlag ab', 'Abschlag'], '[^\\n]{0,70}?', '(?:€|EUR)');
  if (adv) r.advance = adv.value;
  const paid = find(text, ['geleistete Abschläge', 'gezahlte Abschläge', 'bezahlte Abschläge', 'Summe der Abschläge', 'abzüglich Abschläge', 'Abschlagszahlungen'], '[^\\d\\n]{0,50}?', '(?:€|EUR)?');
  if (paid) r.paid = paid.value;
  const total = find(text, ['Gesamtbetrag', 'Rechnungsbetrag', 'Gesamtkosten', 'Summe brutto', 'Bruttobetrag', 'Gesamtsumme'], '[^\\d\\n]{0,50}?', '(?:€|EUR)?');
  if (total) r.cost = total.value;
  const res = text.match(new RegExp(`(Nachzahlung|Guthaben|Rückzahlung|Erstattung)[^\\d\\n]{0,50}?${NUM}`, 'i'));
  if (res) { r.resultAbs = parseDe(res[2]); r.resultSign = /nachzahlung/i.test(res[1]) ? -1 : 1; }
  if (r.cost && !r.paid && r.resultAbs) r.paid = r.cost + r.resultSign * r.resultAbs;
  if (!r.cost && r.paid && r.resultAbs) r.cost = r.paid - r.resultSign * r.resultAbs;
  return r;
}

function reviewBill(p) {
  const types = Object.keys(TYPES);
  const meterOpts = db.meters.map(m => `<option value="${m.id}">${TYPES[m.type].icon} ${esc(m.name)}${m.number ? ' · ' + esc(m.number) : ''}</option>`).join('');
  let preMeter = '';
  if (p.number) preMeter = (db.meters.find(m => m.number && m.number.replace(/\s/g, '') === p.number.replace(/\s/g, '')) || {}).id || '';
  if (!preMeter && p.type) preMeter = (db.meters.find(m => m.type === p.type) || {}).id || '';
  const type = p.type || (meterById(preMeter) || {}).type || 'strom';
  const found = Object.keys(p).filter(k => !['raw', 'type', 'resultAbs', 'resultSign'].includes(k)).length;
  const sh = openSheet(`<h2>Rechnung prüfen</h2>
    <p class="muted small" style="margin-top:0">${p.raw ? `${found} Werte automatisch erkannt. Bitte kontrollieren und Fehlendes ergänzen.` : 'Trage die Werte aus deiner Abrechnung ein.'}</p>
    <label>Zähler</label><select name="meter" id="bm"><option value="">➕ Neuer Zähler…</option>${meterOpts}</select>
    <div id="newm"><div class="grid2"><div><label>Art</label><select name="type" id="btype">${types.map(t => `<option value="${t}" ${t === type ? 'selected' : ''}>${TYPES[t].icon} ${TYPES[t].label}</option>`).join('')}</select></div>
      <div><label>Zählernummer</label><input name="number" value="${esc(p.number || '')}"></div></div></div>
    <h3>Abgerechneter Zeitraum</h3>
    <div class="grid2"><div><label>von</label><input type="date" name="from" value="${p.from || ''}"></div><div><label>bis</label><input type="date" name="to" value="${p.to || ''}"></div></div>
    <div class="grid2"><div><label>Zählerstand Anfang</label><input name="startReading" inputmode="decimal" value="${numIn(p.startReading)}"></div><div><label>Zählerstand Ende</label><input name="endReading" inputmode="decimal" value="${numIn(p.endReading)}"></div></div>
    <div class="grid2"><div><label>Verbrauch (<span class="u">${TYPES[type].unit}</span>)</label><input name="consumption" inputmode="decimal" value="${numIn(p.consumption)}"></div>
      <div class="gasonly"><label>Verbrauch (kWh)</label><input name="kwh" inputmode="decimal" value="${numIn(p.kwh)}"></div></div>
    <div class="grid2"><div><label>Gesamtkosten (€)</label><input name="cost" inputmode="decimal" value="${numIn(p.cost)}"></div><div><label>Gezahlte Abschläge (€)</label><input name="paid" inputmode="decimal" value="${numIn(p.paid)}"></div></div>
    <div id="bres" class="hint"></div>
    <h3>Tarif ab der Abrechnung</h3>
    <div class="grid2"><div><label class="wp">${TYPES[type].priceLabel}</label><input name="workPrice" inputmode="decimal" value="${p.workPrice != null ? numIn(type === 'wasser' ? p.workPrice : p.workPrice * 100) : ''}"></div>
      <div><label>Grundpreis (€/Jahr)</label><input name="basePerYear" inputmode="decimal" value="${numIn(p.basePerYear)}"></div></div>
    <div class="grid2"><div><label>Neuer Abschlag (€/Monat)</label><input name="advance" inputmode="decimal" value="${numIn(p.advance)}"></div>
      <div><label>Gültig ab</label><input type="date" name="validFrom" value="${p.to ? addDays(p.to, 1) : ''}"></div></div>
    <div class="grid2"><div class="gasonly"><label>Umrechnung (kWh/m³)</label><input name="gasFactor" inputmode="decimal" value="${numIn(p.gasFactor ?? 10.5)}"></div>
      <div class="wateronly"><label>Abwasser (€/m³)</label><input name="extraPerUnit" inputmode="decimal" value="${numIn(p.extraPerUnit)}"></div></div>
    <div class="hint gasonly">Gas wird in m³ gemessen, aber in kWh abgerechnet: kWh = m³ × Brennwert × Zustandszahl (steht auf der Rechnung, meist ≈ 10–11).</div>
    ${p.raw ? `<details><summary>Erkannten Text anzeigen</summary><pre class="raw">${esc(p.raw.slice(0, 6000))}</pre></details>` : ''}
    <div class="btnrow"><button class="secondary" onclick="App.closeSheet()">Abbrechen</button><button onclick="App.saveBill()">Speichern</button></div>`);
  const bm = $('#bm', sh); bm.value = preMeter;
  const upd = () => {
    const m = meterById(bm.value), t = m ? m.type : $('#btype', sh).value;
    $('#newm', sh).style.display = m ? 'none' : '';
    $$('.gasonly', sh).forEach(e => e.style.display = t === 'gas' ? '' : 'none');
    $$('.wateronly', sh).forEach(e => e.style.display = t === 'wasser' ? '' : 'none');
    $('.u', sh).textContent = TYPES[t].unit; $('.wp', sh).textContent = TYPES[t].priceLabel;
    const f = formData(sh), c = parseDe(f.cost), pd = parseDe(f.paid);
    $('#bres', sh).innerHTML = !isNaN(c) && !isNaN(pd) ? `Ergebnis dieser Abrechnung: <b style="color:${pd - c >= 0 ? 'var(--good)' : 'var(--bad)'}">${pd - c >= 0 ? 'Guthaben' : 'Nachzahlung'} ${fmtEur(Math.abs(pd - c))}</b>` : '';
    // Verbrauch aus Zählerständen ableiten
    const s = parseDe(f.startReading), e = parseDe(f.endReading), ci = $('[name=consumption]', sh);
    if (!ci.value && !isNaN(s) && !isNaN(e) && e > s) ci.value = numIn(e - s);
  };
  sh.addEventListener('input', upd); sh.addEventListener('change', upd); upd();
}
function saveBill() {
  const sh = $('.sheet'), f = formData(sh);
  let m = meterById(f.meter);
  if (!m) {
    m = { id: uid(), type: f.type, name: TYPES[f.type].label + (db.meters.some(x => x.type === f.type) ? ' 2' : ''), number: f.number.trim() };
    db.meters.push(m);
  }
  const n = k => { const v = parseDe(f[k]); return isNaN(v) ? null : v; };
  const s = n('startReading'), e = n('endReading');
  let consumption = n('consumption'); if (consumption == null && s != null && e != null) consumption = e - s;
  if (f.from && f.to && (consumption != null || n('cost') != null)) {
    db.bills.push({ id: uid(), meterId: m.id, from: f.from, to: f.to, consumption, kwh: n('kwh'), cost: n('cost'), paid: n('paid') });
  }
  const addR = (date, value) => { if (date && value != null && !db.readings.some(r => r.meterId === m.id && r.date === date)) db.readings.push({ id: uid(), meterId: m.id, date, value, source: 'rechnung' }); };
  addR(f.from, s); addR(f.to, e);
  const wp = n('workPrice');
  if (f.validFrom && (wp != null || n('advance') != null)) {
    db.tariffs = db.tariffs.filter(t => !(t.meterId === m.id && t.validFrom === f.validFrom));
    db.tariffs.push({
      id: uid(), meterId: m.id, validFrom: f.validFrom,
      workPrice: wp == null ? 0 : (m.type === 'wasser' ? wp : wp / 100),
      basePerYear: n('basePerYear') || 0, advance: n('advance') || 0,
      gasFactor: m.type === 'gas' ? (n('gasFactor') || 10.5) : undefined,
      extraPerUnit: m.type === 'wasser' ? (n('extraPerUnit') || 0) : undefined,
    });
  }
  save(); closeSheet(); state.billMeter = m.id; toast('Rechnung gespeichert'); renderBills();
}
function delBill(id) { if (!confirm('Diese Abrechnung löschen?')) return; db.bills = db.bills.filter(b => b.id !== id); save(); renderBills(); }

function editTariff(meterId, tariffId) {
  const m = meterById(meterId), t = db.tariffs.find(x => x.id === tariffId) || tariffAt(meterId, todayISO()) || {};
  const sh = openSheet(`<h2>Tarif ${esc(m.name)}</h2>
    <label>Gültig ab (Beginn des Abrechnungszeitraums)</label><input type="date" name="validFrom" value="${t.validFrom || `${todayISO().slice(0, 4)}-01-01`}">
    <div class="grid2"><div><label>${TYPES[m.type].priceLabel}</label><input name="workPrice" inputmode="decimal" value="${t.workPrice != null ? numIn(m.type === 'wasser' ? t.workPrice : t.workPrice * 100) : ''}"></div>
    <div><label>Grundpreis (€/Jahr)</label><input name="basePerYear" inputmode="decimal" value="${numIn(t.basePerYear)}"></div></div>
    <div class="grid2"><div><label>Abschlag (€/Monat)</label><input name="advance" inputmode="decimal" value="${numIn(t.advance)}"></div>
    ${m.type === 'gas' ? `<div><label>Umrechnung (kWh/m³)</label><input name="gasFactor" inputmode="decimal" value="${numIn(t.gasFactor ?? 10.5)}"></div>` : ''}
    ${m.type === 'wasser' ? `<div><label>Abwasser (€/m³)</label><input name="extraPerUnit" inputmode="decimal" value="${numIn(t.extraPerUnit)}"></div>` : ''}</div>
    <label>Zählerstand zu Beginn (optional)</label><input name="startReading" inputmode="decimal" value="${numIn(t.validFrom ? valueAt(m.id, t.validFrom) : null)}" placeholder="Stand am Gültig-ab-Datum">
    <div class="btnrow"><button class="secondary" onclick="App.closeSheet()">Abbrechen</button><button id="tsave">Speichern</button></div>`);
  $('#tsave', sh).onclick = () => {
    const f = formData(sh), n = k => { const v = parseDe(f[k]); return isNaN(v) ? null : v; };
    if (!f.validFrom) { toast('Bitte „Gültig ab“ angeben.'); return; }
    db.tariffs = db.tariffs.filter(x => x.id !== t.id && !(x.meterId === m.id && x.validFrom === f.validFrom));
    db.tariffs.push({ id: t.id || uid(), meterId: m.id, validFrom: f.validFrom, workPrice: n('workPrice') == null ? 0 : (m.type === 'wasser' ? n('workPrice') : n('workPrice') / 100),
      basePerYear: n('basePerYear') || 0, advance: n('advance') || 0, gasFactor: m.type === 'gas' ? (n('gasFactor') || 10.5) : undefined, extraPerUnit: m.type === 'wasser' ? (n('extraPerUnit') || 0) : undefined });
    const sr = n('startReading');
    if (sr != null) { db.readings = db.readings.filter(r => !(r.meterId === m.id && r.date === f.validFrom)); db.readings.push({ id: uid(), meterId: m.id, date: f.validFrom, value: sr, source: 'manuell' }); }
    save(); closeSheet(); toast('Tarif gespeichert'); rerender();
  };
}

/* ---------- Statistik ---------- */
function renderStats() {
  const v = $('#view');
  if (!db.meters.length) { v.innerHTML = noMeters(); return; }
  if (!meterById(state.statMeter)) state.statMeter = db.meters[0].id;
  const m = meterById(state.statMeter), T = TYPES[m.type], rs = readingsOf(m.id);
  let html = meterSeg(m.id, 'statMeter');
  if (rs.length < 2) { v.innerHTML = html + `<div class="card empty"><div class="e">📊</div><p class="muted">Für eine Statistik braucht es mindestens zwei Zählerstände.</p></div>`; return; }
  const first = rs[0].date, last = rs[rs.length - 1].date;
  const years = [];
  for (let y = +first.slice(0, 4); y <= +last.slice(0, 4); y++) {
    const s = `${y}-01-01` < first ? first : `${y}-01-01`, e = `${y + 1}-01-01` > last ? last : `${y + 1}-01-01`;
    if (e <= s) continue;
    const cons = valueAt(m.id, e) - valueAt(m.id, s), days = daysBetween(s, e);
    const t = tariffAt(m.id, `${y}-07-01`), cost = t ? cons * unitCost(m, t) + (t.basePerYear || 0) * days / 365 : null;
    years.push({ y, cons, days, perDay: cons / days, partial: days < 360, cost });
  }
  html += `<div class="card"><h2>Verbrauch pro Jahr</h2><div class="chart">${barChart(years.map(x => x.y + (x.partial ? '*' : '')), [{ color: T.color, values: years.map(x => x.cons) }], T.unit)}</div>
    <table style="margin-top:8px"><tr><th>Jahr</th><th>Verbrauch</th><th>Ø/Tag</th><th>Δ Vorjahr</th><th>Kosten*</th></tr>
    ${years.map((x, i) => { const p = years[i - 1]; const d = p ? (x.perDay / p.perDay - 1) * 100 : null;
      return `<tr><td>${x.y}${x.partial ? ' <span class="muted small">(teilw.)</span>' : ''}</td><td>${fmtNum(x.cons)} ${T.unit}</td><td>${fmtNum(x.perDay, 2)}</td><td style="color:${d == null ? '' : d <= 0 ? 'var(--good)' : 'var(--bad)'}">${d == null ? '–' : (d > 0 ? '+' : '') + fmtNum(d, 1) + ' %'}</td><td>${fmtEur(x.cost)}</td></tr>`; }).join('')}</table>
    <div class="hint">Δ Vorjahr vergleicht den Tagesdurchschnitt, damit auch angefangene Jahre fair verglichen werden. *Kosten geschätzt mit dem jeweils gültigen Tarif.</div></div>`;

  // Monatsvergleich der letzten Jahre
  const ys = years.map(x => x.y).slice(-4);
  const series = ys.map((y, i) => ({
    name: String(y), color: YEAR_COLORS[(YEAR_COLORS.length - ys.length + i)],
    values: MONTHS.map((_, mi) => {
      const s = `${y}-${String(mi + 1).padStart(2, '0')}-01`, e = mi === 11 ? `${y + 1}-01-01` : `${y}-${String(mi + 2).padStart(2, '0')}-01`;
      if (s < first || e > last) return null;
      return valueAt(m.id, e) - valueAt(m.id, s);
    })
  }));
  if (series.some(s => s.values.some(x => x != null))) {
    html += `<div class="card"><h2>Monatsvergleich</h2><div class="chart">${barChart(MONTHS, series, T.unit)}</div>
      <div class="legend">${series.map(s => `<span><i style="background:${s.color}"></i>${s.name}</span>`).join('')}</div>
      <div class="hint">Monate ohne Ablesung am Monatsanfang und -ende fehlen. Darum: jeden Ersten ablesen.</div></div>`;
  }
  const bs = billsOf(m.id);
  if (bs.length) {
    html += `<div class="card"><h2>Abrechnungen im Vergleich</h2><table><tr><th>Zeitraum</th><th>Verbrauch</th><th>Kosten</th><th>Ergebnis</th></tr>
      ${bs.map((b, i) => { const p = bs[i - 1], d = p && p.consumption && b.consumption ? (b.consumption / p.consumption - 1) * 100 : null;
        return `<tr><td>${b.to.slice(0, 4)}</td><td>${fmtNum(b.consumption)}${d != null ? ` <span class="small" style="color:${d <= 0 ? 'var(--good)' : 'var(--bad)'}">${d > 0 ? '+' : ''}${fmtNum(d, 0)}%</span>` : ''}</td><td>${fmtEur(b.cost)}</td><td style="color:${b.paid - b.cost >= 0 ? 'var(--good)' : 'var(--bad)'}">${b.paid ? fmtEur(b.paid - b.cost) : '–'}</td></tr>`; }).join('')}</table></div>`;
  }
  v.innerHTML = html;
}
function barChart(labels, series, unit) {
  const W = 640, H = 240, L = 46, B = 26, Tp = 24, R = 6;
  const all = series.flatMap(s => s.values).filter(x => x != null);
  const max = niceMax(Math.max(...all, 1));
  const gw = (W - L - R) / labels.length, bw = Math.min(42, (gw * 0.78) / series.length);
  const y = v => Tp + (H - Tp - B) * (1 - v / max);
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img">`;
  for (let i = 0; i <= 4; i++) { const v = max * i / 4; s += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${fmtNum(v)}</text>`; }
  labels.forEach((lab, i) => {
    const gx = L + gw * i + (gw - bw * series.length) / 2;
    series.forEach((se, j) => { const v = se.values[i]; if (v == null) return; const x = gx + j * bw;
      s += `<rect x="${x + 1}" y="${y(Math.max(0, v))}" width="${Math.max(1, bw - 2)}" height="${Math.max(0, H - B - y(Math.max(0, v)))}" rx="3" fill="${se.color}"><title>${se.name ? se.name + ' ' : ''}${lab}: ${fmtNum(v, 1)} ${unit}</title></rect>`; });
    s += `<text x="${L + gw * i + gw / 2}" y="${H - 8}" text-anchor="middle">${esc(lab)}</text>`;
  });
  s += `<text x="${L - 6}" y="12" text-anchor="end" font-size="10">${unit}</text></svg>`;
  return s;
}
function niceMax(v) { const p = 10 ** Math.floor(Math.log10(v)); for (const k of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (k * p >= v) return k * p; return 10 * p; }

/* ---------- Mehr / Einstellungen ---------- */
function renderSettings() {
  const v = $('#view');
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  v.innerHTML = `
  ${!standalone ? `<div class="card"><h2>📲 Auf den Home-Bildschirm</h2><p class="small" style="margin:0">In Safari unten auf <b>Teilen</b> (□↑) tippen → <b>Zum Home-Bildschirm</b>. Dann startet die App im Vollbild, funktioniert offline und deine Daten bleiben dauerhaft erhalten.</p></div>` : ''}
  <div class="card"><h2>Zähler</h2><div class="list">${db.meters.map(m => `<div class="row">${typeIcon(m)}<div style="flex:1"><b>${esc(m.name)}</b><div class="muted small">${TYPES[m.type].label}${m.number ? ' · ' + esc(m.number) : ''} · ${readingsOf(m.id).length} Ablesungen</div></div>
    <button class="ghost" onclick="App.editTariff('${m.id}')">Tarif</button><button class="ghost" onclick="App.editMeter('${m.id}')">Bearbeiten</button></div>`).join('') || '<p class="muted">Noch keine Zähler.</p>'}</div>
    <div class="btnrow"><button class="secondary" onclick="App.editMeter()">➕ Zähler hinzufügen</button></div></div>
  <div class="card"><h2>🔔 Monatliche Erinnerung</h2>
    <p class="small" style="margin-top:0">Legt einen wiederkehrenden Termin am <b>1. jedes Monats</b> in deinem iPhone-Kalender an – mit Hinweis zur gewählten Uhrzeit.</p>
    <label>Uhrzeit</label><input type="time" id="remt" value="${db.settings.reminderTime || '09:00'}">
    <div class="btnrow"><button onclick="App.reminder()">📅 In Kalender eintragen</button></div>
    <div class="hint">Lieber in der Erinnerungen-App? Dort „Neue Erinnerung“ → „Zähler ablesen“ → Datum: nächster Monatserster → Wiederholen: Monatlich.</div></div>
  <div class="card"><h2>☁️ Sicherung</h2>
    <p class="small" style="margin-top:0">Deine Daten liegen nur auf diesem Gerät. Sichere sie regelmäßig: „Sichern“ → <b>In Dateien sichern</b> → <b>iCloud Drive</b>. Zum Wiederherstellen (z. B. auf einem neuen iPhone) die Datei hier wieder laden.</p>
    <div class="muted small">${db.settings.lastBackup ? 'Letzte Sicherung: ' + deDate(db.settings.lastBackup.slice(0, 10)) : 'Noch keine Sicherung'}</div>
    <div class="btnrow"><button onclick="App.exportData()">Sichern</button><label class="btn secondary" for="impf" style="margin:0">Wiederherstellen</label></div>
    <input id="impf" type="file" accept="application/json,.json" style="display:none" onchange="App.importData(this)">
    <div class="btnrow"><button class="ghost" onclick="App.exportCsv()">Ablesungen als CSV (für Excel/Numbers)</button></div></div>
  <div class="card"><h2>Sonstiges</h2>
    <div class="btnrow"><button class="secondary" onclick="App.demo()">Beispieldaten laden</button><button class="danger" onclick="App.wipe()">Alle Daten löschen</button></div>
    <p class="hint">Rechnungen und Fotos werden auf dem Gerät ausgewertet und nicht gespeichert, nur die erkannten Werte. Für die Texterkennung lädt die App beim ersten Mal einmalig die Bibliotheken nach (Internet nötig).</p></div>`;
}
function editMeter(id) {
  const m = meterById(id) || { type: 'strom', name: '', number: '' };
  const sh = openSheet(`<h2>${id ? 'Zähler bearbeiten' : 'Neuer Zähler'}</h2>
    <label>Art</label><select name="type" ${id ? 'disabled' : ''}>${Object.keys(TYPES).map(t => `<option value="${t}" ${t === m.type ? 'selected' : ''}>${TYPES[t].icon} ${TYPES[t].label}</option>`).join('')}</select>
    <label>Name</label><input name="name" value="${esc(m.name)}" placeholder="z. B. Strom Wohnung">
    <label>Zählernummer (optional)</label><input name="number" value="${esc(m.number)}">
    <div class="btnrow">${id ? `<button class="danger" id="mdel">Löschen</button>` : ''}<button id="msave">Speichern</button></div>`);
  $('#msave', sh).onclick = () => {
    const f = formData(sh);
    if (id) { m.name = f.name.trim() || TYPES[m.type].label; m.number = f.number.trim(); }
    else db.meters.push({ id: uid(), type: f.type, name: f.name.trim() || TYPES[f.type].label, number: f.number.trim() });
    save(); closeSheet(); rerender();
  };
  if (id) $('#mdel', sh).onclick = () => {
    if (!confirm(`„${m.name}“ mit allen Ablesungen, Tarifen und Abrechnungen löschen?`)) return;
    db.meters = db.meters.filter(x => x.id !== id);
    ['readings', 'tariffs', 'bills'].forEach(k => db[k] = db[k].filter(x => x.meterId !== id));
    save(); closeSheet(); rerender();
  };
}
function download(name, blob) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}
async function shareOrDownload(name, blob, title) {
  const file = new File([blob], name, { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title }); return true; }
    catch (e) { if (e.name === 'AbortError') return false; }
  }
  download(name, blob); return true;
}
async function exportData() {
  const data = { app: 'nebenkosten', exported: new Date().toISOString(), data: db };
  const name = `Nebenkosten-Sicherung-${todayISO()}.json`;
  const ok = await shareOrDownload(name, new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }), 'Nebenkosten-Sicherung');
  if (ok) { db.settings.lastBackup = new Date().toISOString(); db.settings.changedSinceBackup = false; localStorage.setItem(STORE_KEY, JSON.stringify(db)); toast('Sicherung erstellt'); rerender(); }
}
function importData(input) {
  const f = input.files[0]; if (!f) return; input.value = '';
  f.text().then(t => {
    const j = JSON.parse(t), d = j.data || j;
    if (!d.meters || !d.readings) throw new Error('Keine gültige Sicherungsdatei.');
    if (!confirm(`Sicherung vom ${j.exported ? deDate(j.exported.slice(0, 10)) : '?'} laden? Die aktuellen Daten auf diesem Gerät werden ersetzt.`)) return;
    db = Object.assign(emptyDb(), d); db.settings.changedSinceBackup = false;
    localStorage.setItem(STORE_KEY, JSON.stringify(db)); updateBadge(); toast('Sicherung wiederhergestellt'); go('dash');
  }).catch(e => toast('Fehler: ' + e.message, 4000));
}
function exportCsv() {
  const rows = [['Zähler', 'Art', 'Zählernummer', 'Datum', 'Stand', 'Einheit', 'Quelle']];
  db.meters.forEach(m => readingsOf(m.id).forEach(r => rows.push([m.name, TYPES[m.type].label, m.number || '', deDate(r.date), String(r.value).replace('.', ','), TYPES[m.type].unit, r.source])));
  const csv = '﻿' + rows.map(r => r.map(x => `"${String(x).replace(/"/g, '""')}"`).join(';')).join('\r\n');
  shareOrDownload(`Zaehlerstaende-${todayISO()}.csv`, new Blob([csv], { type: 'text/csv' }), 'Zählerstände');
}
function reminder() {
  const time = $('#remt').value || '09:00'; db.settings.reminderTime = time; save();
  const t = todayISO(); let y = +t.slice(0, 4), mo = +t.slice(5, 7) + 1; if (mo > 12) { mo = 1; y++; }
  const d = `${y}${String(mo).padStart(2, '0')}01`, hm = time.replace(':', '') + '00';
  const end = (() => { const [h, mi] = time.split(':').map(Number); const e = h * 60 + mi + 15; return String(Math.floor(e / 60) % 24).padStart(2, '0') + String(e % 60).padStart(2, '0') + '00'; })();
  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Nebenkosten App//DE', 'CALSCALE:GREGORIAN', 'BEGIN:VEVENT',
    `UID:zaehler-ablesen-${uid()}@nebenkosten`, `DTSTAMP:${stamp}`, `DTSTART:${d}T${hm}`, `DTEND:${d}T${end}`,
    'RRULE:FREQ=MONTHLY;BYMONTHDAY=1', 'SUMMARY:📷 Zähler ablesen (Strom\\, Gas\\, Wasser)',
    `DESCRIPTION:Nebenkosten-App öffnen und Zählerstände fotografieren.\\n${location.href.split('#')[0]}`,
    'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Zähler ablesen', 'TRIGGER:PT0M', 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  download('Zaehler-ablesen.ics', new Blob([ics], { type: 'text/calendar' }));
  toast('Kalenderdatei geöffnet – „Hinzufügen“ antippen', 4000);
}
function wipe() {
  if (!confirm('Wirklich ALLE Daten auf diesem Gerät löschen? Das lässt sich nur mit einer Sicherung rückgängig machen.')) return;
  db = emptyDb(); localStorage.setItem(STORE_KEY, JSON.stringify(db)); updateBadge(); go('dash');
}

/* ---------- Beispieldaten ---------- */
function demo() {
  if (db.meters.length && !confirm('Beispieldaten zusätzlich zu deinen Daten laden?')) return;
  const mk = (type, name, number, startVal, monthly, tariffs, billsYears) => {
    const m = { id: uid(), type, name, number }; db.meters.push(m);
    let v = startVal; const today = todayISO();
    for (let y = 2024; y <= +today.slice(0, 4); y++) for (let mo = 0; mo < 12; mo++) {
      const d = `${y}-${String(mo + 1).padStart(2, '0')}-01`; if (d > today) break;
      db.readings.push({ id: uid(), meterId: m.id, date: d, value: Math.round(v * 10) / 10, source: 'manuell' });
      v += monthly[mo] * (y === 2025 ? 1.04 : y === 2026 ? 0.95 : 1) * (0.93 + Math.random() * 0.14);
    }
    tariffs.forEach(t => db.tariffs.push(Object.assign({ id: uid(), meterId: m.id }, t)));
    billsYears.forEach(y => {
      const from = `${y}-01-01`, to = `${y}-12-31`, cons = valueAt(m.id, `${y + 1}-01-01`) - valueAt(m.id, from), t = tariffAt(m.id, `${y}-06-01`);
      db.bills.push({ id: uid(), meterId: m.id, from, to, consumption: Math.round(cons), cost: Math.round((cons * unitCost(m, t) + t.basePerYear) * 100) / 100, paid: t.advance * 12 });
    });
  };
  mk('strom', 'Strom', '1ESY1160123456', 18240, [320, 290, 280, 240, 220, 200, 200, 210, 230, 270, 300, 330],
    [{ validFrom: '2024-01-01', workPrice: 0.34, basePerYear: 150, advance: 85 }, { validFrom: '2025-01-01', workPrice: 0.33, basePerYear: 160, advance: 92 }, { validFrom: '2026-01-01', workPrice: 0.31, basePerYear: 165, advance: 90 }], [2024, 2025]);
  mk('gas', 'Gas', '7GMT0045678', 9500.0, [230, 200, 160, 90, 40, 20, 15, 15, 35, 100, 170, 220],
    [{ validFrom: '2024-01-01', workPrice: 0.12, basePerYear: 180, advance: 140, gasFactor: 10.4 }, { validFrom: '2025-01-01', workPrice: 0.115, basePerYear: 190, advance: 150, gasFactor: 10.4 }, { validFrom: '2026-01-01', workPrice: 0.105, basePerYear: 190, advance: 135, gasFactor: 10.3 }], [2024, 2025]);
  mk('wasser', 'Wasser', '23-445566', 412, [8, 7.5, 8, 8.5, 9.5, 10.5, 11, 11, 9.5, 8.5, 8, 8.5],
    [{ validFrom: '2024-01-01', workPrice: 2.1, extraPerUnit: 2.6, basePerYear: 96, advance: 45 }, { validFrom: '2026-01-01', workPrice: 2.25, extraPerUnit: 2.75, basePerYear: 102, advance: 48 }], [2024, 2025]);
  save(); toast('Beispieldaten geladen'); go('dash');
}

/* ---------- Start ---------- */
window.App = {
  go, pick: (k, id) => { state[k] = id; rerender(); }, editMeter, editTariff, onPhoto, recognize, saveReading, delReading,
  check: checkReading, onBill, reviewBill, saveBill, delBill, closeSheet, exportData, importData, exportCsv, reminder, wipe, demo,
};
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => { });
updateBadge();
go('dash');
