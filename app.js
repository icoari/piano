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

  // Mélodies guidées (notes MIDI, Do central = 60)
  const SONGS = [
    { id: 'lune', name: 'Au clair de la lune', icon: '🌙', level: 'Néophyte',
      notes: [60, 60, 60, 62, 64, 62, 60, 64, 62, 62, 60] },
    { id: 'jacques', name: 'Frère Jacques', icon: '🔔', level: 'Néophyte',
      notes: [60, 62, 64, 60, 60, 62, 64, 60, 64, 65, 67, 64, 65, 67, 67, 69, 67, 65, 64, 60, 67, 69, 67, 65, 64, 60, 60, 55, 60, 60, 55, 60] },
    { id: 'joie', name: 'Ode à la joie', icon: '🎼', level: 'Facile',
      notes: [64, 64, 65, 67, 67, 65, 64, 62, 60, 60, 62, 64, 64, 62, 62, 64, 64, 65, 67, 67, 65, 64, 62, 60, 60, 62, 64, 62, 60, 60] },
    { id: 'birthday', name: 'Joyeux anniversaire', icon: '🎂', level: 'Facile',
      notes: [55, 55, 57, 55, 60, 59, 55, 55, 57, 55, 62, 60, 55, 55, 67, 64, 60, 59, 57, 65, 65, 64, 60, 62, 60] },
    { id: 'jingle', name: 'Vive le vent', icon: '🎄', level: 'Facile',
      notes: [64, 64, 64, 64, 64, 64, 64, 67, 60, 62, 64, 65, 65, 65, 65, 65, 64, 64, 64, 64, 62, 62, 64, 62, 67] },
  ];

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

  // ---------- Clavier ----------
  const kbEl = document.getElementById('kb');
  let octaveBase = 48;            // Do3
  const WHITE_PER_VIEW = 14;      // 2 octaves
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
      const left = ((i + 1) / wCount * 100) - 4.25;
      const extra = shown.get(bm) ? ` bkey--${shown.get(bm)}` : '';
      html += `<button class="bkey${extra}" style="left:${left}%" data-midi="${bm}" type="button" aria-label="${noteName(bm)}">
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
  function pressKey(midi, el) {
    playNote(midi);
    if (el) {
      const down = el.classList.contains('bkey') ? 'bkey--down' : 'key--down';
      el.classList.add(down);
      setTimeout(() => el.classList.remove(down), 140);
    }
    if (navigator.vibrate) { try { navigator.vibrate(4); } catch {} }
    if (noteHandler) noteHandler(midi);
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
    const lo = octaveBase, hi = octaveBase + 24;
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
    else renderDico();
  }

  // ================= JOUER =================
  function renderJouer() {
    headSub.textContent = 'Joue librement, ou laisse-toi guider';
    const rows = SONGS.map(s => `
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
        <div class="card__title">Mélodies guidées</div>
        <div class="card__sub">La touche à jouer s'illumine — avance à ton rythme, sans métronome.</div>
        <div class="songlist" style="margin-top:12px">${rows}</div>
        <p class="freeplay-hint">…ou joue librement : chaque touche sonne, tout simplement.</p>
      </div>`;
    stage.querySelectorAll('[data-song]').forEach(b => b.addEventListener('click', () => startSong(b.dataset.song)));
  }

  function startSong(id) {
    const song = SONGS.find(s => s.id === id);
    if (!song) return;
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
            ${done ? '' : `<button class="btn btn--ghost btn--small" data-hear type="button">Écouter la suite</button>`}
            <button class="btn btn--ghost btn--small" data-quit type="button">${done ? 'Retour' : 'Quitter'}</button>
            ${done ? `<button class="btn btn--small" data-again type="button">Rejouer</button>` : ''}
          </div>
        </div>`;
      stage.querySelector('[data-quit]')?.addEventListener('click', () => { noteHandler = null; clearMarks(); renderJouer(); });
      stage.querySelector('[data-again]')?.addEventListener('click', () => startSong(id));
      stage.querySelector('[data-hear]')?.addEventListener('click', () => {
        // fait entendre les 5 prochaines notes
        song.notes.slice(i, i + 5).forEach((m, k) => playNote(m, 0.6, 0.7, k * 0.45));
      });
      clearMarks();
      if (!done) {
        ensureVisible(song.notes[i]);
        mark([song.notes[i]], 'hint');
      } else {
        prog.songs[id] = true;
        saveProg();
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
})();
