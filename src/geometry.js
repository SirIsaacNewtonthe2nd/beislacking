// Turns a track definition into collision triangles, render buffers, gates,
// the spawn frame and a driving line for the bot.

import { BLOCK, LEVEL, ROAD_HALF, WALL_H, SURF, layoutTrack, toWorld } from './pieces.js';
import { vadd, vsub, vscale, vdot, vcross, vnorm, vlen, vaddScaled, vrotAxis } from './math.js';

const SURF_COLORS = {
  road: [0.34, 0.36, 0.40],
  dirt: [0.56, 0.39, 0.24],
  ice: [0.72, 0.86, 0.96],
  grass: [0.33, 0.56, 0.24],
  turbo: [1.0, 0.74, 0.08],
  turbo2: [0.95, 0.22, 0.14],
  plastic: [0.85, 0.85, 0.3],
  noengine: [0.16, 0.16, 0.19],
  nosteer: [0.56, 0.32, 0.86],
  reset: [0.22, 0.78, 0.45],
};
const WALL_A = [0.92, 0.92, 0.94];
const WALL_B = [0.80, 0.18, 0.16];
const UNDER = [0.22, 0.24, 0.28];
const PILLAR = [0.46, 0.48, 0.53];
const GATE_COLORS = { start: [0.15, 0.75, 0.35], cp: [0.18, 0.45, 0.95], finish: [0.92, 0.2, 0.2] };
const SLAB = 0.9; // visual road thickness

let curPiece = -1; // piece index stamped on every triangle, for editor picking
function makeBuf(withUV) {
  return { pos: [], nrm: [], col: [], uv: withUV ? [] : null, ids: [] };
}
function pushTri(buf, a, b, c, col, uva, uvb, uvc) {
  const n = vnorm(vcross(vsub(b, a), vsub(c, a)));
  buf.ids.push(curPiece);
  buf.pos.push(...a, ...b, ...c);
  buf.nrm.push(...n, ...n, ...n);
  buf.col.push(...col, ...col, ...col);
  if (buf.uv) buf.uv.push(...(uva || [0, 0]), ...(uvb || [0, 0]), ...(uvc || [0, 0]));
}
function pushQuad(buf, a, b, c, d, col, uvs) {
  // a-b-c-d counter-clockwise when seen from the front
  pushTri(buf, a, b, c, col, uvs && uvs[0], uvs && uvs[1], uvs && uvs[2]);
  pushTri(buf, a, c, d, col, uvs && uvs[0], uvs && uvs[2], uvs && uvs[3]);
}
function pushBox(buf, center, f, r, u, hx, hy, hz, col) {
  // hx along r, hy along u, hz along f
  const P = (sx, sy, sz) => vadd(vadd(vadd(center, vscale(r, sx * hx)), vscale(u, sy * hy)), vscale(f, sz * hz));
  const c = [P(-1, -1, -1), P(1, -1, -1), P(1, 1, -1), P(-1, 1, -1), P(-1, -1, 1), P(1, -1, 1), P(1, 1, 1), P(-1, 1, 1)];
  const faces = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 4, 7, 3], [1, 2, 6, 5], [3, 7, 6, 2], [0, 1, 5, 4]];
  for (const [a, b, cc, d] of faces) pushQuad(buf, c[a], c[b], c[cc], c[d], col);
}

// Rotation-minimising frames along a sampled curve (double reflection).
function frames(points, tangents, up0, upEnd) {
  const ups = [up0];
  for (let i = 0; i < points.length - 1; i++) {
    const v1 = vsub(points[i + 1], points[i]);
    const c1 = vdot(v1, v1);
    if (c1 < 1e-12) { ups.push(ups[i]); continue; }
    const rL = vsub(ups[i], vscale(v1, (2 / c1) * vdot(v1, ups[i])));
    const tL = vsub(tangents[i], vscale(v1, (2 / c1) * vdot(v1, tangents[i])));
    const v2 = vsub(tangents[i + 1], tL);
    const c2 = vdot(v2, v2);
    const nu = c2 < 1e-12 ? rL : vsub(rL, vscale(v2, (2 / c2) * vdot(v2, rL)));
    ups.push(vnorm(nu));
  }
  if (upEnd) {
    // remove residual twist so the exit lines up with the next piece
    const n = points.length - 1;
    const T = tangents[n];
    const want = vnorm(vsub(upEnd, vscale(T, vdot(upEnd, T))));
    const have = ups[n];
    const ang = Math.atan2(vdot(vcross(have, want), T), vdot(have, want));
    if (Math.abs(ang) > 1e-6) for (let i = 1; i <= n; i++) ups[i] = vrotAxis(ups[i], tangents[i], (ang * i) / n);
  }
  return ups;
}

function samplePath(pl, path) {
  const us = [];
  for (let i = 0; i <= path.steps; i++) us.push(i / path.steps);
  if (path.zones) for (const z of path.zones) us.push(z.u0, z.u1);
  us.sort((a, b) => a - b);
  const uniq = us.filter((u, i) => i === 0 || u - us[i - 1] > 1e-6);
  const pts = uniq.map((u) => toWorld(pl, path.fn(u)));
  const eps = 1e-4;
  const tans = uniq.map((u) => {
    const a = toWorld(pl, path.fn(Math.max(0, u - eps)));
    const b = toWorld(pl, path.fn(Math.min(1, u + eps)));
    return vnorm(vsub(b, a));
  });
  let ups;
  if (path.upFn) {
    ups = uniq.map((u, i) => {
      const [a, b, c] = path.upFn(u);
      const U = [pl.f[0] * a + pl.r[0] * b, c, pl.f[2] * a + pl.r[2] * b];
      return vnorm(vsub(U, vscale(tans[i], vdot(U, tans[i]))));
    });
  } else {
    const endFlat = Math.abs(tans[tans.length - 1][1]) < 0.02;
    ups = frames(pts, tans, [0, 1, 0], endFlat ? [0, 1, 0] : null);
  }
  if (path.bank) ups = ups.map((U, i) => vrotAxis(U, tans[i], path.bank(uniq[i])));
  let rights;
  if (path.rightAxis) {
    // cross-sections parallel to a fixed axis: the road stays a true cylinder
    rights = ups.map(() => vnorm([pl.r[0], 0, pl.r[2]]));
  } else {
    rights = ups.map((U, i) => vnorm(vcross(tans[i], U)));
    ups = ups.map((U, i) => vnorm(vcross(rights[i], tans[i])));
  }
  const surfAt = (u) => {
    if (path.zones) for (const z of path.zones) if (u >= z.u0 - 1e-6 && u <= z.u1 + 1e-6) return z.surf;
    return pl.piece.surf || 'road';
  };
  return { us: uniq, pts, tans, ups, rights, surfAt };
}

export function buildTrack(track, opts = {}) {
  const layout = layoutTrack(track);
  const tris = [];
  const surface = makeBuf(true);
  const solid = makeBuf(false);
  const decal = makeBuf(false);
  const gates = [];
  const line = [];
  const bounds = [];
  let spawn = null;
  const highlight = opts.highlight || new Set();
  const problems = layout.problems;
  let dist = 0;

  const addColTri = (a, b, c, up, surf, kind) => {
    let n = vnorm(vcross(vsub(b, a), vsub(c, a)));
    if (vdot(n, up) < 0) n = vscale(n, -1);
    tris.push({ a, b, c, n, surf: SURF[surf] ?? 0, kind });
  };
  const tint = (col, idx) => {
    if (problems.has(idx)) return [Math.min(1, col[0] * 0.5 + 0.6), col[1] * 0.4, col[2] * 0.4];
    if (highlight.has(idx)) return [col[0] * 0.6 + 0.1, col[1] * 0.6 + 0.35, Math.min(1, col[2] * 0.6 + 0.45)];
    return col;
  };

  for (const pl of layout.placed) {
    if (!pl) continue;
    const idx = pl.index;
    curPiece = idx;
    const walls = pl.piece.walls !== false;
    const bmin = [Infinity, Infinity, Infinity], bmax = [-Infinity, -Infinity, -Infinity];
    const grow = (p) => { for (let k = 0; k < 3; k++) { bmin[k] = Math.min(bmin[k], p[k]); bmax[k] = Math.max(bmax[k], p[k]); } };

    if (!pl.built.paths.length && !pl.built.cursorOnly) {
      // gap-type piece: straight virtual line for the bot
      const a = pl.origin, b = vaddScaled(pl.origin, pl.f, BLOCK);
      const steps = 8;
      for (let i = 0; i <= steps; i++) {
        if (i === 0 && line.length) continue;
        const p = vadd(a, vscale(vsub(b, a), i / steps));
        if (line.length) dist += vlen(vsub(p, line[line.length - 1].pos));
        line.push({ pos: p, t: pl.f, u: [0, 1, 0], r: pl.r, surf: 'air', d: dist, piece: idx, gap: true, curv: 0, vcurv: 0 });
      }
      grow(vaddScaled(a, [0, 1, 0], -1)); grow(vaddScaled(b, [0, 1, 0], 8));
      grow(vaddScaled(a, pl.r, ROAD_HALF)); grow(vaddScaled(b, pl.r, -ROAD_HALF));
    }

    for (const path of pl.built.paths) {
      const S = samplePath(pl, path);
      const n = S.pts.length;
      const L = [], R = [];
      for (let i = 0; i < n; i++) {
        L.push(vaddScaled(S.pts[i], S.rights[i], -ROAD_HALF));
        R.push(vaddScaled(S.pts[i], S.rights[i], ROAD_HALF));
        grow(L[i]); grow(R[i]);
        grow(vaddScaled(S.pts[i], S.ups[i], WALL_H + 0.5));
      }
      // running distance for texture coordinates and the bot line
      const dloc = [0];
      for (let i = 1; i < n; i++) dloc.push(dloc[i - 1] + vlen(vsub(S.pts[i], S.pts[i - 1])));
      for (let i = 0; i < n; i++) {
        if (i === 0 && line.length) {
          // join: skip the duplicate point at the connector
          const last = line[line.length - 1];
          if (vlen(vsub(last.pos, S.pts[0])) < 0.5) continue;
        }
        if (line.length) dist += vlen(vsub(S.pts[i], line[line.length - 1].pos));
        // lateral curvature (in the road plane) for speed planning
        // curv: turning within the road plane (right positive); vcurv: bending
        // toward the road's normal (positive in dips and loops, negative on crests)
        let curv = 0, vcurv = 0;
        if (i > 0 && i < n - 1) {
          const ds = dloc[i + 1] - dloc[i - 1];
          const dT = vsub(S.tans[i + 1], S.tans[i - 1]);
          curv = ds > 1e-6 ? vdot(dT, S.rights[i]) / ds : 0;
          vcurv = ds > 1e-6 ? vdot(dT, S.ups[i]) / ds : 0;
        }
        line.push({ pos: S.pts[i], t: S.tans[i], u: S.ups[i], r: S.rights[i], surf: S.surfAt(S.us[i]), d: dist, piece: idx, curv, vcurv });
      }

      for (let i = 0; i < n - 1; i++) {
        const um = (S.us[i] + S.us[i + 1]) / 2;
        const surf = S.surfAt(um);
        const up = vnorm(vadd(S.ups[i], S.ups[i + 1]));
        // road top (collision + render), split into columns where the road twists
        const v0 = dloc[i] / 16, v1 = dloc[i + 1] / 16;
        const col = tint(SURF_COLORS[surf] || SURF_COLORS.road, idx);
        const cols = path.cols || 1;
        for (let k = 0; k < cols; k++) {
          const a0 = k / cols, a1 = (k + 1) / cols;
          const A = vadd(L[i], vscale(vsub(R[i], L[i]), a0)), B = vadd(L[i], vscale(vsub(R[i], L[i]), a1));
          const C = vadd(L[i + 1], vscale(vsub(R[i + 1], L[i + 1]), a1)), D = vadd(L[i + 1], vscale(vsub(R[i + 1], L[i + 1]), a0));
          addColTri(A, B, C, up, surf, 0);
          addColTri(A, C, D, up, surf, 0);
          pushQuad(surface, A, B, C, D, col, [[a0, v0], [a1, v0], [a1, v1], [a0, v1]]);
        }
        // underside slab
        const dn0 = vscale(S.ups[i], -SLAB), dn1 = vscale(S.ups[i + 1], -SLAB);
        const Lb0 = vadd(L[i], dn0), Lb1 = vadd(L[i + 1], dn1), Rb0 = vadd(R[i], dn0), Rb1 = vadd(R[i + 1], dn1);
        pushQuad(solid, Lb0, Rb0, Rb1, Lb1, tint(UNDER, idx));
        pushQuad(solid, L[i], Lb0, Lb1, L[i + 1], tint(UNDER, idx));
        pushQuad(solid, R[i], R[i + 1], Rb1, Rb0, tint(UNDER, idx));
        if (walls) {
          const wc = tint(Math.floor(dloc[i] / 4) % 2 ? WALL_B : WALL_A, idx);
          for (const [E, sgn] of [[L, -1], [R, 1]]) {
            const a = E[i], b = E[i + 1];
            const at = vaddScaled(a, S.ups[i], WALL_H), bt = vaddScaled(b, S.ups[i + 1], WALL_H);
            const inward = vscale(S.rights[i], -sgn);
            addColTri(a, b, bt, inward, surf, 1);
            addColTri(a, bt, at, inward, surf, 1);
            // render: inner face, top, outer face
            const o0 = vaddScaled(a, S.rights[i], sgn * 0.5), o1 = vaddScaled(b, S.rights[i + 1], sgn * 0.5);
            const ot0 = vaddScaled(o0, S.ups[i], WALL_H), ot1 = vaddScaled(o1, S.ups[i + 1], WALL_H);
            if (sgn < 0) {
              pushQuad(solid, a, at, bt, b, wc);
              pushQuad(solid, at, ot0, ot1, bt, wc);
              pushQuad(solid, o0, o1, ot1, ot0, tint(UNDER, idx));
            } else {
              pushQuad(solid, a, b, bt, at, wc);
              pushQuad(solid, at, bt, ot1, ot0, wc);
              pushQuad(solid, o0, ot0, ot1, o1, tint(UNDER, idx));
            }
          }
        }
        // turbo chevrons
        if ((surf === 'turbo' || surf === 'turbo2') && i % 1 === 0) {
          const P = vadd(S.pts[i], vscale(S.ups[i], 0.03));
          const T = S.tans[i], Rr = S.rights[i];
          const seg = dloc[i + 1] - dloc[i];
          for (let k = 0; k < Math.floor(seg / 3); k++) {
            const c = vaddScaled(P, T, 1.5 + k * 3);
            const tip = vaddScaled(c, T, 1.2);
            const lw = vaddScaled(vaddScaled(c, Rr, -5), T, -1.2), rw = vaddScaled(vaddScaled(c, Rr, 5), T, -1.2);
            const lwi = vaddScaled(lw, T, 0.9), rwi = vaddScaled(rw, T, 0.9), tipi = vaddScaled(tip, T, 0.9);
            const dc = surf === 'turbo' ? [1, 0.95, 0.75] : [1, 0.85, 0.7];
            pushQuad(decal, lw, lwi, tipi, tip, dc);
            pushQuad(decal, tip, tipi, rwi, rw, dc);
          }
        }
      }
      // end caps of the slab where the chain is broken (cheap: always add)
      for (const i of [0, n - 1]) {
        const dn = vscale(S.ups[i], -SLAB);
        pushQuad(solid, L[i], R[i], vadd(R[i], dn), vadd(L[i], dn), tint(UNDER, idx));
      }
      // pillars under level stretches
      if (S.pts[0][1] > 1 && !path.noPillars) {
        for (let d = 8; d < dloc[n - 1]; d += 24) {
          let i = 0;
          while (i < n - 1 && dloc[i + 1] < d) i++;
          const P = S.pts[i], U = S.ups[i];
          if (U[1] < 0.97 || P[1] < 2) continue;
          const top = P[1] - SLAB;
          const fh = vnorm([S.tans[i][0], 0, S.tans[i][2]]);
          pushBox(solid, [P[0], top / 2 - 0.1, P[2]], fh, vcross(fh, [0, 1, 0]), [0, 1, 0], 1.6, top / 2 + 0.1, 1.6, tint(PILLAR, idx));
        }
      }
      if (path === pl.built.paths[0] && pl.built.spawn != null) {
        const i = Math.max(1, S.us.findIndex((u) => u * BLOCK >= pl.built.spawn));
        spawn = { pos: toWorld(pl, [pl.built.spawn, 0, 0]), f: S.tans[i], r: S.rights[i], u: S.ups[i] };
      }
    }

    for (const g of pl.built.gates || []) {
      const y = g.y || 0;
      const pos = toWorld(pl, [g.s, 0, y]);
      const f = pl.f, r = pl.r, u = [0, 1, 0];
      const gate = { kind: g.kind, piece: idx, pos, f, r, u, halfW: ROAD_HALF + 1.5, lo: g.ring ? -8 : -2.5, hi: g.ring ? 8 : 10, ring: !!g.ring };
      gates.push(gate);
      const gc = tint(GATE_COLORS[g.kind], idx);
      const hw = ROAD_HALF + 1.6;
      if (g.ring) {
        const rh = 8.5, th = 0.6;
        pushBox(solid, vaddScaled(pos, r, -hw), f, r, u, th, rh, 0.4, gc);
        pushBox(solid, vaddScaled(pos, r, hw), f, r, u, th, rh, 0.4, gc);
        pushBox(solid, vaddScaled(pos, u, rh), f, r, u, hw + th, th, 0.4, gc);
        pushBox(solid, vaddScaled(pos, u, -rh), f, r, u, hw + th, th, 0.4, gc);
      } else {
        const ph = 7.5;
        pushBox(solid, vaddScaled(vaddScaled(pos, r, -hw), u, ph / 2), f, r, u, 0.6, ph / 2, 0.6, gc);
        pushBox(solid, vaddScaled(vaddScaled(pos, r, hw), u, ph / 2), f, r, u, 0.6, ph / 2, 0.6, gc);
        pushBox(solid, vaddScaled(pos, u, ph + 0.6), f, r, u, hw + 0.6, 0.6, 0.8, gc);
        // line on the road
        const lc = g.kind === 'finish' || g.kind === 'start' ? [0.95, 0.95, 0.95] : [0.6, 0.78, 1];
        const p0 = vaddScaled(pos, u, 0.035);
        if (g.kind === 'finish' || g.kind === 'start') {
          const n = 12, w = (2 * ROAD_HALF) / n;
          for (let k = 0; k < n; k++) for (let row = 0; row < 2; row++) {
            const cc = (k + row) % 2 ? [0.08, 0.08, 0.1] : lc;
            const a = vaddScaled(vaddScaled(p0, r, -ROAD_HALF + k * w), f, -1 + row);
            pushQuad(decal, a, vaddScaled(a, f, 1), vaddScaled(vaddScaled(a, f, 1), r, w), vaddScaled(a, r, w), cc);
          }
        } else {
          const a = vaddScaled(vaddScaled(p0, r, -ROAD_HALF), f, -0.5);
          pushQuad(decal, a, vaddScaled(a, f, 1), vaddScaled(vaddScaled(a, f, 1), r, 2 * ROAD_HALF), vaddScaled(a, r, 2 * ROAD_HALF), lc);
        }
      }
    }
    bounds.push({ index: idx, min: bmin, max: bmax });
  }

  if (!spawn) {
    const pos = vaddScaled(cursorEntryFallback(track), [0, 0, 0], 0);
    spawn = { pos, f: [0, 0, 1], r: [-1, 0, 0], u: [0, 1, 0] };
  }

  return { track, layout, tris, render: { surface, solid, decal }, gates, spawn, line, bounds };
}

function cursorEntryFallback(track) {
  const s = track.start;
  return [s.i * BLOCK + BLOCK / 2, s.k * LEVEL, s.j * BLOCK + BLOCK / 2];
}
