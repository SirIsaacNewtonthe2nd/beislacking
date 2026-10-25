// Random tracks. A seeded random walk over the block grid that strings
// together pieces and short combos (jumps, loops, turbo runs). Every column of
// the grid holds at most one piece, so no road passes over another (raised
// road stands on pillars) and the air over jump gaps stays clear.

import { layoutTrack, parseTrack, GRID } from './pieces.js';

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// [tokens, weight]. A corner comes before every jump, so the take-off speed
// is predictable, and three landing blocks follow it.
const FEATURES = [
  [['S'], 2.2],
  [['S', 'S'], 1],
  [['T'], 1],
  [['T2', 'S'], 0.45],
  [['R1'], 0.6], [['L1'], 0.6],
  [['R2'], 1.1], [['L2'], 1.1],
  [['R3'], 0.8], [['L3'], 0.8],
  [['BR2'], 0.5], [['BL2'], 0.5],
  [['BR3'], 0.5], [['BL3'], 0.5],
  [['WR', 'S'], 0.35], [['WL', 'S'], 0.35],
  [['U1'], 0.55], [['D1'], 0.55],
  [['U2'], 0.3], [['D2'], 0.3],
  [['R2', 'S', 'K', 'G', 'S', 'S', 'S'], 0.35], [['L2', 'S', 'K', 'G', 'S', 'S', 'S'], 0.35],
  [['R1', 'S', 'K2', 'G', 'G', 'DN', 'S', 'S', 'S'], 0.18], [['L1', 'S', 'K2', 'G', 'G', 'DN', 'S', 'S', 'S'], 0.18],
  [['S', 'LOOPR', 'S'], 0.4], [['S', 'LOOPL', 'S'], 0.4],
  [['S:dirt', 'R2:dirt', 'S:dirt'], 0.2], [['S:dirt', 'L2:dirt', 'S:dirt'], 0.2],
];
const TOTAL_W = FEATURES.reduce((a, f) => a + f[1], 0);

const WORDS_A = ['Copper', 'Neon', 'Rapid', 'Velvet', 'Iron', 'Solar', 'Crimson', 'Echo', 'Turbo', 'Quartz', 'Static', 'Amber', 'Cobalt', 'Hyper', 'Lucky', 'Wild'];
const WORDS_B = ['Ridge', 'Rush', 'Spiral', 'Circuit', 'Sprint', 'Drop', 'Run', 'Valley', 'Loop', 'Line', 'Dash', 'Comet', 'Arc', 'Canyon', 'Switch', 'Rocket'];

function pick(r) {
  let x = r() * TOTAL_W;
  for (const f of FEATURES) { x -= f[1]; if (x <= 0) return f[0]; }
  return FEATURES[0][0];
}

const colKey = (i, j) => i + ',' + j;

// Lays tokens from a cursor; returns the placed pieces and the columns they
// need, or null if they leave the stadium, overlap, or hit a used column.
function tryPlace(cursor, tokens, used) {
  const lay = layoutTrack(parseTrack({ start: cursor, pieces: tokens.join(' ') }));
  if (lay.problems.size) return null;
  const cols = new Set();
  for (const pl of lay.placed) {
    for (const [i, j] of pl.cells) cols.add(colKey(i, j));
    // gaps own their column too: the car flies through it
    if (pl.piece.type === 'G') {
      const c = pl.cursor;
      if (c.i < 0 || c.j < 0 || c.i >= GRID || c.j >= GRID) return null;
      cols.add(colKey(c.i, c.j));
    }
  }
  for (const c of cols) if (used.has(c)) return null;
  // and the block ahead must be free, so the walk is not boxed in
  const e = lay.end;
  if (e.i < 1 || e.j < 1 || e.i >= GRID - 1 || e.j >= GRID - 1 || used.has(colKey(e.i, e.j)) || cols.has(colKey(e.i, e.j))) return null;
  return { cols, end: e };
}

export function randomTrack(seed, { features = 15 } = {}) {
  const r = rng(seed);
  for (let attempt = 0; attempt < 60; attempt++) {
    const start = { i: 8 + Math.floor(r() * 24), j: 8 + Math.floor(r() * 24), k: [0, 1, 1, 2][Math.floor(r() * 4)], h: Math.floor(r() * 4) };
    const first = tryPlace(start, ['START', 'S'], new Set());
    if (!first) continue;
    // a stack of accepted features, so the walk can back up out of dead ends
    const stack = [{ tokens: ['START', 'S'], cols: first.cols, end: first.end }];
    const used = new Set(first.cols);
    let sinceCp = 0, backs = 0;
    while (stack.length - 1 < features && backs < 40) {
      const top = stack[stack.length - 1];
      const wantCp = sinceCp >= 4 + Math.floor(r() * 3);
      let placed = null;
      for (let t = 0; t < 14 && !placed; t++) {
        const tokens = [...pick(r)];
        if (wantCp) tokens.unshift('CP');
        // keep heights modest so raised sections stay readable
        const res = tryPlace(top.end, tokens, used);
        if (res && res.end.k <= 5) placed = { tokens, ...res, cp: wantCp };
      }
      if (placed) {
        stack.push(placed);
        for (const c of placed.cols) used.add(c);
        sinceCp = placed.cp ? 1 : sinceCp + 1;
      } else if (stack.length > 1) {
        const gone = stack.pop();
        for (const c of gone.cols) used.delete(c);
        sinceCp = Math.max(0, sinceCp - 1);
        backs++;
      } else break;
    }
    if (stack.length - 1 < features) continue;
    // finish: a straight run in, then the line
    for (const tail of [['S', 'FIN'], ['FIN']]) {
      const res = tryPlace(stack[stack.length - 1].end, tail, used);
      if (!res) continue;
      const pieces = [...stack.flatMap((s) => s.tokens), ...tail];
      const name = WORDS_A[Math.floor(r() * WORDS_A.length)] + ' ' + WORDS_B[Math.floor(r() * WORDS_B.length)];
      return { name, start, pieces: pieces.join(' ') };
    }
  }
  return null;
}
