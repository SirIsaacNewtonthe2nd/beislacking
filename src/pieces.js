// Track pieces. A track is a chain: each piece starts where the previous one
// ended. Pieces are described in local coordinates (metres):
//   s = forward from the entry edge, t = to the right, y = up.
// All connectors are flat, level and centred on a block edge, so any piece
// can follow any other.

import { smoothstep, smootherstep } from './math.js';

export const BLOCK = 32;      // block length / width in metres
export const LEVEL = 8;       // height of one level in metres
export const ROAD_HALF = 9;   // half road width
export const WALL_H = 1.1;    // border height
export const GRID = 40;       // stadium is GRID x GRID blocks
export const MAX_LEVEL = 12;

// Headings, clockwise seen from above: +Z, -X, -Z, +X. Turning right = h + 1.
export const DIRS = [[0, 1], [-1, 0], [0, -1], [1, 0]];

export const SURFACES = ['road', 'dirt', 'ice', 'grass', 'turbo', 'turbo2', 'plastic', 'noengine', 'nosteer', 'reset'];
export const SURF = Object.fromEntries(SURFACES.map((s, i) => [s, i]));

const straightPath = (len = BLOCK) => ({ fn: (u) => [len * u, 0, 0], len, steps: Math.max(1, Math.round(len / 8)) });

function turn(n, side, maxBank = 0, lift = ROAD_HALF) {
  const R = 16 + BLOCK * (n - 1);
  const sg = side === 'R' ? 1 : -1;
  const len = (R * Math.PI) / 2;
  const banked = maxBank > 0;
  const path = {
    fn: (u) => {
      const th = (u * Math.PI) / 2;
      const bank = maxBank * Math.sin(Math.PI * u) ** 2;
      // lift the centreline so the low (inner) edge stays at road level
      return [R * Math.sin(th), sg * R * (1 - Math.cos(th)), lift * Math.sin(bank)];
    },
    bank: banked ? (u) => sg * maxBank * Math.sin(Math.PI * u) ** 2 : null,
    len,
    steps: Math.max(6, Math.round(len / 2.5)),
    curved: true,
  };
  const cells = [];
  const top = (lift + ROAD_HALF) * Math.sin(maxBank), bottom = (lift - ROAD_HALF) * Math.sin(maxBank);
  const c0 = Math.floor(bottom / LEVEL + 0.02), c1 = Math.max(0, Math.ceil(top / LEVEL) - 1);
  for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) for (let c = Math.min(0, c0); c <= c1; c++) cells.push([a, sg * b, c]);
  return { paths: [path], cells, exit: [n - 1, sg * n, 0, sg] };
}

function slope(blocks, levels) {
  const L = BLOCK * blocks, Hh = LEVEL * levels;
  const path = {
    fn: (u) => [L * u, 0, Hh * smoothstep(u)],
    len: Math.hypot(L, Hh),
    steps: 10 * blocks,
    curved: true,
  };
  const cells = [];
  const lo = Math.min(0, levels), hi = Math.max(0, levels);
  for (let a = 0; a < blocks; a++) for (let c = lo; c <= hi; c++) cells.push([a, 0, c]);
  return { paths: [path], cells, exit: [blocks, 0, levels, 0] };
}

// A helical loop: a full turn on the inside of a cylinder whose axis runs
// sideways, so the exit is one lane over. Driving straight follows a helix on a
// cylinder, so the car needs very little steering once in the loop.
function loop(side) {
  const sg = side === 'R' ? 1 : -1;
  const R = 14;
  // sideways progress: zero rate at both ends, fastest over the top
  const g = (u) => u - Math.sin(2 * Math.PI * u) / (2 * Math.PI);
  const path = {
    fn: (u) => {
      const th = 2 * Math.PI * u;
      return [R * Math.sin(th), sg * BLOCK * g(u), R * (1 - Math.cos(th))];
    },
    // road normal points at the cylinder axis
    upFn: (u) => {
      const th = 2 * Math.PI * u;
      return [-Math.sin(th), 0, Math.cos(th)];
    },
    len: 2 * Math.PI * R * 1.1,
    steps: 120,
    curved: true,
    noPillars: true,
  };
  const cells = [];
  for (let c = 0; c < 4; c++) cells.push([0, 0, c], [-1, sg, c]);
  for (let c = 1; c < 4; c++) cells.push([0, sg, c], [-1, 0, c]);
  return { paths: [path], cells, exit: [0, sg, 0, 0] };
}

function kicker(height) {
  const path = {
    fn: (u) => [BLOCK * u, 0, height * u * u],
    len: BLOCK,
    steps: 12,
    curved: true,
  };
  return { paths: [path], cells: [[0, 0, 0], [0, 0, 1]], exit: [1, 0, 0, 0] };
}

const zone = (u0, u1, surf) => ({ u0, u1, surf });

// Piece catalogue. `build(piece)` returns geometry + connectivity.
export const PIECES = {
  START: { name: 'Start', group: 'Gates', build: () => ({ paths: [straightPath()], cells: [[0, 0, 0]], exit: [1, 0, 0, 0], gates: [{ kind: 'start', s: 20 }], spawn: 9 }) },
  CP: { name: 'Checkpoint', group: 'Gates', build: () => ({ paths: [straightPath()], cells: [[0, 0, 0]], exit: [1, 0, 0, 0], gates: [{ kind: 'cp', s: 16 }] }) },
  RING: { name: 'Air checkpoint', group: 'Gates', build: () => ({ paths: [], cells: [[0, 0, 0], [0, 0, 1]], exit: [1, 0, 0, 0], gates: [{ kind: 'cp', s: 16, y: 8, ring: true }] }) },
  FIN: { name: 'Finish', group: 'Gates', build: () => ({ paths: [straightPath()], cells: [[0, 0, 0]], exit: [1, 0, 0, 0], gates: [{ kind: 'finish', s: 16 }] }) },
  S: { name: 'Straight', group: 'Road', build: () => ({ paths: [straightPath()], cells: [[0, 0, 0]], exit: [1, 0, 0, 0] }) },
  R1: { name: 'Turn right, tight', group: 'Turns', build: () => turn(1, 'R') },
  L1: { name: 'Turn left, tight', group: 'Turns', build: () => turn(1, 'L') },
  R2: { name: 'Turn right, medium', group: 'Turns', build: () => turn(2, 'R') },
  L2: { name: 'Turn left, medium', group: 'Turns', build: () => turn(2, 'L') },
  R3: { name: 'Turn right, wide', group: 'Turns', build: () => turn(3, 'R') },
  L3: { name: 'Turn left, wide', group: 'Turns', build: () => turn(3, 'L') },
  BR2: { name: 'Banked right', group: 'Turns', build: () => turn(2, 'R', 0.6) },
  BL2: { name: 'Banked left', group: 'Turns', build: () => turn(2, 'L', 0.6) },
  BR3: { name: 'Banked right, wide', group: 'Turns', build: () => turn(3, 'R', 0.6) },
  BL3: { name: 'Banked left, wide', group: 'Turns', build: () => turn(3, 'L', 0.6) },
  WR: { name: 'Wall turn right', group: 'Turns', build: () => turn(3, 'R', 1.25, 1.2) },
  WL: { name: 'Wall turn left', group: 'Turns', build: () => turn(3, 'L', 1.25, 1.2) },
  U1: { name: 'Slope up', group: 'Slopes', build: () => slope(2, 1) },
  D1: { name: 'Slope down', group: 'Slopes', build: () => slope(2, -1) },
  U2: { name: 'Long slope up', group: 'Slopes', build: () => slope(3, 2) },
  D2: { name: 'Long slope down', group: 'Slopes', build: () => slope(3, -2) },
  US: { name: 'Steep ramp up', group: 'Slopes', build: () => slope(1, 1) },
  DS: { name: 'Steep ramp down', group: 'Slopes', build: () => slope(1, -1) },
  T: { name: 'Turbo', group: 'Special', build: () => ({ paths: [{ ...straightPath(), zones: [zone(0.3, 0.7, 'turbo')] }], cells: [[0, 0, 0]], exit: [1, 0, 0, 0] }) },
  T2: { name: 'Super turbo', group: 'Special', build: () => ({ paths: [{ ...straightPath(), zones: [zone(0.3, 0.7, 'turbo2')] }], cells: [[0, 0, 0]], exit: [1, 0, 0, 0] }) },
  NE: { name: 'Engine off', group: 'Special', build: () => ({ paths: [{ ...straightPath(), zones: [zone(0.3, 0.7, 'noengine')] }], cells: [[0, 0, 0]], exit: [1, 0, 0, 0] }) },
  NS: { name: 'No steering', group: 'Special', build: () => ({ paths: [{ ...straightPath(), zones: [zone(0.3, 0.7, 'nosteer')] }], cells: [[0, 0, 0]], exit: [1, 0, 0, 0] }) },
  RS: { name: 'Reset effects', group: 'Special', build: () => ({ paths: [{ ...straightPath(), zones: [zone(0.3, 0.7, 'reset')] }], cells: [[0, 0, 0]], exit: [1, 0, 0, 0] }) },
  K: { name: 'Kicker', group: 'Special', build: () => kicker(5) },
  K2: { name: 'Big kicker', group: 'Special', build: () => kicker(9) },
  G: { name: 'Gap', group: 'Special', build: () => ({ paths: [], cells: [], exit: [1, 0, 0, 0] }) },
  LOOPR: { name: 'Loop (exit right)', group: 'Special', build: () => loop('R') },
  LOOPL: { name: 'Loop (exit left)', group: 'Special', build: () => loop('L') },
  UP: { name: 'Raise next piece', group: 'Cursor', build: () => ({ paths: [], cells: [], exit: [0, 0, 1, 0], cursorOnly: true }) },
  DN: { name: 'Lower next piece', group: 'Cursor', build: () => ({ paths: [], cells: [], exit: [0, 0, -1, 0], cursorOnly: true }) },
};

// Pieces that can take a surface other than road
export const SURFACEABLE = new Set(['S', 'R1', 'L1', 'R2', 'L2', 'R3', 'L3', 'BR2', 'BL2', 'BR3', 'BL3', 'WR', 'WL', 'U1', 'D1', 'U2', 'D2', 'US', 'DS', 'CP', 'K', 'K2']);

// Piece tokens look like "R2", "S:dirt", "S:ice!" ("!" removes borders).
export function parsePiece(tok) {
  let walls = true;
  if (tok.endsWith('!')) { walls = false; tok = tok.slice(0, -1); }
  const [type, surf = 'road'] = tok.split(':');
  return { type, surf, walls };
}
export function pieceToken(p) {
  return p.type + (p.surf && p.surf !== 'road' ? ':' + p.surf : '') + (p.walls === false ? '!' : '');
}

export function parseTrack(def) {
  const pieces = (Array.isArray(def.pieces) ? def.pieces : def.pieces.trim().split(/\s+/)).map((t) => (typeof t === 'string' ? parsePiece(t) : t));
  return {
    id: def.id || null,
    name: def.name || 'Untitled',
    author: def.author || '',
    laps: def.laps || 1,
    start: def.start || { i: 20, j: 20, k: 1, h: 0 },
    pieces,
    medals: def.medals || null,
  };
}

export function serializeTrack(track) {
  return {
    name: track.name,
    author: track.author,
    laps: track.laps,
    start: { ...track.start },
    pieces: track.pieces.map(pieceToken).join(' '),
    medals: track.medals || null,
  };
}

// Entry point (world metres) of the cell a cursor points at.
export function cursorEntry(c) {
  const [fx, fz] = DIRS[((c.h % 4) + 4) % 4];
  return [c.i * BLOCK + BLOCK / 2 - fx * BLOCK / 2, c.k * LEVEL, c.j * BLOCK + BLOCK / 2 - fz * BLOCK / 2];
}

export function cursorBasis(h) {
  const [fx, fz] = DIRS[((h % 4) + 4) % 4];
  const [rx, rz] = DIRS[(((h + 1) % 4) + 4) % 4];
  return { f: [fx, 0, fz], r: [rx, 0, rz] };
}

// Walk the chain, placing every piece and flagging overlaps / out-of-bounds.
export function layoutTrack(track) {
  let cur = { ...track.start };
  const placed = [];
  const occupied = new Map();
  const problems = new Set();
  track.pieces.forEach((piece, index) => {
    const def = PIECES[piece.type];
    if (!def) { problems.add(index); placed.push(null); return; }
    const built = def.build(piece);
    const h = ((cur.h % 4) + 4) % 4;
    const { f, r } = cursorBasis(h);
    const origin = cursorEntry({ ...cur, h });
    const cells = built.cells.map(([a, b, c]) => [cur.i + f[0] * a + r[0] * b, cur.j + f[2] * a + r[2] * b, cur.k + c]);
    for (const [ci, cj, ck] of cells) {
      if (ci < 0 || cj < 0 || ci >= GRID || cj >= GRID || ck < 0 || ck > MAX_LEVEL) problems.add(index);
      const key = ci + ',' + cj + ',' + ck;
      if (occupied.has(key)) { problems.add(index); problems.add(occupied.get(key)); }
      else occupied.set(key, index);
    }
    const [da, db, dk, dh] = built.exit;
    const next = { i: cur.i + f[0] * da + r[0] * db, j: cur.j + f[2] * da + r[2] * db, k: cur.k + dk, h: (h + dh + 4) % 4 };
    if (next.k < 0) problems.add(index);
    placed.push({ index, piece, def, built, cursor: { ...cur, h }, origin, f, r, cells, exit: next });
    cur = next;
  });
  const s = track.start;
  const closed = track.pieces.length > 2 && cur.i === s.i && cur.j === s.j && cur.k === s.k && ((cur.h - s.h) % 4 + 4) % 4 === 0;
  return { placed, end: cur, problems, closed, occupied };
}

// Map a local (s, t, y) point of a placed piece into world space.
export function toWorld(pl, p) {
  const [s, t, y] = p;
  return [pl.origin[0] + pl.f[0] * s + pl.r[0] * t, pl.origin[1] + y, pl.origin[2] + pl.f[2] * s + pl.r[2] * t];
}
