// Race rules: countdown, timer, checkpoints, laps, respawns and ghost recording.

import { Car } from './car.js';
import { vadd, vsub, vscale, vdot, vaddScaled } from './math.js';

export const DT = 1 / 200;
export const COUNTDOWN = 1.6;
const GHOST_EVERY = 10; // ticks between ghost samples (20 Hz)
const SPAWN_HEIGHT = 0.42; // centre of mass above the road at rest

export class Race {
  constructor(built, world) {
    this.built = built;
    this.world = world;
    this.car = new Car(world);
    this.cps = built.gates.filter((g) => g.kind === 'cp');
    this.finishGates = built.gates.filter((g) => g.kind === 'finish');
    this.startGate = built.gates.find((g) => g.kind === 'start');
    const t = built.track;
    this.laps = t.laps > 1 && built.layout.closed ? t.laps : 1;
    this.multilap = this.laps > 1;
    this.listeners = [];
    this.reset();
  }

  on(fn) { this.listeners.push(fn); }
  emit(ev) { for (const fn of this.listeners) fn(ev); }

  reset() {
    const s = this.built.spawn;
    this.car.place(vaddScaled(s.pos, s.u, SPAWN_HEIGHT), s.f, s.u);
    this.car.frozen = true;
    this.phase = 'countdown';
    this.countdown = COUNTDOWN;
    this.time = 0;
    this.ticks = 0;
    this.taken = new Set();
    this.cpTimes = [];
    this.lap = 1;
    this.lastCP = null;
    this.respawns = 0;
    this.finishTime = null;
    this.ghost = [];
    this.topSpeed = 0;
    this.emit({ type: 'reset' });
  }

  respawn() {
    if (this.phase === 'finished') return;
    if (!this.lastCP || this.phase === 'countdown') { this.reset(); return; }
    this.car.setState(this.lastCP);
    this.respawns++;
    this.emit({ type: 'respawn' });
  }

  tick(input) {
    const car = this.car;
    if (this.phase === 'countdown') {
      this.countdown -= DT;
      if (this.countdown <= 0) {
        this.phase = 'running';
        car.frozen = false;
        this.recordGhost();
        this.emit({ type: 'go' });
      }
      return;
    }
    const prev = [...car.p];
    if (this.phase === 'finished') {
      car.step({ steer: 0, throttle: 0, brake: 0.4 }, DT);
      return;
    }
    car.step(input, DT);
    const t0 = this.time;
    this.time += DT;
    this.ticks++;
    this.topSpeed = Math.max(this.topSpeed, car.speed);
    this.checkGates(prev, car.p, t0);
    if (this.phase === 'running' && this.ticks % GHOST_EVERY === 0) this.recordGhost();
    if (car.p[1] < -40) this.respawn();
  }

  recordGhost() {
    const c = this.car;
    this.ghost.push(round(this.time, 3), round(c.p[0], 2), round(c.p[1], 2), round(c.p[2], 2), round(c.q[0], 4), round(c.q[1], 4), round(c.q[2], 4), round(c.q[3], 4));
  }

  crossing(g, a, b) {
    const a0 = vdot(vsub(a, g.pos), g.f), a1 = vdot(vsub(b, g.pos), g.f);
    if (!(a0 < 0 && a1 >= 0)) return -1;
    const al = a0 / (a0 - a1);
    const pc = vadd(a, vscale(vsub(b, a), al));
    const rel = vsub(pc, g.pos);
    const lat = vdot(rel, g.r), up = vdot(rel, g.u);
    if (Math.abs(lat) > g.halfW || up < g.lo || up > g.hi) return -1;
    return al;
  }

  checkGates(a, b, t0) {
    for (let i = 0; i < this.cps.length; i++) {
      if (this.taken.has(i)) continue;
      const al = this.crossing(this.cps[i], a, b);
      if (al < 0) continue;
      this.taken.add(i);
      const t = t0 + al * DT;
      this.cpTimes.push(t);
      this.lastCP = this.car.getState();
      this.emit({ type: 'cp', time: t, index: this.cpTimes.length - 1, count: this.taken.size, total: this.cps.length });
    }
    const allCps = this.taken.size === this.cps.length;
    if (!allCps) return;
    if (this.multilap) {
      if (!this.startGate) return;
      const al = this.crossing(this.startGate, a, b);
      if (al < 0) return;
      const t = t0 + al * DT;
      if (this.lap >= this.laps) { this.finish(t); return; }
      this.lap++;
      this.taken.clear();
      this.cpTimes.push(t);
      this.lastCP = this.car.getState();
      this.emit({ type: 'lap', time: t, index: this.cpTimes.length - 1, lap: this.lap });
      return;
    }
    for (const g of this.finishGates) {
      const al = this.crossing(g, a, b);
      if (al >= 0) { this.finish(t0 + al * DT); return; }
    }
  }

  finish(t) {
    this.phase = 'finished';
    this.finishTime = Math.round(t * 1000) / 1000;
    this.recordGhost();
    this.emit({ type: 'finish', time: this.finishTime, cpTimes: this.cpTimes.map((x) => Math.round(x * 1000) / 1000), respawns: this.respawns });
  }
}

function round(x, d) {
  const m = 10 ** d;
  return Math.round(x * m) / m;
}

// Ghost playback: samples are [t, px, py, pz, qx, qy, qz, qw] * n
export function ghostAt(samples, t, out) {
  const n = samples.length / 8;
  if (n === 0) return null;
  out = out || { p: [0, 0, 0], q: [0, 0, 0, 1] };
  let lo = 0, hi = n - 1;
  if (t <= samples[0]) lo = hi = 0;
  else if (t >= samples[(n - 1) * 8]) lo = hi = n - 1;
  else {
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (samples[mid * 8] <= t) lo = mid; else hi = mid;
    }
  }
  const a = lo * 8, b = hi * 8;
  const span = samples[b] - samples[a];
  const k = span > 1e-6 ? (t - samples[a]) / span : 0;
  for (let i = 0; i < 3; i++) out.p[i] = samples[a + 1 + i] + (samples[b + 1 + i] - samples[a + 1 + i]) * k;
  // nlerp is plenty at 20 Hz
  let dot = 0;
  for (let i = 0; i < 4; i++) dot += samples[a + 4 + i] * samples[b + 4 + i];
  const s = dot < 0 ? -1 : 1;
  let l = 0;
  for (let i = 0; i < 4; i++) { out.q[i] = samples[a + 4 + i] * (1 - k) + s * samples[b + 4 + i] * k; l += out.q[i] * out.q[i]; }
  l = Math.sqrt(l) || 1;
  for (let i = 0; i < 4; i++) out.q[i] /= l;
  return out;
}
