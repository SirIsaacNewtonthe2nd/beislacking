// Static collision world: track triangles in a uniform hash grid, plus the
// stadium floor and its outer walls as analytic planes.

import { BLOCK, GRID, SURF } from './pieces.js';

const CELL = 8;
export const FLOOR_Y = -0.1;
export const STADIUM_MAX = GRID * BLOCK;
const key = (x, y, z) => ((x + 1024) * 2048 + (y + 1024)) * 2048 + (z + 1024);

export class World {
  constructor(tris) {
    const n = tris.length;
    this.n = n;
    // packed: a(3) e1(3) e2(3) n(3)
    this.d = new Float64Array(n * 12);
    this.surf = new Uint8Array(n);
    this.kind = new Uint8Array(n);
    this.stamp = new Uint32Array(n);
    this.q = 1;
    this.cells = new Map();
    for (let i = 0; i < n; i++) {
      const { a, b, c, n: nn } = tris[i];
      const o = i * 12;
      this.d[o] = a[0]; this.d[o + 1] = a[1]; this.d[o + 2] = a[2];
      this.d[o + 3] = b[0] - a[0]; this.d[o + 4] = b[1] - a[1]; this.d[o + 5] = b[2] - a[2];
      this.d[o + 6] = c[0] - a[0]; this.d[o + 7] = c[1] - a[1]; this.d[o + 8] = c[2] - a[2];
      this.d[o + 9] = nn[0]; this.d[o + 10] = nn[1]; this.d[o + 11] = nn[2];
      this.surf[i] = tris[i].surf;
      this.kind[i] = tris[i].kind;
      const lo = [0, 1, 2].map((k) => Math.floor((Math.min(a[k], b[k], c[k]) - 0.01) / CELL));
      const hi = [0, 1, 2].map((k) => Math.floor((Math.max(a[k], b[k], c[k]) + 0.01) / CELL));
      for (let x = lo[0]; x <= hi[0]; x++)
        for (let y = lo[1]; y <= hi[1]; y++)
          for (let z = lo[2]; z <= hi[2]; z++) {
            const k = key(x, y, z);
            let list = this.cells.get(k);
            if (!list) this.cells.set(k, (list = []));
            list.push(i);
          }
    }
    for (const [k, list] of this.cells) this.cells.set(k, Int32Array.from(list));
  }

  // Gather candidate triangles overlapping an AABB, each once.
  _gather(minx, miny, minz, maxx, maxy, maxz, out) {
    out.length = 0;
    const q = ++this.q;
    const x0 = Math.floor(minx / CELL), x1 = Math.floor(maxx / CELL);
    const y0 = Math.floor(miny / CELL), y1 = Math.floor(maxy / CELL);
    const z0 = Math.floor(minz / CELL), z1 = Math.floor(maxz / CELL);
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++)
        for (let z = z0; z <= z1; z++) {
          const list = this.cells.get(key(x, y, z));
          if (!list) continue;
          for (let j = 0; j < list.length; j++) {
            const i = list[j];
            if (this.stamp[i] !== q) { this.stamp[i] = q; out.push(i); }
          }
        }
    return out;
  }

  // Ray from o along unit d, up to maxT. Returns the nearest hit or null.
  raycast(o, d, maxT, hit) {
    const ex = o[0] + d[0] * maxT, ey = o[1] + d[1] * maxT, ez = o[2] + d[2] * maxT;
    const cand = this._gather(Math.min(o[0], ex), Math.min(o[1], ey), Math.min(o[2], ez), Math.max(o[0], ex), Math.max(o[1], ey), Math.max(o[2], ez), this._tmp || (this._tmp = []));
    let best = maxT, bi = -1;
    const D = this.d;
    for (let k = 0; k < cand.length; k++) {
      const i = cand[k], b = i * 12;
      const e1x = D[b + 3], e1y = D[b + 4], e1z = D[b + 5];
      const e2x = D[b + 6], e2y = D[b + 7], e2z = D[b + 8];
      const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x;
      const det = e1x * px + e1y * py + e1z * pz;
      if (det > -1e-9 && det < 1e-9) continue;
      const inv = 1 / det;
      const tx = o[0] - D[b], ty = o[1] - D[b + 1], tz = o[2] - D[b + 2];
      const u = (tx * px + ty * py + tz * pz) * inv;
      if (u < 0 || u > 1) continue;
      const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
      const v = (d[0] * qx + d[1] * qy + d[2] * qz) * inv;
      if (v < 0 || u + v > 1) continue;
      const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
      if (t >= 0 && t < best) { best = t; bi = i; }
    }
    // stadium floor
    let floor = false;
    if (d[1] < -1e-6 && o[1] >= FLOOR_Y) {
      const t = (FLOOR_Y - o[1]) / d[1];
      const x = o[0] + d[0] * t, z = o[2] + d[2] * t;
      if (t < best && x >= 0 && z >= 0 && x <= STADIUM_MAX && z <= STADIUM_MAX) { best = t; floor = true; }
    }
    if (!floor && bi < 0) return null;
    hit = hit || {};
    hit.t = best;
    if (floor) {
      hit.n = [0, 1, 0]; hit.surf = SURF.grass; hit.kind = 2;
    } else {
      const b = bi * 12;
      let nx = D[b + 9], ny = D[b + 10], nz = D[b + 11];
      if (nx * d[0] + ny * d[1] + nz * d[2] > 0) { nx = -nx; ny = -ny; nz = -nz; }
      hit.n = [nx, ny, nz]; hit.surf = this.surf[bi]; hit.kind = this.kind[bi];
    }
    return hit;
  }

  // All contacts of a sphere with the world. Pushes {n, depth, p, kind, surf}.
  sphere(c, r, out) {
    out.length = 0;
    const cand = this._gather(c[0] - r, c[1] - r, c[2] - r, c[0] + r, c[1] + r, c[2] + r, this._tmp2 || (this._tmp2 = []));
    const D = this.d;
    const r2 = r * r;
    for (let k = 0; k < cand.length; k++) {
      const i = cand[k], b = i * 12;
      const ax = D[b], ay = D[b + 1], az = D[b + 2];
      // quick plane rejection
      const nx = D[b + 9], ny = D[b + 10], nz = D[b + 11];
      const pd = (c[0] - ax) * nx + (c[1] - ay) * ny + (c[2] - az) * nz;
      if (pd > r || pd < -r) continue;
      const cp = closestOnTri(c, ax, ay, az, D[b + 3], D[b + 4], D[b + 5], D[b + 6], D[b + 7], D[b + 8]);
      const dx = c[0] - cp[0], dy = c[1] - cp[1], dz = c[2] - cp[2];
      const dd = dx * dx + dy * dy + dz * dz;
      if (dd >= r2) continue;
      const dl = Math.sqrt(dd);
      let n;
      if (dl > 1e-6) n = [dx / dl, dy / dl, dz / dl];
      else n = pd >= 0 ? [nx, ny, nz] : [-nx, -ny, -nz];
      out.push({ n, depth: r - dl, p: cp, kind: this.kind[i], surf: this.surf[i] });
    }
    // floor and stadium walls
    if (c[1] - r < FLOOR_Y && c[1] > FLOOR_Y - 2 && c[0] >= 0 && c[2] >= 0 && c[0] <= STADIUM_MAX && c[2] <= STADIUM_MAX)
      out.push({ n: [0, 1, 0], depth: FLOOR_Y - (c[1] - r), p: [c[0], FLOOR_Y, c[2]], kind: 2, surf: SURF.grass });
    if (c[1] < 60) {
      if (c[0] < r && c[0] > -4) out.push({ n: [1, 0, 0], depth: r - c[0], p: [0, c[1], c[2]], kind: 1, surf: 0 });
      if (c[2] < r && c[2] > -4) out.push({ n: [0, 0, 1], depth: r - c[2], p: [c[0], c[1], 0], kind: 1, surf: 0 });
      if (c[0] > STADIUM_MAX - r && c[0] < STADIUM_MAX + 4) out.push({ n: [-1, 0, 0], depth: c[0] - (STADIUM_MAX - r), p: [STADIUM_MAX, c[1], c[2]], kind: 1, surf: 0 });
      if (c[2] > STADIUM_MAX - r && c[2] < STADIUM_MAX + 4) out.push({ n: [0, 0, -1], depth: c[2] - (STADIUM_MAX - r), p: [c[0], c[1], STADIUM_MAX], kind: 1, surf: 0 });
    }
    return out;
  }
}

// Ericson, Real-Time Collision Detection 5.1.5 (a + edge vectors form)
function closestOnTri(p, ax, ay, az, abx, aby, abz, acx, acy, acz) {
  const apx = p[0] - ax, apy = p[1] - ay, apz = p[2] - az;
  const d1 = abx * apx + aby * apy + abz * apz;
  const d2 = acx * apx + acy * apy + acz * apz;
  if (d1 <= 0 && d2 <= 0) return [ax, ay, az];
  const bpx = apx - abx, bpy = apy - aby, bpz = apz - abz;
  const d3 = abx * bpx + aby * bpy + abz * bpz;
  const d4 = acx * bpx + acy * bpy + acz * bpz;
  if (d3 >= 0 && d4 <= d3) return [ax + abx, ay + aby, az + abz];
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    return [ax + abx * v, ay + aby * v, az + abz * v];
  }
  const cpx = apx - acx, cpy = apy - acy, cpz = apz - acz;
  const d5 = abx * cpx + aby * cpy + abz * cpz;
  const d6 = acx * cpx + acy * cpy + acz * cpz;
  if (d6 >= 0 && d5 <= d6) return [ax + acx, ay + acy, az + acz];
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    return [ax + acx * w, ay + acy * w, az + acz * w];
  }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) {
    const w = (d4 - d3) / (d4 - d3 + (d5 - d6));
    return [ax + abx + (acx - abx) * w, ay + aby + (acy - aby) * w, az + abz + (acz - abz) * w];
  }
  const denom = 1 / (va + vb + vc);
  const v = vb * denom, w = vc * denom;
  return [ax + abx * v + acx * w, ay + aby * v + acy * w, az + abz * v + acz * w];
}
