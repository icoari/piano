// Transcription d'un enregistrement de piano en partition.
//
// Chaîne : audio -> mono 16 kHz (OfflineAudioContext) -> coupe des silences
// de début et de fin -> normalisation de crête -> Onsets & Frames (Magenta,
// vendorisé) par segments recouvrants -> nettoyage des notes parasites ->
// tempo (autocorrélation des attaques) -> grille à la double croche suivie
// note à note -> mesure et levée -> tonalité (profils de Krumhansl).

export const MODEL_SR = 16000;
const MODEL_URL = 'model/onsets_frames_uni';

// ---------- Modèle ----------
let modelPromise = null;
function loadScript(src) {
  return new Promise((ok, ko) => {
    const s = document.createElement('script');
    s.src = src; s.onload = ok; s.onerror = ko;
    document.head.appendChild(s);
  });
}
export function loadModel(status = () => {}) {
  if (!modelPromise) {
    modelPromise = (async () => {
      if (!window.mm) { status('Chargement du moteur'); await loadScript('vendor/magentamusic.min.js'); }
      status('Chargement du modèle (60 Mo la première fois)');
      const m = new window.mm.OnsetsAndFrames(MODEL_URL);
      await m.initialize();
      return m;
    })().catch((e) => { modelPromise = null; throw e; });
  }
  return modelPromise;
}

// ---------- Prétraitement ----------
function toMono(buffer) {
  const n = buffer.length, ch = buffer.numberOfChannels;
  if (ch === 1) return Float32Array.from(buffer.getChannelData(0));
  const out = new Float32Array(n);
  for (let c = 0; c < ch; c++) {
    const d = buffer.getChannelData(c);
    for (let i = 0; i < n; i++) out[i] += d[i] / ch;
  }
  return out;
}

// Rééchantillonnage navigateur (filtre anti-repliement inclus).
async function resampleOffline(mono, srIn, srOut) {
  const len = Math.max(1, Math.ceil(mono.length * srOut / srIn));
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const ctx = new OAC(1, len, srOut);
  const src = ctx.createBuffer(1, mono.length, srIn);
  src.getChannelData(0).set(mono);
  const node = ctx.createBufferSource();
  node.buffer = src;
  node.connect(ctx.destination);
  node.start();
  const rendered = await ctx.startRendering();
  return Float32Array.from(rendered.getChannelData(0));
}

// Repli en JS : sinc fenêtré (Blackman), coupure juste sous Nyquist cible.
export function resampleJS(x, srIn, srOut) {
  const ratio = srIn / srOut, len = Math.floor(x.length / ratio);
  const out = new Float32Array(len);
  const fc = Math.min(1, 1 / ratio) * 0.92, HALF = 24;
  for (let i = 0; i < len; i++) {
    const c = i * ratio, c0 = Math.floor(c);
    let acc = 0, wsum = 0;
    for (let k = c0 - HALF + 1; k <= c0 + HALF; k++) {
      if (k < 0 || k >= x.length) continue;
      const t = k - c, a = Math.PI * fc * t;
      const sinc = t === 0 ? 1 : Math.sin(a) / a;
      const w = 0.42 + 0.5 * Math.cos(Math.PI * t / HALF) + 0.08 * Math.cos(2 * Math.PI * t / HALF);
      acc += x[k] * sinc * w; wsum += sinc * w;
    }
    out[i] = wsum ? acc / wsum : 0;
  }
  return out;
}

// Coupe les silences de début et de fin (seuil relatif au bruit de fond
// et au niveau du morceau), retire la composante continue, normalise.
export function trimAndNormalize(x, sr) {
  let mean = 0;
  for (let i = 0; i < x.length; i++) mean += x[i];
  mean /= x.length || 1;
  const hop = Math.round(sr * 0.02), nF = Math.floor(x.length / hop);
  const rms = new Float32Array(nF);
  for (let f = 0; f < nF; f++) {
    let s = 0;
    for (let i = f * hop; i < (f + 1) * hop; i++) { const v = x[i] - mean; s += v * v; }
    rms[f] = Math.sqrt(s / hop);
  }
  const sorted = Array.from(rms).sort((a, b) => a - b);
  const floor = sorted[Math.floor(sorted.length * 0.1)] || 0;
  const top = sorted[Math.floor(sorted.length * 0.98)] || 0;
  const thr = Math.max(floor * 3, top * 0.03, 1e-5);
  let first = 0, last = nF - 1;
  while (first < nF && rms[first] < thr) first++;
  while (last > first && rms[last] < thr) last--;
  if (first >= nF) return { samples: new Float32Array(0), offset: 0, gain: 1 };
  const a = Math.max(0, (first * hop) - Math.round(0.3 * sr));
  const b = Math.min(x.length, ((last + 1) * hop) + Math.round(0.6 * sr));
  const out = new Float32Array(b - a);
  let peak = 0;
  for (let i = a; i < b; i++) { const v = x[i] - mean; out[i - a] = v; if (Math.abs(v) > peak) peak = Math.abs(v); }
  const gain = peak > 0 ? Math.min(0.9 / peak, 1000) : 1;
  for (let i = 0; i < out.length; i++) out[i] *= gain;
  return { samples: out, offset: a / sr, gain };
}

export async function prepareAudio(buffer) {
  const mono = toMono(buffer);
  let x;
  if (buffer.sampleRate === MODEL_SR) x = mono;
  else {
    try { x = await resampleOffline(mono, buffer.sampleRate, MODEL_SR); }
    catch { x = resampleJS(mono, buffer.sampleRate, MODEL_SR); }
  }
  return trimAndNormalize(x, MODEL_SR);
}

function makeBuffer(samples) {
  let b;
  try { b = new AudioBuffer({ length: samples.length, sampleRate: MODEL_SR, numberOfChannels: 1 }); }
  catch {
    const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    b = new OAC(1, 1, MODEL_SR).createBuffer(1, samples.length, MODEL_SR);
  }
  b.getChannelData(0).set(samples);
  return b;
}

// ---------- Inférence par segments recouvrants ----------
const SEG = 30, HOP = 26; // secondes : 4 s de recouvrement au-delà de 40 s
export async function runModel(model, samples, status = () => {}) {
  const dur = samples.length / MODEL_SR;
  const notes = [];
  const toEv = (n, shift) => ({ m: n.pitch, t0: n.startTime + shift, t1: n.endTime + shift, v: n.velocity || 60 });
  if (dur <= 40) {
    const ns = await model.transcribeFromAudioBuffer(makeBuffer(samples));
    (ns.notes || []).forEach(n => notes.push(toEv(n, 0)));
    return notes;
  }
  const starts = [];
  for (let s = 0; s < dur; s += HOP) { starts.push(s); if (s + SEG >= dur) break; }
  for (let i = 0; i < starts.length; i++) {
    const s = starts[i], e = Math.min(dur, s + SEG);
    status(`Analyse ${i + 1} sur ${starts.length}`);
    const seg = samples.subarray(Math.floor(s * MODEL_SR), Math.floor(e * MODEL_SR));
    const ns = await model.transcribeFromAudioBuffer(makeBuffer(seg));
    // on garde les attaques du cœur du segment, la moitié du recouvrement
    // revient au segment voisin
    const lo = i === 0 ? -1 : s + (SEG - HOP) / 2;
    const hi = i === starts.length - 1 ? Infinity : starts[i + 1] + (SEG - HOP) / 2;
    (ns.notes || []).forEach(n => { const ev = toEv(n, s); if (ev.t0 >= lo && ev.t0 < hi) notes.push(ev); });
  }
  return notes;
}

// ---------- Nettoyage ----------
export function median(a) {
  if (!a.length) return 0;
  const s = a.slice().sort((x, y) => x - y);
  return s[s.length >> 1];
}
export function cleanNotes(raw) {
  let ev = raw.filter(e => e.m >= 21 && e.m <= 108 && e.t1 > e.t0)
    .map(e => ({ ...e, v: e.v ?? 60 }))
    .sort((a, b) => a.t0 - b.t0 || a.m - b.m);
  // doublons : même hauteur, attaques à moins de 70 ms
  const out = [];
  const lastBy = new Map();
  for (const e of ev) {
    const p = lastBy.get(e.m);
    if (p && e.t0 - p.t0 < 0.07) { p.t1 = Math.max(p.t1, e.t1); p.v = Math.max(p.v, e.v); continue; }
    out.push(e); lastBy.set(e.m, e);
  }
  if (!out.length) return out;
  const medV = median(out.map(e => e.v));
  return out.filter(e => {
    const dur = e.t1 - e.t0;
    // une trame isolée (32 ms) n'est presque jamais une vraie note
    if (dur < 0.045) return false;
    if (e.v < medV * 0.25) return false;
    if (e.v < medV * 0.5) {
      // fantôme probable : très court, ou harmonique d'une note plus forte
      if (dur < 0.08) return false;
      const ghost = out.some(o => o !== e && o.v > e.v * 1.4 && Math.abs(o.t0 - e.t0) < 0.06 &&
        [12, 19, 24, 28, 31].includes(e.m - o.m));
      if (ghost) return false;
    }
    return true;
  });
}

// ---------- Attaques regroupées (un accord = une attaque) ----------
function clusters(ev) {
  const cl = [];
  for (const e of ev) {
    const c = cl[cl.length - 1];
    if (c && e.t0 - c.t0 < 0.045 && e.t0 - c.first < 0.07) {
      c.notes.push(e); c.w += noteWeight(e);
    } else cl.push({ t0: e.t0, first: e.t0, notes: [e], w: noteWeight(e) });
  }
  cl.forEach(c => { c.t = c.notes.reduce((a, n) => a + n.t0 * noteWeight(n), 0) / c.notes.reduce((a, n) => a + noteWeight(n), 0); });
  return cl;
}
function noteWeight(e) { return 0.4 + (e.v || 60) / 127; }

// ---------- Tempo : autocorrélation de l'enveloppe des attaques ----------
export function estimateBeat(cl) {
  if (cl.length < 4) return 0.6;
  const RES = 0.01, t0 = cl[0].t, n = Math.ceil((cl[cl.length - 1].t - t0) / RES) + 8;
  const env = new Float32Array(n);
  for (const c of cl) {
    const i = Math.round((c.t - t0) / RES);
    for (let k = -3; k <= 3; k++) if (i + k >= 0 && i + k < n) env[i + k] += c.w * Math.exp(-(k * k) / 4.5);
  }
  const acf = (L) => {
    if (L >= n) return 0;
    let s = 0;
    for (let i = 0; i + L < n; i++) s += env[i] * env[i + L];
    return s / (n - L);
  };
  const lo = 25, hi = Math.min(150, Math.floor(n / 2));
  const A = new Float32Array(2 * hi + 2);
  for (let L = 1; L < A.length; L++) A[L] = acf(L);
  let best = -1, bestL = 60;
  for (let L = lo; L <= hi; L++) {
    if (!(A[L] >= A[L - 1] && A[L] >= A[L + 1])) continue;
    const prior = Math.exp(-0.5 * Math.pow(Math.log2(L * RES / 0.7) / 0.9, 2));
    const sc = prior * (A[L] + 0.5 * (A[2 * L] || 0));
    if (sc > best) { best = sc; bestL = L; }
  }
  if (best < 0) {
    // pas de pic net : médiane des intervalles, ramenée vers 55-150 bpm
    const iois = [];
    for (let i = 1; i < cl.length; i++) { const d = cl[i].t - cl[i - 1].t; if (d > 0.12 && d < 2.5) iois.push(d); }
    let b = iois.length ? median(iois) : 0.6;
    while (60 / b > 150) b *= 2;
    while (60 / b < 55) b /= 2;
    return b;
  }
  const y0 = A[bestL - 1], y1 = A[bestL], y2 = A[bestL + 1];
  const den = y0 - 2 * y1 + y2;
  const off = den ? 0.5 * (y0 - y2) / den : 0;
  let b = (bestL + Math.max(-0.5, Math.min(0.5, off))) * RES;
  // une période de plus d'une seconde est une blanche ou une mesure :
  // on écrit en noires, entre 60 et 180 à la noire
  while (b > 1.0) b /= 2;
  while (b < 0.33) b *= 2;
  return b;
}

// ---------- Grille : chaque attaque se place par rapport à la précédente,
// le pas de double croche suit lentement le jeu (rubato, dérive) ----------
export function gridPositions(cl, beat) {
  let q = beat / 4;
  const pos = [0];
  for (let i = 1; i < cl.length; i++) {
    const delta = cl[i].t - cl[i - 1].t;
    const steps = Math.round(delta / q);
    if (steps >= 1 && steps <= 8) {
      const obs = delta / steps;
      if (Math.abs(obs - q) / q < 0.22) q = q * 0.88 + obs * 0.12;
    }
    pos.push(pos[i - 1] + Math.max(0, steps));
  }
  return pos;
}

// temps -> position de grille (interpolation entre attaques connues)
function timeToGrid(t, cl, pos, q) {
  if (t <= cl[0].t) return (t - cl[0].t) / q;
  for (let i = 1; i < cl.length; i++) {
    if (t <= cl[i].t) {
      const span = cl[i].t - cl[i - 1].t, dp = pos[i] - pos[i - 1];
      return pos[i - 1] + (span > 0 && dp > 0 ? (t - cl[i - 1].t) / span * dp : (t - cl[i - 1].t) / q);
    }
  }
  const L = cl.length - 1;
  return pos[L] + (t - cl[L].t) / q;
}

// ---------- Mesure et levée : où tombent les accents ----------
const METERS = [[16, 1.0], [12, 1.0], [8, 0.92], [6, 0.9]]; // en doubles croches
export function estimateMeter(cl, pos) {
  if (cl.length < 6) return { bar: 16, pickup: 0 };
  const acc = cl.map(c => {
    let w = c.w;
    if (c.notes.some(n => n.m < 55)) w += 0.6;
    const longest = Math.max(...c.notes.map(n => n.t1 - n.t0));
    w += 0.4 * Math.min(1, longest / 0.6);
    return w;
  });
  const meanAcc = acc.reduce((a, b) => a + b, 0) / acc.length;
  acc.forEach((a, i) => { acc[i] = a / meanAcc; });
  const span = pos[pos.length - 1];
  // contraste : accent moyen sur les temps forts moins accent moyen ailleurs
  const contrast = (L, p) => {
    let s1 = 0, k1 = 0, s0 = 0, k0 = 0;
    pos.forEach((x, i) => { if (((x - p) % L + L) % L === 0) { s1 += acc[i]; k1++; } else { s0 += acc[i]; k0++; } });
    return k1 >= 2 && k0 ? s1 / k1 - s0 / k0 : -Infinity;
  };
  let best = { bar: 16, pickup: 0, sc: 0.18 }; // en dessous : rien de net, 4/4 sans levée
  for (const [L, prior] of METERS) {
    if (span < 2 * L) continue;
    const c0 = contrast(L, 0);
    for (let p = 0; p < L; p++) {
      const c = contrast(L, p);
      // une levée doit s'imposer nettement face au départ sur le temps
      if (p && !(c > c0 * 1.2 + 0.08)) continue;
      const sc = c * prior;
      if (sc > best.sc) best = { bar: L, pickup: p, sc };
    }
  }
  return { bar: best.bar, pickup: best.pickup };
}

// ---------- Tonalité : profils de Krumhansl-Kessler ----------
const KK_MAJ = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KK_MIN = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
const FIFTHS_MAJ = [0, -5, 2, -3, 4, -1, 6, 1, -4, 3, -2, 5]; // par tonique (do = 0)
function pearson(a, b) {
  const ma = a.reduce((x, y) => x + y, 0) / 12, mb = b.reduce((x, y) => x + y, 0) / 12;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < 12; i++) { num += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
  return da && db ? num / Math.sqrt(da * db) : 0;
}
export function detectKey(notes) {
  // notes : {m, d} (d en temps) ou {m, t0, t1}
  const h = new Array(12).fill(0);
  notes.forEach(n => {
    const d = n.d != null ? n.d : (n.t1 - n.t0) * 2;
    h[n.m % 12] += (0.5 + Math.min(1.5, Math.max(0.25, d))) * (n.m < 55 ? 1.3 : 1);
  });
  // racine : une note très répétée (le mi de la Lettre à Élise) ne doit pas
  // écraser la tierce, qui décide du mode
  for (let i = 0; i < 12; i++) h[i] = Math.sqrt(h[i]);
  let best = { tonic: 0, mode: 'maj', r: -2 };
  for (let t = 0; t < 12; t++) {
    const rot = (p) => h.map((_, i) => p[(i - t + 12) % 12]);
    const rM = pearson(h, rot(KK_MAJ)), rm = pearson(h, rot(KK_MIN));
    if (rM > best.r) best = { tonic: t, mode: 'maj', r: rM };
    if (rm > best.r) best = { tonic: t, mode: 'min', r: rm };
  }
  const relMaj = best.mode === 'maj' ? best.tonic : (best.tonic + 3) % 12;
  let fifths = FIFTHS_MAJ[relMaj];
  return { tonic: best.tonic, mode: best.mode, fifths };
}
const KEY_NAMES_SHARP = ['do', 'do dièse', 'ré', 'ré dièse', 'mi', 'fa', 'fa dièse', 'sol', 'sol dièse', 'la', 'la dièse', 'si'];
const KEY_NAMES_FLAT = ['do', 'ré bémol', 'ré', 'mi bémol', 'mi', 'fa', 'sol bémol', 'sol', 'la bémol', 'la', 'si bémol', 'si'];
export function keyName(k) {
  if (!k) return '';
  const names = k.fifths < 0 ? KEY_NAMES_FLAT : KEY_NAMES_SHARP;
  return names[k.tonic] + (k.mode === 'maj' ? ' majeur' : ' mineur');
}

// ---------- Partition complète ----------
export function buildScore(rawEvents) {
  const ev = cleanNotes(rawEvents);
  if (!ev.length) return null;
  const cl = clusters(ev);
  const beat = estimateBeat(cl);
  const pos = gridPositions(cl, beat);
  // tempo écrit : régression attaques/positions (sert au métronome et au jeu)
  const n = cl.length;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  cl.forEach((c, i) => { sx += pos[i]; sy += c.t; sxx += pos[i] * pos[i]; sxy += pos[i] * c.t; });
  const den = n * sxx - sx * sx;
  let q = den > 0 ? (n * sxy - sx * sy) / den : beat / 4;
  if (!(q > 0.04 && q < 0.6)) q = beat / 4;
  const ref = den > 0 ? (sy - q * sx) / n : cl[0].t;
  const spb = q * 4;
  const meter = estimateMeter(cl, pos);

  const notes = [];
  const seen = new Set();
  cl.forEach((c, i) => {
    for (const e of c.notes) {
      const key = e.m + ':' + pos[i];
      if (seen.has(key)) continue;
      seen.add(key);
      let end = Math.round(timeToGrid(e.t1, cl, pos, q));
      let d = Math.max(1, end - pos[i]);
      // une note se coupe à sa propre reprise
      const nextSame = cl.findIndex((c2, j) => j > i && c2.notes.some(x => x.m === e.m));
      if (nextSame > 0) d = Math.min(d, Math.max(1, pos[nextSame] - pos[i]));
      d = Math.min(d, 32);
      notes.push({ m: e.m, s: pos[i] / 4, d: d / 4, t: +e.t0.toFixed(3) });
    }
  });
  notes.sort((a, b) => a.s - b.s || a.m - b.m);
  const key = detectKey(notes);
  return {
    v: 4,
    bpm: Math.round(60 / spb),
    spb: +spb.toFixed(5),
    ref: +ref.toFixed(4),
    bpb: meter.bar / 4,
    pickup: meter.pickup / 4,
    key,
    notes,
  };
}

// ---------- Tout le parcours ----------
export async function transcribeAudio(buffer, status = () => {}) {
  status('Préparation de l\'audio');
  const prep = await prepareAudio(buffer);
  if (prep.samples.length < MODEL_SR * 0.3) return { events: [], score: null };
  const model = await loadModel(status);
  status(`Lecture de ${Math.round(prep.samples.length / MODEL_SR)} s de piano`);
  const raw = await runModel(model, prep.samples, status);
  const shifted = raw.map(e => ({ ...e, t0: e.t0 + prep.offset, t1: e.t1 + prep.offset }));
  const score = buildScore(shifted);
  return { events: cleanNotes(shifted), score };
}
