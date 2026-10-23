// Car physics in SI units. A 750 kg rigid body on four raycast suspension
// corners, each with a spinning wheel and a combined-slip tyre model
// (Pacejka-style curve, load sensitive). Engine torque curve, automatic
// 7-speed gearbox, limited-slip rear differential, brakes with bias, wing
// downforce and body drag. Optional driver aids: ABS, traction control and
// speed-sensitive steering.

import {
  vadd, vsub, vscale, vdot, vcross, vnorm, vlen, vaddScaledi, vclone, qrot, qconj, qmul, qnorm,
  qfromBasis, clamp, approach, vrotAxis,
} from './math.js';
import { SURF } from './pieces.js';

export const GRAVITY = 9.81;
export const MAX_SPEED = 1000 / 3.6;

// ---------------------------------------------------------------- chassis
export const MASS = 700;                       // kg, with driver
const INERTIA = [900, 800, 280];               // kg m^2 about local x (pitch), y (yaw), z (roll)
const INV_I = INERTIA.map((x) => 1 / x);
export const WHEEL_RADIUS = 0.34;
export const REST = 0.3;                       // mount to wheel centre, spring unloaded
const MOUNT_Y = 0.314;                         // centre of mass ~30 cm above the road at rest
// Wide track and low centre of mass: the car can only tip once its grip (in g)
// passes track / (2 * height), here ~3.3 g, above what the tyres can give.
export const WHEELS = [
  { pos: [1.0, MOUNT_Y, 1.38], front: true, left: true },
  { pos: [-1.0, MOUNT_Y, 1.38], front: true, left: false },
  { pos: [0.98, MOUNT_Y, -1.37], front: false, left: true },
  { pos: [-0.98, MOUNT_Y, -1.37], front: false, left: false },
];
const WHEELBASE = 2.75;
const RAY = REST + WHEEL_RADIUS;
const TRAVEL = 0.13;                           // bump stop engages here
const SPRING = [58000, 72000];                 // N/m front, rear: ~3 Hz, ~2.6 cm of droop
const DAMP_BUMP = [3100, 3400];                // N s/m
const DAMP_REBOUND = [4400, 4800];
const BUMP_K = 2.0e6;
const BUMP_C = 38000;                           // close to critical for the bump stop, so it doesn't chatter
const WHEEL_INERTIA = [1.0, 1.25];             // kg m^2 incl. brake disc / driveline share

// collision spheres (local): tub, nose, wings, sidepods and the four wheels.
// Ground is at y = -0.30 at rest; the floor clears it by ~12 cm and the bump
// stops end the travel before the floor can touch.
const BODY = [
  { p: [0, 0.07, 0.7], r: 0.25 },
  { p: [0, 0.08, -0.2], r: 0.26 },
  { p: [0, 0.1, -1.0], r: 0.27 },
  { p: [0, 0.01, 1.75], r: 0.19 },
  { p: [0, 0.0, 2.3], r: 0.16 },
  { p: [0.55, 0.04, -0.1], r: 0.22 },
  { p: [-0.55, 0.04, -0.1], r: 0.22 },
  { p: [0, 0.45, -1.9], r: 0.3 },
  ...WHEELS.map((w) => ({ p: [w.pos[0], 0.14, w.pos[2]], r: 0.22 })),
];

// ---------------------------------------------------------------- powertrain
// ~900 kW peak: a high-output racing engine
const TORQUE_CURVE = [[0, 350], [3000, 510], [6000, 700], [9000, 840], [11000, 780], [12500, 660], [13200, 550]];
const IDLE = 3000, REDLINE = 12800, LAUNCH = 6500;
export const GEARS = [3.8, 4.2, 3.41, 2.77, 2.25, 1.83, 1.49, 1.24]; // [reverse, 1st..7th]
const FINAL = 3.15;                            // geared for ~410 km/h in 7th
const DRIVELINE = 0.92;
const SHIFT_TIME = 0.05;
const UPSHIFT = 12300, DOWNSHIFT = 7200;
const LSD = 0.25;                              // share of drive torque the diff can move side to side
const BRAKE_TORQUE = 5600;                     // N m per wheel at full pedal, before bias
const BRAKE_BIAS = 0.67;                       // front share

// ---------------------------------------------------------------- aero
const RHO = 1.225;
const CDA = [2.4, 3.0, 0.85];                  // body drag area along local x, y, z (m^2)
const DRAG_CENTRE = [0, 0.05, -0.35];
const WINGS = [{ p: [0, -0.25, 2.25] }, { p: [0, 0.6, -1.95] }];
export const DOWNFORCE_PER_MASS = (0.5 * RHO * 6.0) / MASS; // m/s^2 per (m/s)^2, used by the bot
// the wings stall (and the floor stops sealing) beyond ~3x the car's weight
export const DOWNFORCE_CAP = 3 * GRAVITY;                  // m/s^2

// ---------------------------------------------------------------- tyres
// Combined slip: slip ratio and slip angle are normalised by their peak values
// and fed through one Pacejka-style curve, so grip is shared between braking,
// driving and cornering.
const MF_C = 1.6, MF_E = 0.3;
const MF_B = (() => {
  const target = Math.tan(Math.PI / (2 * MF_C));
  let lo = 0.1, hi = 10;
  for (let i = 0; i < 60; i++) {
    const b = (lo + hi) / 2;
    const phi = b - MF_E * (b - Math.atan(b));
    if (phi < target) lo = b; else hi = b;
  }
  return (lo + hi) / 2;
})();
const mf = (s) => Math.sin(MF_C * Math.atan(MF_B * s - MF_E * (MF_B * s - Math.atan(MF_B * s))));
const FZ_NOM = 2500;
// Handling balance, in one place so it can be tuned (tools/handling.mjs searches it)
export const SETUP = {
  axleGrip: [1.08, 1.0],      // front tyres are the grippier compound, so the nose bites
  arb: [12000, 22000],        // anti-roll bars, N/m: soft front for front grip
  wingCla: [2.45, 3.55],      // front / rear wing downforce, ClA m^2: rear-biased for high-speed stability
};
const V_MIN = 3; // m/s: slip denominators never go below this, which keeps standstill stable

// mu: peak friction, kp / ap: slip ratio / slip angle at peak, rr: rolling resistance coefficient
const SURFACE = {
  [SURF.road]: { mu: 2.8, kp: 0.08, ap: 0.09, rr: 0.015 },
  [SURF.turbo]: { mu: 2.8, kp: 0.08, ap: 0.09, rr: 0.015 },
  [SURF.turbo2]: { mu: 2.8, kp: 0.08, ap: 0.09, rr: 0.015 },
  [SURF.noengine]: { mu: 2.8, kp: 0.08, ap: 0.09, rr: 0.015 },
  [SURF.nosteer]: { mu: 2.8, kp: 0.08, ap: 0.09, rr: 0.015 },
  [SURF.reset]: { mu: 2.8, kp: 0.08, ap: 0.09, rr: 0.015 },
  [SURF.plastic]: { mu: 2.1, kp: 0.08, ap: 0.09, rr: 0.02 },
  [SURF.dirt]: { mu: 1.35, kp: 0.2, ap: 0.2, rr: 0.04 },
  [SURF.grass]: { mu: 0.9, kp: 0.18, ap: 0.18, rr: 0.08 },
  [SURF.ice]: { mu: 0.22, kp: 0.08, ap: 0.1, rr: 0.01 },
};
export const SURFACE_MU = Object.fromEntries(Object.entries(SURF).map(([k, v]) => [k, (SURFACE[v] || SURFACE[SURF.road]).mu]));

const BOOST_TIME = 1.4;
const BOOST_FORCE = { [SURF.turbo]: 7000, [SURF.turbo2]: 12000 }; // N, a thrust on top of the engine
export const EFFECT_TIME = 4; // engine-off / no-steering last this long unless reset sooner
const SURF_NAME = Object.fromEntries(Object.entries(SURF).map(([k, v]) => [v, k]));
const LOCK = 0.52; // max road-wheel angle, rad
const MU_REF = 2.8; // road grip, used by the steering assist and stability control

export function engineTorque(rpm) {
  const c = TORQUE_CURVE;
  if (rpm <= c[0][0]) return c[0][1];
  for (let i = 1; i < c.length; i++) {
    if (rpm <= c[i][0]) {
      const t = (rpm - c[i - 1][0]) / (c[i][0] - c[i - 1][0]);
      return c[i - 1][1] + (c[i][1] - c[i - 1][1]) * t;
    }
  }
  return c[c.length - 1][1];
}

export class Car {
  constructor(world) {
    this.world = world;
    this.p = [0, 0, 0];
    this.v = [0, 0, 0];
    this.q = [0, 0, 0, 1];
    this.w = [0, 0, 0];
    this.steer = 0;          // driver input, -1..1 (right positive)
    this.steerAngle = 0;     // road-wheel angle, rad (right positive)
    this.gear = 1;
    this.rpm = IDLE;
    this.shift = 0;
    this.reverseTimer = 0;
    this.boost = 0;
    this.boostForce = 0;
    this.noEngine = 0;
    this.noSteer = 0;
    this.airTime = 0;
    this.grounded = 0;
    this.load = 1;
    this.wheels = WHEELS.map(() => ({ contact: false, comp: 0, compPrev: 0, surf: 0, n: [0, 1, 0], spin: 0, omega: 0, kind: 0, slip: 0, fz: 0 }));
    this.contacts = [];
    this.hitTmp = {};
    this.wallHit = 0;
    this.scrape = 0;
    this.surfaceName = 'road';
    this.tyreSlip = 0;       // largest normalised combined slip, for sound
    this.frozen = false;
    this.abs = false;
    this.tc = false;
  }

  place(pos, f, u) {
    const r = vnorm(vcross(f, u));
    this.p = vclone(pos);
    this.q = qfromBasis(r, u, f);
    this.v = [0, 0, 0];
    this.w = [0, 0, 0];
    this.steer = 0;
    this.steerAngle = 0;
    this.gear = 1;
    this.rpm = IDLE;
    this.shift = 0;
    this.boost = 0;
    this.noEngine = 0;
    this.noSteer = 0;
    this.airTime = 0;
    for (const w of this.wheels) { w.contact = false; w.comp = 0; w.compPrev = 0; w.omega = 0; }
  }

  getState() {
    return {
      p: vclone(this.p), v: vclone(this.v), q: [...this.q], w: vclone(this.w),
      steer: this.steer, steerAngle: this.steerAngle, gear: this.gear, rpm: this.rpm,
      boost: this.boost, boostForce: this.boostForce, noEngine: this.noEngine, noSteer: this.noSteer,
      omegas: this.wheels.map((w) => w.omega),
    };
  }
  setState(s) {
    this.p = vclone(s.p); this.v = vclone(s.v); this.q = [...s.q]; this.w = vclone(s.w);
    this.steer = s.steer; this.steerAngle = s.steerAngle || 0; this.gear = s.gear || 1; this.rpm = s.rpm || IDLE;
    this.boost = s.boost; this.boostForce = s.boostForce || 0;
    this.noEngine = s.noEngine || 0; this.noSteer = s.noSteer || 0;
    this.shift = 0;
    this.wheels.forEach((w, i) => { w.omega = s.omegas ? s.omegas[i] : 0; w.compPrev = w.comp; });
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
  worldI(w) {
    const l = qrot(qconj(this.q), w);
    return qrot(this.q, [l[0] * INERTIA[0], l[1] * INERTIA[1], l[2] * INERTIA[2]]);
  }
  // force (N) at a world point for dt seconds
  applyForce(F, at, dt) {
    const j = vscale(F, dt);
    this.v[0] += j[0] / MASS; this.v[1] += j[1] / MASS; this.v[2] += j[2] / MASS;
    const dw = this.invI(vcross(vsub(at, this.p), j));
    this.w[0] += dw[0]; this.w[1] += dw[1]; this.w[2] += dw[2];
  }
  applyImpulse(j, at) {
    this.v[0] += j[0] / MASS; this.v[1] += j[1] / MASS; this.v[2] += j[2] / MASS;
    const dw = this.invI(vcross(vsub(at, this.p), j));
    this.w[0] += dw[0]; this.w[1] += dw[1]; this.w[2] += dw[2];
  }
  applyTorque(T, dt) {
    const dw = this.invI(vscale(T, dt));
    this.w[0] += dw[0]; this.w[1] += dw[1]; this.w[2] += dw[2];
  }
  pointVel(at) {
    return vadd(this.v, vcross(this.w, vsub(at, this.p)));
  }
  // effective mass at a point along a direction
  effMass(at, n) {
    const r = vsub(at, this.p);
    const rn = vcross(r, n);
    return 1 / (1 / MASS + vdot(n, vcross(this.invI(rn), r)));
  }

  // Largest steering angle worth asking for at this speed: enough to use the
  // front tyres' peak grip, no more. Keyboard full lock then means "turn as
  // hard as the car can".
  // Uses the measured tyre load, so the limit opens up where the road presses
  // the car down (dips, banking, loops) and closes over crests.
  steerLimit(vx) {
    const v = Math.abs(vx);
    if (v < 1) return LOCK;
    const aLat = 1.1 * MU_REF * GRAVITY * Math.max(0.6, this.load);
    // extra angle for the tyres' slip, generous at low speed, tighter at high speed
    return Math.min(LOCK, Math.atan((WHEELBASE * aLat) / (v * v)) + 0.035 + 0.05 / (1 + v / 25));
  }

  step(input, dt) {
    if (this.frozen) return;
    const n = Math.max(5, Math.ceil((this.speed * dt) / 0.08));
    const h = dt / n;
    for (let i = 0; i < n; i++) this.substep(input, h);
  }

  substep(input, dt) {
    const { f, u, r } = this.basis();
    const world = this.world;
    const assists = input.assists !== false;
    this.abs = assists; this.tc = assists;

    // ---- driver inputs
    const want = this.noSteer > 0 ? 0 : clamp(input.steer || 0, -1, 1);
    if (input.analog) this.steer = want;
    else this.steer = approach(this.steer, want, (Math.abs(want) < Math.abs(this.steer) || want * this.steer < 0 ? 16 : 12) * dt);
    const vxCar = vdot(this.v, f);
    const limit = assists ? this.steerLimit(vxCar) : LOCK;
    // the rack moves at a finite rate
    this.steerAngle = approach(this.steerAngle, this.steer * limit, 7 * dt);

    let gas = this.noEngine > 0 ? 0 : clamp(input.throttle || 0, 0, 1);
    let pedal = clamp(input.brake || 0, 0, 1);

    // ---- automatic gearbox, including reverse
    const speedFwd = vxCar;
    if (this.gear > 0 && speedFwd < 0.8 && pedal > 0 && gas === 0) {
      this.reverseTimer += dt;
      if (this.reverseTimer > 0.25) { this.gear = -1; this.reverseTimer = 0; }
    } else if (this.gear < 0 && speedFwd > -0.8 && gas > 0 && pedal === 0) {
      this.reverseTimer += dt;
      if (this.reverseTimer > 0.25) { this.gear = 1; this.reverseTimer = 0; }
    } else this.reverseTimer = 0;
    if (this.gear < 0) { const t = gas; gas = pedal; pedal = t; }

    // ---- suspension: find contacts and vertical loads
    const down = vscale(u, -1);
    const corner = [];
    let grounded = 0;
    for (let i = 0; i < 4; i++) {
      const wd = this.wheels[i];
      const def = WHEELS[i];
      const mount = vadd(this.p, qrot(this.q, def.pos));
      const hit = world.raycast(mount, down, RAY + 0.25, this.hitTmp);
      if (hit && hit.t <= RAY) {
        const x = RAY - hit.t;
        corner.push({ i, mount, x, n: hit.n, surf: hit.surf, kind: hit.kind, at: vaddScaled3(mount, down, hit.t) });
        wd.contact = true; wd.comp = x; wd.surf = hit.surf; wd.n = hit.n; wd.kind = hit.kind;
        grounded++;
      } else {
        wd.contact = false; wd.comp = 0; wd.fz = 0;
        corner.push(null);
      }
    }
    this.grounded = grounded;

    // anti-roll bars push down the more compressed side
    const arb = [0, 0, 0, 0];
    for (const [a, b, k] of [[0, 1, SETUP.arb[0]], [2, 3, SETUP.arb[1]]]) {
      if (corner[a] && corner[b]) {
        const d = (corner[a].x - corner[b].x) * k;
        arb[a] = d; arb[b] = -d;
      }
    }

    // ---- powertrain torque at the rear axle
    const rear = (this.wheels[2].omega + this.wheels[3].omega) / 2;
    const ratio = GEARS[this.gear < 0 ? 0 : this.gear] * FINAL * (this.gear < 0 ? -1 : 1);
    let rpm = Math.abs(rear * ratio) * 60 / (2 * Math.PI);
    const slipping = rpm < LAUNCH && this.gear !== 0;
    if (slipping) rpm = Math.max(rpm, IDLE + (LAUNCH - IDLE) * gas);
    this.shift = Math.max(0, this.shift - dt);
    let crank = gas * engineTorque(rpm) - (1 - gas) * (25 + rpm * 0.006);
    if (rpm > REDLINE) crank = Math.min(crank, 0);
    if (this.shift > 0) crank = 0;
    if (slipping && gas === 0) crank = 0; // clutch open
    this.rpm += (rpm - this.rpm) * Math.min(1, dt * 30);
    if (this.gear > 0 && this.shift === 0 && grounded) {
      // shift on road speed too, so locked or spinning wheels can't fool the box
      const rpmRoad = (Math.abs(speedFwd) / WHEEL_RADIUS) * Math.abs(ratio) * 60 / (2 * Math.PI);
      const hi = Math.max(rpm, rpmRoad);
      if (hi > UPSHIFT && this.gear < 7 && rpmRoad > UPSHIFT * 0.7) { this.gear++; this.shift = SHIFT_TIME; }
      else if (this.gear > 1 && hi < DOWNSHIFT && (hi * GEARS[this.gear - 1]) / GEARS[this.gear] < UPSHIFT - 600) { this.gear--; this.shift = SHIFT_TIME; }
    }
    let drive = crank * ratio * DRIVELINE; // at the axle
    // traction / stability control: trim torque when the rear tyres pass their
    // peak (wheelspin or a sliding rear), or when the car starts to yaw away
    if (this.tc && gas > 0 && drive * Math.sign(ratio) > 0) {
      const spin = Math.max(this.wheels[2].slip, this.wheels[3].slip);
      let cut = clamp(1 - (spin - 1.0) / 0.6, 0, 1);
      const vl = vdot(this.v, r), vf = vdot(this.v, f);
      if (Math.abs(vf) > 5) cut = Math.min(cut, clamp(1 - (Math.abs(Math.atan2(vl, Math.abs(vf))) - 0.15) / 0.15, 0, 1));
      drive *= cut;
    }
    // engine-braking control: slip the clutch rather than lock the rear tyres
    if (this.tc && drive * Math.sign(ratio) < 0) {
      const lockR = Math.max(this.wheels[2].slip, this.wheels[3].slip);
      drive *= clamp(1 - (lockR - 0.9) / 0.4, 0, 1);
    }
    // limited-slip differential: equal split, plus a locking share toward the slower wheel
    const dOm = this.wheels[2].omega - this.wheels[3].omega;
    const lock = clamp(dOm * 60, -1, 1) * LSD * Math.abs(drive) * 0.5;
    const driveT = [0, 0, drive / 2 - lock, drive / 2 + lock];

    const bodySlip = Math.abs(vxCar) > 5 ? Math.abs(Math.atan2(vdot(this.v, r), Math.abs(vxCar))) : 0;

    // stability control: compare the yaw rate with what the steering asks for
    // and brake one front wheel to pull the car back in line
    const escT = [0, 0, 0, 0];
    if (assists && vxCar > 8 && grounded >= 3) {
      const yaw = vdot(this.w, u); // left positive
      const lim = (1.1 * MU_REF * GRAVITY * Math.max(0.6, this.load)) / vxCar;
      const ref = clamp((vxCar * Math.tan(-this.steerAngle)) / WHEELBASE, -lim, lim);
      const dead = 0.1 + 0.3 * Math.abs(ref);
      const over = Math.abs(yaw) - Math.abs(ref) - dead; // rotating more than asked (or the wrong way)
      const wrongWay = yaw * ref < 0 && Math.abs(yaw) > dead;
      if (over > 0 || wrongWay) {
        const e = wrongWay ? Math.abs(yaw) : over;
        const T = clamp(e * 12000, 0, 5000);
        if (yaw > 0) escT[1] = T; else escT[0] = T; // spinning left: brake the right front, and vice versa
        drive *= clamp(1 - e * 3, 0, 1);
      } else if (Math.abs(ref) - Math.abs(yaw) > dead) {
        drive *= clamp(1 - (Math.abs(ref) - Math.abs(yaw) - dead) * 2, 0.3, 1); // pushing wide: ease the power
      }
      driveT[2] = drive / 2 - lock; driveT[3] = drive / 2 + lock;
    }

    // ---- per-wheel: suspension force, tyre forces, wheel spin
    let load = 0, maxSlip = 0;
    const surfCount = {};
    let axleTorque = 0; // torque that went into spinning the wheels up or down
    for (let i = 0; i < 4; i++) {
      const wd = this.wheels[i];
      const def = WHEELS[i];
      const ax = def.front ? 0 : 1;
      const brakeT = pedal * BRAKE_TORQUE * 2 * (def.front ? BRAKE_BIAS : 1 - BRAKE_BIAS) + escT[i];
      const Iw = WHEEL_INERTIA[ax];
      const c = corner[i];
      if (!c) {
        // free wheel: drive and brake act on it alone; the reaction turns the body
        let om = wd.omega + (driveT[i] / Iw) * dt;
        om = brakeTo(om, (brakeT / Iw) * dt);
        axleTorque += ((om - wd.omega) * Iw) / dt;
        wd.omega = om;
        wd.slip = 0;
        wd.spin += wd.omega * dt;
        continue;
      }
      const n = c.n;
      const vm = this.pointVel(c.mount);
      const xdot = -vdot(vm, n);
      const kSpring = SPRING[ax];
      let Fz = kSpring * c.x + (xdot > 0 ? DAMP_BUMP[ax] : DAMP_REBOUND[ax]) * xdot + arb[i];
      if (c.x > TRAVEL) Fz += BUMP_K * (c.x - TRAVEL) + BUMP_C * xdot;
      Fz = Math.max(0, Fz);
      this.applyForce(vscale(n, Fz), c.at, dt);
      if (c.x > TRAVEL + 0.03) {
        // rigid stop: no more travel, so that corner can't keep closing in
        const vn = -vdot(this.pointVel(c.mount), n);
        if (vn > 0) this.applyImpulse(vscale(n, vn * this.effMass(c.mount, n)), c.mount);
      }
      wd.fz = Fz;
      load += Fz;
      surfCount[c.surf] = (surfCount[c.surf] || 0) + 1;

      // wheel frame on the ground
      let fw = def.front ? vrotAxis(f, u, -this.steerAngle) : f;
      fw = vnorm(vsub(fw, vscale(n, vdot(fw, n))));
      const rw = vcross(fw, n);
      const vc = this.pointVel(c.at);
      const vx = vdot(vc, fw), vy = vdot(vc, rw);
      const S = SURFACE[c.surf] || SURFACE[SURF.road];
      const mu = S.mu * SETUP.axleGrip[ax] * clamp(1 - 0.12 * (Fz / FZ_NOM - 1), 0.62, 1.12);
      const den = Math.max(Math.abs(vx), V_MIN);
      const ta = vy / den; // tan of slip angle
      const R = WHEEL_RADIUS;
      const fx = (om) => {
        const kap = (om * R - vx) / den;
        const sx = kap / S.kp, sy = ta / Math.tan(S.ap);
        const s = Math.hypot(sx, sy);
        const k = s < 1e-6 ? MF_B * MF_C : mf(s) / s;
        return [mu * Fz * k * sx, -mu * Fz * k * sy, s];
      };

      // ABS: release a wheel's brake as it passes peak slip, so it keeps turning;
      // stability control also eases the rear brakes once the car starts to slide
      let bT = brakeT;
      if (this.abs && bT > 0) {
        const kap = (wd.omega * R - vx) / den;
        // the rear runs a little under peak slip so it keeps some side grip
        const edge = def.front ? 1.25 : 1.0;
        bT *= clamp((kap / S.kp + edge) / 0.25, 0, 1);
        if (!def.front) bT *= clamp(1 - (bodySlip - 0.08) / 0.12, 0, 1);
      }
      // implicit update of wheel speed against the tyre's longitudinal force
      const om0 = wd.omega;
      const [Fx0] = fx(om0);
      const eps = 0.05;
      const dFdom = Math.max(0, (fx(om0 + eps)[0] - fx(om0 - eps)[0]) / (2 * eps));
      let om1 = om0 + (dt * (driveT[i] - Fx0 * R)) / (Iw + dt * R * dFdom);
      om1 = brakeTo(om1, (bT / Iw) * dt, om0);
      const [Fx, Fy, s] = fx(om1);
      // the tyre force at the contact patch already carries the drive/brake
      // torque's effect on the chassis; only the wheel's own spin-up is extra
      axleTorque += ((om1 - om0) * Iw) / dt;
      wd.fx = Fx; wd.fy = Fy;
      wd.omega = om1;
      wd.slip = s;
      maxSlip = Math.max(maxSlip, s);
      // rolling resistance
      const rr = -S.rr * Fz * clamp(vx / 0.5, -1, 1);
      this.applyForce(vadd(vscale(fw, Fx + rr), vscale(rw, Fy)), c.at, dt);
      wd.spin += wd.omega * dt;
    }
    this.tyreSlip = maxSlip;
    this.load += (clamp(load / (MASS * GRAVITY), 0, 3) - this.load) * Math.min(1, dt * 25);
    // the chassis feels the opposite of every drive and brake torque: squat and
    // dive on the ground, and in the air throttle lifts the nose, brake drops it
    if (axleTorque) this.applyTorque(vscale(qrot(this.q, [1, 0, 0]), -axleTorque), dt);

    let surf = SURF.road, best = 0;
    for (const k in surfCount) if (surfCount[k] > best) { best = surfCount[k]; surf = +k; }
    this.surfaceName = grounded ? SURF_NAME[surf] : 'air';

    // ---- pads
    for (const wd of this.wheels) {
      if (!wd.contact) continue;
      if (BOOST_FORCE[wd.surf]) { this.boost = BOOST_TIME; this.boostForce = Math.max(this.boost > 0 ? this.boostForce : 0, BOOST_FORCE[wd.surf]); }
      else if (wd.surf === SURF.noengine) this.noEngine = EFFECT_TIME;
      else if (wd.surf === SURF.nosteer) this.noSteer = EFFECT_TIME;
      else if (wd.surf === SURF.reset) { this.noEngine = 0; this.noSteer = 0; }
    }
    this.noEngine = Math.max(0, this.noEngine - dt);
    this.noSteer = Math.max(0, this.noSteer - dt);
    if (this.boost > 0) {
      if (grounded) this.applyForce(vscale(f, this.boostForce * (0.4 + 0.6 * this.boost / BOOST_TIME)), this.p, dt);
      this.boost = Math.max(0, this.boost - dt);
      if (this.boost === 0) this.boostForce = 0;
    }

    // ---- aerodynamics
    const vl = qrot(qconj(this.q), this.v); // car-frame velocity
    const sp = vlen(this.v);
    if (sp > 0.5) {
      const dragL = [-0.5 * RHO * CDA[0] * sp * vl[0], -0.5 * RHO * CDA[1] * sp * vl[1], -0.5 * RHO * CDA[2] * sp * vl[2]];
      this.applyForce(qrot(this.q, dragL), vadd(this.p, qrot(this.q, DRAG_CENTRE)), dt);
      const vfwd = Math.max(0, vl[2]);
      const total = 0.5 * RHO * (SETUP.wingCla[0] + SETUP.wingCla[1]) * vfwd * vfwd;
      const stall = total > 0 ? Math.min(1, (DOWNFORCE_CAP * MASS) / total) : 1;
      WINGS.forEach((wg, k) => this.applyForce(vscale(u, -0.5 * RHO * SETUP.wingCla[k] * vfwd * vfwd * stall), vadd(this.p, qrot(this.q, wg.p)), dt));
    }

    // ---- gravity, integration
    this.v[1] -= GRAVITY * dt;
    if (grounded) this.airTime = 0; else this.airTime += dt;
    const spd = vlen(this.v);
    if (spd > MAX_SPEED) this.v = vscale(this.v, MAX_SPEED / spd);
    vaddScaledi(this.p, this.v, dt);
    // rotate, conserving angular momentum: as the body turns its world-space
    // inertia changes, which is what makes a tumbling car wobble and precess
    const wl = vlen(this.w);
    if (wl > 1e-9) {
      const L = this.worldI(this.w);
      const ang = wl * dt;
      const axv = vscale(this.w, 1 / wl);
      const s2 = Math.sin(ang / 2);
      this.q = qnorm(qmul([axv[0] * s2, axv[1] * s2, axv[2] * s2, Math.cos(ang / 2)], this.q));
      this.w = this.invI(L);
    }
    if (wl > 15) this.w = vscale(this.w, 15 / wl);

    this.collideBody(dt);
  }

  collideBody(dt) {
    this.wallHit = Math.max(0, this.wallHit - dt);
    this.scrape = Math.max(0, this.scrape - dt * 4);
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
          const e = wall ? 0.2 : 0.05;
          const mu = wall ? 0.45 : 0.5; // carbon on concrete / plank on asphalt
          const jn = -(1 + e) * vn * this.effMass(at, n);
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
          if (!wall) this.scrape = 1;
        }
      }
    }
  }
}

function vaddScaled3(a, b, s) { return [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s]; }

// Apply a brake as friction: slow the wheel toward zero by at most `amount`
// (rad/s), never past zero. `ref` is the speed before other torques acted.
function brakeTo(om, amount, ref = om) {
  if (amount <= 0) return om;
  const sgn = Math.sign(om || ref);
  const mag = Math.abs(om) - amount;
  return mag > 0 ? sgn * mag : 0;
}
