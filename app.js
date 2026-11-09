// Piano : le compagnon du vrai piano.
// Deux fonctions : écouter un morceau et en écrire la partition (grand
// portée), puis rejouer une partition en rythme sur un vrai piano, validée
// au micro. Tout tourne en local, hors connexion une fois le modèle en cache.
import { transcribeAudio, buildScore, detectKey, keyName } from './modules/transcription.js';
import { renderGrandStaff } from './modules/notation.js';
import { icon } from './modules/icons.js';

// ---------- Utilitaires ----------
const $ = (id) => document.getElementById(id);
const app = $('app');
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const FR = ['Do', 'Do♯', 'Ré', 'Ré♯', 'Mi', 'Fa', 'Fa♯', 'Sol', 'Sol♯', 'La', 'La♯', 'Si'];
const BLACK = new Set([1, 3, 6, 8, 10]);
const noteName = (midi) => FR[midi % 12] + (Math.floor(midi / 12) - 1);
function N(str) {
  const L = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  return str.trim().split(/\s+/).map(t => {
    const m = t.match(/^([A-G])([#b]?)(\d)$/);
    return (Number(m[3]) + 1) * 12 + L[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  });
}
const fmtTime = (s) => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
const fmtDate = (d) => new Date(d).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

// ---------- Thème : celui de Bob s'il est réglé, sinon celui du système ----------
function applyTheme() {
  let t = 'auto';
  try { t = JSON.parse(localStorage.getItem('cockpit-v3') || '{}')?.settings?.theme || 'auto'; } catch {}
  const root = document.documentElement;
  root.classList.toggle('theme-dark', t === 'dark');
  root.classList.toggle('theme-light', t === 'light');
}
applyTheme();

// ---------- Stockage (format v2 conservé : Bob lit piano-v2-data) ----------
const KEY = 'piano-v2-data';
function load() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (d) return d;
  } catch {}
  const d = { scores: [], best: {}, settings: { metro: true } };
  try {
    const v1 = JSON.parse(localStorage.getItem('piano-progress-v1') || 'null');
    if (v1 && Array.isArray(v1.recs)) {
      v1.recs.forEach(r => {
        const ev = (r.notes || []).map((n, i, a) => ({
          m: n.m, t0: n.t / 1000,
          t1: (a[i + 1] ? Math.min(n.t / 1000 + 0.6, a[i + 1].t / 1000) : n.t / 1000 + 0.5),
        }));
        const sc = ev.length && buildScore(ev);
        if (sc) d.scores.push(finishScore(sc, r.name, r.date));
      });
    }
  } catch {}
  return d;
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(data)); } catch {} }
function finishScore(sc, name, date) {
  return {
    id: 'p' + Date.now().toString(36) + Math.floor(Math.random() * 99),
    name: name || null, date: date || Date.now(),
    v: 4, bpm: sc.bpm, bpb: sc.bpb, pickup: sc.pickup, key: sc.key,
    notes: sc.notes.map(n => ({ m: n.m, s: n.s, d: n.d })),
  };
}

// ---------- Synthé (lecture + métronome) ----------
let actx = null, master = null;
function audio() {
  if (!actx) {
    actx = new (window.AudioContext || window.webkitAudioContext)();
    const comp = actx.createDynamicsCompressor();
    master = actx.createGain();
    master.gain.value = 0.9;
    master.connect(comp);
    comp.connect(actx.destination);
  }
  if (actx.state === 'suspended') actx.resume();
  return actx;
}
function playNote(midi, dur = 1.0, vel = 0.85, when = 0) {
  const ctx = audio();
  const t = ctx.currentTime + when;
  const f = 440 * Math.pow(2, (midi - 69) / 12);
  const g = ctx.createGain();
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = Math.min(9000, f * 9);
  g.connect(lp); lp.connect(master);
  const partials = [[1, 1, 'triangle'], [2, 0.32, 'sine'], [3, 0.14, 'sine'], [4.02, 0.06, 'sine'], [5, 0.035, 'sine']];
  for (const [mult, amp, type] of partials) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = f * mult;
    const og = ctx.createGain();
    og.gain.value = amp;
    o.connect(og); og.connect(g);
    o.start(t); o.stop(t + dur + 0.15);
  }
  const peak = vel * 0.42 * (midi < 55 ? 1.15 : midi > 76 ? 0.8 : 1);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
}
function click(accent, when = 0) {
  const ctx = audio();
  const t = ctx.currentTime + when;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = 'square';
  o.frequency.value = accent ? 1980 : 1320;
  g.gain.setValueAtTime(accent ? 0.22 : 0.13, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
  o.connect(g); g.connect(master);
  o.start(t); o.stop(t + 0.06);
}

// ================= L'OREILLE (temps réel) =================
// Attaques sur l'enveloppe d'énergie, hauteur par YIN. Sert au jeu, au
// vu-mètre pendant l'enregistrement et de secours si le modèle échoue.
const Ear = {
  stream: null, analyser: null, timer: null, on: false,
  onNote: null, onEvent: null, live: null, meter: null,
  noise: 0.0012, frames: 0,
  _buf: null, _hist: [], _cur: null, _pend: null, _silent: 0, _lastOn: 0, _chg: null,
  get gate() { return Math.min(0.02, Math.max(0.002, this.noise * 3.5)); },
  async start() {
    if (this.on) return;
    audio();
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true },
    });
    if (actx.state === 'suspended') actx.resume();
    const src = actx.createMediaStreamSource(this.stream);
    this.analyser = actx.createAnalyser();
    this.analyser.fftSize = 2048;
    src.connect(this.analyser);
    this._buf = new Float32Array(2048);
    this._hist = []; this._cur = null; this._pend = null; this._silent = 0;
    this.noise = 0.0012; this.frames = 0;
    this.timer = setInterval(() => this._tick(), 25);
    this.on = true;
    listenUI();
  },
  stop() {
    clearInterval(this.timer); this.timer = null;
    try { this.stream?.getTracks().forEach(t => t.stop()); } catch {}
    this.stream = null; this.analyser = null; this.on = false;
    this._close(actx ? actx.currentTime : 0);
    listenUI();
  },
  _close(t) {
    if (this._cur) {
      const ev = { m: this._cur.m, t0: this._cur.t0, t1: t };
      this._cur = null;
      if (this.onEvent) this.onEvent(ev);
    }
  },
  _tick() {
    const now = actx.currentTime;
    this.analyser.getFloatTimeDomainData(this._buf);
    const gate = this.gate;
    const { f, rms } = yin(this._buf, actx.sampleRate, gate);
    this.frames++;
    if (this.frames < 15 || rms < gate * 1.2) this.noise = this.noise * 0.94 + rms * 0.06;
    if (this.meter) this.meter(rms, gate);
    const prev = this._hist.length ? this._hist.slice(-5, -1) : [];
    const ref = prev.length ? prev.reduce((a, b) => a + b, 0) / prev.length : 0;
    this._hist.push(rms);
    if (this._hist.length > 14) this._hist.shift();
    const onset = rms > gate * 1.3 && rms > ref * 1.7 && (now - this._lastOn) > 0.09;
    if (onset) this._lastOn = now;
    const midi = f > 0 ? Math.round(69 + 12 * Math.log2(f / 440)) : -1;
    const okPitch = midi >= 21 && midi <= 108;
    if (rms < gate || !okPitch) {
      this._silent++;
      if (this._silent >= 3) { this._close(now - 0.05); this._pend = null; if (this.live) this.live(''); }
      return;
    }
    this._silent = 0;
    if (this.live) this.live(noteName(midi));
    if (onset) {
      this._close(now);
      this._pend = { m: midi, n: 1, t0: now };
      return;
    }
    if (this._pend) {
      if (midi === this._pend.m) this._pend.n++;
      else this._pend = { m: midi, n: 1, t0: this._pend.t0 };
      if (this._pend.n >= 2) {
        this._cur = { m: this._pend.m, t0: this._pend.t0 };
        this._pend = null;
        if (this.onNote) this.onNote(this._cur.m, this._cur.t0);
      }
      return;
    }
    if (!this._cur) {
      this._pend = { m: midi, n: 1, t0: now - 0.025 };
    } else if (midi !== this._cur.m) {
      if (this._chg === midi) {
        this._close(now);
        this._cur = { m: midi, t0: now - 0.05 };
        this._chg = null;
        if (this.onNote) this.onNote(midi, this._cur.t0);
      } else this._chg = midi;
    } else this._chg = null;
  },
};
function yin(buf, sr, gate) {
  const SIZE = buf.length, HALF = SIZE >> 1;
  let rms = 0;
  for (let i = 0; i < SIZE; i++) rms += buf[i] * buf[i];
  rms = Math.sqrt(rms / SIZE);
  if (rms < gate) return { f: -1, rms };
  const tauMin = Math.max(20, Math.floor(sr / 2100));
  const tauMax = Math.min(HALF - 2, Math.ceil(sr / 50));
  const d = new Float32Array(tauMax + 2);
  for (let tau = tauMin; tau <= tauMax + 1; tau++) {
    let s = 0;
    for (let i = 0; i < HALF; i++) { const del = buf[i] - buf[i + tau]; s += del * del; }
    d[tau] = s;
  }
  let run = 0, tau = -1;
  const cm = new Float32Array(tauMax + 2);
  for (let t = tauMin; t <= tauMax + 1; t++) { run += d[t]; cm[t] = d[t] * (t - tauMin + 1) / run; }
  for (let t = tauMin + 1; t <= tauMax; t++) {
    if (cm[t] < 0.14) {
      while (t + 1 <= tauMax && cm[t + 1] < cm[t]) t++;
      tau = t; break;
    }
  }
  if (tau < 0) {
    let min = 1, mi = -1;
    for (let t = tauMin + 1; t <= tauMax; t++) if (cm[t] < min) { min = cm[t]; mi = t; }
    if (min < 0.30) tau = mi; else return { f: -1, rms };
  }
  const x0 = cm[tau - 1] ?? cm[tau], x2 = cm[tau + 1] ?? cm[tau];
  const a = (x0 + x2 - 2 * cm[tau]) / 2, b = (x2 - x0) / 2;
  const t2 = a ? tau - b / (2 * a) : tau;
  return { f: sr / t2, rms };
}

// Bouton d'écoute de l'accueil : affiche la note entendue
function listenUI() {
  const b = $('listenBtn'), l = $('liveNote');
  if (!b) return;
  b.classList.toggle('is-on', Ear.on && !rec && !game);
  b.setAttribute('aria-pressed', Ear.on ? 'true' : 'false');
  if (l) { l.hidden = !Ear.on; if (!Ear.on) l.textContent = ''; }
}
const baseLive = (txt) => { const l = $('liveNote'); if (l && !l.hidden) l.textContent = txt || ''; };

// ================= ŒUVRES INTÉGRÉES =================
function builtin(id, name, author, level, bpm, bpb, notesStr, beats) {
  const ms = N(notesStr);
  let s = 0;
  const notes = ms.map((m, i) => { const n = { m, s, d: beats[i] }; s += beats[i]; return n; });
  return { id, name: name + ' · ' + author, title: name, author, level, bpm, bpb, notes, builtin: true };
}
const ELISE_RUN = 'E5 D#5 E5 D#5 E5 B4 D5 C5 A4';
const EA1 = ELISE_RUN + ' C4 E4 A4 B4 E4 G#4 B4 C5 E4';
const EA2 = ELISE_RUN + ' C4 E4 A4 B4 E4 C5 B4 A4';
const EB = 'B4 C5 D5 E5 G4 F5 E5 D5 F4 E5 D5 C5 E4 D5 C5 B4';
const BR = [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 1];
const BA1 = BR.concat([0.5, 0.5, 0.5, 1, 0.5, 0.5, 0.5, 1, 0.5]);
const BA2 = BR.concat([0.5, 0.5, 0.5, 1, 0.5, 0.5, 0.5, 2]);
const BB = [0.5, 0.5, 0.5, 1, 0.5, 0.5, 0.5, 1, 0.5, 0.5, 0.5, 1, 0.5, 0.5, 0.5, 1];
const ODE_A = 'E4 E4 F4 G4 G4 F4 E4 D4 C4 C4 D4 E4 E4 D4 D4';
const ODE_A2 = 'E4 E4 F4 G4 G4 F4 E4 D4 C4 C4 D4 E4 D4 C4 C4';
const ODE_B = 'D4 D4 E4 C4 D4 E4 F4 E4 C4 D4 E4 F4 E4 D4 C4 D4 G3';
const OB = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1.5, 0.5, 2];
const OBB = [1, 1, 1, 1, 1, 0.5, 0.5, 1, 1, 1, 0.5, 0.5, 1, 1, 1, 1, 2];
const BUILTINS = [
  builtin('elise', 'Lettre à Élise', 'Beethoven', 'Moyen', 120, 1.5,
    [EA1, EA2, EB, EA2, EB, EA2].join(' '),
    [].concat(BA1, BA2, BB, BA2, BB, BA2.slice(0, -1), [3])),
  builtin('joie', 'Ode à la joie', 'Beethoven', 'Facile', 108, 4,
    [ODE_A, ODE_A2, ODE_B, ODE_A2, ODE_B, ODE_A2].join(' '),
    [].concat(OB, OB, OBB, OB, OBB, OB.slice(0, -1), [3])),
  builtin('hallelujah', 'Hallelujah', 'Leonard Cohen', 'Facile', 66, 3,
    `G4 G4 G4 G4 G4 G4 A4 A4 A4
     E4 G4 G4 G4 G4 A4 E4 E4 A4
     A4 A4 A4 A4 A4 A4 B4 B4 G4
     E4 E4 G4 G4 A4 A4 B4 B4 C5
     E4 G4 A4 A4 A4 G4 E4 E4 E4 G4 A4 A4 A4 G4 E4 D4 C4
     E4 G4 A4 A4 A4 G4 E4 E4 E4 G4 A4 A4 A4 G4 E4 D4 C4`,
    [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 2,
      0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 2,
      0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 2,
      0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 2,
      0.5, 0.5, 1, 1, 0.5, 0.5, 1, 1, 0.5, 0.5, 1, 1, 0.5, 0.5, 0.5, 0.5, 4,
      0.5, 0.5, 1, 1, 0.5, 0.5, 1, 1, 0.5, 0.5, 1, 1, 0.5, 0.5, 0.5, 0.5, 4]),
  builtin('greensleeves', 'Greensleeves', 'Traditionnel', 'Moyen', 120, 3,
    `A4 C5 D5 E5 F5 E5 D5 B4 G4 A4 B4 C5 A4 A4 G#4 A4 B4 G#4 E4
     A4 C5 D5 E5 F5 E5 D5 B4 G4 A4 B4 C5 B4 A4 G#4 F#4 G#4 A4 A4`,
    [1, 2, 1, 1.5, 0.5, 1, 2, 1, 1.5, 0.5, 1, 2, 1, 1.5, 0.5, 1, 2, 1, 3,
      1, 2, 1, 1.5, 0.5, 1, 2, 1, 1.5, 0.5, 1, 1.5, 0.5, 1, 1.5, 0.5, 1, 2, 3]),
];

const data = load();
save();

// Mélodie d'une partition polyphonique : la ligne du haut
function skyline(notes) {
  const by = new Map();
  notes.forEach(n => { const p = by.get(n.s); if (!p || n.m > p.m) by.set(n.s, n); });
  return [...by.values()].sort((a, b) => a.s - b.s);
}
const scoreBeats = (sc) => (sc.notes.length ? Math.max(...sc.notes.map(n => n.s + n.d)) : 0);
const scoreKey = (sc) => sc.key || detectKey(sc.notes);
function meterLabel(bpb) {
  if (bpb === 1.5) return '3/8';
  if (bpb === 3 || bpb === 2 || bpb === 4) return bpb + '/4';
  return '';
}

// ================= LECTURE =================
let playTimers = [];
function stopPlayback() { playTimers.forEach(clearTimeout); playTimers = []; }
function playScore(score, mult = 1) {
  stopPlayback();
  const spb = 60 / (score.bpm * mult);
  score.notes.forEach(n => {
    playTimers.push(setTimeout(() => playNote(n.m, Math.max(0.35, n.d * spb * 0.95), 0.8), n.s * spb * 1000));
  });
}

// ================= ÉCRANS =================
let rec = null, game = null;
function leave() {
  stopPlayback();
  if (game) { game.done = true; cancelAnimationFrame(game.raf); game = null; }
  Ear.onNote = null; Ear.onEvent = null; Ear.meter = null; Ear.live = baseLive;
  if (Ear.on && !rec) Ear.stop();
  app.scrollTop = 0;
}
function subHeader(label) {
  return `<header class="sub">
      <button class="iconbtn" type="button" data-back aria-label="Retour">${icon('back')}</button>
      <span class="sub__label">${esc(label)}</span>
    </header>`;
}
function wireBack(fn) { app.querySelectorAll('[data-back]').forEach(b => b.addEventListener('click', fn)); }

// ---------- Accueil ----------
function renderHome() {
  leave();
  const mine = data.scores.slice().reverse();
  const rows = mine.map(sc => {
    const k = scoreKey(sc);
    return `<button class="row" type="button" data-open="${sc.id}">
        <span class="row__main">
          <span class="row__title">${esc(sc.name || 'Partition')}</span>
          <span class="row__meta">${sc.notes.length} notes · ${sc.bpm} bpm · ${esc(keyName(k))}</span>
        </span>${icon('chevron')}
      </button>`;
  }).join('');
  const plays = BUILTINS.map(sc => {
    const best = data.best[sc.id];
    const sec = Math.round(scoreBeats(sc) * 60 / sc.bpm);
    return `<button class="row" type="button" data-g="${sc.id}">
        <span class="row__main">
          <span class="row__title">${esc(sc.title)}</span>
          <span class="row__meta">${esc(sc.author)} · ${esc(sc.level)} · ${fmtTime(sec)}${best ? ` · record ${best.pct} %` : ''}</span>
        </span>${icon('chevron')}
      </button>`;
  }).join('');
  app.innerHTML = `
    <header class="mast">
      <div class="mast__main">
        <div class="mast__eyebrow">Le compagnon du vrai piano</div>
        <h1 class="mast__title">Piano</h1>
      </div>
      <span class="live" id="liveNote" hidden></span>
      <button class="iconbtn" id="listenBtn" type="button" aria-label="Écouter le piano" aria-pressed="false">${icon('wave')}</button>
    </header>
    <section class="sec">
      <h2 class="sec__label">Transcrire</h2>
      <p class="lede">Le téléphone près du piano, on joue, la partition s'écrit.</p>
      <div class="actions">
        <button class="btn btn--primary" id="recStart" type="button">${icon('mic')}Enregistrer</button>
        <button class="btn btn--ghost" id="importBtn" type="button">${icon('file')}Importer</button>
        <input type="file" id="importFile" accept="audio/*,video/*" hidden>
      </div>
    </section>
    <section class="sec">
      <h2 class="sec__label">Mes partitions</h2>
      ${rows ? `<div class="rows">${rows}</div>` : '<p class="muted">Aucune partition pour l\'instant.</p>'}
    </section>
    <section class="sec">
      <h2 class="sec__label">Jouer</h2>
      <div class="rows">${plays}</div>
    </section>`;
  $('recStart').addEventListener('click', startRecording);
  $('importBtn').addEventListener('click', () => $('importFile').click());
  $('importFile').addEventListener('change', (e) => { const f = e.target.files && e.target.files[0]; if (f) importFile(f); });
  $('listenBtn').addEventListener('click', async () => {
    if (Ear.on) { Ear.stop(); return; }
    try { Ear.live = baseLive; await Ear.start(); }
    catch { const l = $('liveNote'); if (l) { l.hidden = false; l.textContent = 'micro refusé'; setTimeout(() => { l.hidden = true; }, 2500); } }
  });
  app.querySelectorAll('[data-open]').forEach(el => el.addEventListener('click', () => openScore(el.dataset.open)));
  app.querySelectorAll('[data-g]').forEach(el => el.addEventListener('click', () => {
    const sc = BUILTINS.find(x => x.id === el.dataset.g);
    if (sc) configGame(sc, renderHome);
  }));
  listenUI();
}

// ---------- Enregistrement ----------
const REC_MAX = 90;
async function startRecording() {
  leave();
  try { await Ear.start(); }
  catch { showMessage('Micro indisponible', 'Autorise le micro pour transcrire.'); return; }
  let recorder;
  try { recorder = new MediaRecorder(Ear.stream); }
  catch { Ear.stop(); showMessage('Enregistrement indisponible', 'Cet appareil ne sait pas enregistrer l\'audio.'); return; }
  const chunks = [];
  recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  rec = { recorder, chunks, events: [], start: Date.now(), timer: null };
  Ear.onEvent = (ev) => rec && rec.events.push(ev);
  recorder.start(1000);
  renderRecording();
}
function renderRecording() {
  app.innerHTML = `
    <header class="sub"><span class="sub__label"><i class="recdot"></i>Enregistrement</span></header>
    <section class="rec">
      <div class="rec__time" id="recTime">0:00</div>
      <div class="rec__max">sur ${fmtTime(REC_MAX)}</div>
      <div class="meter" aria-hidden="true"><i id="vuBar"></i><b id="vuGate"></b></div>
      <div class="rec__hint"><span class="rec__note" id="vuNote"></span><span id="vuHint">La ligne doit bouger avec la musique</span></div>
      <div class="actions">
        <button class="btn btn--primary" id="recStop" type="button">${icon('stop')}Terminer</button>
        <button class="btn btn--ghost" id="recCancel" type="button">Annuler</button>
      </div>
    </section>`;
  $('recStop').addEventListener('click', () => stopRecording(false));
  $('recCancel').addEventListener('click', () => stopRecording(true));
  const started = Date.now();
  rec.timer = setInterval(() => {
    const el = $('recTime');
    if (!el || !rec) return;
    const s = Math.floor((Date.now() - rec.start) / 1000);
    el.textContent = fmtTime(s);
    if (s >= REC_MAX) stopRecording(false);
  }, 500);
  Ear.meter = (rms, gate) => {
    const bar = $('vuBar'), g = $('vuGate'), hint = $('vuHint');
    if (!bar) return;
    bar.style.width = Math.min(100, Math.pow(rms / 0.12, 0.5) * 100) + '%';
    bar.classList.toggle('is-hot', rms > gate);
    g.style.left = Math.min(100, Math.pow(gate / 0.12, 0.5) * 100) + '%';
    if (hint && Date.now() - started > 6000) {
      hint.textContent = rec && rec.events.length ? 'Ça capte' : 'Presque rien : monte le son ou rapproche le téléphone';
    }
  };
  Ear.live = (txt) => { const n = $('vuNote'); if (n) n.textContent = txt || ''; };
}
async function stopRecording(cancel) {
  if (!rec) return;
  clearInterval(rec.timer);
  const { recorder, chunks, events } = rec;
  rec = null;
  Ear.onEvent = null; Ear.onNote = null; Ear.meter = null; Ear.live = baseLive;
  await new Promise(res => {
    recorder.onstop = res;
    try { recorder.state !== 'inactive' ? recorder.stop() : res(); } catch { res(); }
    setTimeout(res, 1500);
  });
  Ear.stop();
  if (cancel) { renderHome(); return; }
  const blob = new Blob(chunks, { type: recorder.mimeType || '' });
  analyse(blob.size > 1000 ? await blob.arrayBuffer() : null, events);
}
async function importFile(file) {
  leave();
  let arr = null;
  try { arr = await file.arrayBuffer(); } catch {}
  analyse(arr, [], file.name.replace(/\.[^.]+$/, '').slice(0, 50));
}

// ---------- Analyse ----------
async function analyse(arr, fallbackEvents, name) {
  app.innerHTML = `
    <header class="sub"><span class="sub__label">Analyse</span></header>
    <section class="rec">
      <div class="progress" aria-hidden="true"><i></i></div>
      <p class="status" id="anaStatus">Préparation de l'audio</p>
    </section>`;
  const status = (t) => { const el = $('anaStatus'); if (el) el.textContent = t; };
  let sc = null;
  try {
    if (arr) {
      let buf = await audio().decodeAudioData(arr);
      if (buf.duration > 180) {
        // au-delà de 3 minutes, on garde le début (mémoire du téléphone)
        const n = Math.floor(180 * buf.sampleRate);
        const cut = audio().createBuffer(buf.numberOfChannels, n, buf.sampleRate);
        for (let c = 0; c < buf.numberOfChannels; c++) cut.getChannelData(c).set(buf.getChannelData(c).subarray(0, n));
        buf = cut;
      }
      const r = await transcribeAudio(buf, status);
      sc = r.score;
    }
  } catch (e) { console.warn('Transcription par le modèle impossible, secours YIN', e); }
  if ((!sc || !sc.notes.length) && fallbackEvents.length) sc = buildScore(fallbackEvents);
  if (!sc || !sc.notes.length) {
    showMessage('Rien à écrire', 'Aucune note exploitable. Monte le son de la source ou rapproche le téléphone. La première analyse a besoin d\'internet pour télécharger le modèle.');
    return;
  }
  const now = new Date();
  const out = finishScore(sc, name || ('Partition du ' + fmtDate(now) + ' à ' + now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })));
  data.scores.push(out);
  while (data.scores.length > 30) data.scores.shift();
  save();
  openScore(out.id);
}
function showMessage(title, text) {
  app.innerHTML = `
    ${subHeader('Piano')}
    <h1 class="title">${esc(title)}</h1>
    <p class="lede">${esc(text)}</p>
    <div class="actions"><button class="btn btn--primary" type="button" data-back>Retour</button></div>`;
  wireBack(renderHome);
}

// ---------- Partition ----------
function openScore(id) {
  const sc = data.scores.find(x => x.id === id);
  if (!sc) { renderHome(); return; }
  leave();
  const k = scoreKey(sc);
  const width = Math.max(300, Math.min(720, app.clientWidth - 2 * parseFloat(getComputedStyle(app).paddingLeft || '20')));
  app.innerHTML = `
    ${subHeader('Partition')}
    <h1 class="title">${esc(sc.name || 'Partition')}</h1>
    <dl class="facts">
      <div><dt>Tempo</dt><dd>${sc.bpm}</dd></div>
      <div><dt>Mesure</dt><dd>${meterLabel(sc.bpb) || '4/4'}</dd></div>
      <div><dt>Tonalité</dt><dd>${esc(keyName(k))}</dd></div>
      <div><dt>Notes</dt><dd>${sc.notes.length}</dd></div>
    </dl>
    <div class="score" id="score">${renderGrandStaff({ ...sc, key: k }, width)}</div>
    <div class="actions">
      <button class="btn btn--primary" type="button" data-a="game">${icon('keys')}La jouer</button>
      <button class="btn btn--ghost" type="button" data-a="play">${icon('play')}Écouter</button>
    </div>
    <div class="links">
      <button class="link" type="button" data-a="ren">${icon('pencil')}Renommer</button>
      <button class="link link--danger" type="button" data-a="del">${icon('trash')}Supprimer</button>
    </div>`;
  wireBack(renderHome);
  const playBtn = app.querySelector('[data-a="play"]');
  playBtn.addEventListener('click', () => {
    if (playTimers.length) { stopPlayback(); playBtn.innerHTML = icon('play') + 'Écouter'; return; }
    playScore(sc);
    playBtn.innerHTML = icon('stop') + 'Arrêter';
    const total = scoreBeats(sc) * 60 / sc.bpm * 1000 + 600;
    playTimers.push(setTimeout(() => { stopPlayback(); if (playBtn.isConnected) playBtn.innerHTML = icon('play') + 'Écouter'; }, total));
  });
  app.querySelector('[data-a="game"]').addEventListener('click', () => configGame(sc, () => openScore(id)));
  app.querySelector('[data-a="ren"]').addEventListener('click', () => {
    const v = prompt('Nom de la partition', sc.name || '');
    if (v && v.trim()) { sc.name = v.trim().slice(0, 60); save(); openScore(id); }
  });
  app.querySelector('[data-a="del"]').addEventListener('click', () => {
    if (!confirm('Supprimer cette partition ?')) return;
    data.scores = data.scores.filter(x => x.id !== id);
    save();
    renderHome();
  });
}

// ================= LE JEU =================
function configGame(sc, back) {
  leave();
  const best = data.best[sc.id];
  const melody = skyline(sc.notes).length;
  const sec = Math.round(scoreBeats(sc) * 60 / sc.bpm);
  app.innerHTML = `
    ${subHeader('Jouer')}
    <h1 class="title">${esc(sc.title || sc.name || 'Partition')}</h1>
    ${sc.author ? `<p class="byline">${esc(sc.author)}</p>` : ''}
    <dl class="facts">
      <div><dt>Notes</dt><dd>${melody}</dd></div>
      <div><dt>Durée</dt><dd>${fmtTime(sec)}</dd></div>
      <div><dt>Record</dt><dd>${best ? best.pct + ' %' : 'aucun'}</dd></div>
    </dl>
    <div class="field">
      <div class="field__head"><span class="field__label">Vitesse</span><span class="field__val" id="gTv"></span></div>
      <input type="range" id="gTempo" class="slider" min="25" max="100" step="5" value="60" aria-label="Vitesse du morceau">
    </div>
    <div class="field">
      <span class="field__label">Mode</span>
      <div class="seg" id="gMode" role="radiogroup">
        <button class="seg__opt is-on" data-mode="rythme" type="button" role="radio" aria-checked="true">En rythme</button>
        <button class="seg__opt" data-mode="libre" type="button" role="radio" aria-checked="false">Libre</button>
      </div>
    </div>
    <label class="switch"><input type="checkbox" id="gMetro" ${data.settings.metro ? 'checked' : ''}><span class="switch__track"></span>Métronome</label>
    <div class="actions">
      <button class="btn btn--primary" id="gStart" type="button">Commencer</button>
      <button class="btn btn--ghost" id="gHear" type="button">${icon('play')}Écouter</button>
    </div>`;
  wireBack(back);
  let mult = 0.6, mode = 'rythme';
  const tv = () => { $('gTv').textContent = Math.round(mult * 100) + ' % · ' + Math.round(sc.bpm * mult) + ' bpm'; };
  tv();
  $('gTempo').addEventListener('input', () => { mult = Number($('gTempo').value) / 100; tv(); });
  $('gMode').addEventListener('click', e => {
    const b = e.target.closest('[data-mode]'); if (!b) return;
    mode = b.dataset.mode;
    $('gMode').querySelectorAll('.seg__opt').forEach(x => { x.classList.toggle('is-on', x === b); x.setAttribute('aria-checked', x === b ? 'true' : 'false'); });
  });
  $('gHear').addEventListener('click', () => playScore(sc, mult));
  $('gStart').addEventListener('click', async () => {
    data.settings.metro = $('gMetro').checked;
    save();
    stopPlayback();
    try { await Ear.start(); }
    catch { showMessage('Micro indisponible', 'Le micro entend ton piano : autorise-le pour jouer.'); return; }
    startGame(sc, mult, mode, data.settings.metro, back);
  });
}

// Fenêtres de tolérance + compensation de la latence micro (~100 ms)
const LAT = 0.10, W_PERFECT = 0.16, W_GOOD = 0.34;
function startGame(sc, mult, mode, metro, back) {
  stopPlayback();
  const spb = 60 / (sc.bpm * mult);
  const seq = skyline(sc.notes);
  app.innerHTML = `
    <div class="game">
      <div class="hud">
        <span class="hud__score" id="gScore">0</span>
        <span class="hud__combo" id="gCombo"></span>
        <span class="hud__next" id="gNext"></span>
        <button class="iconbtn" id="gQuit" type="button" aria-label="Quitter">${icon('back')}</button>
      </div>
      <canvas id="gCanvas"></canvas>
      <div class="gbar"><i id="gProg"></i></div>
    </div>`;
  const C = {
    bg: cssVar('--paper'), ink: cssVar('--text'), dim: cssVar('--text-faint'), rule: cssVar('--hairline'),
    accent: cssVar('--accent'), good: cssVar('--success'), bad: cssVar('--danger'),
    white: cssVar('--key-white'), black: cssVar('--key-black'), onAccent: cssVar('--on-accent'),
  };
  const canvas = $('gCanvas');
  const dpr = Math.min(2.5, window.devicePixelRatio || 1);
  const wrapW = canvas.parentElement.clientWidth;
  const H = window.innerHeight > window.innerWidth
    ? Math.max(320, Math.min(640, window.innerHeight - 230))
    : Math.max(240, window.innerHeight - 160);
  canvas.style.height = H + 'px';
  canvas.width = wrapW * dpr; canvas.height = H * dpr;
  const ctx2 = canvas.getContext('2d');
  ctx2.scale(dpr, dpr);
  const W = wrapW;

  const KB_H = Math.max(58, Math.min(86, H * 0.2));
  const kbTop = H - KB_H;
  let lo = Math.min(...seq.map(n => n.m)) - 1;
  let hi = Math.max(...seq.map(n => n.m)) + 1;
  while (BLACK.has(((lo % 12) + 12) % 12)) lo--;
  while (BLACK.has(((hi % 12) + 12) % 12)) hi++;
  const whites = [];
  for (let m = lo; m <= hi; m++) if (!BLACK.has(m % 12)) whites.push(m);
  const wW = W / whites.length;
  const xFor = (m) => (!BLACK.has(m % 12) ? (whites.indexOf(m) + 0.5) * wW : (whites.indexOf(m - 1) + 1) * wW);
  const PXB = Math.max(64, Math.min(130, (H - KB_H) / 3.2));
  const keyFlash = {};

  const st = {
    notes: seq.map(n => ({ ...n, state: 0 })),
    score: 0, combo: 0, maxCombo: 0, perfects: 0, goods: 0,
    startT: audio().currentTime + 4 * spb + 0.2,
    done: false, waitPos: 0, raf: 0, lastBeatTick: -1,
  };
  game = st;
  for (let i = 0; i < 4; i++) click(i === 0, (st.startT - audio().currentTime) - (4 - i) * spb);
  const beatsTotal = Math.max(...st.notes.map(n => n.s + n.d));
  const posNow = () => (mode === 'libre' ? st.waitPos : (actx.currentTime - st.startT) / spb);

  Ear.onEvent = null;
  Ear.onNote = (midi, t) => {
    if (st.done) return;
    const tBeat = (t - LAT - st.startT) / spb;
    if (mode === 'libre') {
      const next = st.notes.find(n => n.state === 0);
      if (next && next.m === midi) {
        next.state = 1; st.perfects++; st.combo++; st.maxCombo = Math.max(st.maxCombo, st.combo);
        st.score += 100;
      } else if (next) { st.combo = 0; flashWrong(); }
      return;
    }
    let best = null, bestDt = 1e9;
    for (const n of st.notes) {
      if (n.state !== 0 || n.m !== midi) continue;
      const dt = Math.abs(tBeat - n.s) * spb;
      if (dt < bestDt) { bestDt = dt; best = n; }
    }
    if (best && bestDt <= W_GOOD) {
      best.state = bestDt <= W_PERFECT ? 1 : 2;
      if (best.state === 1) { st.perfects++; st.score += 100; } else { st.goods++; st.score += 60; }
      st.combo++; st.maxCombo = Math.max(st.maxCombo, st.combo);
      st.score += Math.min(50, st.combo * 2);
    } else { st.combo = 0; flashWrong(); }
  };
  let wrongFlash = 0;
  function flashWrong() { wrongFlash = actx.currentTime; }

  const stateColor = [C.accent, C.accent, C.good, C.bad];
  function draw() {
    const pos = posNow();
    if (mode === 'libre') {
      const next = st.notes.find(n => n.state === 0);
      st.waitPos = next ? Math.min(st.waitPos + 0.035, next.s) : st.waitPos + 0.035;
    }
    if (mode === 'rythme') {
      for (const n of st.notes) if (n.state === 0 && (pos - n.s) * spb > W_GOOD) { n.state = 3; st.combo = 0; }
      const beatIdx = Math.floor(pos);
      if (metro && beatIdx > st.lastBeatTick && pos >= 0 && beatIdx <= beatsTotal) {
        st.lastBeatTick = beatIdx;
        click(beatIdx % (sc.bpb || 4) === 0);
      }
    }
    $('gScore').textContent = st.score;
    $('gCombo').textContent = st.combo >= 3 ? 'série ' + st.combo : '';
    const next = st.notes.find(n => n.state === 0 && n.s >= pos - 0.5) || st.notes.find(n => n.state === 0);
    $('gNext').textContent = next ? noteName(next.m) : '';
    $('gProg').style.width = Math.min(100, Math.max(0, pos / beatsTotal * 100)) + '%';

    ctx2.clearRect(0, 0, W, H);
    ctx2.fillStyle = C.bg;
    ctx2.fillRect(0, 0, W, kbTop);
    ctx2.strokeStyle = C.rule;
    ctx2.lineWidth = 1;
    for (const m of whites) {
      if (m % 12 === 0) {
        const x = whites.indexOf(m) * wW + 0.5;
        ctx2.beginPath(); ctx2.moveTo(x, 0); ctx2.lineTo(x, kbTop); ctx2.stroke();
      }
    }
    for (const n of st.notes) {
      const isB = BLACK.has(n.m % 12);
      const wN = isB ? wW * 0.55 : wW * 0.8;
      const x = xFor(n.m) - wN / 2;
      const hN = Math.max(18, n.d * PXB - 5);
      const yBot = kbTop - (n.s - pos) * PXB;
      const yTop = yBot - hN;
      if (yBot < -10 || yTop > kbTop + 10) continue;
      const yb = Math.min(yBot, kbTop);
      ctx2.globalAlpha = n.state === 0 ? 1 : n.state === 3 ? 0.35 : 0.55;
      ctx2.fillStyle = stateColor[n.state];
      ctx2.beginPath();
      if (ctx2.roundRect) ctx2.roundRect(x, yTop, wN, yb - yTop, 4); else ctx2.rect(x, yTop, wN, yb - yTop);
      ctx2.fill();
      ctx2.globalAlpha = 1;
      ctx2.font = '600 9.5px Inter, sans-serif';
      if (ctx2.measureText(FR[n.m % 12]).width < wN - 3 && yb - yTop > 15) {
        ctx2.fillStyle = C.onAccent;
        ctx2.textAlign = 'center';
        ctx2.fillText(FR[n.m % 12], x + wN / 2, yb - 5);
        ctx2.textAlign = 'left';
      }
      if (n.state > 0 && !keyFlash[n.m + '_' + n.s]) {
        keyFlash[n.m + '_' + n.s] = 1;
        keyFlash[n.m] = { t: actx.currentTime, c: n.state === 3 ? C.bad : n.state === 1 ? C.accent : C.good };
      }
    }
    // le clavier
    ctx2.fillStyle = C.black;
    ctx2.fillRect(0, kbTop, W, KB_H);
    ctx2.fillStyle = wrongFlash && actx.currentTime - wrongFlash < 0.18 ? C.bad : C.accent;
    ctx2.fillRect(0, kbTop - 2, W, 2.5);
    whites.forEach((m, i) => {
      const fl = keyFlash[m];
      const hot = fl && actx.currentTime - fl.t < 0.3;
      ctx2.fillStyle = hot ? fl.c : C.white;
      ctx2.fillRect(i * wW + 0.5, kbTop + 1, wW - 1, KB_H - 1);
      if (m % 12 === 0 && wW > 17) {
        ctx2.fillStyle = C.dim;
        ctx2.font = '500 9px Inter, sans-serif';
        ctx2.textAlign = 'center';
        ctx2.fillText('Do' + (Math.floor(m / 12) - 1), i * wW + wW / 2, H - 6);
        ctx2.textAlign = 'left';
      }
    });
    for (let m = lo; m <= hi; m++) {
      if (!BLACK.has(m % 12)) continue;
      const fl = keyFlash[m];
      const hot = fl && actx.currentTime - fl.t < 0.3;
      const bw = wW * 0.6;
      ctx2.fillStyle = hot ? fl.c : C.black;
      ctx2.fillRect(xFor(m) - bw / 2, kbTop + 1, bw, KB_H * 0.58);
    }
    if (mode === 'rythme' && pos < 0) {
      ctx2.fillStyle = C.ink;
      ctx2.font = '400 56px Fraunces, Georgia, serif';
      ctx2.textAlign = 'center';
      ctx2.fillText(String(Math.min(4, Math.max(1, Math.ceil(-pos)))), W / 2, (H - KB_H) / 2 + 18);
      ctx2.textAlign = 'left';
    }
    const allDone = st.notes.every(n => n.state !== 0);
    const timeOver = mode === 'rythme' && pos > beatsTotal + 2;
    if (allDone || timeOver) { endGame(sc, mult, mode, st, back); return; }
    st.raf = requestAnimationFrame(draw);
  }
  $('gQuit').addEventListener('click', () => { st.done = true; cancelAnimationFrame(st.raf); Ear.onNote = null; game = null; configGame(sc, back); });
  st.raf = requestAnimationFrame(draw);
}

function endGame(sc, mult, mode, st, back) {
  st.done = true;
  cancelAnimationFrame(st.raf);
  game = null;
  Ear.onNote = null;
  Ear.stop();
  const total = st.notes.length;
  const hit = st.perfects + st.goods;
  const pct = Math.round(hit / total * 100);
  const stars = pct >= 95 ? 3 : pct >= 75 ? 2 : pct >= 45 ? 1 : 0;
  const prev = data.best[sc.id];
  if (mode === 'rythme' && (!prev || pct > prev.pct)) { data.best[sc.id] = { pct, stars, mult }; save(); }
  app.innerHTML = `
    ${subHeader('Résultat')}
    <h1 class="title">${esc(sc.title || sc.name || 'Partition')}</h1>
    <div class="result">
      <div class="stars" aria-label="${stars} étoile${stars > 1 ? 's' : ''} sur 3">${[0, 1, 2].map(i => `<span class="${i < stars ? 'is-on' : ''}">${icon('star')}</span>`).join('')}</div>
      <div class="result__pct">${pct} %</div>
    </div>
    <dl class="facts">
      <div><dt>Parfaites</dt><dd>${st.perfects}</dd></div>
      <div><dt>Bien</dt><dd>${st.goods}</dd></div>
      <div><dt>Manquées</dt><dd>${total - hit}</dd></div>
      <div><dt>Série</dt><dd>${st.maxCombo}</dd></div>
    </dl>
    ${mode === 'libre' ? '<p class="muted">Mode libre : le record ne compte qu\'en rythme.</p>' : ''}
    <div class="actions">
      <button class="btn btn--primary" type="button" data-r="again">Rejouer</button>
      <button class="btn btn--ghost" type="button" data-r="cfg">Régler</button>
    </div>`;
  wireBack(back);
  app.querySelector('[data-r="again"]').addEventListener('click', async () => {
    try { await Ear.start(); } catch { return; }
    startGame(sc, mult, mode, data.settings.metro, back);
  });
  app.querySelector('[data-r="cfg"]').addEventListener('click', () => configGame(sc, back));
}

renderHome();
