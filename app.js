// Piano v2 — le compagnon du vrai piano.
// Deux fonctions : ÉCOUTER quelqu'un jouer et écrire la partition (silences
// compris), et JOUER une partition en rythme sur un vrai piano, validé au
// micro. Tout tourne en local, hors connexion.
(function () {
  'use strict';

  // ---------- Utilitaires ----------
  const $ = (id) => document.getElementById(id);
  const stage = $('stage');
  const headSub = $('headSub');
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const FR = ['Do', 'Do♯', 'Ré', 'Ré♯', 'Mi', 'Fa', 'Fa♯', 'Sol', 'Sol♯', 'La', 'La♯', 'Si'];
  const BLACK = new Set([1, 3, 6, 8, 10]);
  function noteName(midi, withOct = true) {
    const oct = Math.floor(midi / 12) - 1;
    return FR[midi % 12] + (withOct ? oct : '');
  }
  function N(str) {
    const L = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
    return str.trim().split(/\s+/).map(t => {
      const m = t.match(/^([A-G])([#b]?)(\d)$/);
      return (Number(m[3]) + 1) * 12 + L[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
    });
  }

  // ---------- Stockage (+ migration depuis la v1) ----------
  const KEY = 'piano-v2-data';
  function load() {
    try {
      const d = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (d) return d;
    } catch {}
    const d = { scores: [], best: {}, settings: { metro: true } };
    // Migration : les enregistrements de l'ancienne version (notes en ms)
    try {
      const v1 = JSON.parse(localStorage.getItem('piano-progress-v1') || 'null');
      if (v1 && Array.isArray(v1.recs)) {
        v1.recs.forEach(r => {
          const ev = (r.notes || []).map((n, i, a) => ({
            m: n.m, t0: n.t / 1000,
            t1: (a[i + 1] ? Math.min(n.t / 1000 + 0.6, a[i + 1].t / 1000) : n.t / 1000 + 0.5),
          }));
          if (ev.length) d.scores.push(quantize(ev, r.name, r.date));
        });
      }
    } catch {}
    return d;
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(data)); } catch {} }

  // ---------- Synthé (lecture des partitions + métronome) ----------
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

  // ================= L'OREILLE =================
  // Pipeline (état de l'art transcription monophonique) :
  // 1) enveloppe d'énergie -> détection d'ATTAQUES (le piano est percussif,
  //    c'est le signal le plus fiable — et ça capte les notes répétées) ;
  // 2) hauteur par YIN (CMNDF + seuil absolu + interpolation parabolique),
  //    bien plus robuste que l'autocorrélation simple ;
  // 3) machine à états note ouverte / silence -> événements {m, t0, t1}.
  const GATE = 0.010;
  const Ear = {
    stream: null, analyser: null, timer: null, on: false,
    onNote: null,     // (midi, tSec) à l'ouverture d'une note
    onEvent: null,    // ({m,t0,t1}) à la fermeture
    live: null,       // (texte) indicateur temps réel
    _buf: null, _hist: [], _cur: null, _pend: null, _silent: 0, _lastOn: 0,
    async start() {
      if (this.on) return;
      audio();
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      const src = actx.createMediaStreamSource(this.stream);
      this.analyser = actx.createAnalyser();
      this.analyser.fftSize = 2048;
      src.connect(this.analyser);
      this._buf = new Float32Array(2048);
      this._hist = []; this._cur = null; this._pend = null; this._silent = 0;
      this.timer = setInterval(() => this._tick(), 25);
      this.on = true;
      listenUI(true);
    },
    stop() {
      clearInterval(this.timer); this.timer = null;
      try { this.stream?.getTracks().forEach(t => t.stop()); } catch {}
      this.stream = null; this.analyser = null; this.on = false;
      this._close(actx ? actx.currentTime : 0);
      listenUI(false);
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
      const { f, rms } = yin(this._buf, actx.sampleRate);
      // enveloppe -> attaque : montée franche au-dessus de la médiane récente
      this._hist.push(rms);
      if (this._hist.length > 14) this._hist.shift();
      const med = median(this._hist);
      const onset = rms > GATE * 1.6 && rms > med * 2.3 && (now - this._lastOn) > 0.09;
      if (onset) this._lastOn = now;

      const midi = f > 0 ? Math.round(69 + 12 * Math.log2(f / 440)) : -1;
      const okPitch = midi >= 21 && midi <= 108;

      if (rms < GATE || !okPitch) {
        this._silent++;
        if (this._silent >= 3) { this._close(now - 0.05); this._pend = null; if (this.live) this.live(''); }
        return;
      }
      this._silent = 0;
      if (this.live) this.live(noteName(midi));

      if (onset) {
        // nouvelle frappe : on ferme la note en cours, la hauteur se confirme
        this._close(now);
        this._pend = { m: midi, n: 1, t0: now };
        return;
      }
      if (this._pend) {
        if (midi === this._pend.m) this._pend.n++;
        else { this._pend = { m: midi, n: 1, t0: this._pend.t0 }; }
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
        // changement de hauteur sans attaque nette (legato) : confirmé
        // sur 2 trames consécutives pour ignorer les micro-erreurs de YIN
        if (this._chg === midi) {
          this._close(now);
          this._cur = { m: midi, t0: now - 0.05 };
          this._chg = null;
          if (this.onNote) this.onNote(midi, this._cur.t0);
        } else this._chg = midi;
      } else this._chg = null;
    },
  };
  function median(a) {
    if (!a.length) return 0;
    const s = a.slice().sort((x, y) => x - y);
    return s[s.length >> 1];
  }
  // YIN : différence cumulative normalisée + seuil absolu + parabole.
  function yin(buf, sr) {
    const SIZE = buf.length, HALF = SIZE >> 1;
    let rms = 0;
    for (let i = 0; i < SIZE; i++) rms += buf[i] * buf[i];
    rms = Math.sqrt(rms / SIZE);
    if (rms < GATE) return { f: -1, rms };
    const tauMin = Math.max(20, Math.floor(sr / 2100));   // ~Do7
    const tauMax = Math.min(HALF - 2, Math.ceil(sr / 50)); // ~Sol1
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

  // Bouton Écoute (indicateur global)
  const liveEl = $('kbLive');
  function listenUI(on) {
    $('listenBtn').classList.toggle('hero-btn--on', on);
    liveEl.hidden = !on;
    if (on) liveEl.textContent = '· · ·';
  }
  Ear.live = (txt) => { if (!liveEl.hidden) liveEl.textContent = txt || '· · ·'; };
  $('listenBtn').addEventListener('click', async () => {
    if (Ear.on) { Ear.stop(); return; }
    try { await Ear.start(); }
    catch { liveEl.hidden = false; liveEl.textContent = 'micro refusé'; setTimeout(() => { liveEl.hidden = true; }, 2500); }
  });

  // ================= QUANTIFICATION =================
  // Tempo estimé sur les intervalles entre attaques (médiane), calé vers
  // 60-140 bpm, puis tout est arrondi à la double-croche. Les trous entre
  // fin de note et attaque suivante deviennent des SILENCES ; les trous
  // minuscules sont absorbés dans la durée (le piano s'éteint tout seul).
  function quantize(events, name, date) {
    events = events.filter(e => e.m >= 21 && e.m <= 108).sort((a, b) => a.t0 - b.t0);
    const iois = [];
    for (let i = 1; i < events.length; i++) {
      const d = events[i].t0 - events[i - 1].t0;
      if (d > 0.12 && d < 2.5) iois.push(d);
    }
    let beat = iois.length ? median(iois) : 0.6;
    while (60 / beat > 150) beat *= 2;
    while (60 / beat < 55) beat /= 2;
    const bpm = Math.round(60 / beat);
    const spb = 60 / bpm;
    const ref = events.length ? events[0].t0 : 0;
    const Q = (x) => Math.round(x / spb * 4) / 4;   // grille : double-croche
    const notes = [];
    events.forEach((e, i) => {
      const s = Q(e.t0 - ref);
      let d = Math.max(0.25, Q(Math.max(0.1, e.t1 - e.t0)));
      const next = events[i + 1];
      if (next) {
        const gap = Q(next.t0 - ref) - s;
        if (gap <= 0) return;                        // fusion de doublon
        if (gap - d < 0.5) d = gap;                  // trou minuscule absorbé
        d = Math.min(d, gap);
      }
      d = Math.min(d, 4);
      notes.push({ m: e.m, s, d });
    });
    return {
      id: 'p' + Date.now().toString(36) + Math.floor(Math.random() * 99),
      name: name || null, date: date || Date.now(),
      bpm, bpb: 4, notes,
    };
  }

  // ================= PARTITION (rendu SVG avec rythme) =================
  const PC_LETTER = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6];
  const PC_SHARP = [false, true, false, true, false, false, true, false, true, false, true, false];
  function diatonic(midi) { return (Math.floor(midi / 12) - 1) * 7 + PC_LETTER[midi % 12]; }
  const E4_DIA = diatonic(64);
  // durée (en temps) -> figure : [base, pointée]
  function figure(d) {
    const F = [[4, 4, 0], [3, 2, 1], [2, 2, 0], [1.5, 1, 1], [1, 1, 0], [0.75, 0.5, 1], [0.5, 0.5, 0], [0.25, 0.25, 0]];
    let best = F[4];
    for (const f of F) if (Math.abs(f[0] - d) < Math.abs(best[0] - d)) best = f;
    return best; // [valeur, base, pointée]
  }
  function restGlyphs(gap) {
    const out = [];
    for (const v of [4, 2, 1, 0.5, 0.25]) {
      while (gap >= v - 0.01) { out.push(v); gap -= v; }
    }
    return out;
  }
  function scoreSVG(score, opts = {}) {
    const GAP = 9, STEP = GAP / 2, PXB = 46, left = 44;
    const notes = score.notes;
    const totalBeats = notes.length ? Math.max(...notes.map(n => n.s + n.d)) : 4;
    const w = Math.max(320, left + totalBeats * PXB + 30);
    const top = 34, bot = top + 4 * GAP, midY = top + 2 * GAP;
    let s = `<svg class="score" viewBox="0 0 ${w} ${bot + 46}" width="${w}">`;
    for (let i = 0; i < 5; i++)
      s += `<line x1="8" y1="${top + i * GAP}" x2="${w - 8}" y2="${top + i * GAP}" class="score__line"/>`;
    s += `<text x="12" y="${bot - 2}" class="score__clef">𝄞</text>`;
    // mesures
    const bpb = score.bpb || 4;
    for (let b = bpb; b <= totalBeats + 0.01; b += bpb) {
      const x = left + b * PXB - 6;
      s += `<line x1="${x}" y1="${top}" x2="${x}" y2="${bot}" class="score__bar"/>`;
    }
    let cursor = 0;
    notes.forEach((n, i) => {
      // silence avant la note
      const gap = n.s - cursor;
      if (gap >= 0.24) {
        let gx = left + cursor * PXB + 10;
        for (const v of restGlyphs(gap)) {
          s += restSVG(v, gx, midY);
          gx += v * PXB * 0.6;
        }
      }
      cursor = Math.max(cursor, n.s + n.d);
      const x = left + n.s * PXB + 10;
      const y = bot - (diatonic(n.m) - E4_DIA) * STEP;
      for (let ly = bot + GAP; ly <= y + 1; ly += GAP) s += `<line x1="${x - 8}" y1="${ly}" x2="${x + 8}" y2="${ly}" class="score__line"/>`;
      for (let ly = top - GAP; ly >= y - 1; ly -= GAP) s += `<line x1="${x - 8}" y1="${ly}" x2="${x + 8}" y2="${ly}" class="score__line"/>`;
      if (PC_SHARP[n.m % 12]) s += `<text x="${x - 14}" y="${y + 3.5}" class="score__acc">♯</text>`;
      const [, base, dotted] = figure(n.d);
      const hollow = base >= 2;
      const cls = opts.mark === i ? ' score__note--cur' : '';
      s += `<ellipse cx="${x}" cy="${y}" rx="5.4" ry="4" class="score__note${hollow ? ' score__note--o' : ''}${cls}" transform="rotate(-18 ${x} ${y})"/>`;
      if (base < 4) s += `<line x1="${x + 5}" y1="${y - 1.5}" x2="${x + 5}" y2="${y - 26}" class="score__stem"/>`;
      if (base <= 0.5) s += `<path d="M ${x + 5},${y - 26} q 8,3 7,12" class="score__flag"/>`;
      if (base <= 0.25) s += `<path d="M ${x + 5},${y - 20} q 8,3 7,12" class="score__flag"/>`;
      if (dotted) s += `<circle cx="${x + 10}" cy="${y - 1}" r="1.7" class="score__dot"/>`;
      if (opts.names) s += `<text x="${x}" y="${bot + 26}" text-anchor="middle" class="score__nm">${FR[n.m % 12]}</text>`;
    });
    if (!notes.length) s += `<text x="${w / 2}" y="${midY + 3}" text-anchor="middle" class="score__empty">La portée attend la musique…</text>`;
    s += '</svg>';
    return s;
  }
  function restSVG(v, x, midY) {
    if (v >= 4) return `<rect x="${x - 5}" y="${midY - 9}" width="12" height="4.5" class="score__rest"/>`;
    if (v >= 2) return `<rect x="${x - 5}" y="${midY - 4.5}" width="12" height="4.5" class="score__rest"/>`;
    if (v >= 1) return `<path d="M ${x},${midY - 11} l 5,6 l -5,6 q 6,2 3,8" class="score__restq"/>`;
    if (v >= 0.5) return `<path d="M ${x + 3},${midY - 6} q -5,3 -6,0 m 6,0 l -4,12" class="score__restq"/>`;
    return `<path d="M ${x + 3},${midY - 8} q -5,3 -6,0 m 6,0 l -5,14 m 4,-8 q -5,3 -6,0" class="score__restq"/>`;
  }

  // ================= ŒUVRES INTÉGRÉES =================
  function builtin(id, name, icon, level, bpm, bpb, notesStr, beats) {
    const ms = N(notesStr);
    let s = 0;
    const notes = ms.map((m, i) => { const n = { m, s, d: beats[i] }; s += beats[i]; return n; });
    return { id, name, icon, level, bpm, bpb, notes, builtin: true };
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
    builtin('elise', 'Lettre à Élise · Beethoven', '🕯️', 'Moyen', 120, 1.5,
      [EA1, EA2, EB, EA2, EB, EA2].join(' '),
      [].concat(BA1, BA2, BB, BA2, BB, BA2.slice(0, -1), [3])),
    builtin('joie', 'Ode à la joie · Beethoven', '🎼', 'Facile', 108, 4,
      [ODE_A, ODE_A2, ODE_B, ODE_A2, ODE_B, ODE_A2].join(' '),
      [].concat(OB, OB, OBB, OB, OBB, OB.slice(0, -1), [3])),
    builtin('twinkle', 'Ah ! vous dirai-je, maman · Mozart', '⭐', 'Néophyte', 112, 4,
      `C4 C4 G4 G4 A4 A4 G4 F4 F4 E4 E4 D4 D4 C4
       G4 G4 F4 F4 E4 E4 D4 G4 G4 F4 F4 E4 E4 D4
       C4 C4 G4 G4 A4 A4 G4 F4 F4 E4 E4 D4 D4 C4`,
      [1, 1, 1, 1, 1, 1, 2, 1, 1, 1, 1, 1, 1, 2, 1, 1, 1, 1, 1, 1, 2, 1, 1, 1, 1, 1, 1, 2, 1, 1, 1, 1, 1, 1, 2, 1, 1, 1, 1, 1, 1, 3]),
    builtin('greensleeves', 'Greensleeves · Traditionnel', '🍃', 'Moyen', 120, 3,
      `A4 C5 D5 E5 F5 E5 D5 B4 G4 A4 B4 C5 A4 A4 G#4 A4 B4 G#4 E4
       A4 C5 D5 E5 F5 E5 D5 B4 G4 A4 B4 C5 B4 A4 G#4 F#4 G#4 A4 A4`,
      [1, 2, 1, 1.5, 0.5, 1, 2, 1, 1.5, 0.5, 1, 2, 1, 1.5, 0.5, 1, 2, 1, 3,
        1, 2, 1, 1.5, 0.5, 1, 2, 1, 1.5, 0.5, 1, 1.5, 0.5, 1, 1.5, 0.5, 1, 2, 3]),
  ];

  const data = load();
  save();

  // ================= LECTURE D'UNE PARTITION =================
  let playTimers = [];
  function stopPlayback() { playTimers.forEach(clearTimeout); playTimers = []; }
  function playScore(score, mult = 1) {
    stopPlayback();
    const spb = 60 / (score.bpm * mult);
    score.notes.forEach(n => {
      playTimers.push(setTimeout(() => playNote(n.m, Math.max(0.35, n.d * spb * 0.95), 0.8), n.s * spb * 1000));
    });
  }

  // ================= ONGLET PARTITION =================
  let rec = null; // {events, t0, liveTimer}
  function renderPartition() {
    headSub.textContent = 'Ce qui se joue s\'écrit';
    stopPlayback();
    Ear.onNote = null; Ear.onEvent = null;
    if (rec) { renderRecording(); return; }
    const scores = data.scores.slice().reverse();
    const rows = scores.map(sc => `
      <div class="songrow" data-open="${sc.id}">
        <span class="songrow__icon">𝄞</span>
        <span class="songrow__main">
          <span class="songrow__name">${esc(sc.name)}</span>
          <div class="songrow__meta">${sc.notes.length} notes · ♩ = ${sc.bpm} · ${new Date(sc.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}</div>
        </span>
      </div>`).join('');
    stage.innerHTML = `
      <div class="card reccard">
        <div class="card__title">Écouter &amp; transcrire</div>
        <div class="card__sub">Pose le téléphone près du piano — quelqu'un joue (ou une vidéo tourne sur l'ordi), l'app écrit la partition : notes, rythme <strong>et silences</strong>.</div>
        <button class="bigrec" id="recStart" type="button"><i></i>Enregistrer</button>
      </div>
      ${scores.length ? `<div class="card"><div class="card__title">Mes partitions</div><div class="songlist" style="margin-top:10px">${rows}</div></div>` : ''}`;
    $('recStart').addEventListener('click', startRecording);
    stage.querySelectorAll('[data-open]').forEach(el => el.addEventListener('click', () => openScore(el.dataset.open)));
  }

  async function startRecording() {
    try { await Ear.start(); }
    catch { alert('Le micro est nécessaire pour transcrire.'); return; }
    rec = { events: [], live: [] };
    Ear.onEvent = (ev) => { rec.events.push(ev); renderRecLive(); };
    Ear.onNote = () => renderRecLive(true);
    renderRecording();
  }
  function renderRecording() {
    stage.innerHTML = `
      <div class="card">
        <div class="rec-head"><span class="rec-dot"></span><span class="card__title">J'écoute…</span><span class="rec-count" id="recCount">0 note</span></div>
        <div class="card__sub">Joue naturellement — les pauses deviendront des soupirs et des silences sur la portée.</div>
        <div class="score-scroll" id="recScore">${scoreSVG({ notes: [], bpb: 4 })}</div>
        <div class="session__row" style="justify-content:flex-start">
          <button class="btn btn--small" id="recStop" type="button">■ Terminer</button>
          <button class="btn btn--ghost btn--small" id="recCancel" type="button">Annuler</button>
        </div>
      </div>`;
    $('recStop').addEventListener('click', stopRecording);
    $('recCancel').addEventListener('click', () => { rec = null; Ear.onEvent = null; Ear.onNote = null; renderPartition(); });
    renderRecLive();
  }
  let recThrottle = 0;
  function renderRecLive() {
    const c = $('recCount');
    if (c) c.textContent = rec.events.length + ' note' + (rec.events.length > 1 ? 's' : '');
    const now = Date.now();
    if (now - recThrottle < 400) return;
    recThrottle = now;
    const holder = $('recScore');
    if (holder && rec.events.length) {
      holder.innerHTML = scoreSVG(quantize(rec.events));
      holder.scrollLeft = holder.scrollWidth;
    }
  }
  function stopRecording() {
    Ear.onEvent = null; Ear.onNote = null;
    const events = rec.events; rec = null;
    if (!events.length) { renderPartition(); return; }
    const sc = quantize(events);
    sc.name = 'Partition du ' + new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
      + ' · ' + new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
    data.scores.push(sc);
    while (data.scores.length > 30) data.scores.shift();
    save();
    openScore(sc.id);
  }

  function openScore(id) {
    const sc = data.scores.find(x => x.id === id);
    if (!sc) { renderPartition(); return; }
    stopPlayback();
    stage.innerHTML = `
      <div class="card">
        <div class="card__title">${esc(sc.name)}</div>
        <div class="card__sub">${sc.notes.length} notes · ♩ = ${sc.bpm} · silences détectés</div>
        <div class="score-scroll">${scoreSVG(sc, { names: true })}</div>
        <div class="session__row" style="justify-content:flex-start">
          <button class="btn btn--small" data-a="play" type="button">▶ Écouter</button>
          <button class="btn btn--small" data-a="game" type="button">🎹 La jouer</button>
          <button class="btn btn--ghost btn--small" data-a="ren" type="button">Renommer</button>
          <button class="btn btn--ghost btn--small" data-a="del" type="button">Supprimer</button>
          <button class="btn btn--ghost btn--small" data-a="back" type="button">Retour</button>
        </div>
      </div>`;
    stage.querySelector('[data-a="back"]').addEventListener('click', renderPartition);
    stage.querySelector('[data-a="play"]').addEventListener('click', () => playScore(sc));
    stage.querySelector('[data-a="game"]').addEventListener('click', () => { switchTab('jouer'); configGame(sc); });
    stage.querySelector('[data-a="ren"]').addEventListener('click', () => {
      const v = prompt('Nom de la partition :', sc.name);
      if (v && v.trim()) { sc.name = v.trim().slice(0, 60); save(); openScore(id); }
    });
    stage.querySelector('[data-a="del"]').addEventListener('click', () => {
      if (!confirm('Supprimer cette partition ?')) return;
      data.scores = data.scores.filter(x => x.id !== id);
      save();
      renderPartition();
    });
  }

  // ================= ONGLET JOUER (le jeu) =================
  const LVL_ORDER = { 'Néophyte': 0, 'Facile': 1, 'Moyen': 2, 'Difficile': 3 };
  function renderJouer() {
    headSub.textContent = 'Joue en rythme, sur ton vrai piano';
    stopPlayback();
    Ear.onNote = null; Ear.onEvent = null;
    const mine = data.scores.slice().reverse();
    const cards = BUILTINS.map(sc => gameCard(sc)).join('');
    const mineRows = mine.map(sc => gameCard(sc)).join('');
    stage.innerHTML = `
      <div class="songgrid">${cards}</div>
      ${mine.length ? `<div class="col__label" style="margin:16px 0 8px">Mes partitions</div><div class="songgrid">${mineRows}</div>` : `<p class="freeplay-hint">Tes transcriptions de l'onglet Partition apparaîtront aussi ici.</p>`}`;
    stage.querySelectorAll('[data-g]').forEach(el => el.addEventListener('click', () => {
      const sc = BUILTINS.find(x => x.id === el.dataset.g) || data.scores.find(x => x.id === el.dataset.g);
      if (sc) configGame(sc);
    }));
  }
  function gameCard(sc) {
    const best = data.best[sc.id];
    const [title, author] = (sc.name || 'Partition').split(' · ');
    const beats = sc.notes.length ? Math.max(...sc.notes.map(n => n.s + n.d)) : 0;
    const sec = Math.round(beats * 60 / sc.bpm);
    return `
      <button class="songcard ${best ? 'songcard--done' : ''}" data-g="${sc.id}" type="button">
        <span class="songcard__icon">${sc.icon || '𝄞'}</span>
        <span class="songcard__name">${esc(title)}</span>
        <span class="songcard__author">${esc(author || '')}&nbsp;</span>
        <span class="songcard__meta"><span>${sc.notes.length} notes · ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}</span>${best ? `<span class="songcard__done">${'★'.repeat(best.stars)}</span>` : ''}</span>
      </button>`;
  }

  let game = null;
  function configGame(sc) {
    stopPlayback();
    const best = data.best[sc.id];
    stage.innerHTML = `
      <div class="card">
        <div class="session__eyebrow">${sc.icon || '𝄞'} Prêt à jouer</div>
        <div class="session__title">${esc(sc.name)}</div>
        <div class="card__sub">Les notes défilent vers la ligne d'or — joue-les sur ton <strong>vrai piano</strong>, le micro valide. ${best ? `Record : ${best.pct} % ${'★'.repeat(best.stars)}` : ''}</div>
        <div class="col__label" style="margin-top:14px">Tempo</div>
        <div class="chiprow" id="gTempo">
          <button class="chippick" data-m="0.5" type="button">Lent · 50 %</button>
          <button class="chippick on" data-m="0.7" type="button">Tranquille · 70 %</button>
          <button class="chippick" data-m="0.85" type="button">Presque · 85 %</button>
          <button class="chippick" data-m="1" type="button">Réel · 100 %</button>
        </div>
        <div class="col__label" style="margin-top:12px">Mode</div>
        <div class="chiprow" id="gMode">
          <button class="chippick on" data-mode="rythme" type="button">En rythme 🎯</button>
          <button class="chippick" data-mode="libre" type="button">Libre — l'app t'attend</button>
        </div>
        <label class="metrow"><input type="checkbox" id="gMetro" ${data.settings.metro ? 'checked' : ''}> Métronome pendant le jeu</label>
        <div class="session__row" style="justify-content:flex-start">
          <button class="btn" id="gStart" type="button">C'est parti</button>
          <button class="btn btn--ghost btn--small" id="gHear" type="button">🔊 Écouter d'abord</button>
          <button class="btn btn--ghost btn--small" id="gBack" type="button">Retour</button>
        </div>
      </div>`;
    let mult = 0.7, mode = 'rythme';
    $('gTempo').addEventListener('click', e => {
      const b = e.target.closest('[data-m]'); if (!b) return;
      mult = Number(b.dataset.m);
      $('gTempo').querySelectorAll('.chippick').forEach(x => x.classList.toggle('on', x === b));
    });
    $('gMode').addEventListener('click', e => {
      const b = e.target.closest('[data-mode]'); if (!b) return;
      mode = b.dataset.mode;
      $('gMode').querySelectorAll('.chippick').forEach(x => x.classList.toggle('on', x === b));
    });
    $('gHear').addEventListener('click', () => playScore(sc, mult));
    $('gBack').addEventListener('click', renderJouer);
    $('gStart').addEventListener('click', async () => {
      data.settings.metro = $('gMetro').checked;
      save();
      try { await Ear.start(); }
      catch { alert('Le micro est nécessaire — c\'est lui qui entend ton piano.'); return; }
      startGame(sc, mult, mode, data.settings.metro);
    });
  }

  // Fenêtres de tolérance (état de l'art jeux de rythme) + compensation de
  // la latence micro (~100 ms entre la frappe réelle et sa détection).
  const LAT = 0.10, W_PERFECT = 0.16, W_GOOD = 0.34;
  function startGame(sc, mult, mode, metro) {
    stopPlayback();
    const spb = 60 / (sc.bpm * mult);
    const total = sc.notes.length;
    stage.innerHTML = `
      <div class="gamewrap">
        <div class="gamehud">
          <span class="ghud" id="gScore">0</span>
          <span class="ghud ghud--combo" id="gCombo"></span>
          <span class="ghud ghud--big" id="gNext">—</span>
          <button class="btn btn--ghost btn--small" id="gQuit" type="button">Quitter</button>
        </div>
        <canvas id="gCanvas"></canvas>
        <div class="gamebar"><i id="gProg"></i></div>
      </div>`;
    const canvas = $('gCanvas');
    const dpr = Math.min(2.5, window.devicePixelRatio || 1);
    const wrapW = canvas.parentElement.clientWidth - 2;
    const H = window.innerHeight > window.innerWidth ? 300 : Math.max(240, window.innerHeight - 230);
    canvas.style.height = H + 'px';
    canvas.width = wrapW * dpr; canvas.height = H * dpr;
    const ctx2 = canvas.getContext('2d');
    ctx2.scale(dpr, dpr);
    const W = wrapW;

    const lo = Math.min(...sc.notes.map(n => n.m)) - 1;
    const hi = Math.max(...sc.notes.map(n => n.m)) + 1;
    const laneH = H / (hi - lo + 1);
    const yFor = (m) => H - (m - lo + 0.5) * laneH;
    const PXB = Math.max(60, Math.min(110, spb >= 0.5 ? 80 : 110));
    const hitX = Math.round(W * 0.18);

    const st = {
      notes: sc.notes.map(n => ({ ...n, state: 0 })),   // 0 à venir, 1 parfait, 2 bien, 3 raté
      score: 0, combo: 0, maxCombo: 0, perfects: 0, goods: 0,
      startT: audio().currentTime + 4 * spb + 0.2,      // 4 temps de décompte
      done: false, idx: 0, waitPos: 0, waiting: false, raf: 0, lastBeatTick: -1,
    };
    game = st;
    // décompte
    for (let i = 0; i < 4; i++) click(i === 0, (st.startT - audio().currentTime) - (4 - i) * spb);

    const beatsTotal = Math.max(...st.notes.map(n => n.s + n.d));
    const posNow = () => {
      if (mode === 'libre') return st.waitPos;
      return (actx.currentTime - st.startT) / spb;
    };

    Ear.onEvent = null;
    Ear.onNote = (midi, t) => {
      if (st.done) return;
      const tBeat = (t - LAT - st.startT) / spb;
      if (mode === 'libre') {
        const next = st.notes.find(n => n.state === 0);
        if (next && next.m === midi) {
          next.state = 1; st.perfects++; st.combo++; st.maxCombo = Math.max(st.maxCombo, st.combo);
          st.score += 100;
          st.waiting = false;
        } else if (next) { st.combo = 0; flashWrong(); }
        return;
      }
      // en rythme : la note attendue la plus proche, même hauteur, non jouée
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
      } else {
        st.combo = 0; flashWrong();
      }
    };
    let wrongFlash = 0;
    function flashWrong() { wrongFlash = actx.currentTime; }

    function draw() {
      const pos = posNow();
      // libre : la partition avance jusqu'à la prochaine note, puis t'attend
      if (mode === 'libre') {
        const next = st.notes.find(n => n.state === 0);
        if (next) {
          st.waitPos = Math.min(st.waitPos + 0.035, next.s);
          st.waiting = st.waitPos >= next.s - 0.001;
        } else st.waitPos += 0.035;
      }
      // rythme : marquer les ratées + métronome
      if (mode === 'rythme') {
        for (const n of st.notes) {
          if (n.state === 0 && (pos - n.s) * spb > W_GOOD) { n.state = 3; st.combo = 0; }
        }
        const beatIdx = Math.floor(pos);
        if (metro && beatIdx > st.lastBeatTick && pos >= 0 && beatIdx <= beatsTotal) {
          st.lastBeatTick = beatIdx;
          click(beatIdx % (sc.bpb || 4) === 0);
        }
      }
      // HUD
      $('gScore').textContent = st.score;
      $('gCombo').textContent = st.combo >= 3 ? '×' + st.combo : '';
      const next = st.notes.find(n => n.state === 0 && n.s >= pos - 0.5) || st.notes.find(n => n.state === 0);
      $('gNext').textContent = next ? noteName(next.m) : '';
      $('gProg').style.width = Math.min(100, Math.max(0, pos / beatsTotal * 100)) + '%';

      // scène
      ctx2.clearRect(0, 0, W, H);
      for (let m = lo; m <= hi; m++) {
        if (BLACK.has(m % 12)) { ctx2.fillStyle = 'rgba(255,255,255,0.035)'; ctx2.fillRect(0, yFor(m) - laneH / 2, W, laneH); }
        if (m % 12 === 0) { ctx2.strokeStyle = 'rgba(217,179,106,0.25)'; ctx2.beginPath(); ctx2.moveTo(0, yFor(m) + laneH / 2); ctx2.lineTo(W, yFor(m) + laneH / 2); ctx2.stroke(); }
      }
      // ligne d'or
      ctx2.fillStyle = wrongFlash && actx.currentTime - wrongFlash < 0.18 ? 'rgba(226,109,92,0.8)' : 'rgba(217,179,106,0.9)';
      ctx2.fillRect(hitX - 2, 0, 3, H);
      // notes
      const colors = ['#7D88C4', '#D9B36A', '#6FBF8F', 'rgba(226,109,92,0.45)'];
      for (const n of st.notes) {
        const x = hitX + (n.s - pos) * PXB;
        const wN = Math.max(14, n.d * PXB - 4);
        if (x + wN < -20 || x > W + 20) continue;
        const y = yFor(n.m);
        ctx2.fillStyle = colors[n.state];
        ctx2.beginPath();
        const nh = Math.min(laneH * 0.88, 22), ny = y - nh / 2;
        if (ctx2.roundRect) ctx2.roundRect(x, ny, wN, nh, 6);
        else ctx2.rect(x, ny, wN, nh);
        ctx2.fill();
        if (laneH > 13 || n.state === 0) {
          ctx2.fillStyle = n.state === 0 ? 'rgba(255,255,255,0.85)' : 'rgba(11,11,18,0.75)';
          ctx2.font = '600 10px Inter, sans-serif';
          ctx2.fillText(FR[n.m % 12], x + 4, y + 3.5);
        }
      }
      // décompte
      if (mode === 'rythme' && pos < 0) {
        ctx2.fillStyle = 'rgba(217,179,106,0.95)';
        ctx2.font = '700 44px Inter, sans-serif';
        ctx2.textAlign = 'center';
        ctx2.fillText(String(Math.max(1, Math.ceil(-pos))), W / 2, H / 2 + 14);
        ctx2.textAlign = 'left';
      }
      // fin ?
      const allDone = st.notes.every(n => n.state !== 0);
      const timeOver = mode === 'rythme' && pos > beatsTotal + 2;
      if (allDone || timeOver) { endGame(sc, mult, mode, st); return; }
      st.raf = requestAnimationFrame(draw);
    }
    $('gQuit').addEventListener('click', () => { st.done = true; cancelAnimationFrame(st.raf); Ear.onNote = null; configGame(sc); });
    st.raf = requestAnimationFrame(draw);
  }

  function endGame(sc, mult, mode, st) {
    st.done = true;
    cancelAnimationFrame(st.raf);
    Ear.onNote = null;
    const total = sc.notes.length;
    const hit = st.perfects + st.goods;
    const pct = Math.round(hit / total * 100);
    const stars = pct >= 95 ? 3 : pct >= 75 ? 2 : pct >= 45 ? 1 : 0;
    const prev = data.best[sc.id];
    if (mode === 'rythme' && (!prev || pct > prev.pct)) { data.best[sc.id] = { pct, stars, mult }; save(); }
    stage.innerHTML = `
      <div class="card session">
        <div class="session__eyebrow">${sc.icon || '𝄞'} ${esc(sc.name)}</div>
        <div class="gstars">${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}</div>
        <div class="session__big">${pct} %</div>
        <div class="session__text">
          ${st.perfects} parfaites · ${st.goods} bien · ${total - hit} manquées<br>
          Meilleure série : ${st.maxCombo} — score ${st.score}${mode === 'libre' ? ' (mode libre)' : ''}
        </div>
        <div class="session__row">
          <button class="btn" data-r="again" type="button">Rejouer</button>
          <button class="btn btn--ghost btn--small" data-r="cfg" type="button">Régler</button>
          <button class="btn btn--ghost btn--small" data-r="list" type="button">Autres œuvres</button>
        </div>
      </div>`;
    stage.querySelector('[data-r="again"]').addEventListener('click', async () => {
      try { await Ear.start(); } catch { return; }
      startGame(sc, mult, mode, data.settings.metro);
    });
    stage.querySelector('[data-r="cfg"]').addEventListener('click', () => configGame(sc));
    stage.querySelector('[data-r="list"]').addEventListener('click', renderJouer);
  }

  // ---------- Navigation ----------
  let tab = 'partition';
  function switchTab(t) {
    tab = t;
    if (game) { game.done = true; cancelAnimationFrame(game.raf); game = null; }
    document.querySelectorAll('.tab').forEach(b => b.classList.toggle('tab--active', b.dataset.tab === t));
    render();
  }
  $('tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (b) switchTab(b.dataset.tab);
  });
  function render() {
    if (tab === 'partition') renderPartition();
    else renderJouer();
  }
  render();
})();
