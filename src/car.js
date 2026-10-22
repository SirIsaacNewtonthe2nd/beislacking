// Car physics: a rigid body on four raycast springs, with an arcade tyre
// model on top (very high grip, brake-to-drift, strong boosts, air control).

import {
  vadd, vsub, vscale, vdot, vcross, vnorm, vlen, vaddScaledi, vclone, qrot, qconj, qmul, qnorm,
  qfromBasis, clamp, approach,
} from './math.js';
import { SURF } from './pieces.js';

export const GRAVITY = 16;
export const MAX_SPEED = 1000 / 3.6;

const WHEELS = [
  { pos: [0.86, -0.22, 1.38], front: true },   // front left (local +x is left)
  { pos: [-0.86, -0.22, 1.38], front: true },  // front right
  { pos: [0.88, -0.22, -1.32], front: false }, // rear left
  { pos: [-0.88, -0.22, -1.32], front: false },// rear right
];
export const WHEEL_RADIUS = 0.38;
const REST = 0.42;            // spring length at rest (mount to wheel centre)
const TRAVEL = 0.3;           // compression where the bump stop is rigid
const RAY = REST + WHEEL_RADIUS;
const K = 70, C = 5;        // spring / damper per wheel (per unit mass)
const KB = 700, CB = 18;      // bump stop
const WHEELBASE = 2.7;

const BODY = [
  { p: [0, 0.05, 1.6], r: 0.5 },
  { p: [0, 0.05, -1.6], r: 0.5 },
  { p: [0.55, 0.0, 0.85], r: 0.45 },
  { p: [-0.55, 0.0, 0.85], r: 0.45 },
  { p: [0.55, 0.0, -0.85], r: 0.45 },
  { p: [-0.55, 0.0, -0.85], r: 0.45 },
  { p: [0, 0.3, -0.15], r: 0.62 },
];
const INV_I = [1 / 2.4, 1 / 2.8, 1 / 1.3]; // local pitch (x), yaw (y), roll (z)

// Per-surface tyre behaviour
const SURFACE = {
  [SURF.road]: { grip: 1, yawGrip: 1, accel: 1, drag: 0, steer: 1, yawAcc: 1 },
  [SURF.turbo]: { grip: 1, yawGrip: 1, accel: 1, drag: 0, steer: 1, yawAcc: 1 },
  [SURF.turbo2]: { grip: 1, yawGrip: 1, accel: 1, drag: 0, steer: 1, yawAcc: 1 },
  [SURF.noengine]: { grip: 1, yawGrip: 1, accel: 1, drag: 0, steer: 1, yawAcc: 1 },
  [SURF.nosteer]: { grip: 1, yawGrip: 1, accel: 1, drag: 0, steer: 1, yawAcc: 1 },
  [SURF.reset]: { grip: 1, yawGrip: 1, accel: 1, drag: 0, steer: 1, yawAcc: 1 },
  [SURF.plastic]: { grip: 0.85, yawGrip: 0.9, accel: 0.9, drag: 0.0004, steer: 1, yawAcc: 1 },
  [SURF.dirt]: { grip: 0.66, yawGrip: 0.85, accel: 0.88, drag: 0.0011, steer: 1.05, yawAcc: 0.8, driftEasy: true },
  [SURF.grass]: { grip: 0.5, yawGrip: 0.6, accel: 0.55, drag: 0.006, steer: 0.9, yawAcc: 0.7 },
  [SURF.ice]: { grip: 0.07, yawGrip: 0.55, accel: 0.42, drag: 0, steer: 0.75, yawAcc: 0.4, ice: true },
};

export function engineAccel(vf) {
  const v = Math.max(vf, 0);
  return 17 * Math.max(0, 1 - Math.pow(v / 95, 1.6)) + 1.0;
}
const DRAG = 0.00028;
const DOWNFORCE = 0.0025;
const BRAKE = 34;
const REVERSE_MAX = 16;
const BOOST_TIME = 1.4;
export const EFFECT_TIME = 4; // engine-off / no-steering last this long unless reset sooner
const SURF_NAME = Object.fromEntries(Object.entries(SURF).map(([k, v]) => [v, k]));

export class Car {
  constructor(world) {
    this.world = world;
    this.p = [0, 0, 0];
    this.v = [0, 0, 0];
    this.q = [0, 0, 0, 1];
    this.w = [0, 0, 0];
    this.steer = 0;
    this.drift = 0;          // 0 none, -1 left, +1 right
    this.boost = 0;          // remaining boost time
    this.boostPower = 0;
    this.noEngine = 0;       // seconds of engine cut left
    this.noSteer = 0;        // seconds of locked steering left
    this.airTime = 0;
    this.load = 1;
    this.wheels = WHEELS.map(() => ({ contact: false, comp: 0, surf: 0, n: [0, 1, 0], spin: 0, kind: 0 }));
    this.prevVelDir = null;
    this.grounded = 0;
    this.contacts = [];
    this.hitTmp = {};
    this.wallHit = 0;
    this.surfaceName = 'road';
    this.slip = 0;
    this.frozen = false;
  }

  place(pos, f, u) {
    const r = vnorm(vcross(f, u));
    this.p = vclone(pos);
    this.q = qfromBasis(r, u, f);
    this.v = [0, 0, 0];
    this.w = [0, 0, 0];
    this.steer = 0;
    this.drift = 0;
    this.boost = 0;
    this.noEngine = 0;
    this.noSteer = 0;
    this.airTime = 0;
    this.prevVelDir = null;
    for (const w of this.wheels) { w.contact = false; w.comp = 0; }
  }

  getState() {
    return { p: vclone(this.p), v: vclone(this.v), q: [...this.q], w: vclone(this.w), steer: this.steer, drift: this.drift, boost: this.boost, boostPower: this.boostPower, noEngine: this.noEngine, noSteer: this.noSteer };
  }
  setState(s) {
    this.p = vclone(s.p); this.v = vclone(s.v); this.q = [...s.q]; this.w = vclone(s.w);
    this.steer = s.steer; this.drift = s.drift; this.boost = s.boost; this.boostPower = s.boostPower;
    this.noEngine = s.noEngine || 0; this.noSteer = s.noSteer || 0;
    this.prevVelDir = null;
  }

  basis() {
    const f = qrot(this.q, [0, 0, 1]);
    const u = qrot(this.q, [0, 1, 0]);
    const r = vcross(f, u);
    return { f, u, r };
  }
  get speed() { return vlen(this.v); }
  get forwardSpeed() { return vdot(this.v, qrot(this.q, [0, 0, 1])); }

  // world-space inverse inertia applied to a vector
  invI(t) {
    const l = qrot(qconj(this.q), t);
    return qrot(this.q, [l[0] * INV_I[0], l[1] * INV_I[1], l[2] * INV_I[2]]);
  }
  applyImpulse(j, at) {
    this.v[0] += j[0]; this.v[1] += j[1]; this.v[2] += j[2];
    const r = vsub(at, this.p);
    const dw = this.invI(vcross(r, j));
    this.w[0] += dw[0]; this.w[1] += dw[1]; this.w[2] += dw[2];
  }
  pointVel(at) {
    return vadd(this.v, vcross(this.w, vsub(at, this.p)));
  }
  effMass(at, n) {
    const r = vsub(at, this.p);
    const rn = vcross(r, n);
    return 1 / (1 + vdot(n, vcross(this.invI(rn), r)));
  }

  step(input, dt) {
    if (this.frozen) return;
    const n = Math.max(1, Math.ceil((this.speed * dt) / 0.45));
    const h = dt / n;
    for (let i = 0; i < n; i++) this.substep(input, h);
  }

  substep(input, dt) {
    const { f, u, r } = this.basis();
    const world = this.world;

    // steering input: fast ramp, faster return
    const target = this.noSteer > 0 ? 0 : clamp(input.steer || 0, -1, 1);
    const rate = Math.abs(target) < Math.abs(this.steer) || target * this.steer < 0 ? 9 : 6;
    this.steer = approach(this.steer, target, rate * dt);
    if (input.analog) this.steer = target;

    // --- suspension ---
    let grounded = 0, nsum = [0, 0, 0], load = 0;
    const surfCount = {};
    const down = vscale(u, -1);
    for (let i = 0; i < 4; i++) {
      const wd = this.wheels[i];
      const mount = vadd(this.p, qrot(this.q, WHEELS[i].pos));
      const hit = world.raycast(mount, down, RAY + 0.3, this.hitTmp);
      if (hit && hit.t <= RAY) {
        const x = RAY - hit.t;
        const nrm = hit.n;
        const vm = this.pointVel(mount);
        const xdot = -vdot(vm, nrm);
        let F = K * x + C * xdot;
        if (x > TRAVEL * 0.7) F += KB * (x - TRAVEL * 0.7) + CB * Math.max(0, xdot);
        F = Math.max(0, F);
        this.applyImpulse(vscale(nrm, F * dt), mount);
        // rigid stop at full travel
        if (x > TRAVEL) {
          const vn = -vdot(this.pointVel(mount), nrm);
          if (vn > 0) this.applyImpulse(vscale(nrm, vn * this.effMass(mount, nrm)), mount);
          vaddScaledi(this.p, nrm, (x - TRAVEL) * 0.3);
        }
        load += F;
        wd.contact = true; wd.comp = x; wd.surf = hit.surf; wd.n = nrm; wd.kind = hit.kind;
        grounded++;
        nsum = vadd(nsum, nrm);
        surfCount[hit.surf] = (surfCount[hit.surf] || 0) + 1;
      } else {
        wd.contact = false; wd.comp = 0;
      }
    }
    this.grounded = grounded;
    this.load += (clamp(load / GRAVITY, 0, 2) - this.load) * Math.min(1, dt * 25);

    // dominant surface under the car
    let surf = SURF.road, best = 0;
    for (const k in surfCount) if (surfCount[k] > best) { best = surfCount[k]; surf = +k; }
    const S = SURFACE[surf] || SURFACE[SURF.road];
    this.surfaceName = grounded ? SURF_NAME[surf] : 'air';

    // boosts trigger on contact and last a moment after leaving the pad
    for (const wd of this.wheels) {
      if (!wd.contact) continue;
      if (wd.surf === SURF.turbo2) { this.boost = BOOST_TIME; this.boostPower = 34; }
      else if (wd.surf === SURF.turbo) { this.boost = BOOST_TIME; if (this.boostPower < 20) this.boostPower = 20; }
      else if (wd.surf === SURF.noengine) this.noEngine = EFFECT_TIME;
      else if (wd.surf === SURF.nosteer) this.noSteer = EFFECT_TIME;
      else if (wd.surf === SURF.reset) { this.noEngine = 0; this.noSteer = 0; }
    }
    this.noEngine = Math.max(0, this.noEngine - dt);
    this.noSteer = Math.max(0, this.noSteer - dt);

    const throttle = this.noEngine > 0 ? 0 : clamp(input.throttle || 0, 0, 1);
    const brake = clamp(input.brake || 0, 0, 1);

    if (grounded > 0) {
      this.airTime = 0;
      const nn = vnorm(nsum);
      const gf = grounded / 4;
      let fg = vsub(f, vscale(nn, vdot(f, nn)));
      fg = vnorm(fg);
      const rg = vcross(fg, nn);
      let vf = vdot(this.v, fg);
      let vl = vdot(this.v, rg);
      const sp = Math.hypot(vf, vl);
      const loadF = clamp(this.load, 0, 1);

      // longitudinal
      let along = 0;
      if (throttle > 0 && !(brake > 0 && vf > 0.5)) along += engineAccel(vf) * S.accel * throttle;
      if (brake > 0) {
        if (vf > 0.5) along -= Math.min(BRAKE * brake, vf / dt);
        else if (vf > -REVERSE_MAX && throttle === 0) along -= 9 * brake;
      }
      if (throttle === 0 && brake === 0) along -= Math.sign(vf) * Math.min(Math.abs(vf) / dt, 1.2);
      if (this.boost > 0) along += this.boostPower * (0.35 + (0.65 * this.boost) / BOOST_TIME);
      along -= S.drag * vf * Math.abs(vf);
      this.v = vadd(this.v, vscale(fg, along * dt * Math.min(1, gf * 1.6)));
      // aero downforce keeps the car planted over crests
      vaddScaledi(this.v, nn, -DOWNFORCE * sp * sp * gf * dt);

      // lateral grip
      const gripBase = 40 + 0.0042 * sp * sp;
      let latMax = gripBase * S.grip * Math.min(1, gf * 1.4) * loadF;
      const slipAng = Math.atan2(vl, Math.abs(vf) + 0.5); // >0: nose left of travel
      this.slip = slipAng;

      // drift state
      const sgn = Math.sign(this.steer);
      const canDrift = input.allowDrift !== false;
      if (!this.drift && canDrift && sp > 22 && Math.abs(this.steer) > 0.25 && (brake > 0.3 || (S.driftEasy && Math.abs(this.steer) > 0.9 && throttle > 0 && sp > 26))) this.drift = sgn;
      if (this.drift) {
        const ended = sp < 12 || (sgn !== this.drift && Math.abs(this.steer) > 0.2) || (Math.abs(slipAng) < 0.05 && Math.abs(this.steer) < 0.25);
        if (ended) this.drift = 0;
      }
      if (this.drift) latMax *= 0.3;

      const dvl = clamp(-vl, -latMax * dt, latMax * dt);
      this.v = vadd(this.v, vscale(rg, dvl));

      // yaw control around the ground normal (positive = left)
      const psi = vdot(this.w, nn);
      let psiT;
      const steerMax = (0.55 / (1 + sp / 20)) * S.steer;
      const bike = (-vf * Math.tan(this.steer * steerMax)) / WHEELBASE;
      const yawLimit = ((gripBase * S.yawGrip * loadF) / Math.max(sp, 4)) * 0.97;
      if (this.drift) {
        // hold a slip angle that grows with steering, around the path's own turn rate
        const want = -this.drift * (0.28 + 0.32 * Math.abs(this.steer));
        const velDir = vnorm(vsub(this.v, vscale(nn, vdot(this.v, nn))));
        let pathRate = 0;
        if (this.prevVelDir) pathRate = Math.atan2(vdot(vcross(this.prevVelDir, velDir), nn), vdot(this.prevVelDir, velDir)) / dt;
        psiT = pathRate + 5 * (want - slipAng);
        // drifting carves the travel direction toward the nose, at a cost
        const carve = clamp(slipAng, -0.6, 0.6) * 2.0 * dt;
        const vt = vsub(this.v, vscale(nn, vdot(this.v, nn)));
        const rot = vadd(vscale(vt, Math.cos(carve)), vscale(vcross(nn, vt), Math.sin(carve)));
        this.v = vadd(vscale(nn, vdot(this.v, nn)), rot);
        this.v = vscale(this.v, 1 - Math.abs(Math.sin(slipAng)) * 0.12 * dt);
      } else if (S.ice) {
        psiT = clamp(bike, -yawLimit, yawLimit);
      } else {
        psiT = clamp(bike, -yawLimit, yawLimit);
      }
      const yawAcc = 22 * S.yawAcc * Math.min(1, gf * 2);
      const dpsi = clamp(psiT - psi, -yawAcc * dt, yawAcc * dt);
      vaddScaledi(this.w, nn, dpsi);
      {
        const velDir = vnorm(vsub(this.v, vscale(nn, vdot(this.v, nn))));
        this.prevVelDir = vlen(velDir) > 0.5 ? velDir : null;
      }
      // damp roll / pitch wobble a little on the ground
      const wn = vdot(this.w, nn);
      const wOther = vsub(this.w, vscale(nn, wn));
      this.w = vadd(vscale(nn, wn), vscale(wOther, 1 - 2.5 * dt));
    } else {
      this.airTime += dt;
      this.drift = this.airTime > 0.4 ? 0 : this.drift;
      this.prevVelDir = null;
      // air control: steer yaws the car, brake steadies its rotation
      const wy = vdot(this.w, u);
      const wantY = -this.steer * 2.0;
      vaddScaledi(this.w, u, clamp(wantY - wy, -3.5 * dt, 3.5 * dt) * (Math.abs(this.steer) > 0.05 ? 1 : 0.3));
      // level the car toward whatever surface is below it, so jumps land on four wheels
      const below = world.raycast(this.p, [0, -1, 0], 120, this.hitTmp);
      const target = below && below.n[1] > 0.3 ? below.n : [0, 1, 0];
      const axis = vcross(u, target);
      const sinA = vlen(axis);
      if (sinA > 1e-4) {
        const ang = Math.atan2(sinA, vdot(u, target));
        vaddScaledi(this.w, vscale(axis, 1 / sinA), ang * 3.2 * dt);
      }
      const wYaw = vdot(this.w, u);
      const wTilt = vsub(this.w, vscale(u, wYaw));
      const damp = 1 - (2.4 + (brake > 0 ? 3 : 0)) * dt;
      this.w = vadd(vscale(u, wYaw * (brake > 0 ? 1 - 2 * dt : 1)), vscale(wTilt, damp));
    }

    if (this.boost > 0) { this.boost = Math.max(0, this.boost - dt); if (this.boost === 0) this.boostPower = 0; }

    // gravity and air drag
    this.v[1] -= GRAVITY * dt;
    const sp = vlen(this.v);
    if (sp > 0) this.v = vscale(this.v, Math.max(0, 1 - DRAG * sp * dt));
    if (sp > MAX_SPEED) this.v = vscale(this.v, MAX_SPEED / sp);

    // integrate
    vaddScaledi(this.p, this.v, dt);
    const wl = vlen(this.w);
    if (wl > 1e-9) {
      const ang = wl * dt;
      const ax = vscale(this.w, 1 / wl);
      const s = Math.sin(ang / 2);
      this.q = qnorm(qmul([ax[0] * s, ax[1] * s, ax[2] * s, Math.cos(ang / 2)], this.q));
    }
    if (wl > 12) this.w = vscale(this.w, 12 / wl);

    this.collideBody(dt);
    for (const wd of this.wheels) wd.spin += (vdot(this.v, f) / WHEEL_RADIUS) * dt;
  }

  collideBody(dt) {
    this.wallHit = Math.max(0, this.wallHit - dt);
    for (let iter = 0; iter < 2; iter++) {
      for (const s of BODY) {
        const c = vadd(this.p, qrot(this.q, s.p));
        const contacts = this.world.sphere(c, s.r, this.contacts);
        for (const ct of contacts) {
          const n = ct.n;
          vaddScaledi(this.p, n, ct.depth * 0.6);
          const at = ct.p;
          const vrel = this.pointVel(at);
          const vn = vdot(vrel, n);
          if (vn >= 0) continue;
          const wall = ct.kind === 1;
          const e = wall ? 0.12 : 0.05;
          const mu = wall ? 0.22 : 0.3;
          const m = this.effMass(at, n);
          const jn = -(1 + e) * vn * m;
          this.applyImpulse(vscale(n, jn), at);
          const vr2 = this.pointVel(at);
          const vt = vsub(vr2, vscale(n, vdot(vr2, n)));
          const vtl = vlen(vt);
          if (vtl > 1e-6) {
            const tdir = vscale(vt, 1 / vtl);
            const jt = Math.min(vtl * this.effMass(at, tdir), mu * jn);
            this.applyImpulse(vscale(tdir, -jt), at);
          }
          if (wall && -vn > 3) this.wallHit = Math.min(1, -vn / 25);
        }
      }
    }
  }
}
