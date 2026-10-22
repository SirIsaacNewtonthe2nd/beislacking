// A simple driver that follows the track centreline. Used to sanity-check
// tracks (can they be finished?) and to set medal times.

import { vsub, vdot, vdist, clamp } from './math.js';

const GRIP = { road: 1, turbo: 1, turbo2: 1, noengine: 1, nosteer: 1, reset: 1, plastic: 0.85, dirt: 0.66, grass: 0.5, ice: 0.12, air: 1 };

export class Bot {
  constructor(built, opts = {}) {
    this.line = built.line;
    this.idx = 0;
    this.margin = opts.margin ?? 0.9;
    this.decel = opts.decel ?? 24;
    this.plan = planSpeeds(this.line, this.margin, this.decel);
    this.stuck = 0;
  }

  reset() { this.idx = 0; this.stuck = 0; }

  locate(p) {
    const L = this.line;
    let best = Infinity, bi = this.idx;
    const lo = Math.max(0, this.idx - 4), hi = Math.min(L.length - 1, this.idx + 50);
    for (let i = lo; i <= hi; i++) {
      const d = vdist(L[i].pos, p);
      if (d < best) { best = d; bi = i; }
    }
    if (best > 40) {
      // lost (respawn or big jump): global search
      for (let i = 0; i < L.length; i++) {
        const d = vdist(L[i].pos, p);
        if (d < best) { best = d; bi = i; }
      }
    }
    this.idx = bi;
    return bi;
  }

  input(car, dt) {
    const L = this.line;
    const i = this.locate(car.p);
    const sp = car.speed;
    const look = 7 + 0.33 * sp;
    let j = i;
    while (j < L.length - 1 && L[j].d - L[i].d < look) j++;
    const target = L[j].pos;
    const { f, u, r } = car.basis();
    const dv = vsub(target, car.p);
    const x = vdot(dv, r), z = vdot(dv, f);
    const k = (2 * x) / Math.max(1, x * x + z * z);
    const grip = 40 + 0.0042 * sp * sp;
    const kmax = Math.min(Math.tan(0.55 / (1 + sp / 20)) / 2.7, (grip * 0.97) / Math.max(16, sp * sp));
    const steer = clamp(k / kmax, -1, 1);

    let vt = this.plan[i];
    for (let m = i; m < Math.min(L.length, i + 6); m++) vt = Math.min(vt, this.plan[m]);
    let throttle = 1, brake = 0;
    if (sp > vt + 1) throttle = 0;
    if (sp > vt + 5) brake = 1;
    if (z < 0 && sp < 5) { throttle = 1; }

    const off = vdist(L[i].pos, car.p) > 25 && !L[i].gap;
    this.stuck = sp < 1 || off ? this.stuck + dt : 0;
    return { steer, throttle, brake, analog: true, allowDrift: false, wantRespawn: this.stuck > 2 };
  }
}

export function planSpeeds(line, margin, decel) {
  const n = line.length;
  const v = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let k = 0;
    for (let m = Math.max(0, i - 2); m <= Math.min(n - 1, i + 2); m++) k = Math.max(k, Math.abs(line[m].curv));
    const g = (GRIP[line[i].surf] ?? 1) * margin;
    const denom = k - 0.0042 * g;
    v[i] = denom <= 1e-6 ? 300 : Math.min(300, Math.sqrt((40 * g) / denom));
  }
  for (let i = n - 2; i >= 0; i--) {
    const ds = Math.max(0, line[i + 1].d - line[i].d);
    v[i] = Math.min(v[i], Math.sqrt(v[i + 1] * v[i + 1] + 2 * decel * ds));
  }
  return v;
}
