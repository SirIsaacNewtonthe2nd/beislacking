// A driver that follows the track centreline. Used to check that tracks can
// be finished with the real physics, and to set medal times.

import { vsub, vdot, vdist, clamp } from './math.js';
import { GRAVITY, DOWNFORCE_PER_MASS, DOWNFORCE_CAP, SURFACE_MU } from './car.js';

const WHEELBASE = 2.75;

export class Bot {
  constructor(built, opts = {}) {
    this.line = built.line;
    this.idx = 0;
    this.margin = opts.margin ?? 0.66;
    this.plan = planSpeeds(this.line, this.margin);
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
    const { f, u, r } = car.basis();
    const vx = vdot(car.v, f);

    // in the air: steering does nothing; use throttle and brake to pitch the
    // car parallel to whatever it will land on
    if (!car.grounded && car.airTime > 0.05) {
      // a car resting on its back or side reads as airborne; give up on it
      this.stuck = sp < 1 ? this.stuck + dt : 0;
      const hit = car.world.raycast(car.p, [0, -1, 0], 150, {});
      const n = hit && hit.n[1] > 0.3 ? hit.n : [0, 1, 0];
      const noseUp = vdot(f, n);
      const pitchRate = vdot(car.w, r);
      const cmd = noseUp * 4 + pitchRate * 0.8;
      return { steer: 0, throttle: cmd < -0.05 ? clamp(-cmd * 3, 0, 1) : 0, brake: cmd > 0.05 ? clamp(cmd * 3, 0, 1) : 0, analog: true, assists: true, wantRespawn: this.stuck > 2 };
    }

    // steering: follow the line's heading and close the sideways gap, all
    // measured in the car's own frame so it works upside down in a loop too
    let j = i;
    const preview = 2 + 0.12 * sp;
    while (j < L.length - 1 && L[j].d - L[i].d < preview) j++;
    const T = L[i].t;
    const headErr = Math.atan2(vdot(T, r), vdot(T, f));
    const offset = vdot(vsub(L[i].pos, car.p), r);
    const ff = Math.atan(WHEELBASE * L[j].curv);
    const angle = ff + headErr + Math.atan((1.2 * offset) / (Math.abs(vx) + 3));
    const steer = clamp(angle / car.steerLimit(vx), -1, 1);
    const z = vdot(vsub(L[Math.min(L.length - 1, i + 3)].pos, car.p), f);

    let vt = this.plan[i];
    for (let m = i; m < Math.min(L.length, i + 6); m++) vt = Math.min(vt, this.plan[m]);
    // squeeze the throttle near the target speed and while turning hard; lift if the car slides
    let throttle = clamp((vt - sp) * 0.4 + 0.3, 0, 1) * clamp(1.6 - Math.abs(steer), 0.3, 1);
    let brake = sp > vt + 3 ? clamp((sp - vt - 3) * 0.5, 0.3, 1) * (1 - 0.6 * Math.abs(steer)) : 0;
    const beta = Math.atan2(vdot(car.v, r), Math.abs(vx) + 0.1);
    if (Math.abs(beta) > 0.18 && sp > 5) throttle = 0;
    if (sp > vt + 0.5) throttle = 0;
    // out of steering: the front tyres are at their limit, so scrub some speed
    if (Math.abs(steer) > 0.95 && sp > 8) { throttle = 0; brake = Math.max(brake, 0.25); }
    if (z < 0 && sp < 5) throttle = 1;

    const off = vdist(L[i].pos, car.p) > 12 && !L[i].gap;
    this.stuck = sp < 1 || off ? this.stuck + dt : 0;
    return { steer, throttle, brake, analog: true, assists: true, wantRespawn: this.stuck > 2 };
  }
}

// Speed the car can carry at each point of the line: lateral grip limit from
// friction plus downforce, then a backward pass for braking distances.
export function planSpeeds(line, margin = 0.66) {
  const n = line.length;
  const v = new Float64Array(n);
  const D = DOWNFORCE_PER_MASS;
  const muAt = (i) => (line[i].surf === 'air' ? 0 : (SURFACE_MU[line[i].surf] ?? SURFACE_MU.road) * margin);
  // lateral need v^2 k must fit in mu * (g * up_y + v^2 * (vcurv + D))
  for (let i = 0; i < n; i++) {
    let k = 0, kv = Infinity;
    for (let m = Math.max(0, i - 2); m <= Math.min(n - 1, i + 2); m++) {
      k = Math.max(k, Math.abs(line[m].curv));
      kv = Math.min(kv, line[m].vcurv || 0);
    }
    const mu = line[i].surf === 'air' ? SURFACE_MU.road * margin : muAt(i);
    const g = GRAVITY * Math.max(0.2, line[i].u[1]);
    let denom = k - mu * (D + kv);
    v[i] = denom <= 1e-6 ? 300 : Math.min(300, Math.sqrt((mu * g) / denom));
    if (D * v[i] * v[i] > DOWNFORCE_CAP) {
      // past the downforce cap the extra grip stops growing with speed
      denom = k - mu * kv;
      v[i] = denom <= 1e-6 ? 300 : Math.min(v[i], Math.sqrt((mu * (g + DOWNFORCE_CAP)) / denom));
    }
  }
  for (let i = n - 2; i >= 0; i--) {
    const ds = Math.max(0, line[i + 1].d - line[i].d);
    const mu = muAt(i) * 0.9;
    const a = mu * (GRAVITY + Math.min(DOWNFORCE_CAP, D * v[i + 1] * v[i + 1]));
    v[i] = Math.min(v[i], Math.sqrt(v[i + 1] * v[i + 1] + 2 * a * ds));
  }
  return v;
}
