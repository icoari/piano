// Piano — l'atelier du clavier. App autonome, hors-ligne, sans le moindre
// sample audio : le son est synthétisé en Web Audio (partiels harmoniques +
// enveloppe percussive), donc l'app pèse trois fois rien et joue en avion.
//
//   Jouer      — clavier libre + mélodies guidées note à note
//   Apprendre  — parcours progressif (néophyte → confirmé), leçons interactives
//   Entraîner  — trouve la note, quiz d'accords, oreille (intervalle)
//   Dico       — accords & gammes dans toutes les tonalités + cycle des quintes
(() => {
  'use strict';

  const PROG_KEY = 'piano-progress-v1';

  // ---------- Théorie ----------
  const FR = ['Do', 'Do♯', 'Ré', 'Ré♯', 'Mi', 'Fa', 'Fa♯', 'Sol', 'Sol♯', 'La', 'La♯', 'Si'];
  const EN = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
  const BLACK = new Set([1, 3, 6, 8, 10]);

  const CHORDS = {
    'Majeur':   { iv: [0, 4, 7],      suffix: '' },
    'Mineur':   { iv: [0, 3, 7],      suffix: 'm' },
    '7':        { iv: [0, 4, 7, 10],  suffix: '7' },
    'Maj7':     { iv: [0, 4, 7, 11],  suffix: 'maj7' },
    'Min7':     { iv: [0, 3, 7, 10],  suffix: 'm7' },
    'Dim':      { iv: [0, 3, 6],      suffix: 'dim' },
    'Aug':      { iv: [0, 4, 8],      suffix: 'aug' },
    'Sus2':     { iv: [0, 2, 7],      suffix: 'sus2' },
    'Sus4':     { iv: [0, 5, 7],      suffix: 'sus4' },
  };
  const SCALES = {
    'Majeure':            { iv: [0, 2, 4, 5, 7, 9, 11], hint: 'La gamme de référence — joyeuse, stable.' },
    'Mineure naturelle':  { iv: [0, 2, 3, 5, 7, 8, 10], hint: 'La couleur mélancolique.' },
    'Mineure harmonique': { iv: [0, 2, 3, 5, 7, 8, 11], hint: 'Le 7ᵉ degré remonté — parfum oriental.' },
    'Penta majeure':      { iv: [0, 2, 4, 7, 9],        hint: '5 notes, zéro fausse note — idéale pour improviser.' },
    'Penta mineure':      { iv: [0, 3, 5, 7, 10],       hint: 'La gamme du rock et du blues.' },
    'Blues':              { iv: [0, 3, 5, 6, 7, 10],    hint: 'La penta mineure + la blue note.' },
  };
  // Cycle des quintes (majeures, relatives mineures, armure)
  const COF = [
    ['C', 'Am', '—'], ['G', 'Em', '1♯'], ['D', 'Bm', '2♯'], ['A', 'F♯m', '3♯'],
    ['E', 'C♯m', '4♯'], ['B', 'G♯m', '5♯'], ['F♯', 'D♯m', '6♯'], ['D♭', 'B♭m', '5♭'],
    ['A♭', 'Fm', '4♭'], ['E♭', 'Cm', '3♭'], ['B♭', 'Gm', '2♭'], ['F', 'Dm', '1♭'],
  ];
  const COF_PC = [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5];
  const DEGREES = ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°'];

  // Mélodies guidées — écrites en noms de notes pour rester lisibles.
  // N('C4 F#4 Bb3 …') -> tableau MIDI (Do central = C4 = 60).
  function N(str) {
    const L = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
    return str.trim().split(/\s+/).map(t => {
      const m = t.match(/^([A-G])([#b]?)(\d)$/);
      return (Number(m[3]) + 1) * 12 + L[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
    });
  }
  // beats (optionnel) : durée relative de chaque note (1 = noire) — utilisé
  // pour que « Écouter » restitue le vrai rythme du morceau.
  const SONGS = [
    // --- Comptines ---
    { id: 'lune', name: 'Au clair de la lune', icon: '🌙', level: 'Néophyte', cat: 'comptines',
      notes: N('C4 C4 C4 D4 E4 D4 C4 E4 D4 D4 C4'),
      beats: [1, 1, 1, 1, 2, 2, 1, 1, 1, 1, 4] },
    { id: 'jacques', name: 'Frère Jacques', icon: '🔔', level: 'Néophyte', cat: 'comptines',
      notes: N('C4 D4 E4 C4 C4 D4 E4 C4 E4 F4 G4 E4 F4 G4 G4 A4 G4 F4 E4 C4 G4 A4 G4 F4 E4 C4 C4 G3 C4 C4 G3 C4'),
      beats: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 1, 1, 2, 0.5, 0.5, 0.5, 0.5, 1, 1, 0.5, 0.5, 0.5, 0.5, 1, 1, 1, 1, 2, 1, 1, 2] },
    { id: 'twinkle', name: 'Ah ! vous dirai-je, maman', icon: '⭐', level: 'Néophyte', cat: 'comptines',
      notes: N('C4 C4 G4 G4 A4 A4 G4 F4 F4 E4 E4 D4 D4 C4 G4 G4 F4 F4 E4 E4 D4 G4 G4 F4 F4 E4 E4 D4 C4 C4 G4 G4 A4 A4 G4 F4 F4 E4 E4 D4 D4 C4'),
      beats: [1, 1, 1, 1, 1, 1, 2, 1, 1, 1, 1, 1, 1, 2, 1, 1, 1, 1, 1, 1, 2, 1, 1, 1, 1, 1, 1, 2, 1, 1, 1, 1, 1, 1, 2, 1, 1, 1, 1, 1, 1, 2] },
    // --- Classique ---
    { id: 'joie', name: 'Ode à la joie · Beethoven', icon: '🎼', level: 'Facile', cat: 'classique',
      notes: N('E4 E4 F4 G4 G4 F4 E4 D4 C4 C4 D4 E4 E4 D4 D4 E4 E4 F4 G4 G4 F4 E4 D4 C4 C4 D4 E4 D4 C4 C4'),
      beats: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1.5, 0.5, 2, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1.5, 0.5, 2] },
    { id: 'symph5', name: '5ᵉ Symphonie · Beethoven', icon: '🎻', level: 'Facile', cat: 'classique',
      notes: N('G4 G4 G4 Eb4 F4 F4 F4 D4 G4 G4 G4 Eb4 Ab4 Ab4 Ab4 G4 Eb5 Eb5 Eb5 C5'),
      beats: [0.5, 0.5, 0.5, 3, 0.5, 0.5, 0.5, 3, 0.5, 0.5, 0.5, 3, 0.5, 0.5, 0.5, 3, 0.5, 0.5, 0.5, 3] },
    { id: 'elise', name: 'Lettre à Élise · Beethoven', icon: '🕯️', level: 'Moyen', cat: 'classique',
      notes: N('E5 D#5 E5 D#5 E5 B4 D5 C5 A4 C4 E4 A4 B4 E4 G#4 B4 C5 E4 E5 D#5 E5 D#5 E5 B4 D5 C5 A4 C4 E4 A4 B4 E4 C5 B4 A4'),
      beats: [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 1, 0.5, 0.5, 0.5, 1, 0.5, 0.5, 0.5, 1, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 1, 0.5, 0.5, 0.5, 1, 0.5, 0.5, 0.5, 2] },
    { id: 'menuet', name: 'Menuet en sol · Bach', icon: '🎩', level: 'Moyen', cat: 'classique',
      notes: N('D5 G4 A4 B4 C5 D5 G4 G4 E5 C5 D5 E5 F#5 G5 G4 G4 C5 D5 C5 B4 A4 B4 C5 B4 A4 G4 F#4 G4 A4 B4 G4 A4'),
      beats: [1, 0.5, 0.5, 0.5, 0.5, 1, 1, 1, 1, 0.5, 0.5, 0.5, 0.5, 1, 1, 1, 1, 0.5, 0.5, 0.5, 0.5, 1, 0.5, 0.5, 0.5, 0.5, 1, 0.5, 0.5, 0.5, 0.5, 3] },
    { id: 'nachtmusik', name: 'Petite musique de nuit · Mozart', icon: '🌃', level: 'Moyen', cat: 'classique',
      notes: N('G4 D4 G4 D4 G4 D4 G4 B4 D5 C5 A4 C5 A4 C5 A4 F#4 A4 D4'),
      beats: [1.5, 0.5, 1.5, 0.5, 0.5, 0.5, 0.5, 0.5, 2, 1.5, 0.5, 1.5, 0.5, 0.5, 0.5, 0.5, 0.5, 2] },
    { id: 'turque', name: 'Marche turque · Mozart', icon: '🏇', level: 'Difficile', cat: 'classique',
      notes: N('B4 A4 G#4 A4 C5 D5 C5 B4 C5 E5 F5 E5 D#5 E5 B5 A5 G#5 A5 B5 A5 G#5 A5 C6'),
      beats: [0.5, 0.5, 0.5, 0.5, 2, 0.5, 0.5, 0.5, 0.5, 2, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 2] },
    { id: 'canon', name: 'Canon · Pachelbel', icon: '⛪', level: 'Facile', cat: 'classique',
      notes: N('F#5 E5 D5 C#5 B4 A4 B4 C#5 D5 C#5 B4 A4 G4 F#4 G4 E4') },
    { id: 'toccata', name: 'Toccata en ré mineur · Bach', icon: '⚡', level: 'Moyen', cat: 'classique',
      notes: N('A5 G5 A5 G5 F5 E5 D5 C#5 D5 A4 G4 A4 E4 F4 C#4 D4'),
      beats: [1, 0.5, 2, 0.5, 0.5, 0.5, 0.5, 1, 2.5, 1, 0.5, 2, 0.5, 0.5, 1, 3] },
    { id: 'dvorak', name: 'Symphonie du Nouveau Monde · Dvořák', icon: '🌍', level: 'Moyen', cat: 'classique',
      notes: N('E4 G4 G4 E4 D4 C4 D4 E4 G4 E4 D4 E4 G4 G4 E4 D4 C4 D4 E4 D4 C4'),
      beats: [1, 1, 1.5, 0.5, 1, 1, 1, 1, 1, 1, 2, 1, 1, 1.5, 0.5, 1, 1, 1, 1, 1, 3] },
    { id: 'brahms', name: 'Berceuse · Brahms', icon: '😴', level: 'Moyen', cat: 'classique',
      notes: N('E4 E4 G4 E4 E4 G4 E4 G4 C5 B4 A4 A4 G4 D4 E4 F4 D4 D4 E4 F4 D4 F4 B4 A4 G4 B4 C5'),
      beats: [0.5, 0.5, 2, 0.5, 0.5, 2, 0.5, 0.5, 1, 1, 1, 1, 2, 0.5, 0.5, 1, 1, 0.5, 0.5, 1, 1, 1, 1, 1, 1, 1, 2] },
    { id: 'greensleeves', name: 'Greensleeves · Traditionnel', icon: '🍃', level: 'Moyen', cat: 'classique',
      notes: N('A4 C5 D5 E5 F5 E5 D5 B4 G4 A4 B4 C5 A4 A4 G#4 A4 B4 G#4 E4 A4 C5 D5 E5 F5 E5 D5 B4 G4 A4 B4 C5 B4 A4 G#4 F#4 G#4 A4 A4') },
    // --- Films ---
    { id: 'starwars', name: 'Star Wars · J. Williams', icon: '⚔️', level: 'Moyen', cat: 'films',
      notes: N('G4 G4 G4 C5 G5 F5 E5 D5 C6 G5 F5 E5 D5 C6 G5 F5 E5 F5 D5'),
      beats: [0.5, 0.5, 0.5, 2, 2, 0.5, 0.5, 0.5, 2, 1, 0.5, 0.5, 0.5, 2, 1, 0.5, 0.5, 0.5, 2] },
    { id: 'potter', name: 'Harry Potter · J. Williams', icon: '🪄', level: 'Difficile', cat: 'films',
      notes: N('B4 E5 G5 F#5 E5 B5 A5 F#5 E5 G5 F#5 D#5 F5 B4'),
      beats: [1, 1.5, 0.5, 1, 2, 1, 3, 3, 1.5, 0.5, 1, 2, 1, 3] },
    { id: 'pirates', name: 'Pirates des Caraïbes', icon: '🏴‍☠️', level: 'Moyen', cat: 'films',
      notes: N('A4 C5 D5 D5 D5 E5 F5 F5 F5 G5 E5 E5 D5 C5 C5 D5'),
      beats: [0.5, 0.5, 1, 1, 0.5, 0.5, 1, 1, 0.5, 0.5, 1, 1, 0.5, 0.5, 1, 2] },
    { id: 'panther', name: 'La Panthère rose · Mancini', icon: '🐾', level: 'Difficile', cat: 'films',
      notes: N('D#4 E4 F#4 G4 D#4 E4 F#4 G4 C5 B4 E4 G4 B4 Bb4 A4 G4 E4 D4 E4'),
      beats: [0.5, 2, 0.5, 2, 0.5, 0.5, 0.5, 0.5, 1.5, 1.5, 0.5, 0.5, 0.5, 1.5, 1, 1, 1, 1, 3] },
    // --- Chansons & fêtes ---
    { id: 'birthday', name: 'Joyeux anniversaire', icon: '🎂', level: 'Facile', cat: 'chansons',
      notes: N('G3 G3 A3 G3 C4 B3 G3 G3 A3 G3 D4 C4 G3 G3 G4 E4 C4 B3 A3 F4 F4 E4 C4 D4 C4'),
      beats: [0.5, 0.5, 1, 1, 1, 2, 0.5, 0.5, 1, 1, 1, 2, 0.5, 0.5, 1, 1, 1, 1, 2, 0.5, 0.5, 1, 1, 1, 3] },
    { id: 'jingle', name: 'Vive le vent', icon: '🎄', level: 'Facile', cat: 'chansons',
      notes: N('E4 E4 E4 E4 E4 E4 E4 G4 C4 D4 E4 F4 F4 F4 F4 F4 E4 E4 E4 E4 D4 D4 E4 D4 G4'),
      beats: [0.5, 0.5, 1, 0.5, 0.5, 1, 0.5, 0.5, 0.75, 0.25, 2, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 2] },
    { id: 'nuit', name: 'Douce nuit', icon: '✨', level: 'Moyen', cat: 'chansons',
      notes: N('G4 A4 G4 E4 G4 A4 G4 E4 D5 D5 B4 C5 C5 G4 A4 A4 C5 B4 A4 G4 A4 G4 E4 A4 A4 C5 B4 A4 G4 A4 G4 E4 D5 D5 F5 D5 B4 C5 E5 C5 G4 E4 G4 F4 D4 C4'),
      beats: [1.5, 0.5, 1, 3, 1.5, 0.5, 1, 3, 2, 1, 3, 2, 1, 3, 2, 1, 1.5, 0.5, 1, 1.5, 0.5, 1, 3, 2, 1, 1.5, 0.5, 1, 1.5, 0.5, 1, 3, 2, 1, 1.5, 0.5, 1, 3, 3, 1, 1, 1, 1.5, 0.5, 1, 4] },
    { id: 'saints', name: 'When the Saints', icon: '🎺', level: 'Facile', cat: 'chansons',
      notes: N('C4 E4 F4 G4 C4 E4 F4 G4 C4 E4 F4 G4 E4 C4 E4 D4 E4 D4 C4 C4 E4 G4 G4 G4 F4 E4 F4 G4 E4 C4 D4 C4') },
  ];
  const SONG_CATS = [['tout', 'Tout'], ['comptines', 'Comptines'], ['classique', 'Classique'], ['films', 'Films'], ['chansons', 'Chansons']];

  // ---------- Progression ----------
  function loadProg() {
    try {
      const p = JSON.parse(localStorage.getItem(PROG_KEY) || 'null') || {};
      if (!p.lessons) p.lessons = {};
      if (!p.songs) p.songs = {};
      if (!p.best) p.best = {};
      if (!p.labels) p.labels = 'fr';
      return p;
    } catch { return { lessons: {}, songs: {}, best: {}, labels: 'fr' }; }
  }
  const prog = loadProg();
  function saveProg() { try { localStorage.setItem(PROG_KEY, JSON.stringify(prog)); } catch {} }

  // ---------- Son (Web Audio, zéro sample) ----------
  let actx = null, master = null;
  function audio() {
    if (!actx) {
      actx = new (window.AudioContext || window.webkitAudioContext)();
      const comp = actx.createDynamicsCompressor();
      comp.threshold.value = -18; comp.ratio.value = 6;
      master = actx.createGain();
      master.gain.value = 0.9;
      master.connect(comp);
      comp.connect(actx.destination);
    }
    if (actx.state === 'suspended') actx.resume();
    return actx;
  }
  const midiFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);
  function playNote(midi, dur = 1.4, vel = 0.85, when = 0) {
    const ctx = audio();
    const t = ctx.currentTime + when;
    const f = midiFreq(midi);
    const g = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = Math.min(9000, f * 7);
    g.connect(lp); lp.connect(master);
    // Partiels façon piano : fondamentale triangle + harmoniques sinus.
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
    // Enveloppe percussive : attaque 6 ms, décroissance exponentielle.
    const peak = vel * 0.42 * (midi < 55 ? 1.15 : midi > 76 ? 0.8 : 1);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  }
  function playChordNotes(midis, arp = 0.03) {
    midis.forEach((m, i) => playNote(m, 1.6, 0.8, i * arp));
  }

  // ---------- Écoute (détection de hauteur au micro) ----------
  // Pose le téléphone sur le vrai piano : l'app entend la note jouée et la
  // fait suivre dans le même canal que le toucher. Autocorrélation (ACF2+)
  // + stabilisation sur 2 trames + porte d'amplitude. Monophonique : parfait
  // pour les mélodies et les leçons note à note (les accords se valident en
  // arpège, note après note).
  let micStream = null, micAnalyser = null, micTimer = null;
  let listenOn = false;
  let candMidi = null, candCount = 0, lastEmitted = null, silentFrames = 0;

  function autoCorrelate(buf, sampleRate) {
    let SIZE = buf.length;
    let rms = 0;
    for (let i = 0; i < SIZE; i++) { const v = buf[i]; rms += v * v; }
    rms = Math.sqrt(rms / SIZE);
    if (rms < 0.012) return -1;                      // trop faible → silence
    let r1 = 0, r2 = SIZE - 1;
    const thres = 0.2;
    for (let i = 0; i < SIZE / 2; i++) if (Math.abs(buf[i]) < thres) { r1 = i; break; }
    for (let i = 1; i < SIZE / 2; i++) if (Math.abs(buf[SIZE - i]) < thres) { r2 = SIZE - i; break; }
    buf = buf.slice(r1, r2);
    SIZE = buf.length;
    if (SIZE < 32) return -1;
    const c = new Float32Array(SIZE);
    for (let i = 0; i < SIZE; i++)
      for (let j = 0; j < SIZE - i; j++)
        c[i] += buf[j] * buf[j + i];
    let d = 0;
    while (d < SIZE - 1 && c[d] > c[d + 1]) d++;
    let maxval = -1, maxpos = -1;
    for (let i = d; i < SIZE; i++) if (c[i] > maxval) { maxval = c[i]; maxpos = i; }
    if (maxpos <= 0) return -1;
    let T0 = maxpos;
    const x1 = c[T0 - 1] || 0, x2 = c[T0], x3 = c[T0 + 1] || 0;
    const a = (x1 + x3 - 2 * x2) / 2, b = (x3 - x1) / 2;
    if (a) T0 = T0 - b / (2 * a);
    return sampleRate / T0;
  }

  const liveEl = document.getElementById('kbLive');
  function micTick() {
    const buf = new Float32Array(micAnalyser.fftSize);
    micAnalyser.getFloatTimeDomainData(buf);
    const freq = autoCorrelate(buf, actx.sampleRate);
    if (freq < 26 || freq > 4500) {                  // hors du piano → silence
      silentFrames++;
      if (silentFrames >= 3) { lastEmitted = null; candMidi = null; candCount = 0; if (liveEl) liveEl.textContent = '· · ·'; }
      return;
    }
    silentFrames = 0;
    const midi = Math.round(69 + 12 * Math.log2(freq / 440));
    if (midi < 21 || midi > 108) return;
    if (midi === candMidi) candCount++;
    else { candMidi = midi; candCount = 1; }
    if (liveEl) liveEl.textContent = noteName(midi);
    // 2 trames stables (~130 ms) et pas de re-déclenchement de la même note
    // tant qu'elle n'a pas été relâchée (silence) ou remplacée.
    if (candCount >= 2 && midi !== lastEmitted) {
      lastEmitted = midi;
      micNote(midi);
    }
  }

  async function startListening() {
    audio();
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    const src = actx.createMediaStreamSource(micStream);
    micAnalyser = actx.createAnalyser();
    micAnalyser.fftSize = 2048;
    src.connect(micAnalyser);
    candMidi = null; candCount = 0; lastEmitted = null; silentFrames = 0;
    micTimer = setInterval(micTick, 66);
    listenOn = true;
    if (liveEl) { liveEl.hidden = false; liveEl.textContent = '· · ·'; }
    document.getElementById('listenBtn').classList.add('kb-tool--listen');
  }
  function stopListening() {
    clearInterval(micTimer); micTimer = null;
    try { micStream?.getTracks().forEach(t => t.stop()); } catch {}
    micStream = null; micAnalyser = null; listenOn = false;
    if (liveEl) liveEl.hidden = true;
    document.getElementById('listenBtn').classList.remove('kb-tool--listen');
  }
  document.getElementById('listenBtn').addEventListener('click', async () => {
    if (listenOn) { stopListening(); return; }
    try { await startListening(); }
    catch { if (liveEl) { liveEl.hidden = false; liveEl.textContent = 'micro refusé'; setTimeout(() => { liveEl.hidden = true; }, 2500); } }
  });

  // ---------- Clavier ----------
  const kbEl = document.getElementById('kb');
  let octaveBase = 48;            // Do3
  // En paysage on affiche 3 octaves — pensé pour poser le téléphone sur le piano.
  function whitesPerView() { return window.innerWidth > window.innerHeight ? 21 : 14; }
  let WHITE_PER_VIEW = whitesPerView();
  const WHITE_PC = [0, 2, 4, 5, 7, 9, 11];
  // position des noires : après quelle touche blanche de l'octave (index 0-6)
  const BLACK_AFTER = { 1: 0, 3: 1, 6: 3, 8: 4, 10: 5 };

  let noteHandler = null;          // hook pédagogique (leçons, quiz, mélodies)
  const shown = new Map();         // midi -> classe d'affichage ('show'|'root'|'hint')
  const fingers = new Map();       // midi -> doigté à afficher

  function labelFor(midi) {
    if (prog.labels === 'off') return '';
    const pc = midi % 12;
    const names = prog.labels === 'en' ? EN : FR;
    return names[pc];
  }
  function noteName(midi, withOct = true) {
    const names = prog.labels === 'en' ? EN : FR;
    const oct = Math.floor(midi / 12) - 1;
    return names[midi % 12] + (withOct ? oct : '');
  }

  function renderKeyboard() {
    const whites = [];
    let midi = octaveBase;
    while (whites.length < WHITE_PER_VIEW + 1) {
      if (!BLACK.has(midi % 12)) whites.push(midi);
      midi++;
    }
    const wCount = whites.length;
    let html = '';
    whites.forEach((m) => {
      const extra = shown.get(m) ? ` key--${shown.get(m)}` : '';
      const fing = fingers.has(m) ? ' key--finger' : '';
      html += `<button class="key${extra}${fing}" data-midi="${m}" type="button" aria-label="${noteName(m)}">
        <span class="key__finger">${fingers.get(m) || ''}</span>
        <span class="key__label">${labelFor(m)}${prog.labels !== 'off' && m % 12 === 0 ? Math.floor(m / 12) - 1 : ''}</span>
      </button>`;
    });
    // noires par-dessus
    whites.forEach((m, i) => {
      if (i === wCount - 1) return;
      const pc = m % 12;
      const bpc = pc + 1;
      if (!BLACK.has(bpc % 12)) return;
      const bm = m + 1;
      const bw = 127.5 / wCount;   // ≡ 8.5% quand 15 blanches sont visibles
      const left = ((i + 1) / wCount * 100) - bw / 2;
      const extra = shown.get(bm) ? ` bkey--${shown.get(bm)}` : '';
      html += `<button class="bkey${extra}" style="left:${left}%;width:${bw}%" data-midi="${bm}" type="button" aria-label="${noteName(bm)}">
        <span class="bkey__label">${prog.labels === 'off' ? '' : labelFor(bm)}</span>
      </button>`;
    });
    kbEl.innerHTML = html;
    document.getElementById('kbRange').textContent = `${noteName(whites[0])} – ${noteName(whites[wCount - 1])}`;

    kbEl.querySelectorAll('[data-midi]').forEach(k => {
      k.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        const m = Number(k.dataset.midi);
        pressKey(m, k);
      });
    });
  }

  function keyEl(midi) { return kbEl.querySelector(`[data-midi="${midi}"]`); }
  function flashKey(midi, cls, ms = 260) {
    const k = keyEl(midi);
    if (!k) return;
    const c = (k.classList.contains('bkey') ? 'bkey--' : 'key--') + cls;
    k.classList.add(c);
    setTimeout(() => k.classList.remove(c), ms);
  }
  // Canal unique pour toutes les notes — écran OU vrai piano via le micro.
  // Les leçons, mélodies guidées et l'enregistrement de partition sont
  // agnostiques de la source.
  let lastSynthAt = 0;
  function emitNote(midi, fromMic) {
    if (recording) recNotes.push({ m: midi, t: Date.now() - recStart });
    if (noteHandler) noteHandler(midi);
    if (recording && tab === 'partition') renderScoreLive();
  }
  function pressKey(midi, el) {
    playNote(midi);
    lastSynthAt = Date.now();   // le micro doit ignorer le son du synthé
    if (el) {
      const down = el.classList.contains('bkey') ? 'bkey--down' : 'key--down';
      el.classList.add(down);
      setTimeout(() => el.classList.remove(down), 140);
    }
    if (navigator.vibrate) { try { navigator.vibrate(4); } catch {} }
    emitNote(midi, false);
  }
  function micNote(midi) {
    // Anti-larsen logique : juste après une note jouée par le synthé, la
    // détection entend l'app elle-même — on l'ignore.
    if (Date.now() - lastSynthAt < 450) return;
    const k = keyEl(midi);
    if (k) {
      const cls = k.classList.contains('bkey') ? 'bkey--down' : 'key--down';
      k.classList.add(cls);
      setTimeout(() => k.classList.remove(cls), 180);
    }
    emitNote(midi, true);
  }

  function clearMarks() {
    shown.clear();
    fingers.clear();
    renderKeyboard();
  }
  function mark(midis, cls, fing) {
    midis.forEach((m, i) => {
      shown.set(m, cls);
      if (fing) fingers.set(m, fing[i]);
    });
    renderKeyboard();
  }
  function ensureVisible(midi) {
    // recadre le clavier pour que la note soit dans la fenêtre
    const lo = octaveBase, hi = octaveBase + (WHITE_PER_VIEW / 7) * 12;
    if (midi < lo) { octaveBase = Math.max(24, octaveBase - 12 * Math.ceil((lo - midi) / 12)); renderKeyboard(); }
    else if (midi > hi) { octaveBase = Math.min(84, octaveBase + 12 * Math.ceil((midi - hi) / 12)); renderKeyboard(); }
  }

  document.getElementById('octDown').addEventListener('click', () => {
    octaveBase = Math.max(24, octaveBase - 12);
    renderKeyboard();
  });
  document.getElementById('octUp').addEventListener('click', () => {
    octaveBase = Math.min(84, octaveBase + 12);
    renderKeyboard();
  });
  const labelsBtn = document.getElementById('labelsBtn');
  function labelsBtnText() {
    labelsBtn.textContent = prog.labels === 'fr' ? 'Do Ré Mi' : prog.labels === 'en' ? 'C D E' : 'Sans noms';
    labelsBtn.classList.toggle('kb-tool--on', prog.labels !== 'off');
  }
  labelsBtn.addEventListener('click', () => {
    prog.labels = prog.labels === 'fr' ? 'en' : prog.labels === 'en' ? 'off' : 'fr';
    saveProg();
    labelsBtnText();
    renderKeyboard();
  });

  // ---------- Scène / navigation ----------
  const stage = document.getElementById('stage');
  const headSub = document.getElementById('headSub');
  let tab = 'jouer';
  document.getElementById('tabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-tab]');
    if (!b) return;
    tab = b.dataset.tab;
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('tab--active', t === b));
    noteHandler = null;
    clearMarks();
    render();
  });

  function render() {
    if (tab === 'jouer') renderJouer();
    else if (tab === 'apprendre') renderApprendre();
    else if (tab === 'entrainer') renderEntrainer();
    else if (tab === 'partition') renderPartition();
    else renderDico();
  }

  // ================= PARTITION =================
  // Ce que tu joues s'écrit : touche l'écran ou active l'Écoute et joue sur
  // le vrai piano — les notes se posent sur la portée en direct.
  let recording = false, recStart = 0, recNotes = [];
  if (!Array.isArray(prog.recs)) prog.recs = [];

  // midi → position diatonique (lettre + octave) pour la portée en clé de sol.
  const PC_LETTER = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6];   // C C# D D# E F F# G G# A A# B
  const PC_SHARP = [false, true, false, true, false, false, true, false, true, false, true, false];
  function diatonic(midi) {
    const oct = Math.floor(midi / 12) - 1;
    return oct * 7 + PC_LETTER[midi % 12];
  }
  const E4_DIA = diatonic(64);   // ligne du bas de la portée

  function scoreSVG(notes) {
    const GAP = 9;                     // interligne
    const STEP = GAP / 2;              // un degré diatonique
    const NW = 26;                     // espacement horizontal des notes
    const left = 34;
    const w = Math.max(300, left + notes.length * NW + 20);
    const top = 30, bottomLine = top + 4 * GAP;
    let s = `<svg class="score" viewBox="0 0 ${w} ${bottomLine + 42}" width="${w}">`;
    for (let i = 0; i < 5; i++) {
      const y = top + i * GAP;
      s += `<line x1="8" y1="${y}" x2="${w - 8}" y2="${y}" class="score__line"/>`;
    }
    s += `<text x="12" y="${bottomLine - 2}" class="score__clef">𝄞</text>`;
    notes.forEach((n, i) => {
      const x = left + 14 + i * NW;
      const y = bottomLine - (diatonic(n.m) - E4_DIA) * STEP;
      // lignes supplémentaires
      for (let ly = bottomLine + GAP; ly <= y + 1; ly += GAP)
        s += `<line x1="${x - 8}" y1="${ly}" x2="${x + 8}" y2="${ly}" class="score__line"/>`;
      for (let ly = top - GAP; ly >= y - 1; ly -= GAP)
        s += `<line x1="${x - 8}" y1="${ly}" x2="${x + 8}" y2="${ly}" class="score__line"/>`;
      if (PC_SHARP[n.m % 12]) s += `<text x="${x - 14}" y="${y + 3.5}" class="score__acc">♯</text>`;
      s += `<ellipse cx="${x}" cy="${y}" rx="5.4" ry="4" class="score__note" transform="rotate(-18 ${x} ${y})"/>`;
      s += `<line x1="${x + 5}" y1="${y - 1.5}" x2="${x + 5}" y2="${y - 26}" class="score__stem"/>`;
    });
    if (!notes.length) s += `<text x="${w / 2}" y="${bottomLine - GAP}" text-anchor="middle" class="score__empty">La portée attend tes notes…</text>`;
    s += '</svg>';
    return s;
  }

  function renderScoreLive() {
    const holder = stage.querySelector('[data-live-score]');
    if (!holder) return;
    holder.innerHTML = scoreSVG(recNotes);
    holder.scrollLeft = holder.scrollWidth;
    const cnt = stage.querySelector('[data-rec-count]');
    if (cnt) cnt.textContent = recNotes.length + ' note' + (recNotes.length > 1 ? 's' : '');
  }

  function renderPartition() {
    headSub.textContent = 'Ce que tu joues s\'écrit';
    noteHandler = null;
    clearMarks();
    if (recording) { renderRecordingUI(); return; }
    const recs = prog.recs.slice().reverse();
    const rows = recs.length ? recs.map(r => `
      <div class="songrow" data-rec="${r.id}">
        <span class="songrow__icon">𝄞</span>
        <span class="songrow__main">
          <span class="songrow__name">${escapeHTMLp(r.name)}</span>
          <div class="songrow__meta">${r.notes.length} notes · ${new Date(r.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}</div>
        </span>
      </div>`).join('') : '';
    stage.innerHTML = `
      <div class="card">
        <div class="card__title">Nouvelle partition</div>
        <div class="card__sub">Lance l'enregistrement puis joue — sur l'écran, ou sur ton vrai piano avec le mode <strong>Écoute</strong> activé.</div>
        <div class="session__row" style="justify-content:flex-start">
          <button class="btn btn--small" data-rec-start type="button">● Enregistrer</button>
        </div>
      </div>
      ${recs.length ? `<div class="card"><div class="card__title">Mes partitions</div><div class="songlist" style="margin-top:10px">${rows}</div></div>` : ''}`;
    stage.querySelector('[data-rec-start]').addEventListener('click', () => {
      recording = true; recStart = Date.now(); recNotes = [];
      renderRecordingUI();
    });
    stage.querySelectorAll('[data-rec]').forEach(el => el.addEventListener('click', () => openRec(el.dataset.rec)));
  }

  function renderRecordingUI() {
    stage.innerHTML = `
      <div class="card">
        <div class="rec-head">
          <span class="rec-dot"></span>
          <span class="card__title">Enregistrement…</span>
          <span class="rec-count" data-rec-count>0 note</span>
        </div>
        <div class="score-scroll" data-live-score></div>
        <div class="session__row" style="justify-content:flex-start">
          <button class="btn btn--small" data-rec-stop type="button">■ Terminer</button>
          <button class="btn btn--ghost btn--small" data-rec-cancel type="button">Annuler</button>
        </div>
      </div>`;
    renderScoreLive();
    stage.querySelector('[data-rec-stop]').addEventListener('click', () => {
      recording = false;
      if (!recNotes.length) { renderPartition(); return; }
      const name = 'Partition du ' + new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
        + ' · ' + new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
      prog.recs.push({ id: 'r' + Date.now().toString(36), name, date: Date.now(), notes: recNotes });
      while (prog.recs.length > 20) prog.recs.shift();
      saveProg();
      openRec(prog.recs[prog.recs.length - 1].id);
    });
    stage.querySelector('[data-rec-cancel]').addEventListener('click', () => { recording = false; recNotes = []; renderPartition(); });
  }

  function openRec(id) {
    const r = prog.recs.find(x => x.id === id);
    if (!r) { renderPartition(); return; }
    stage.innerHTML = `
      <div class="card">
        <div class="card__title" data-rec-name>${escapeHTMLp(r.name)}</div>
        <div class="card__sub">${r.notes.length} notes · ${new Date(r.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}</div>
        <div class="score-scroll">${scoreSVG(r.notes)}</div>
        <div class="session__row" style="justify-content:flex-start">
          <button class="btn btn--small" data-play type="button">▶ Écouter</button>
          <button class="btn btn--ghost btn--small" data-practice type="button">Travailler en guidé</button>
          <button class="btn btn--ghost btn--small" data-rename type="button">Renommer</button>
          <button class="btn btn--ghost btn--small" data-del type="button">Supprimer</button>
          <button class="btn btn--ghost btn--small" data-back type="button">Retour</button>
        </div>
      </div>`;
    stage.querySelector('[data-back]').addEventListener('click', renderPartition);
    stage.querySelector('[data-play]').addEventListener('click', () => {
      // rejoue avec le rythme d'origine (silences bornés à 1,2 s)
      let acc = 0, prev = null;
      r.notes.forEach((n) => {
        const gap = prev === null ? 0 : Math.min(1200, Math.max(140, n.t - prev));
        acc += gap;
        prev = n.t;
        playNote(n.m, 0.8, 0.8, acc / 1000);
      });
    });
    stage.querySelector('[data-practice]').addEventListener('click', () => {
      startSongObj({ id: null, name: r.name, icon: '𝄞', notes: r.notes.map(n => n.m) }, () => openRec(id));
    });
    stage.querySelector('[data-rename]').addEventListener('click', () => {
      const v = prompt('Nom de la partition :', r.name);
      if (v && v.trim()) { r.name = v.trim().slice(0, 60); saveProg(); openRec(id); }
    });
    stage.querySelector('[data-del]').addEventListener('click', () => {
      if (!confirm('Supprimer cette partition ?')) return;
      prog.recs = prog.recs.filter(x => x.id !== id);
      saveProg();
      renderPartition();
    });
  }

  function escapeHTMLp(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ================= JOUER =================
  let jouerCat = 'tout';
  function renderJouer() {
    headSub.textContent = 'Joue librement, ou laisse-toi guider';
    const list = jouerCat === 'tout' ? SONGS : SONGS.filter(s => s.cat === jouerCat);
    const doneCount = SONGS.filter(s => prog.songs[s.id]).length;
    const pills = SONG_CATS.map(([k, lbl]) => {
      const n = k === 'tout' ? SONGS.length : SONGS.filter(s => s.cat === k).length;
      return `<button class="pill pill--small ${k === jouerCat ? 'pill--on' : ''}" data-cat="${k}" type="button">${lbl} · ${n}</button>`;
    }).join('');
    const rows = list.map(s => `
      <button class="songrow" data-song="${s.id}" type="button">
        <span class="songrow__icon">${s.icon}</span>
        <span class="songrow__main">
          <span class="songrow__name">${s.name}</span>
          <div class="songrow__meta">${s.level} · ${s.notes.length} notes</div>
        </span>
        ${prog.songs[s.id] ? '<span class="songrow__badge">✓ jouée</span>' : ''}
      </button>`).join('');
    stage.innerHTML = `
      <div class="card">
        <div class="card__title">Mélodies guidées ${doneCount ? `<span class="songcount">${doneCount}/${SONGS.length} jouées</span>` : ''}</div>
        <div class="card__sub">La touche à jouer s'illumine — avance à ton rythme, sans métronome.</div>
        <div class="pills" style="margin-top:10px">${pills}</div>
        <div class="songlist" style="margin-top:10px">${rows}</div>
        <p class="freeplay-hint">…ou joue librement : chaque touche sonne, tout simplement.</p>
      </div>`;
    stage.querySelectorAll('[data-cat]').forEach(b => b.addEventListener('click', () => { jouerCat = b.dataset.cat; renderJouer(); }));
    stage.querySelectorAll('[data-song]').forEach(b => b.addEventListener('click', () => startSong(b.dataset.song)));
  }

  function startSong(id) {
    const song = SONGS.find(s => s.id === id);
    if (!song) return;
    startSongObj(song, renderJouer, () => startSong(id));
  }

  // Version générale : accepte n'importe quel objet {name, icon, notes[, id]}
  // — y compris les partitions enregistrées par l'utilisateur.
  function startSongObj(song, onBack, onAgain) {
    let i = 0;
    headSub.textContent = 'Mélodie guidée';
    const draw = () => {
      const done = i >= song.notes.length;
      stage.innerHTML = `
        <div class="card session">
          <div class="session__eyebrow">${song.icon} Mélodie guidée</div>
          <div class="session__title">${song.name}</div>
          ${done
            ? `<div class="bravo"><div class="bravo__emoji">🎉</div><div class="session__text"><strong>Bravo !</strong> Mélodie jouée en entier.</div></div>`
            : `<div class="session__text">Note <strong>${i + 1} / ${song.notes.length}</strong> — joue la touche qui brille.</div>`}
          <div class="session__progress"><i style="width:${Math.round(i / song.notes.length * 100)}%"></i></div>
          <div class="session__row">
            ${done ? `<button class="btn btn--ghost btn--small" data-full type="button">🔊 Réécouter</button>` : `<button class="btn btn--ghost btn--small" data-hear type="button">Écouter la suite</button>`}
            <button class="btn btn--ghost btn--small" data-quit type="button">${done ? 'Retour' : 'Quitter'}</button>
            ${done ? `<button class="btn btn--small" data-again type="button">Rejouer</button>` : ''}
          </div>
        </div>`;
      stage.querySelector('[data-quit]')?.addEventListener('click', () => { noteHandler = null; clearMarks(); onBack(); });
      stage.querySelector('[data-again]')?.addEventListener('click', () => (onAgain ? onAgain() : startSongObj(song, onBack, onAgain)));
      stage.querySelector('[data-hear]')?.addEventListener('click', () => {
        // fait entendre les 5 prochaines notes, avec le vrai rythme
        let t = 0;
        song.notes.slice(i, i + 5).forEach((m, k) => {
          playNote(m, 0.6, 0.7, t);
          t += 0.45 * ((song.beats && song.beats[i + k]) || 1);
        });
      });
      stage.querySelector('[data-full]')?.addEventListener('click', () => {
        // le morceau en entier, comme il s'écoute
        let t = 0;
        song.notes.forEach((m, k) => {
          playNote(m, 0.7, 0.75, t);
          t += 0.42 * ((song.beats && song.beats[k]) || 1);
        });
      });
      clearMarks();
      if (!done) {
        ensureVisible(song.notes[i]);
        mark([song.notes[i]], 'hint');
      } else {
        if (song.id) { prog.songs[song.id] = true; saveProg(); }
        noteHandler = null;
      }
    };
    noteHandler = (midi) => {
      if (i >= song.notes.length) return;
      if (midi === song.notes[i]) { flashKey(midi, 'good'); i++; draw(); }
      else flashKey(midi, 'bad');
    };
    draw();
  }

  // ================= APPRENDRE =================
  const LESSONS = [
    { id: 'l1', level: 'Néophyte', name: 'Repérer Do', desc: 'Le groupe de 2 touches noires, ton point d\'ancrage',
      steps: [
        { type: 'info', text: 'Regarde les touches noires : elles vont par <strong>groupes de 2 et de 3</strong>. La touche blanche juste à gauche d\'un groupe de 2 noires est toujours un <strong>Do</strong>.', show: [60], cls: 'root' },
        { type: 'find', text: 'Trouve et joue <strong>3 Do différents</strong> sur le clavier.', targetPc: 0, count: 3 },
      ] },
    { id: 'l2', level: 'Néophyte', name: 'Les 7 notes', desc: 'Do Ré Mi Fa Sol La Si — et ça recommence',
      steps: [
        { type: 'info', text: 'Les touches blanches se nomment <strong>Do Ré Mi Fa Sol La Si</strong>, puis la série recommence une octave plus haut. Regarde-les s\'illuminer.', show: [60, 62, 64, 65, 67, 69, 71], cls: 'show', play: true },
        { type: 'seq', text: 'À toi : joue <strong>Do Ré Mi Fa Sol</strong> dans l\'ordre.', notes: [60, 62, 64, 65, 67] },
        { type: 'seq', text: 'Et maintenant en redescendant : <strong>Sol Fa Mi Ré Do</strong>.', notes: [67, 65, 64, 62, 60] },
      ] },
    { id: 'l3', level: 'Néophyte', name: 'La position à 5 doigts', desc: 'Pouce sur Do, un doigt par touche',
      steps: [
        { type: 'info', text: 'Pose ta main droite : <strong>pouce (1) sur Do</strong>, puis un doigt par touche jusqu\'à <strong>l\'auriculaire (5) sur Sol</strong>. C\'est LA position de départ du pianiste.', show: [60, 62, 64, 65, 67], cls: 'show', fingers: ['1', '2', '3', '4', '5'] },
        { type: 'seq', text: 'Joue <strong>1-3-5</strong> (Do, Mi, Sol) sans bouger la main.', notes: [60, 64, 67] },
        { type: 'seq', text: 'Le petit défi : <strong>1-3-2-4-3-5</strong>.', notes: [60, 64, 62, 65, 64, 67] },
      ] },
    { id: 'l4', level: 'Néophyte', name: 'Ta première mélodie', desc: 'Au clair de la lune, guidée note à note',
      steps: [
        { type: 'song', text: 'Tout est prêt : joue <strong>Au clair de la lune</strong> en suivant la touche qui brille.', song: 'lune' },
      ] },
    { id: 'l5', level: 'Débutant', name: 'Les touches noires', desc: 'Dièses et bémols — la même touche, deux noms',
      steps: [
        { type: 'info', text: 'Une touche noire prend le nom de sa voisine : à droite de Fa, c\'est <strong>Fa♯</strong> (fa dièse) ; à gauche de Sol, c\'est <strong>Sol♭</strong> (sol bémol). <strong>C\'est la même touche !</strong>', show: [66], cls: 'root' },
        { type: 'find', text: 'Trouve et joue <strong>2 Fa♯</strong> (le 1ᵉʳ du groupe de 3 noires).', targetPc: 6, count: 2 },
        { type: 'find', text: 'Trouve <strong>2 Do♯</strong> (le 1ᵉʳ du groupe de 2 noires).', targetPc: 1, count: 2 },
      ] },
    { id: 'l6', level: 'Débutant', name: 'Ton premier accord', desc: 'Do majeur — trois notes qui sonnent ensemble',
      steps: [
        { type: 'info', text: 'Un accord = plusieurs notes ensemble. <strong>Do majeur</strong> = Do + Mi + Sol (doigts 1-3-5). Écoute-le.', show: [60, 64, 67], cls: 'show', fingers: ['1', '3', '5'], playChord: true },
        { type: 'chord', text: 'Joue les 3 notes de <strong>Do majeur</strong> — ensemble ou l\'une après l\'autre.', notes: [60, 64, 67] },
        { type: 'chord', text: 'Même forme, décalée : <strong>Fa majeur</strong> (Fa-La-Do).', notes: [65, 69, 72] },
        { type: 'chord', text: 'Et <strong>Sol majeur</strong> (Sol-Si-Ré).', notes: [67, 71, 74] },
      ] },
    { id: 'l7', level: 'Débutant', name: 'La gamme de Do majeur', desc: 'Le passage du pouce, geste fondateur',
      steps: [
        { type: 'info', text: 'Pour monter 8 notes avec 5 doigts, le <strong>pouce passe sous le majeur</strong> après Mi : doigté <strong>1-2-3-1-2-3-4-5</strong>.', show: [60, 62, 64, 65, 67, 69, 71, 72], cls: 'show', fingers: ['1', '2', '3', '1', '2', '3', '4', '5'], play: true },
        { type: 'seq', text: 'Monte la gamme complète : <strong>Do → Do</strong>.', notes: [60, 62, 64, 65, 67, 69, 71, 72] },
        { type: 'seq', text: 'Redescends : <strong>Do → Do</strong> (doigté 5-4-3-2-1-3-2-1).', notes: [72, 71, 69, 67, 65, 64, 62, 60] },
      ] },
    { id: 'l8', level: 'Confirmé', name: 'Majeur vs mineur', desc: 'Une note change tout : la tierce',
      steps: [
        { type: 'info', text: 'Baisse la note du milieu d\'un demi-ton et l\'accord devient <strong>mineur</strong> — la couleur triste. Do majeur : Do-Mi-Sol. <strong>Do mineur : Do-Mi♭-Sol</strong>.', show: [60, 63, 67], cls: 'show', playChord: true },
        { type: 'chord', text: 'Joue <strong>La mineur</strong> (La-Do-Mi) — l\'accord mineur le plus utilisé.', notes: [57, 60, 64] },
        { type: 'chord', text: 'Puis <strong>Ré mineur</strong> (Ré-Fa-La).', notes: [62, 65, 69] },
        { type: 'chord', text: 'Et <strong>Mi mineur</strong> (Mi-Sol-Si).', notes: [64, 67, 71] },
      ] },
    { id: 'l9', level: 'Confirmé', name: 'La suite magique', desc: 'Do — Sol — La m — Fa : la moitié de la pop mondiale',
      steps: [
        { type: 'info', text: 'Ces 4 accords enchaînés (<strong>I-V-vi-IV</strong>) portent des centaines de tubes. Écoute l\'enchaînement.', show: [60, 64, 67], cls: 'show', progression: [[60, 64, 67], [55, 59, 62], [57, 60, 64], [53, 57, 60]] },
        { type: 'chord', text: '1/4 — <strong>Do majeur</strong> (Do-Mi-Sol).', notes: [60, 64, 67] },
        { type: 'chord', text: '2/4 — <strong>Sol majeur</strong> (Sol-Si-Ré, en dessous).', notes: [55, 59, 62] },
        { type: 'chord', text: '3/4 — <strong>La mineur</strong> (La-Do-Mi).', notes: [57, 60, 64] },
        { type: 'chord', text: '4/4 — <strong>Fa majeur</strong> (Fa-La-Do). Enchaîne les 4 en boucle : tu accompagnes déjà.', notes: [53, 57, 60] },
      ] },
    { id: 'l10', level: 'Confirmé', name: 'Improviser sans faute', desc: 'La gamme pentatonique, terrain de jeu sûr',
      steps: [
        { type: 'info', text: 'La <strong>penta majeure de Do</strong> (Do Ré Mi Sol La) : 5 notes qui sonnent toujours bien ensemble. Il n\'y a <strong>pas de fausse note</strong> dedans.', show: [60, 62, 64, 67, 69, 72], cls: 'show', play: true },
        { type: 'seq', text: 'Monte-la une fois : <strong>Do Ré Mi Sol La Do</strong>.', notes: [60, 62, 64, 67, 69, 72] },
        { type: 'free', text: '<strong>Improvise 12 notes</strong> en ne jouant QUE les touches illuminées. Écoute ce que ça raconte.', pool: [60, 62, 64, 67, 69, 72, 74, 76], count: 12 },
      ] },
  ];

  function renderApprendre() {
    headSub.textContent = 'Le parcours, pas à pas';
    const done = Object.keys(prog.lessons).filter(k => prog.lessons[k]).length;
    const rows = LESSONS.map((l, i) => `
      <button class="lesson ${prog.lessons[l.id] ? 'lesson--done' : ''}" data-lesson="${l.id}" type="button">
        <span class="lesson__num">${prog.lessons[l.id] ? '✓' : i + 1}</span>
        <span class="lesson__main">
          <span class="lesson__name">${l.name}</span>
          <div class="lesson__desc">${l.desc}</div>
        </span>
        <span class="lesson__level">${l.level}</span>
      </button>`).join('');
    stage.innerHTML = `
      <div class="learnhead">
        <span class="learnhead__t">10 leçons</span>
        <span class="learnhead__p">${done} / ${LESSONS.length} terminées</span>
      </div>
      <div class="lessons">${rows}</div>`;
    stage.querySelectorAll('[data-lesson]').forEach(b => b.addEventListener('click', () => startLesson(b.dataset.lesson)));
  }

  function startLesson(id) {
    const lesson = LESSONS.find(l => l.id === id);
    if (!lesson) return;
    let si = 0;
    headSub.textContent = lesson.level;

    function stepDraw(extraState) {
      const step = lesson.steps[si];
      const finished = si >= lesson.steps.length;
      if (finished) {
        prog.lessons[id] = true;
        saveProg();
        noteHandler = null;
        clearMarks();
        stage.innerHTML = `
          <div class="card session">
            <div class="bravo"><div class="bravo__emoji">🎉</div></div>
            <div class="session__title">Leçon terminée !</div>
            <div class="session__text"><strong>${lesson.name}</strong> — c'est acquis.</div>
            <div class="session__row">
              <button class="btn btn--ghost btn--small" data-back type="button">Retour aux leçons</button>
              ${LESSONS.indexOf(lesson) < LESSONS.length - 1 ? `<button class="btn btn--small" data-next type="button">Leçon suivante</button>` : ''}
            </div>
          </div>`;
        stage.querySelector('[data-back]').addEventListener('click', renderApprendre);
        stage.querySelector('[data-next]')?.addEventListener('click', () => startLesson(LESSONS[LESSONS.indexOf(lesson) + 1].id));
        return;
      }
      stage.innerHTML = `
        <div class="card session">
          <div class="session__eyebrow">Leçon — ${lesson.name}</div>
          <div class="session__text" style="margin-top:10px">${step.text}</div>
          <div class="session__feedback session__feedback--good" data-fb-line>${extraState || ''}</div>
          <div class="session__progress"><i style="width:${Math.round(si / lesson.steps.length * 100)}%"></i></div>
          <div class="session__row">
            <button class="btn btn--ghost btn--small" data-quit type="button">Quitter</button>
            ${step.type === 'info' ? `<button class="btn btn--small" data-next type="button">J'ai vu — suite</button>` : ''}
            ${(step.play || step.playChord || step.progression) ? `<button class="btn btn--ghost btn--small" data-listen type="button">Réécouter</button>` : ''}
          </div>
        </div>`;
      stage.querySelector('[data-quit]').addEventListener('click', () => { noteHandler = null; clearMarks(); renderApprendre(); });
      stage.querySelector('[data-next]')?.addEventListener('click', () => { si++; stepDraw(); });
      const listen = () => {
        if (step.progression) step.progression.forEach((ch, i) => setTimeout(() => playChordNotes(ch), i * 750));
        else if (step.playChord) playChordNotes(step.show);
        else if (step.play) step.show.forEach((m, i) => playNote(m, 0.55, 0.7, i * 0.38));
      };
      stage.querySelector('[data-listen]')?.addEventListener('click', listen);

      // Prépare le clavier + le handler du pas
      clearMarks();
      if (step.show) {
        ensureVisible(step.show[0]);
        mark(step.show, step.cls || 'show', step.fingers);
        if (step.play || step.playChord || step.progression) setTimeout(listen, 350);
      }

      if (step.type === 'find') {
        // Le compteur vit dans la fermeture — le feedback met à jour la ligne
        // sans re-rendre le pas (un re-rendu remettait la progression à zéro).
        const found = new Set();
        const fb = () => { const el = stage.querySelector('[data-fb-line]'); if (el) el.textContent = `${found.size} / ${step.count} — continue !`; };
        noteHandler = (midi) => {
          if (midi % 12 === step.targetPc && !found.has(midi)) {
            found.add(midi);
            flashKey(midi, 'good');
            if (found.size >= step.count) { si++; setTimeout(() => stepDraw(), 350); }
            else fb();
          } else if (midi % 12 !== step.targetPc) flashKey(midi, 'bad');
        };
      } else if (step.type === 'seq') {
        let i = 0;
        ensureVisible(step.notes[0]);
        mark([step.notes[0]], 'hint');
        noteHandler = (midi) => {
          if (midi === step.notes[i]) {
            flashKey(midi, 'good');
            i++;
            if (i >= step.notes.length) { si++; setTimeout(() => stepDraw(), 350); }
            else { clearMarks(); ensureVisible(step.notes[i]); mark([step.notes[i]], 'hint'); }
          } else flashKey(midi, 'bad');
        };
      } else if (step.type === 'chord') {
        const want = new Set(step.notes);
        const got = new Set();
        ensureVisible(step.notes[0]);
        mark(step.notes, 'hint');
        noteHandler = (midi) => {
          if (want.has(midi)) {
            got.add(midi);
            flashKey(midi, 'good');
            if (got.size >= want.size) {
              setTimeout(() => playChordNotes(step.notes), 150);
              si++; setTimeout(() => stepDraw(), 550);
            }
          } else { got.clear(); flashKey(midi, 'bad'); }
        };
      } else if (step.type === 'free') {
        let n = 0;
        const pool = new Set(step.pool);
        ensureVisible(step.pool[0]);
        mark(step.pool, 'show');
        noteHandler = (midi) => {
          if (pool.has(midi)) {
            n++;
            if (n >= step.count) { si++; setTimeout(() => stepDraw(), 300); }
            else { const el = stage.querySelector('[data-fb-line]'); if (el) el.textContent = `${n} / ${step.count} notes — laisse venir…`; }
          } else flashKey(midi, 'bad');
        };
      } else if (step.type === 'song') {
        noteHandler = null;
        startSongInLesson(step.song, () => { si++; stepDraw(); }, () => { noteHandler = null; clearMarks(); renderApprendre(); });
      }
    }
    stepDraw();
  }

  function startSongInLesson(songId, onDone, onQuit) {
    const song = SONGS.find(s => s.id === songId);
    let i = 0;
    const draw = () => {
      stage.innerHTML = `
        <div class="card session">
          <div class="session__eyebrow">${song.icon} ${song.name}</div>
          <div class="session__text">Note <strong>${i + 1} / ${song.notes.length}</strong> — suis la touche qui brille.</div>
          <div class="session__progress"><i style="width:${Math.round(i / song.notes.length * 100)}%"></i></div>
          <div class="session__row"><button class="btn btn--ghost btn--small" data-quit type="button">Quitter</button></div>
        </div>`;
      stage.querySelector('[data-quit]').addEventListener('click', onQuit);
      clearMarks();
      ensureVisible(song.notes[i]);
      mark([song.notes[i]], 'hint');
    };
    noteHandler = (midi) => {
      if (midi === song.notes[i]) {
        flashKey(midi, 'good');
        i++;
        if (i >= song.notes.length) { prog.songs[songId] = true; saveProg(); noteHandler = null; onDone(); }
        else draw();
      } else flashKey(midi, 'bad');
    };
    draw();
  }

  // ================= ENTRAÎNER =================
  function renderEntrainer() {
    headSub.textContent = 'Des jeux courts, un niveau qui monte';
    const best = prog.best;
    stage.innerHTML = `
      <div class="games">
        <button class="game" data-game="note" type="button">
          <div class="game__icon">🎯</div>
          <div class="game__name">Trouve la note</div>
          <div class="game__desc">Un nom s'affiche, joue la bonne touche.</div>
          <div class="game__best">${best.note ? 'Record : ' + best.note + ' d\'affilée' : 'Pas encore joué'}</div>
        </button>
        <button class="game" data-game="chord" type="button">
          <div class="game__icon">🎹</div>
          <div class="game__name">Quel accord ?</div>
          <div class="game__desc">Écoute et regarde — majeur, mineur… ?</div>
          <div class="game__best">${best.chord ? 'Record : ' + best.chord + ' d\'affilée' : 'Pas encore joué'}</div>
        </button>
        <button class="game" data-game="ear" type="button">
          <div class="game__icon">👂</div>
          <div class="game__name">L'oreille</div>
          <div class="game__desc">Deux notes — quel intervalle les sépare ?</div>
          <div class="game__best">${best.ear ? 'Record : ' + best.ear + ' d\'affilée' : 'Pas encore joué'}</div>
        </button>
        <button class="game" data-game="rush" type="button">
          <div class="game__icon">⚡</div>
          <div class="game__name">Note rush</div>
          <div class="game__desc">30 secondes, un max de notes trouvées.</div>
          <div class="game__best">${best.rush ? 'Record : ' + best.rush + ' notes' : 'Pas encore joué'}</div>
        </button>
      </div>`;
    stage.querySelectorAll('[data-game]').forEach(b => b.addEventListener('click', () => startGame(b.dataset.game)));
  }

  const randInt = (a, b) => a + Math.floor(Math.random() * (b - a + 1));

  function startGame(kind) {
    let streakN = 0;
    if (kind === 'note' || kind === 'rush') {
      const rush = kind === 'rush';
      let target = null, score = 0, deadline = 0, timer = null;
      const next = () => {
        target = randInt(rush ? octaveBase : 55, rush ? octaveBase + 23 : 72);
        draw();
      };
      const draw = () => {
        const left = rush ? Math.max(0, Math.ceil((deadline - Date.now()) / 1000)) : null;
        stage.innerHTML = `
          <div class="card session">
            <div class="session__eyebrow">${rush ? '⚡ Note rush' : '🎯 Trouve la note'}</div>
            <div class="session__big">${noteName(target, true)}</div>
            <div class="session__feedback" data-fb></div>
            <div class="quiz-score">
              <span>${rush ? 'Score : ' : 'Série : '}<b>${rush ? score : streakN}</b></span>
              ${rush ? `<span>Temps : <b>${left}s</b></span>` : `<span>Record : <b>${prog.best[kind] || 0}</b></span>`}
            </div>
            <div class="session__row"><button class="btn btn--ghost btn--small" data-quit type="button">Quitter</button></div>
          </div>`;
        stage.querySelector('[data-quit]').addEventListener('click', () => {
          clearInterval(timer);
          noteHandler = null;
          renderEntrainer();
        });
      };
      if (rush) {
        deadline = Date.now() + 30000;
        timer = setInterval(() => {
          if (Date.now() >= deadline) {
            clearInterval(timer);
            noteHandler = null;
            if (score > (prog.best.rush || 0)) { prog.best.rush = score; saveProg(); }
            stage.innerHTML = `
              <div class="card session">
                <div class="bravo"><div class="bravo__emoji">⚡</div></div>
                <div class="session__title">${score} note${score > 1 ? 's' : ''} en 30 s</div>
                <div class="session__text">${score >= (prog.best.rush || 0) ? '<strong>Nouveau record !</strong>' : 'Record : ' + (prog.best.rush || 0)}</div>
                <div class="session__row">
                  <button class="btn btn--ghost btn--small" data-quit type="button">Retour</button>
                  <button class="btn btn--small" data-again type="button">Rejouer</button>
                </div>
              </div>`;
            stage.querySelector('[data-quit]').addEventListener('click', renderEntrainer);
            stage.querySelector('[data-again]').addEventListener('click', () => startGame('rush'));
          } else draw();
        }, 500);
      }
      noteHandler = (midi) => {
        if (!target) return;
        if (midi % 12 === target % 12 && (!rush ? midi === target : true)) {
          flashKey(midi, 'good');
          if (rush) score++;
          else {
            streakN++;
            if (streakN > (prog.best.note || 0)) { prog.best.note = streakN; saveProg(); }
          }
          next();
        } else {
          flashKey(midi, 'bad');
          if (!rush) { streakN = 0; draw(); }
        }
      };
      next();
      return;
    }

    if (kind === 'chord') {
      const KINDS = ['Majeur', 'Mineur', 'Dim', 'Sus4', '7'];
      let answer = null, notes = null;
      const next = () => {
        const root = randInt(55, 67);
        answer = KINDS[randInt(0, KINDS.length - 1)];
        notes = CHORDS[answer].iv.map(i => root + i);
        clearMarks();
        ensureVisible(root);
        mark(notes, 'show');
        setTimeout(() => playChordNotes(notes), 300);
        const opts = [...KINDS].sort(() => Math.random() - 0.5);
        stage.innerHTML = `
          <div class="card session">
            <div class="session__eyebrow">🎹 Quel accord ?</div>
            <div class="session__text">Écoute et regarde le clavier…</div>
            <div class="quiz-choices">${opts.map(o => `<button class="choice" data-c="${o}" type="button">${o}</button>`).join('')}</div>
            <div class="quiz-score"><span>Série : <b>${streakN}</b></span><span>Record : <b>${prog.best.chord || 0}</b></span></div>
            <div class="session__row">
              <button class="btn btn--ghost btn--small" data-listen type="button">Réécouter</button>
              <button class="btn btn--ghost btn--small" data-quit type="button">Quitter</button>
            </div>
          </div>`;
        stage.querySelector('[data-quit]').addEventListener('click', () => { noteHandler = null; clearMarks(); renderEntrainer(); });
        stage.querySelector('[data-listen]').addEventListener('click', () => playChordNotes(notes));
        stage.querySelectorAll('[data-c]').forEach(b => b.addEventListener('click', () => {
          if (b.dataset.c === answer) {
            b.classList.add('choice--good');
            streakN++;
            if (streakN > (prog.best.chord || 0)) { prog.best.chord = streakN; saveProg(); }
            setTimeout(next, 550);
          } else {
            b.classList.add('choice--bad');
            stage.querySelector(`[data-c="${answer}"]`)?.classList.add('choice--good');
            streakN = 0;
            setTimeout(next, 1100);
          }
        }));
      };
      next();
      return;
    }

    if (kind === 'ear') {
      const INTERVALS = [
        [2, 'Seconde (Do→Ré)'], [4, 'Tierce majeure (Do→Mi)'], [5, 'Quarte (Do→Fa)'],
        [7, 'Quinte (Do→Sol)'], [12, 'Octave (Do→Do)'],
      ];
      let answer = null, base = null;
      const next = () => {
        base = randInt(55, 67);
        answer = INTERVALS[randInt(0, INTERVALS.length - 1)];
        const hear = () => { playNote(base, 0.8, 0.8); playNote(base + answer[0], 0.8, 0.8, 0.85); };
        setTimeout(hear, 300);
        const opts = [...INTERVALS].sort(() => Math.random() - 0.5);
        stage.innerHTML = `
          <div class="card session">
            <div class="session__eyebrow">👂 L'oreille</div>
            <div class="session__text">Deux notes montantes — quel <strong>intervalle</strong> ?</div>
            <div class="quiz-choices">${opts.map(o => `<button class="choice" data-i="${o[0]}" type="button">${o[1].split(' (')[0]}</button>`).join('')}</div>
            <div class="quiz-score"><span>Série : <b>${streakN}</b></span><span>Record : <b>${prog.best.ear || 0}</b></span></div>
            <div class="session__row">
              <button class="btn btn--ghost btn--small" data-listen type="button">Réécouter</button>
              <button class="btn btn--ghost btn--small" data-quit type="button">Quitter</button>
            </div>
          </div>`;
        stage.querySelector('[data-quit]').addEventListener('click', () => { noteHandler = null; renderEntrainer(); });
        stage.querySelector('[data-listen]').addEventListener('click', hear);
        stage.querySelectorAll('[data-i]').forEach(b => b.addEventListener('click', () => {
          if (Number(b.dataset.i) === answer[0]) {
            b.classList.add('choice--good');
            streakN++;
            if (streakN > (prog.best.ear || 0)) { prog.best.ear = streakN; saveProg(); }
            setTimeout(next, 550);
          } else {
            b.classList.add('choice--bad');
            stage.querySelector(`[data-i="${answer[0]}"]`)?.classList.add('choice--good');
            streakN = 0;
            setTimeout(next, 1100);
          }
        }));
      };
      next();
      return;
    }
  }

  // ================= DICO =================
  let dicoView = 'accords';
  let dicoRoot = 0, dicoChord = 'Majeur', dicoScale = 'Majeure', cofSel = 0;

  function renderDico() {
    headSub.textContent = 'Accords, gammes, tonalités';
    const tabs = `
      <div class="dico-tabs">
        <button class="dico-tab ${dicoView === 'accords' ? 'dico-tab--on' : ''}" data-v="accords" type="button">Accords</button>
        <button class="dico-tab ${dicoView === 'gammes' ? 'dico-tab--on' : ''}" data-v="gammes" type="button">Gammes</button>
        <button class="dico-tab ${dicoView === 'quintes' ? 'dico-tab--on' : ''}" data-v="quintes" type="button">Cycle des quintes</button>
      </div>`;

    if (dicoView === 'quintes') {
      stage.innerHTML = tabs + renderCof();
      wireDicoTabs();
      wireCof();
      return;
    }

    const names = prog.labels === 'en' ? EN : FR;
    const roots = names.map((n, i) => `<button class="pill pill--small ${i === dicoRoot ? 'pill--on' : ''}" data-root="${i}" type="button">${n}</button>`).join('');
    const kinds = dicoView === 'accords'
      ? Object.keys(CHORDS).map(k => `<button class="pill ${k === dicoChord ? 'pill--on' : ''}" data-kind="${k}" type="button">${k}</button>`).join('')
      : Object.keys(SCALES).map(k => `<button class="pill ${k === dicoScale ? 'pill--on' : ''}" data-kind="${k}" type="button">${k}</button>`).join('');

    const base = 60 + dicoRoot;
    const iv = dicoView === 'accords' ? CHORDS[dicoChord].iv : SCALES[dicoScale].iv;
    const midis = iv.map(i => base + i);
    if (dicoView === 'gammes') midis.push(base + 12);
    const noteStr = midis.map(m => names[m % 12]).join(' · ');
    const label = dicoView === 'accords'
      ? names[dicoRoot] + (CHORDS[dicoChord].suffix ? ' ' + CHORDS[dicoChord].suffix : ' majeur')
      : names[dicoRoot] + ' — ' + dicoScale.toLowerCase();

    stage.innerHTML = tabs + `
      <div class="card">
        <div class="pills" style="margin-bottom:10px">${roots}</div>
        <div class="pills">${kinds}</div>
        <div class="dico-result">
          <div class="dico-result__name">${label}</div>
          <div class="dico-result__notes">${noteStr}</div>
          ${dicoView === 'gammes' ? `<div class="dico-result__hint">${SCALES[dicoScale].hint}</div>` : ''}
          <div class="session__row">
            <button class="btn btn--small" data-hear type="button">Écouter</button>
          </div>
        </div>
      </div>`;
    wireDicoTabs();
    stage.querySelectorAll('[data-root]').forEach(b => b.addEventListener('click', () => { dicoRoot = Number(b.dataset.root); renderDico(); }));
    stage.querySelectorAll('[data-kind]').forEach(b => b.addEventListener('click', () => {
      if (dicoView === 'accords') dicoChord = b.dataset.kind; else dicoScale = b.dataset.kind;
      renderDico();
    }));
    stage.querySelector('[data-hear]').addEventListener('click', () => {
      if (dicoView === 'accords') playChordNotes(midis);
      else midis.forEach((m, i) => playNote(m, 0.5, 0.75, i * 0.3));
    });
    clearMarks();
    ensureVisible(midis[0]);
    midis.forEach((m, i) => shown.set(m, i === 0 || m % 12 === dicoRoot ? 'root' : 'show'));
    renderKeyboard();
  }

  function wireDicoTabs() {
    stage.querySelectorAll('[data-v]').forEach(b => b.addEventListener('click', () => { dicoView = b.dataset.v; renderDico(); }));
  }

  function renderCof() {
    const cx = 50, cy = 50, r1 = 28, r2 = 48;
    let segs = '', labels = '';
    for (let i = 0; i < 12; i++) {
      const a0 = (i * 30 - 105) * Math.PI / 180;
      const a1 = (i * 30 - 75) * Math.PI / 180;
      const p = (r, a) => `${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`;
      segs += `<path class="cof__seg ${i === cofSel ? 'cof__seg--on' : ''}" data-seg="${i}"
        d="M ${p(r1, a0)} A ${r1} ${r1} 0 0 1 ${p(r1, a1)} L ${p(r2, a1)} A ${r2} ${r2} 0 0 0 ${p(r2, a0)} Z"/>`;
      const am = (i * 30 - 90) * Math.PI / 180;
      const lx = cx + 40 * Math.cos(am), ly = cy + 40 * Math.sin(am);
      const mx = cx + 33.5 * Math.cos(am), my = cy + 33.5 * Math.sin(am);
      labels += `<text class="cof__maj" x="${lx.toFixed(1)}" y="${(ly + 2.4).toFixed(1)}" text-anchor="middle">${COF[i][0]}</text>`;
      labels += `<text class="cof__min" x="${mx.toFixed(1)}" y="${(my + 1.6).toFixed(1)}" text-anchor="middle">${COF[i][1]}</text>`;
    }
    const sel = COF[cofSel];
    const pc = COF_PC[cofSel];
    const scale = SCALES['Majeure'].iv.map(i => (pc + i) % 12);
    const chordBtns = DEGREES.map((d, i) => {
      const rootPc = scale[i];
      const minor = d === d.toLowerCase() && !d.includes('°');
      const dim = d.includes('°');
      const names = prog.labels === 'en' ? EN : FR;
      const nm = names[rootPc] + (dim ? 'dim' : minor ? 'm' : '');
      return `<button class="pill pill--small" data-deg="${i}" type="button">${d} · ${nm}</button>`;
    }).join('');
    return `
      <div class="card cof-wrap">
        <svg class="cof" viewBox="0 0 100 100">${segs}${labels}</svg>
        <div class="cof-info">
          <div class="cof-info__key">${sel[0]} majeur <span style="color:var(--text-dim)">· relative ${sel[1]}</span></div>
          <div class="cof-info__sig">Armure : ${sel[2]}</div>
          <div class="cof-chords">${chordBtns}</div>
          <div class="dico-result__hint" style="margin-top:8px">Tape un degré pour l'entendre et le voir sur le clavier.</div>
        </div>
      </div>`;
  }

  function wireCof() {
    stage.querySelectorAll('[data-seg]').forEach(s => s.addEventListener('click', () => {
      cofSel = Number(s.dataset.seg);
      renderDico();
    }));
    stage.querySelectorAll('[data-deg]').forEach(b => b.addEventListener('click', () => {
      const i = Number(b.dataset.deg);
      const pc = COF_PC[cofSel];
      const scale = SCALES['Majeure'].iv;
      const rootPc = (pc + scale[i]) % 12;
      const minor = ['ii', 'iii', 'vi'].includes(DEGREES[i]);
      const dim = DEGREES[i] === 'vii°';
      const iv = dim ? CHORDS['Dim'].iv : minor ? CHORDS['Mineur'].iv : CHORDS['Majeur'].iv;
      const base = 60 + rootPc > 67 ? 48 + rootPc : 60 + rootPc;
      const midis = iv.map(x => base + x);
      clearMarks();
      ensureVisible(midis[0]);
      midis.forEach((m, k) => shown.set(m, k === 0 ? 'root' : 'show'));
      renderKeyboard();
      playChordNotes(midis);
    }));
  }

  // ---------- Init ----------
  labelsBtnText();
  renderKeyboard();
  render();

  // Portrait ↔ paysage : le clavier passe de 2 à 3 octaves.
  let lastOrient = window.innerWidth > window.innerHeight;
  function onResize() {
    const nowLandscape = window.innerWidth > window.innerHeight;
    if (nowLandscape === lastOrient && WHITE_PER_VIEW === whitesPerView()) return;
    lastOrient = nowLandscape;
    WHITE_PER_VIEW = whitesPerView();
    renderKeyboard();
  }
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', () => setTimeout(onResize, 120));
})();
