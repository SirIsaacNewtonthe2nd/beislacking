// An AI driver that learns a track by trial and error.
//
// Its policy is a racing line (a smooth sideways offset from the centre line)
// and a speed profile (how hard to push each stretch, on top of a planner that
// knows the car's grip, downforce and braking). Training is an evolution
// strategy: change a small part of the policy, drive it, keep it if the lap is
// faster. The simulation is deterministic, so each attempt restarts from a
// saved state just before the changed stretch, and stops early once it falls
// behind or rejoins the best run's path.
//
// It also learns from your runs: it reads where your car was across the road
// and how fast you took each corner, tries your whole line at the start, and
// keeps trying stretches of it in place of its own. Like any other change, a
// stretch of yours stays only if it makes the lap faster.
//
// The score is the lap time. While an attempt is judged early, speed it
// carries counts in its favour, and its changes lean toward pushing harder.
// Walls cost only the time they cost: after a crash the driver backs off and
// carries on. It never respawns; an attempt is dropped only when the car
// can't get going again.

import { vsub, vdot, vdist, clamp } from './math.js';
import { GRAVITY, DOWNFORCE_PER_MASS, DOWNFORCE_CAP, SURFACE_MU } from './car.js';
import { ROAD_HALF } from './pieces.js';
import { buildTrack } from './geometry.js';
import { World } from './collision.js';
import { Race, DT } from './race.js';
import { rng } from './generator.js';

const WHEELBASE = 2.75;
const KNOT = 12;              // m between control points of the line and speed profile
const SNAP_EVERY = 40;        // ticks between saved states

// limits on the sideways offset, per piece type. Kickers stay on the centre
// line so the car takes off straight and lands on the road.
// (Letting the line run right up to the borders was tried: it learned slower
// on jump tracks, so the line keeps about half a metre of room.)
const OFFSET_LIMIT = { LOOPR: 2.5, LOOPL: 2.5, WR: 5, WL: 5, BR2: 6, BL2: 6, BR3: 6, BL3: 6, K: 0, K2: 0 };
const ROAD_LIMIT = ROAD_HALF - 1.7;

// uniform cubic B-spline basis and its first two derivatives
function basis(t) {
  const it = 1 - t, t2 = t * t, t3 = t2 * t;
  return [
    [it * it * it / 6, (3 * t3 - 6 * t2 + 4) / 6, (-3 * t3 + 3 * t2 + 3 * t + 1) / 6, t3 / 6],
    [-it * it / 2, (3 * t2 - 4 * t) / 2, (-3 * t2 + 2 * t + 1) / 2, t2 / 2],
    [it, 3 * t - 2, -3 * t + 1, t],
  ];
}

export function initialPolicy(built) {
  const n = Math.ceil(built.line[built.line.length - 1].d / KNOT) + 4;
  return { off: new Array(n).fill(0), fac: new Array(n).fill(1), margin: 0.66, gain: 1.2, preview: 0.12, slide: 0.18, lift: 1.6 };
}

// A first racing line: treat the line as an elastic band and let it pull
// tight between the road edges, which cuts across the inside of corners.
export function smoothPolicy(built, pol) {
  const L = built.line, n = L.length, nk = pol.off.length;
  const types = built.layout.placed.map((pl) => (pl ? pl.piece.type : ''));
  // centre line, sideways axis and offset limit at each control point
  const C = [], R = [], lim = [];
  let i = 0;
  for (let k = 0; k < nk; k++) {
    const d = (k - 1) * KNOT; // a B-spline control point sits about a knot behind its peak
    while (i < n - 1 && L[i + 1].d < d) i++;
    const p = L[Math.min(n - 1, i)];
    C.push(p.pos); R.push(p.r);
    const lineLim = p.gap ? 0 : OFFSET_LIMIT[types[p.piece]] ?? ROAD_LIMIT;
    lim.push(d < 0 || d > L[n - 1].d ? 0 : lineLim * 0.85);
  }
  const off = [...pol.off];
  for (let it = 0; it < 300; it++) {
    for (let k = 1; k < nk - 1; k++) {
      if (!lim[k]) { off[k] = 0; continue; }
      const P = (j) => [C[j][0] + R[j][0] * off[j], C[j][1] + R[j][1] * off[j], C[j][2] + R[j][2] * off[j]];
      const a = P(k - 1), b = P(k + 1), c = P(k);
      const mid = [(a[0] + b[0]) / 2 - c[0], (a[1] + b[1]) / 2 - c[1], (a[2] + b[2]) / 2 - c[2]];
      off[k] = clamp(off[k] + 0.8 * vdot(mid, R[k]), -lim[k], lim[k]);
    }
  }
  return { ...pol, off };
}

// Turns a policy into per-line-point targets: path position, tangent,
// curvature and planned speed.
export function compilePolicy(built, pol) {
  const L = built.line, n = L.length;
  const pos = new Array(n), tan = new Array(n), curv = new Float64Array(n), off = new Float64Array(n), plan = new Float64Array(n), lat = new Float64Array(n);
  const types = built.layout.placed.map((pl) => (pl ? pl.piece.type : ''));
  for (let i = 0; i < n; i++) {
    const p = L[i];
    const u = p.d / KNOT, seg = Math.min(pol.off.length - 4, Math.floor(u));
    const [b, b1, b2] = basis(u - seg);
    let o = 0, o1 = 0, o2 = 0;
    for (let k = 0; k < 4; k++) { const c = pol.off[seg + k]; o += b[k] * c; o1 += b1[k] * c; o2 += b2[k] * c; }
    o1 /= KNOT; o2 /= KNOT * KNOT;
    const lim = p.gap ? 0 : OFFSET_LIMIT[types[p.piece]] ?? ROAD_LIMIT;
    if (Math.abs(o) > lim) { o = Math.sign(o) * lim; o1 = 0; o2 = 0; }
    off[i] = o;
    pos[i] = [p.pos[0] + p.r[0] * o, p.pos[1] + p.r[1] * o, p.pos[2] + p.r[2] * o];
    const k0 = p.curv || 0, s = 1 - k0 * o;
    const tx = p.t[0] * s + p.r[0] * o1, ty = p.t[1] * s + p.r[1] * o1, tz = p.t[2] * s + p.r[2] * o1;
    const tl = Math.hypot(tx, ty, tz) || 1;
    tan[i] = [tx / tl, ty / tl, tz / tl];
    curv[i] = k0 / Math.max(0.2, s) + o2;
  }
  // speed: lateral grip limit from friction plus downforce, scaled by the
  // policy's push factor, then a backward pass for braking distances
  const D = DOWNFORCE_PER_MASS;
  const fac = (d) => {
    const u = d / KNOT, seg = Math.min(pol.fac.length - 4, Math.floor(u));
    const [b] = basis(u - seg);
    let f = 0;
    for (let k = 0; k < 4; k++) f += b[k] * pol.fac[seg + k];
    return f;
  };
  const muAt = (i) => (SURFACE_MU[L[i].surf] ?? SURFACE_MU.road) * pol.margin;
  for (let i = 0; i < n; i++) {
    let k = 0, kv = Infinity;
    for (let m = Math.max(0, i - 2); m <= Math.min(n - 1, i + 2); m++) { k = Math.max(k, Math.abs(curv[m])); kv = Math.min(kv, L[m].vcurv || 0); }
    const mu = L[i].surf === 'air' ? SURFACE_MU.road * pol.margin : muAt(i);
    const g = GRAVITY * Math.max(0.2, L[i].u[1]);
    let den = k - mu * (D + kv);
    let v = den <= 1e-6 ? 300 : Math.min(300, Math.sqrt((mu * g) / den));
    if (D * v * v > DOWNFORCE_CAP) {
      den = k - mu * kv;
      v = den <= 1e-6 ? 300 : Math.min(v, Math.sqrt((mu * (g + DOWNFORCE_CAP)) / den));
    }
    lat[i] = v;
    plan[i] = Math.min(300, v * fac(L[i].d));
  }
  for (let i = n - 2; i >= 0; i--) {
    const ds = Math.max(0, L[i + 1].d - L[i].d);
    const mu = (L[i].surf === 'air' ? SURFACE_MU.road * pol.margin : muAt(i)) * 0.9;
    const a = mu * (GRAVITY + Math.min(DOWNFORCE_CAP, D * plan[i + 1] * plan[i + 1]));
    plan[i] = Math.min(plan[i], Math.sqrt(plan[i + 1] * plan[i + 1] + 2 * a * ds));
  }
  return { pos, tan, curv, off, plan, lat, gain: pol.gain, preview: pol.preview, slide: pol.slide ?? 0.18, lift: pol.lift ?? 1.6 };
}

// ---------------------------------------------------------------- learning from your runs

function splineAt(c, d) {
  const u = Math.max(0, d) / KNOT, seg = Math.min(c.length - 4, Math.floor(u));
  const [b] = basis(u - seg);
  return b[0] * c[seg] + b[1] * c[seg + 1] + b[2] * c[seg + 2] + b[3] * c[seg + 3];
}

// Adjust control points so the curve passes through each target (null: leave
// that one alone). Control point k peaks a knot behind its index.
function fitSpline(c, targets, lo, hi) {
  for (let it = 0; it < 24; it++) {
    for (let k = 1; k < c.length - 1; k++) {
      if (targets[k] == null) continue;
      c[k] = clamp(c[k] + (targets[k] - splineAt(c, (k - 1) * KNOT)) * 1.3, lo, hi);
    }
  }
  return c;
}

// Where a recorded run (ghost samples: t, position, rotation) crossed the
// road at each line point, and how fast it was going there.
export function readRun(built, ghost) {
  const L = built.line, n = L.length, ns = Math.floor((ghost ? ghost.length : 0) / 8);
  if (ns < 3) return null;
  const off = new Float64Array(n).fill(NaN), spd = new Float64Array(n).fill(NaN);
  let found = 0;
  for (let i = 0; i < n; i++) {
    const p = L[i];
    if (p.gap) continue;
    const P = p.pos, T = p.t;
    let a0 = null;
    for (let j = 0; j < ns; j++) {
      const o = j * 8;
      const a = (ghost[o + 1] - P[0]) * T[0] + (ghost[o + 2] - P[1]) * T[1] + (ghost[o + 3] - P[2]) * T[2];
      if (a0 !== null && a0 < 0 && a >= 0) {
        const q = o - 8, lam = a0 / (a0 - a);
        const x = ghost[q + 1] + (ghost[o + 1] - ghost[q + 1]) * lam - P[0];
        const y = ghost[q + 2] + (ghost[o + 2] - ghost[q + 2]) * lam - P[1];
        const z = ghost[q + 3] + (ghost[o + 3] - ghost[q + 3]) * lam - P[2];
        // near this point: the plane also cuts far-off parts of the track
        if (x * x + y * y + z * z < 225) {
          if (Number.isNaN(off[i])) found++;
          off[i] = x * p.r[0] + y * p.r[1] + z * p.r[2]; // the last pass wins (after a respawn, laps)
          spd[i] = Math.hypot(ghost[o + 1] - ghost[q + 1], ghost[o + 2] - ghost[q + 2], ghost[o + 3] - ghost[q + 3]) / Math.max(1e-3, ghost[o] - ghost[q]);
        }
      }
      a0 = a;
    }
  }
  return found > n * 0.3 ? { off, spd } : null;
}

// A run read by readRun, as a policy built on `onto`: its line, and its pace
// through corners as push factors on top of the planner (at onto's margin).
// `has` marks the control points the run covered.
export function runPolicy(built, run, onto) {
  const L = built.line, n = L.length, nk = onto.off.length;
  const tOff = new Array(nk).fill(null), at = new Array(nk).fill(-1);
  let i = 0;
  for (let k = 1; k < nk - 1; k++) {
    const d = (k - 1) * KNOT;
    while (i < n - 1 && L[i + 1].d <= d) i++;
    let bj = -1, bd = KNOT / 2;
    for (let j = Math.max(0, i - 3); j <= Math.min(n - 1, i + 4); j++) {
      const dd = Math.abs(L[j].d - d);
      if (!Number.isNaN(run.off[j]) && dd <= bd) { bd = dd; bj = j; }
    }
    if (bj >= 0) { tOff[k] = run.off[bj]; at[k] = bj; }
  }
  const off = fitSpline([...onto.off], tOff, -ROAD_LIMIT, ROAD_LIMIT);
  // pace where grip limits it (corners): its speed over the planner's limit on that line
  const lat = compilePolicy(built, { ...onto, off, fac: onto.fac.map(() => 1) }).lat;
  const tFac = at.map((j) => (j >= 0 && lat[j] < 150 && run.spd[j] > 1 ? run.spd[j] / lat[j] : null));
  const fac = fitSpline([...onto.fac], tFac, 0.6, 2.2);
  return { ...onto, off, fac, has: tOff.map((x) => x != null), at, pace: tFac.map((x) => x != null) };
}

// Drives a compiled policy. Same controls a player has: steer, throttle, brake.
export class AIDriver {
  constructor(built, compiled) {
    this.line = built.line;
    this.c = compiled;
    this.idx = 0;
    this.stuck = 0;      // s resting still in the air (on its back or side)
    this.blocked = 0;    // s barely moving while trying to go
    this.recover = 0;    // s left backing away from a crash
    this.recoverSteer = 0;
    this.grace = 0;      // s to pull away after backing off before checking again
    this.offTime = 0;    // s far from the track (fallen to the floor below)
    this.still = 0;      // s without getting further along the line
    this.far = 0;
  }

  locate(p) {
    const L = this.line;
    let best = Infinity, bi = this.idx;
    const lo = Math.max(0, this.idx - 4), hi = Math.min(L.length - 1, this.idx + 50);
    for (let i = lo; i <= hi; i++) {
      const d = vdist(L[i].pos, p);
      if (d < best) { best = d; bi = i; }
    }
    // lost the line (a new lap starts back at its beginning): search it all
    if (best > 40) {
      for (let i = 0; i < L.length; i++) {
        const d = vdist(L[i].pos, p);
        if (d < best) { best = d; bi = i; }
      }
    }
    this.idx = bi;
    return bi;
  }

  input(car, dt) {
    const L = this.line, C = this.c, n = L.length;
    const i = this.locate(car.p);
    const sp = car.speed;
    const { f, u, r } = car.basis();
    const vx = vdot(car.v, f);

    // progress along the line (wrapping round at a new lap)
    if (i > this.far || this.far - i > n / 2) { this.far = i; this.still = 0; } else this.still += dt;

    if (!car.grounded && car.airTime > 0.05) {
      // a car resting on its back or side reads as airborne: that one is done
      this.stuck = sp < 1 ? this.stuck + dt : 0;
      const hit = car.world.raycast(car.p, [0, -1, 0], 150, {});
      const nrm = hit && hit.n[1] > 0.3 ? hit.n : [0, 1, 0];
      const cmd = vdot(f, nrm) * 4 + vdot(car.w, r) * 0.8;
      return { steer: 0, throttle: cmd < -0.05 ? clamp(-cmd * 3, 0, 1) : 0, brake: cmd > 0.05 ? clamp(cmd * 3, 0, 1) : 0, analog: true, assists: true, giveUp: this.stuck > 3 || this.still > 8 };
    }

    // where along the line the car is, between two line points
    const along = vdot(vsub(car.p, L[i].pos), L[i].t);
    const a = along >= 0 ? Math.min(i, n - 2) : Math.max(0, i - 1);
    const seg = Math.max(1e-6, L[a + 1].d - L[a].d);
    const lam = clamp((L[i].d + along - L[a].d) / seg, 0, 1);
    const tp = [0, 1, 2].map((k) => C.pos[a][k] + (C.pos[a + 1][k] - C.pos[a][k]) * lam);
    const T = C.tan[lam < 0.5 ? a : a + 1];

    let j = i;
    const preview = 2 + C.preview * sp;
    while (j < n - 1 && L[j].d - L[i].d < preview) j++;
    const headErr = Math.atan2(vdot(T, r), vdot(T, f));
    const offset = vdot(vsub(tp, car.p), r);
    const ff = Math.atan(WHEELBASE * C.curv[j]);
    const angle = ff + headErr + Math.atan((C.gain * offset) / (Math.abs(vx) + 3));
    const steer = clamp(angle / car.steerLimit(vx), -1, 1);
    const z = vdot(vsub(L[Math.min(n - 1, i + 3)].pos, car.p), f);

    // no way back: fallen off raised road onto the floor, or going nowhere
    const off = vdist(L[i].pos, car.p) > 12 && !L[i].gap;
    this.offTime = off ? this.offTime + dt : 0;
    const giveUp = this.offTime > 3 || this.still > 8;

    // after a crash: back away from the wall, swinging the nose toward the
    // line (steering works the other way in reverse), then carry on
    if (this.recover > 0) {
      this.recover -= dt;
      if (this.recover <= 0) this.grace = 1.5;
      return { steer: this.recoverSteer, throttle: 0, brake: 1, analog: true, assists: true, giveUp };
    }
    this.grace = Math.max(0, this.grace - dt);

    let vt = C.plan[a] + (C.plan[a + 1] - C.plan[a]) * lam;
    for (let m = a + 1; m < Math.min(n, i + 6); m++) vt = Math.min(vt, C.plan[m]);
    let throttle = clamp((vt - sp) * 0.4 + 0.3, 0, 1) * clamp(C.lift - Math.abs(steer), 0.3, 1);
    let brake = sp > vt + 3 ? clamp((sp - vt - 3) * 0.5, 0.3, 1) * (1 - 0.6 * Math.abs(steer)) : 0;
    const beta = Math.atan2(vdot(car.v, r), Math.abs(vx) + 0.1);
    if (Math.abs(beta) > C.slide && sp > 5) throttle = 0;
    if (sp > vt + 0.5) throttle = 0;
    if (Math.abs(steer) > 0.95 && sp > 8) { throttle = 0; brake = Math.max(brake, 0.25); }
    if (z < 0 && sp < 5) throttle = 1;

    // stuck: in a forward gear, on the throttle, and not moving (nose in a wall)
    this.blocked = car.grounded && sp < 1.5 && throttle > 0.2 && car.gear >= 1 && this.grace <= 0 ? this.blocked + dt : 0;
    if (this.blocked > 0.6) {
      this.blocked = 0;
      this.recover = 1.1;
      this.recoverSteer = -Math.sign(angle || 1);
    }
    return { steer, throttle, brake, analog: true, assists: true, giveUp };
  }
}

// ---------------------------------------------------------------- training

const RACE_SKIP = new Set(['built', 'world', 'car', 'listeners', 'cps', 'finishGates', 'startGate', 'ghost']);
const CAR_SKIP = new Set(['world', 'contacts', 'hitTmp']);
function pickClone(obj, skip) {
  const o = {};
  for (const k of Object.keys(obj)) if (!skip.has(k)) o[k] = obj[k];
  return structuredClone(o);
}

export class Trainer {
  constructor(track, opts = {}) {
    this.built = buildTrack(track);
    this.race = new Race(this.built, new World(this.built.tris));
    this.line = this.built.line;
    this.rand = rng(opts.seed ?? 12345);
    this.attempts = 0;
    this.improvements = 0;
    this.sigmaOff = 1.6;
    this.sigmaFac = 0.06;
    this.history = [];
    this.start = opts.policy || null;
    this.best = null; // the first attempt drives the starting policy
    // when several trainers work together, each takes a share of the warm-up
    this.part = opts.part || 0;
    this.parts = opts.parts || 1;
    // your runs, read once the track is built
    this.runs = (opts.runs || []).map((g) => readRun(this.built, g)).filter(Boolean);
    this.runCache = new Map();
    this.fromRuns = 0;      // new bests that came from your driving
    this.lastSource = null;
  }

  // run i as a policy at a given margin (cached)
  runAt(i, margin) {
    const key = i + ':' + margin;
    if (!this.runCache.has(key)) this.runCache.set(key, runPolicy(this.built, this.runs[i], { ...initialPolicy(this.built), margin }));
    return this.runCache.get(key);
  }

  init() {
    const base = initialPolicy(this.built);
    const resume = this.start && Array.isArray(this.start.off) && this.start.off.length === base.off.length;
    this.best = this.fullRun(resume ? this.start : base);
    if (!this.best.time && resume) this.best = this.fullRun(base);
    if (this.best.time) this.history.push([0, this.best.time]);
    // warm-up: a tight line at a few levels of overall push, before the
    // small changes start
    const tight = smoothPolicy(this.built, base);
    this.warmup = resume ? [] : [0.74, 0.8, 0.86, 0.92, 0.98, 1.04, 1.1].map((m) => ({ pol: { ...tight, margin: m } })).concat([0.74, 0.82].map((m) => ({ pol: { ...base, margin: m } })));
    // your runs: each one's line and pace, and its line at a few levels of push
    // (and, when carrying on, your line on the AI's own pace)
    this.runs.forEach((run, i) => {
      const cur = this.best.time ? this.best.pol : base;
      const { has, at, pace, ...pol } = runPolicy(this.built, run, cur);
      this.warmup.push({ pol, source: 'run', practice: 3, run, at, pace });
      for (const m of resume ? [cur.margin] : [0.86, 0.98]) this.warmup.push({ pol: { ...cur, margin: m, off: this.runAt(i, m).off }, source: 'run' });
    });
    this.warmup = this.warmup.filter((_, i) => i % this.parts === this.part);
  }

  // The best run as another trainer needs it to carry on from it: its saved
  // states come along, so taking it over costs no driving.
  record() {
    const b = this.best;
    return { time: b.time, cps: b.cps, ghost: b.ghost, cross: b.cross, snaps: b.snaps, pol: b.pol };
  }

  // Carry on from a better run another trainer found. Returns true if taken.
  adopt(rec) {
    if (!this.best) this.init();
    if (!rec || !rec.time || (this.best.time && this.best.time <= rec.time)) return false;
    this.best = { ...rec, compiled: compilePolicy(this.built, rec.pol) };
    return true;
  }

  // What the page shows; the run itself (ghost, splits, policy) only when asked
  report(withRun) {
    const b = this.best;
    return {
      ready: !!b, failed: !!b && !b.time, attempts: this.attempts, improvements: this.improvements,
      runs: this.runs.length, fromRuns: this.fromRuns, lastSource: this.lastSource,
      time: b ? b.time : null, history: this.history.slice(-400),
      run: withRun && b && b.time ? { time: b.time, cps: b.cps, ghost: b.ghost, pol: b.pol } : null,
    };
  }

  // drive a policy from the start; returns the run record or one with time null
  fullRun(pol) {
    const compiled = compilePolicy(this.built, pol);
    const rec = this.drive(pol, compiled, null, null);
    return rec && rec.time ? rec : { time: null, pol };
  }

  // Drive from a saved state of the best run (or from the start). With `cmp`,
  // stop early when the attempt is clearly slower, or when it has rejoined
  // the best run after the changed stretch (then its finish time is known).
  drive(pol, compiled, snap, cmp) {
    const race = this.race, car = race.car, L = this.line, n = L.length;
    const driver = new AIDriver(this.built, compiled);
    // progress: the planes through each line point, once per lap
    const N = n * race.laps, lapLen = L[n - 1].d;
    const dAt = (k) => Math.floor(k / n) * lapLen + L[k % n].d;
    const cross = { t: new Float64Array(N).fill(NaN), lat: new Float64Array(N), spd: new Float64Array(N) };
    let k = 0, snaps = [];
    if (snap) {
      Object.assign(car, structuredClone(snap.car));
      Object.assign(race, structuredClone(snap.race));
      race.ghost = cmp.ghost.slice(0, snap.ghostLen);
      driver.idx = snap.idx; driver.stuck = snap.stuck;
      k = snap.k;
      for (let m = 0; m < k; m++) { cross.t[m] = cmp.cross.t[m]; cross.lat[m] = cmp.cross.lat[m]; cross.spd[m] = cmp.cross.spd[m]; }
      snaps = cmp.snaps.filter((s) => s.tick <= snap.tick);
    } else {
      race.reset();
      race.phase = 'running';
      race.car.frozen = false;
      race.recordGhost();
    }
    let prev = [...car.p], tPrev = race.time, verifying = false;
    const maxTicks = Math.round(300 / DT);
    while (race.phase === 'running') {
      if (race.ticks % SNAP_EVERY === 0 && (!snaps.length || snaps[snaps.length - 1].tick < race.ticks)) {
        snaps.push({ tick: race.ticks, k, idx: driver.idx, stuck: driver.stuck, car: pickClone(car, CAR_SKIP), race: pickClone(race, RACE_SKIP), ghostLen: race.ghost.length });
      }
      const inp = driver.input(car, DT);
      if (inp.giveUp) return null;
      prev[0] = car.p[0]; prev[1] = car.p[1]; prev[2] = car.p[2];
      tPrev = race.time;
      race.tick(inp);
      if (race.respawns || race.ticks > maxTicks) return null; // fell off the stadium
      // crossings of the planes through each line point
      while (k < N) {
        const pt = L[k % n], P = pt.pos, tk = pt.t;
        const a1 = (car.p[0] - P[0]) * tk[0] + (car.p[1] - P[1]) * tk[1] + (car.p[2] - P[2]) * tk[2];
        if (a1 < 0) break;
        const a0 = (prev[0] - P[0]) * tk[0] + (prev[1] - P[1]) * tk[1] + (prev[2] - P[2]) * tk[2];
        const lam = a0 < 0 ? a0 / (a0 - a1) : 0;
        cross.t[k] = tPrev + lam * DT;
        cross.lat[k] = vdot(vsub(car.p, P), pt.r);
        cross.spd[k] = car.speed;
        if (cmp && !Number.isNaN(cmp.cross.t[k])) {
          const dt = cross.t[k] - cmp.cross.t[k];
          const dv = cross.spd[k] - cmp.cross.spd[k];
          const past = dAt(k) - L[cmp.lastDiff].d;
          if (verifying) {
            // ahead and back on the best run's line: drive it out, but stop
            // as soon as the lead is gone
            if (dt > 0.0005) return { slower: true, why: 'lost lead' };
          } else if (cmp.global) {
            // a change to the whole lap (overall push, steering) can't rejoin;
            // drop it once it is clearly losing
            if (dt > 0.25 || (dAt(k) > 100 && dt > 0.03)) return { slower: true, why: 'behind' };
          } else {
            // behind and no faster: it won't make that back. Carrying more
            // speed counts in its favour (about the time it saves over the
            // next 60 m), until it is well past the change, when only the
            // time counts.
            const v = Math.max(20, cmp.cross.spd[k]);
            const score = dt - (past < 150 ? (clamp(dv, 0, 5) * 60) / (v * v) : 0);
            if (score > 0.25 || (past > 40 && score > 0.002 && (dv < 0.3 || past > 150))) return { slower: true, why: 'behind' };
            // back on the best run's line at about its speed: the time gap now
            // is the gap at the finish. If it's ahead, drive it out to be sure.
            if (past > 25 && Math.abs(cross.lat[k] - cmp.cross.lat[k]) < 0.15 && Math.abs(dv) < 0.15) {
              if (dt > -0.001) return { slower: true, why: 'rejoined' };
              verifying = true;
            }
          }
        }
        k++;
      }
    }
    if (race.phase !== 'finished') return null;
    return { time: race.finishTime, cps: race.cpTimes.map((x) => Math.round(x * 1000) / 1000), ghost: race.ghost, cross, snaps, pol, compiled };
  }

  // After driving a copy of one of your runs: match your speed through each
  // corner more closely next time (it tends to come in under its targets),
  // or ease off everywhere if it didn't make it round. Practice stops once a
  // lap comes out slower than the one before.
  practise(item, res) {
    const n = this.line.length, last = (this.race.laps - 1) * n;
    const fac = [...item.pol.fac];
    for (let k = 0; k < fac.length; k++) {
      if (!item.pace[k]) continue;
      if (!res.time) { fac[k] *= 0.95; continue; }
      const j = item.at[k], got = res.cross.spd[last + j], want = item.run.spd[j];
      if (got > 1 && want > 1) fac[k] = clamp(fac[k] * Math.pow(want / got, 0.8), 0.6, 2.2);
    }
    return { ...item, pol: { ...item.pol, fac }, practice: item.practice - 1, lastTime: res.time || item.lastTime };
  }

  // A control point to change, picked in proportion to the time the best run
  // spends around it: the slow parts of the lap, where time is lost, get the
  // most attention
  pickKnot(x) {
    const best = this.best, nk = best.pol.off.length;
    if (this.weightsFor !== best) {
      const L = this.line, n = L.length, w = new Float64Array(nk), t = best.cross.t;
      for (let k = 0; k + 1 < t.length; k++) {
        const dt = t[k + 1] - t[k];
        if (dt > 0 && dt < 5) w[Math.min(nk - 1, Math.round(L[k % n].d / KNOT) + 1)] += dt;
      }
      for (let k = 1; k < nk; k++) w[k] += w[k - 1];
      this.weights = w;
      this.weightsFor = best;
    }
    const w = this.weights, total = w[nk - 1];
    if (!(total > 0)) return Math.floor(x * nk);
    let lo = 0, hi = nk - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (w[m] < x * total) lo = m + 1; else hi = m; }
    return lo;
  }

  // A changed copy of a policy, and where the change came from
  mutate(pol) {
    const r = this.rand;
    const gauss = () => Math.sqrt(-2 * Math.log(1 - r())) * Math.cos(2 * Math.PI * r());
    const p = { ...pol, off: [...pol.off], fac: [...pol.fac] };
    const nk = p.off.length;
    // take a stretch of one of your runs: its line, and sometimes its pace
    if (this.runs.length && r() < 0.2) {
      const run = this.runAt(Math.floor(r() * this.runs.length), p.margin);
      const c = Math.floor(r() * nk), w = 2 + Math.floor(r() * 7), pace = r() < 0.5;
      let copied = 0;
      for (let k = Math.max(0, c - w); k <= Math.min(nk - 1, c + w); k++) {
        if (!run.has[k]) continue;
        p.off[k] = run.off[k];
        if (pace) p.fac[k] = run.fac[k];
        copied++;
      }
      if (copied) return [p, 'run'];
    }
    const roll = r();
    if (roll < 0.03) {
      p.margin = clamp(p.margin * Math.exp((gauss() + 0.4) * 0.02), 0.5, 1.3);
    } else if (roll < 0.05) {
      p.gain = clamp(p.gain * Math.exp(gauss() * 0.1), 0.4, 4);
      p.preview = clamp(p.preview * Math.exp(gauss() * 0.1), 0.04, 0.3);
      // how much slide and steering it tolerates before lifting
      p.slide = clamp((p.slide ?? 0.18) * Math.exp((gauss() + 0.3) * 0.1), 0.1, 0.6);
      p.lift = clamp((p.lift ?? 1.6) * Math.exp((gauss() + 0.3) * 0.05), 1, 3);
    } else {
      const c = this.pickKnot(r()), w = 1 + Math.floor(r() * 3);
      const amp = gauss();
      for (let k = Math.max(0, c - w); k <= Math.min(nk - 1, c + w); k++) {
        const fall = 1 - Math.abs(k - c) / (w + 1);
        if (roll < 0.62) p.off[k] = clamp(p.off[k] + amp * this.sigmaOff * fall, -ROAD_LIMIT, ROAD_LIMIT);
        else p.fac[k] = clamp(p.fac[k] * Math.exp((amp + 0.2) * this.sigmaFac * fall), 0.6, 2.2); // leans toward more push
      }
    }
    return [p, 'self'];
  }

  // One attempt. Returns true when it set a new best.
  attempt() {
    if (!this.best) { this.init(); return !!this.best.time; }
    const best = this.best;
    if (!best.time) return false;
    this.attempts++;
    if (this.warmup.length) {
      const item = this.warmup.shift(), { pol, source = 'self' } = item;
      const res = this.fullRun(pol);
      if (item.practice && !(res.time && item.lastTime && res.time > item.lastTime)) this.warmup.unshift(this.practise(item, res));
      if (!res.time || res.time >= best.time) return false;
      this.best = res;
      this.improvements++;
      if (source === 'run') this.fromRuns++;
      this.lastSource = source;
      this.history.push([this.attempts, res.time]);
      return true;
    }
    const [pol, source] = this.mutate(best.pol);
    const compiled = compilePolicy(this.built, pol);
    // first and last line points where the targets changed
    const n = this.line.length, B = best.compiled;
    let first = -1, last = -1;
    for (let i = 0; i < n; i++) {
      if (Math.abs(compiled.off[i] - B.off[i]) > 1e-9 || Math.abs(compiled.plan[i] - B.plan[i]) > 1e-9 || compiled.gain !== B.gain || compiled.preview !== B.preview || compiled.slide !== B.slide || compiled.lift !== B.lift) {
        if (first < 0) first = i;
        last = i;
      }
    }
    if (first < 0) return false;
    // resume from the last saved state well before the change
    const dStart = this.line[first].d - 45;
    let snap = null;
    for (const s of best.snaps) if (this.line[Math.min(n - 1, s.idx)].d < dStart && s.k <= first) snap = s;
    const global = this.line[last].d - this.line[first].d > this.line[n - 1].d * 0.5;
    const res = this.drive(pol, compiled, snap, { ...best, lastDiff: last, global });
    if (!res || res.slower || !res.time || res.time >= best.time) {
      this.sigmaOff = Math.max(0.3, this.sigmaOff * 0.998);
      this.sigmaFac = Math.max(0.01, this.sigmaFac * 0.998);
      return false;
    }
    this.best = res;
    this.improvements++;
    if (source === 'run') this.fromRuns++;
    this.lastSource = source;
    this.sigmaOff = Math.min(3, this.sigmaOff * 1.02);
    this.sigmaFac = Math.min(0.12, this.sigmaFac * 1.02);
    this.history.push([this.attempts, res.time]);
    return true;
  }

  // Train for about `ms` milliseconds; returns how many new bests were found.
  step(ms) {
    const end = performanceNow() + ms;
    let found = 0;
    while (performanceNow() < end) if (this.attempt()) found++;
    return found;
  }
}

const performanceNow = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
