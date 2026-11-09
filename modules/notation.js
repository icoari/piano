// Grand portée en SVG : clé de sol + clé de fa, armure, chiffrage, barres de
// mesure, lignes supplémentaires, ligatures, liaisons de valeur, silences.
// Entrée : partition {notes:[{m, s, d}] (en temps), bpb, pickup, key}.
// Unité interne : la double croche (1 temps = 4).

import { detectKey } from './transcription.js';

const G = 8, ST = G / 2;               // interligne, demi-interligne
const NAT = [0, 2, 4, 5, 7, 9, 11];    // do ré mi fa sol la si
const SHARP_ORDER = [3, 0, 4, 1, 5, 2, 6];
const FLAT_ORDER = [6, 2, 5, 1, 4, 0, 3];
const VALUES = [16, 12, 8, 6, 4, 3, 2, 1];
const TREBLE_BOTTOM = 4 * 7 + 2;       // mi4 (octave 4 * 7 + lettre)
const BASS_BOTTOM = 2 * 7 + 4;         // sol2
const MID = { t: 4 * 7 + 6, b: 3 * 7 + 1 }; // si4, ré3

// ---------- Orthographe selon la tonalité ----------
function keySig(fifths) {
  const sig = new Array(7).fill(0);
  if (fifths > 0) SHARP_ORDER.slice(0, fifths).forEach(l => { sig[l] = 1; });
  if (fifths < 0) FLAT_ORDER.slice(0, -fifths).forEach(l => { sig[l] = -1; });
  return sig;
}
function speller(key) {
  const sig = keySig(key.fifths);
  const majLetter = (((key.fifths * 4) % 7) + 7) % 7;
  const tonicLetter = key.mode === 'min' ? (majLetter + 5) % 7 : majLetter;
  return function spell(m) {
    const pc = m % 12;
    const cands = [];
    for (let L = 0; L < 7; L++) {
      const a = ((pc - NAT[L] + 18) % 12) - 6;
      if (Math.abs(a) <= 2) cands.push({ L, a });
    }
    let pick = cands.find(c => c.a === sig[c.L]);
    if (!pick && key.mode === 'min') {
      // sensible et sixte haussées du mineur mélodique/harmonique
      const lead = (tonicLetter + 6) % 7, sixth = (tonicLetter + 5) % 7;
      pick = cands.find(c => (c.L === lead || c.L === sixth) && c.a === sig[c.L] + 1);
    }
    if (!pick && key.fifths === 0 && key.mode === 'maj' && pc === 10) pick = cands.find(c => c.L === 6 && c.a === -1);
    if (!pick) {
      const dir = key.fifths < 0 ? -1 : 1;
      pick = cands.find(c => c.a === sig[c.L] + dir) || cands.find(c => c.a === sig[c.L] - dir);
    }
    if (!pick) pick = cands.sort((x, y) => Math.abs(x.a) - Math.abs(y.a))[0];
    const oct = Math.round((m - NAT[pick.L] - pick.a) / 12) - 1;
    return { L: pick.L, a: pick.a, oct, dia: oct * 7 + pick.L };
  };
}

// ---------- Mains : partage autour du do central ----------
function assignStaves(notes) {
  const low = notes.filter(n => n.m < 60).length;
  const n = notes.length || 1;
  let split = 60;
  // presque tout à une main : on évite une portée orpheline d'une note
  if (low / n < 0.12 && notes.every(x => x.m >= 53)) split = 0;
  if (low / n > 0.88 && notes.every(x => x.m <= 67)) split = 200;
  return (m) => (m >= split ? 't' : 'b');
}

// ---------- Découpage rythmique ----------
function pieces(start, len, barStart, bar) {
  const out = [];
  let x = start, rem = len;
  while (rem > 0) {
    const rel = x - barStart;
    let v = 1;
    for (const c of VALUES) {
      if (c > rem) continue;
      if (c >= 4 && c !== 6 && rel % 4) continue;
      if (c === 6 && !(bar === 6 && rel === 0) && rel % 4) continue;
      if (c === 3 && rel % 4) continue;
      if (c === 2 && rel % 2) continue;
      if (c > 4 && rel + c > bar) continue;
      v = c; break;
    }
    out.push([x, v]);
    x += v; rem -= v;
  }
  return out;
}

function buildStaffItems(notes, staff, total, bars) {
  const byPos = new Map();
  notes.forEach(n => {
    const p = Math.round(n.s * 4);
    if (!byPos.has(p)) byPos.set(p, []);
    byPos.get(p).push({ m: n.m, d: Math.max(1, Math.round(n.d * 4)) });
  });
  const P = [...byPos.keys()].sort((a, b) => a - b);
  // ligne rythmique de la portée : chaque accord dure jusqu'à l'attaque suivante
  // de la même main, au plus sa propre durée ; les micro-trous sont absorbés
  const spans = [];
  let cursor = 0;
  P.forEach((p, i) => {
    if (p > cursor) spans.push({ rest: true, pos: cursor, len: p - cursor });
    const next = i + 1 < P.length ? P[i + 1] : total;
    const chord = byPos.get(p);
    let dur = Math.min(Math.max(...chord.map(c => c.d)), next - p);
    const gap = next - (p + dur);
    if (gap > 0 && (gap <= 1 || gap * 4 <= dur)) dur += gap;
    spans.push({ rest: false, pos: p, len: dur, notes: chord.map(c => c.m).sort((a, b) => a - b) });
    cursor = p + dur;
  });
  if (cursor < total) spans.push({ rest: true, pos: cursor, len: total - cursor });
  // coupe aux barres de mesure, puis en valeurs écrivables, liées entre elles
  const items = [];
  for (const sp of spans) {
    let prev = null;
    for (const b of bars) {
      const a = Math.max(sp.pos, b.start), e = Math.min(sp.pos + sp.len, b.start + b.len);
      if (e <= a) continue;
      if (sp.rest && a === b.start && e === b.start + b.len && b.len === b.full) {
        items.push({ rest: true, pos: a, v: b.len, whole: true, bar: b });
        continue;
      }
      for (const [x, v] of pieces(a, e - a, b.start - (b.full - b.len), b.full)) {
        const it = { rest: sp.rest, pos: x, v, notes: sp.notes, staff, bar: b };
        if (!sp.rest && prev) prev.tieNext = it;
        items.push(it);
        if (!sp.rest) prev = it;
      }
    }
  }
  return items;
}

// ---------- Glyphes ----------
// Clés dessinées au trait, en coordonnées de portée (haut = 0, interligne 8)
const CLEF_G = 'M11 26.5C7.5 27 6.5 22 10 21C14.5 20 16.5 26 13 29.5C9 33 2.5 30.5 2.5 24.5C2.5 18 8 15 11.5 10.5C14.5 6.5 15.5 0 14 -4C13 -7 11 -8 9.5 -5C8 -2 8.5 3 9.5 9L12.5 38C13 43 9.5 45 7 42.5';
const CLEF_F = 'M4.2 8.4C3.8 3 11 0.5 15.5 4C19.5 7.5 17 17 4 25';
function clefSVG(type, x, top) {
  if (type === 't') {
    return `<g transform="translate(${x} ${top})"><path class="gs-clef" d="${CLEF_G}"/><circle class="gs-fill" cx="7.6" cy="41.4" r="2"/></g>`;
  }
  return `<g transform="translate(${x} ${top})"><path class="gs-clef" d="${CLEF_F}"/><circle class="gs-fill" cx="4.6" cy="8" r="2.5"/>` +
    '<circle class="gs-fill" cx="21" cy="4" r="1.3"/><circle class="gs-fill" cx="21" cy="12" r="1.3"/></g>';
}
function accSVG(a, x, y) {
  if (a === 1) return `<path class="gs-acc" d="M${x - 1.6} ${y - 8}v15.5M${x + 1.6} ${y - 7.5}v15.5"/><path class="gs-accb" d="M${x - 3.6} ${y - 1.6}l7.2-2.2M${x - 3.6} ${y + 3.6}l7.2-2.2"/>`;
  if (a === -1) return `<path class="gs-acc" d="M${x - 2.4} ${y - 11}v14.4c4.6-2.4 6.2-5.4 4.6-6.8-1.4-1.2-3.4-.4-4.6.9"/>`;
  return `<path class="gs-acc" d="M${x - 2.2} ${y - 8.5}V${y + 3.3}L${x + 2.2} ${y + 1.7}M${x + 2.2} ${y + 8.5}V${y - 3.3}L${x - 2.2} ${y - 1.7}"/>`;
}
function restSVG(v, x, staffTop) {
  const mid = staffTop + 2 * G;
  if (v >= 16) return `<rect class="gs-fill" x="${x - 5}" y="${staffTop + G}" width="10" height="4"/>`;
  if (v >= 8) return `<rect class="gs-fill" x="${x - 5}" y="${mid - 4}" width="10" height="4"/>` + (v === 12 ? dot(x + 9, mid - 3) : '');
  if (v >= 4) return `<path class="gs-rest" d="M${x - 1.5} ${mid - 11}l4.2 5.2-3.6 4.4 4.2 5.4c-3-1.4-5.6-.4-3.4 4.2"/>` + (v === 6 ? dot(x + 8, mid - 3) : '');
  const flag = (yy) => `<path class="gs-rest" d="M${x + 2.6} ${yy}l-3.6 9"/><circle class="gs-fill" cx="${x - 1.4}" cy="${yy + 0.6}" r="1.7"/><path class="gs-rest" d="M${x - 1.4} ${yy + 1.8}c1.8.8 3.4 0 4-1.8"/>`;
  if (v >= 2) return flag(mid - 5) + (v === 3 ? dot(x + 7, mid - 3) : '');
  return flag(mid - 7) + `<path class="gs-rest" d="M${x + 1.2} ${mid - 3.2}l-3.4 8.2"/><circle class="gs-fill" cx="${x - 2.6}" cy="${mid - 0.4}" r="1.7"/><path class="gs-rest" d="M${x - 2.6} ${mid + 0.8}c1.8.8 3.4 0 4-1.8"/>`;
}
const dot = (x, y) => `<circle class="gs-fill" cx="${x}" cy="${y}" r="1.5"/>`;

// ---------- Rendu ----------
export function renderGrandStaff(score, width = 360) {
  const notes = (score.notes || []).filter(n => n.m >= 21 && n.m <= 108);
  if (!notes.length) return '<p class="gs-empty">Aucune note</p>';
  const key = score.key || detectKey(notes);
  const spell = speller(key);
  const sig = keySig(key.fifths);
  const staffOf = assignStaves(notes);
  const bar = Math.max(2, Math.round((score.bpb || 4) * 4));
  const pickup = Math.round((score.pickup || 0) * 4) % bar;
  const end = Math.max(...notes.map(n => Math.round(n.s * 4) + Math.max(1, Math.round(n.d * 4))));
  // mesures
  const bars = [];
  let x0 = 0;
  if (pickup) { bars.push({ start: 0, len: pickup, full: bar }); x0 = pickup; }
  while (x0 < end || !bars.length) { bars.push({ start: x0, len: bar, full: bar }); x0 += bar; }
  const total = x0;
  const items = [
    ...buildStaffItems(notes.filter(n => staffOf(n.m) === 't'), 't', total, bars),
    ...buildStaffItems(notes.filter(n => staffOf(n.m) === 'b'), 'b', total, bars),
  ];
  // orthographe + altérations (mémoire par mesure, par portée)
  bars.forEach(b => {
    const memo = new Map();
    items.filter(it => it.bar === b && !it.rest).sort((p, q) => p.pos - q.pos).forEach(it => {
      it.heads = it.notes.map(m => {
        const sp = spell(m);
        const k = it.staff + sp.dia;
        const cur = memo.has(k) ? memo.get(k) : sig[sp.L];
        let acc = null;
        if (sp.a !== cur && !it.tiedFrom) { acc = sp.a; memo.set(k, sp.a); }
        return { m, ...sp, acc };
      });
      if (it.tieNext) it.tieNext.tiedFrom = it;
    });
  });
  // les notes liées reprennent l'orthographe sans répéter l'altération
  items.forEach(it => { if (it.tiedFrom && it.heads) it.heads.forEach(h => { h.acc = null; }); });

  // colonnes et largeurs de mesure
  const beamLen = bar === 6 ? 6 : 4;
  bars.forEach(b => {
    const its = items.filter(it => it.bar === b);
    const cols = [...new Set(its.map(it => it.pos))].sort((p, q) => p - q);
    b.cols = cols.map((p, i) => {
      const nextP = i + 1 < cols.length ? cols[i + 1] : b.start + b.len;
      const dur = nextP - p;
      const hasAcc = its.some(it => it.pos === p && it.heads && it.heads.some(h => h.acc !== null));
      return { pos: p, w: 12 + 9.5 * Math.log2(1 + dur) + (hasAcc ? 7 : 0), acc: hasAcc };
    });
    b.natural = 12 + b.cols.reduce((a, c) => a + c.w, 0);
  });

  // systèmes (lignes) : remplissage glouton puis justification
  const nAcc = Math.abs(key.fifths);
  const headW = (first) => 30 + nAcc * 7 + (first ? 20 : 0) + 6;
  const systems = [];
  let cur = null;
  bars.forEach(b => {
    const hw = headW(!systems.length && !cur);
    if (!cur) cur = { bars: [], w: hw, head: hw };
    if (cur.bars.length && cur.w + b.natural > width) { systems.push(cur); cur = { bars: [], w: headW(false), head: headW(false) }; }
    cur.bars.push(b); cur.w += b.natural;
  });
  if (cur) systems.push(cur);

  const TT = 5 * G, BT = TT + 4 * G + 7 * G; // haut de la portée de sol, de fa
  const H = BT + 4 * G + 5 * G;
  let out = '';
  systems.forEach((sys, si) => {
    const avail = width - sys.head - 4;
    const nat = sys.bars.reduce((a, b) => a + b.natural, 0);
    const stretch = (si < systems.length - 1 || nat > avail * 0.72) ? avail / nat : 1;
    let x = sys.head;
    sys.bars.forEach(b => {
      b.x = x;
      let cx = x + 12 * stretch;
      b.cols.forEach(c => { c.x = cx + 4; cx += c.w * stretch; });
      b.w = b.natural * stretch;
      x += b.w;
      b.sys = si;
    });
    sys.end = x;
  });
  items.forEach(it => {
    const col = it.bar.cols.find(c => c.pos === it.pos);
    it.x = col.x + (col.acc ? 6 : 0);
    it.sys = it.bar.sys;
  });

  const yOf = (staff, dia) => (staff === 't' ? TT + 4 * G - (dia - TREBLE_BOTTOM) * ST : BT + 4 * G - (dia - BASS_BOTTOM) * ST);

  // ligatures : croches et doubles consécutives d'un même temps
  items.forEach(it => { it.base = it.rest ? it.v : (it.v === 3 ? 2 : it.v === 6 ? 4 : it.v === 12 ? 8 : it.v); });
  const groups = [];
  ['t', 'b'].forEach(staff => bars.forEach(b => {
    const its = items.filter(it => it.bar === b && it.staff === staff).sort((p, q) => p.pos - q.pos);
    let g = [];
    const flush = () => { if (g.length >= 2) groups.push(g); g = []; };
    its.forEach(it => {
      const win = Math.floor((it.pos - b.start + (b.len < b.full ? b.full - b.len : 0)) / beamLen);
      if (it.rest || it.base > 2) { flush(); return; }
      if (g.length && g[0].win !== win) flush();
      it.win = win; g.push(it);
    });
    flush();
  }));
  groups.forEach(g => {
    const dias = g.flatMap(it => it.heads.map(h => h.dia));
    const avg = dias.reduce((a, d) => a + d, 0) / dias.length;
    const up = avg < MID[g[0].staff];
    const ys = g.flatMap(it => it.heads.map(h => yOf(it.staff, h.dia)));
    const by = up ? Math.min(...ys) - 3.5 * G : Math.max(...ys) + 3.5 * G;
    g.forEach(it => { it.beam = g; it.up = up; it.stemEnd = by; });
    g.up = up; g.by = by;
  });

  const svgs = systems.map(() => []);
  const push = (si, s) => svgs[si].push(s);

  // portées, accolade, clés, armures, chiffrage, barres
  systems.forEach((sys, si) => {
    for (const top of [TT, BT]) for (let i = 0; i < 5; i++) push(si, `<line class="gs-line" x1="0" y1="${top + i * G}" x2="${sys.end}" y2="${top + i * G}"/>`);
    push(si, `<line class="gs-bar" x1="0" y1="${TT}" x2="0" y2="${BT + 4 * G}"/><path class="gs-brace" d="M-3 ${TT}V${BT + 4 * G}"/>`);
    push(si, clefSVG('t', 5, TT) + clefSVG('b', 5, BT));
    let kx = 30;
    const sharp = key.fifths > 0;
    // positions d'armure (diatoniques) usuelles
    const TPOS = sharp ? [38, 35, 39, 36, 33, 37, 34] : [34, 37, 33, 36, 32, 35, 31];
    for (let i = 0; i < nAcc; i++) {
      const tdia = TPOS[i];
      const bdia = tdia - 14;
      push(si, accSVG(sharp ? 1 : -1, kx + 3, yOf('t', tdia)) + accSVG(sharp ? 1 : -1, kx + 3, yOf('b', bdia)));
      kx += 7;
    }
    if (si === 0) {
      const [num, den] = bar === 6 ? [3, 8] : [bar / 4, 4];
      for (const top of [TT, BT]) {
        push(si, `<text class="gs-time" x="${kx + 8}" y="${top + 2 * G - 1}" text-anchor="middle">${num}</text><text class="gs-time" x="${kx + 8}" y="${top + 4 * G - 1}" text-anchor="middle">${den}</text>`);
      }
    }
    sys.bars.forEach((b, bi) => {
      const xr = b.x + b.w;
      const last = si === systems.length - 1 && bi === sys.bars.length - 1;
      if (last) push(si, `<line class="gs-bar" x1="${xr - 4}" y1="${TT}" x2="${xr - 4}" y2="${BT + 4 * G}"/><rect class="gs-fill" x="${xr - 2}" y="${TT}" width="3" height="${BT + 4 * G - TT}"/>`);
      else push(si, `<line class="gs-bar" x1="${xr}" y1="${TT}" x2="${xr}" y2="${BT + 4 * G}"/>`);
    });
  });

  // notes et silences
  items.forEach(it => {
    const si = it.sys;
    const top = it.staff === 't' ? TT : BT;
    if (it.rest) {
      const rx = it.whole ? it.bar.x + it.bar.w / 2 : it.x;
      push(si, restSVG(it.whole ? 16 : it.v, rx, top));
      return;
    }
    const hs = it.heads.slice().sort((p, q) => p.dia - q.dia);
    const avg = hs.reduce((a, h) => a + h.dia, 0) / hs.length;
    const up = it.beam ? it.up : avg < MID[it.staff];
    const hollow = it.base >= 8;
    const hw = 5.6;
    // secondes dans un accord : tête décalée de l'autre côté de la hampe
    const shift = new Map();
    const seq = up ? hs : hs.slice().reverse();
    for (let i = 1; i < seq.length; i++) {
      if (Math.abs(seq[i].dia - seq[i - 1].dia) === 1 && !shift.get(seq[i - 1])) shift.set(seq[i], up ? 2 * hw - 1 : -(2 * hw - 1));
    }
    // lignes supplémentaires
    const ledger = new Set();
    hs.forEach(h => {
      const y = yOf(it.staff, h.dia);
      for (let ly = top + 5 * G; ly <= y + 0.1; ly += G) ledger.add(ly);
      for (let ly = top - G; ly >= y - 0.1; ly -= G) ledger.add(ly);
    });
    ledger.forEach(ly => push(si, `<line class="gs-ledger" x1="${it.x - 8}" y1="${ly}" x2="${it.x + 8 + (shift.size ? 2 * hw : 0)}" y2="${ly}"/>`));
    // altérations, en escalier si elles se gênent
    let lastAccY = null, accCol = 0;
    hs.slice().reverse().forEach(h => {
      if (h.acc === null || h.acc === undefined) return;
      const y = yOf(it.staff, h.dia);
      accCol = lastAccY !== null && Math.abs(y - lastAccY) < 3 * G ? accCol + 1 : 0;
      lastAccY = y;
      push(si, accSVG(h.acc, it.x - 11 - accCol * 7, y));
    });
    hs.forEach(h => {
      const y = yOf(it.staff, h.dia);
      const hx = it.x + (shift.get(h) || 0);
      push(si, `<ellipse class="${hollow ? 'gs-head gs-head--o' : 'gs-head'}" cx="${hx}" cy="${y}" rx="${hw}" ry="3.9" transform="rotate(-20 ${hx} ${y})"/>`);
      if ([12, 6, 3].includes(it.v)) {
        const onLine = ((it.staff === 't' ? h.dia - TREBLE_BOTTOM : h.dia - BASS_BOTTOM) % 2 + 2) % 2 === 0;
        push(si, dot(it.x + hw + 5 + (shift.size && up ? 2 * hw : 0), y - (onLine ? ST : 0)));
      }
    });
    // hampe
    if (it.base < 16) {
      const yLo = yOf(it.staff, hs[0].dia), yHi = yOf(it.staff, hs[hs.length - 1].dia);
      const sx = up ? it.x + hw - 0.6 : it.x - hw + 0.6;
      const yEnd = it.beam ? it.stemEnd : (up ? yHi - 3.5 * G : yLo + 3.5 * G);
      const yStart = up ? yLo : yHi;
      it.sx = sx;
      push(si, `<line class="gs-stem" x1="${sx}" y1="${yStart}" x2="${sx}" y2="${yEnd}"/>`);
      if (!it.beam && it.base <= 2) {
        const n = it.base === 1 ? 2 : 1;
        for (let k = 0; k < n; k++) {
          const fy = yEnd + (up ? k * 6 : -k * 6);
          push(si, up
            ? `<path class="gs-flag" d="M${sx} ${fy}c.6 4 7 6 5.6 13"/>`
            : `<path class="gs-flag" d="M${sx} ${fy}c.6 -4 7 -6 5.6 -13"/>`);
        }
      }
    }
  });
  // poutres
  groups.forEach(g => {
    const si = g[0].sys;
    const th = 3.6, dirY = g.up ? 1 : -1;
    const x1 = g[0].sx, x2 = g[g.length - 1].sx;
    push(si, `<path class="gs-fill" d="M${x1 - 0.6} ${g.by}H${x2 + 0.6}v${dirY * th}H${x1 - 0.6}z"/>`);
    const y2 = g.by + dirY * 6;
    for (let i = 0; i < g.length; i++) {
      if (g[i].base !== 1) continue;
      const prev = g[i - 1], next = g[i + 1];
      if (next && next.base === 1) {
        push(si, `<path class="gs-fill" d="M${g[i].sx - 0.6} ${y2}H${next.sx + 0.6}v${dirY * th}H${g[i].sx - 0.6}z"/>`);
      } else if (!(prev && prev.base === 1)) {
        const toR = !prev || (next && i === 0);
        const xa = toR ? g[i].sx : g[i].sx - 7, xb = toR ? g[i].sx + 7 : g[i].sx;
        push(si, `<path class="gs-fill" d="M${xa} ${y2}H${xb}v${dirY * th}H${xa}z"/>`);
      }
    }
  });
  // liaisons de valeur
  items.forEach(it => {
    if (it.rest || !it.tieNext) return;
    const nx = it.tieNext;
    it.heads.forEach(h => {
      const y = yOf(it.staff, h.dia);
      // la liaison se place du côté opposé à la hampe
      const below = it.beam ? it.up : (it.heads.reduce((a, q) => a + q.dia, 0) / it.heads.length) < MID[it.staff];
      const dy = below ? 5 : -5, bend = below ? 6 : -6;
      const arc = (xa, xb, s) => push(s, `<path class="gs-tie" d="M${xa} ${y + dy}Q${(xa + xb) / 2} ${y + dy + bend} ${xb} ${y + dy}"/>`);
      if (nx.sys === it.sys) arc(it.x + 5, nx.x - 5, it.sys);
      else { arc(it.x + 5, systems[it.sys].end - 2, it.sys); arc(systems[nx.sys].head - 6, nx.x - 5, nx.sys); }
    });
  });

  return systems.map((sys, si) => `<svg class="gs" viewBox="-6 0 ${width + 8} ${H}" preserveAspectRatio="xMinYMin meet" role="img" aria-label="Partition, ligne ${si + 1}">${svgs[si].join('')}</svg>`).join('');
}
