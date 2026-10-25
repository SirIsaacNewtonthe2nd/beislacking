// Visual effects that make speed and grip readable: skid marks, tyre smoke
// and dust, sparks, a boost flame and speed lines. Also reports the moments
// worth a sound or a camera shake (landings, wall hits, boosts).
/* global THREE */

import { SURF } from './pieces.js';

const MAX_MARKS = 1800;      // skid mark segments kept on the road
const MAX_PUFFS = 110;       // smoke / dust sprites
const MAX_SPARKS = 240;
const SPEED_LINES = 70;
const MARK_HALF = 0.17;      // half tyre width, m

const PUFF_COLOR = { [SURF.road]: 0xe9ecef, [SURF.dirt]: 0xa0764c, [SURF.grass]: 0x7d9656, [SURF.ice]: 0xe8f6ff, [SURF.plastic]: 0xdde3ea };

function puffTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,0.9)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.35)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export class Effects {
  constructor(scene, camera, carModel) {
    this.scene = scene;
    this.camera = camera;

    // skid marks: a ring buffer of quads laid on the road
    const mg = new THREE.BufferGeometry();
    this.markPos = new Float32Array(MAX_MARKS * 4 * 3);
    const idx = new Uint32Array(MAX_MARKS * 6);
    for (let i = 0; i < MAX_MARKS; i++) idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 1, i * 4 + 3, i * 4 + 2], i * 6);
    mg.setAttribute('position', new THREE.BufferAttribute(this.markPos, 3));
    mg.setIndex(new THREE.BufferAttribute(idx, 1));
    mg.setDrawRange(0, 0);
    this.marks = new THREE.Mesh(mg, new THREE.MeshBasicMaterial({ color: 0x16181c, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
    this.marks.frustumCulled = false;
    scene.add(this.marks);
    this.markNext = 0;
    this.markCount = 0;
    this.wheelPrev = [null, null, null, null];

    // smoke and dust
    const tex = puffTexture();
    this.puffs = [];
    for (let i = 0; i < MAX_PUFFS; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0 }));
      sp.visible = false;
      scene.add(sp);
      this.puffs.push({ sp, life: 0, max: 1, v: [0, 0, 0], size: 1, grow: 1, alpha: 0.5 });
    }
    this.puffNext = 0;
    this.puffAcc = [0, 0, 0, 0];

    // sparks: additive points that fade to black
    const sg = new THREE.BufferGeometry();
    this.sparkPos = new Float32Array(MAX_SPARKS * 3);
    this.sparkCol = new Float32Array(MAX_SPARKS * 3);
    sg.setAttribute('position', new THREE.BufferAttribute(this.sparkPos, 3));
    sg.setAttribute('color', new THREE.BufferAttribute(this.sparkCol, 3));
    this.sparks = new THREE.Points(sg, new THREE.PointsMaterial({ size: 0.22, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.sparks.frustumCulled = false;
    scene.add(this.sparks);
    this.sparkData = Array.from({ length: MAX_SPARKS }, () => ({ life: 0, max: 1, v: [0, 0, 0] }));
    this.sparkNext = 0;

    // boost flame behind the diffuser
    const flameGeo = new THREE.ConeGeometry(0.3, 1.6, 10, 1, true);
    flameGeo.rotateX(-Math.PI / 2);
    flameGeo.translate(0, 0, -0.8);
    this.flame = new THREE.Mesh(flameGeo, new THREE.MeshBasicMaterial({ color: 0xff9a2e, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.flame.position.set(0, -0.05, -1.85);
    this.flame.visible = false;
    carModel.add(this.flame);
    const core = new THREE.Mesh(flameGeo, new THREE.MeshBasicMaterial({ color: 0xfff1b0, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
    core.scale.set(0.45, 0.45, 0.7);
    this.flame.add(core);

    // speed lines live in camera space
    const lg = new THREE.BufferGeometry();
    this.linePos = new Float32Array(SPEED_LINES * 2 * 3);
    lg.setAttribute('position', new THREE.BufferAttribute(this.linePos, 3));
    this.lines = new THREE.LineSegments(lg, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }));
    this.lines.frustumCulled = false;
    camera.add(this.lines);
    this.lineData = Array.from({ length: SPEED_LINES }, () => this.newLine({}, true));

    this.prevAir = 0;
    this.prevWall = 0;
    this.prevBoost = 0;
    this.tmp = new THREE.Vector3();
  }

  newLine(l, anywhere = false) {
    const a = Math.random() * Math.PI * 2, r = 2.2 + Math.random() * 5;
    l.x = Math.cos(a) * r * 1.4;
    l.y = Math.sin(a) * r * 0.8;
    l.z = anywhere ? -4 - Math.random() * 70 : -60 - Math.random() * 14;
    return l;
  }

  clear() {
    this.markCount = 0;
    this.markNext = 0;
    this.marks.geometry.setDrawRange(0, 0);
    this.wheelPrev = [null, null, null, null];
    for (const p of this.puffs) { p.life = 0; p.sp.visible = false; }
    for (const s of this.sparkData) s.life = 0;
    this.sparkCol.fill(0);
    this.sparks.geometry.attributes.color.needsUpdate = true;
    this.prevAir = 0;
    this.lines.visible = false;
    this.flame.visible = false;
  }

  addMark(a, b, n) {
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    // side vector = dir x n
    let sx = dy * n[2] - dz * n[1], sy = dz * n[0] - dx * n[2], sz = dx * n[1] - dy * n[0];
    const l = Math.hypot(sx, sy, sz) || 1;
    sx *= MARK_HALF / l; sy *= MARK_HALF / l; sz *= MARK_HALF / l;
    const o = this.markNext * 12, P = this.markPos, lift = 0.025;
    const ax = a[0] + n[0] * lift, ay = a[1] + n[1] * lift, az = a[2] + n[2] * lift;
    const bx = b[0] + n[0] * lift, by = b[1] + n[1] * lift, bz = b[2] + n[2] * lift;
    P[o] = ax - sx; P[o + 1] = ay - sy; P[o + 2] = az - sz;
    P[o + 3] = ax + sx; P[o + 4] = ay + sy; P[o + 5] = az + sz;
    P[o + 6] = bx - sx; P[o + 7] = by - sy; P[o + 8] = bz - sz;
    P[o + 9] = bx + sx; P[o + 10] = by + sy; P[o + 11] = bz + sz;
    this.markNext = (this.markNext + 1) % MAX_MARKS;
    this.markCount = Math.min(MAX_MARKS, this.markCount + 1);
    this.marksDirty = true;
  }

  puff(pos, vel, color, size, life, alpha) {
    const p = this.puffs[this.puffNext];
    this.puffNext = (this.puffNext + 1) % MAX_PUFFS;
    p.sp.position.set(pos[0], pos[1], pos[2]);
    p.sp.material.color.setHex(color);
    p.v = vel;
    p.life = p.max = life;
    p.size = size;
    p.grow = size * 2.2;
    p.alpha = alpha;
    p.sp.visible = true;
  }

  spark(pos, vel) {
    const i = this.sparkNext;
    this.sparkNext = (i + 1) % MAX_SPARKS;
    const s = this.sparkData[i];
    s.life = s.max = 0.25 + Math.random() * 0.35;
    s.v = vel;
    this.sparkPos.set(pos, i * 3);
  }

  // Call once per rendered frame. Returns what happened, for sound and camera.
  update(dt, car, snap = false) {
    const ev = { landed: 0, air: 0, wallHit: 0, boostStart: false, sliding: 0 };
    if (snap) { this.wheelPrev = [null, null, null, null]; this.prevAir = 0; this.prevWall = car.wallHit; }
    const sp = car.speed;
    const v = car.v;

    // tyres: marks where they slide on hard surfaces, smoke or dust behind them
    for (let i = 0; i < 4; i++) {
      const w = car.wheels[i];
      if (!w.contact || !w.at || car.frozen) { this.wheelPrev[i] = null; continue; }
      const surf = w.surf;
      const loose = surf === SURF.dirt || surf === SURF.grass;
      const sliding = w.slip > 1.12 && sp > 3;
      if (sliding) ev.sliding = Math.max(ev.sliding, Math.min(1, (w.slip - 1.1) * 0.8));
      const marking = sliding && !loose && surf !== SURF.ice;
      const prev = this.wheelPrev[i];
      if (marking) {
        if (!prev) this.wheelPrev[i] = [...w.at];
        else {
          const d = Math.hypot(w.at[0] - prev[0], w.at[1] - prev[1], w.at[2] - prev[2]);
          if (d > 0.35 && d < 8) { this.addMark(prev, w.at, w.n); this.wheelPrev[i] = [...w.at]; }
          else if (d >= 8) this.wheelPrev[i] = [...w.at];
        }
      } else this.wheelPrev[i] = null;

      let rate = 0;
      if (sliding) rate = 26 * Math.min(1.5, w.slip - 1);
      if (loose && sp > 6) rate += Math.min(22, sp * 0.45);
      if (surf === SURF.ice && sp > 15 && sliding) rate *= 0.6;
      this.puffAcc[i] += rate * dt;
      while (this.puffAcc[i] >= 1) {
        this.puffAcc[i] -= 1;
        const color = PUFF_COLOR[surf] ?? PUFF_COLOR[SURF.road];
        const jitter = () => (Math.random() - 0.5) * 1.6;
        const vel = [v[0] * 0.15 + jitter() + w.n[0] * 1.2, v[1] * 0.15 + jitter() * 0.5 + w.n[1] * 1.2, v[2] * 0.15 + jitter() + w.n[2] * 1.2];
        this.puff([w.at[0] + w.n[0] * 0.3, w.at[1] + w.n[1] * 0.3, w.at[2] + w.n[2] * 0.3], vel, color, loose ? 1.4 : 1.1, loose ? 1.1 : 1.5, loose ? 0.55 : 0.42);
      }
    }
    if (this.marksDirty) {
      this.marks.geometry.attributes.position.needsUpdate = true;
      this.marks.geometry.setDrawRange(0, this.markCount * 6);
      this.marksDirty = false;
    }

    // landings
    if (!car.grounded) this.prevAir = car.airTime;
    else if (this.prevAir > 0.35) {
      ev.landed = Math.min(1, this.prevAir / 2);
      ev.air = this.prevAir;
      const at = car.p;
      for (let k = 0; k < 8 + ev.landed * 10; k++) {
        const a = Math.random() * Math.PI * 2, s = 3 + Math.random() * 4;
        this.puff([at[0], at[1] - 0.2, at[2]], [Math.cos(a) * s + v[0] * 0.2, 0.6, Math.sin(a) * s + v[2] * 0.2], PUFF_COLOR[car.wheels[0].surf] ?? PUFF_COLOR[SURF.road], 1.5, 0.9, 0.4);
      }
      this.prevAir = 0;
    } else this.prevAir = 0;

    // body hits: sparks, more for harder hits
    if (car.wallHit > this.prevWall + 0.04) {
      ev.wallHit = car.wallHit;
      const n = 10 + Math.round(car.wallHit * 40);
      for (let k = 0; k < n; k++) this.spark(car.hitAt, [v[0] * 0.5 + (Math.random() - 0.5) * 9, Math.random() * 6, v[2] * 0.5 + (Math.random() - 0.5) * 9]);
    }
    this.prevWall = car.wallHit;
    if (car.scrape > 0.6 && sp > 8 && Math.random() < 0.8) {
      for (let k = 0; k < 3; k++) this.spark(car.hitAt, [v[0] * 0.7 + (Math.random() - 0.5) * 3, Math.random() * 2.5, v[2] * 0.7 + (Math.random() - 0.5) * 3]);
    }

    // boost flame
    if (car.boost > 0 && this.prevBoost <= 0) ev.boostStart = true;
    this.prevBoost = car.boost;
    this.flame.visible = car.boost > 0;
    if (this.flame.visible) {
      const k = 0.7 + 0.3 * Math.min(1, car.boost / 1.4);
      const f = k * (0.85 + Math.random() * 0.3);
      this.flame.scale.set(k, k, f * (car.boostForce > 9000 ? 1.5 : 1));
    }

    this.stepParticles(dt);
    this.stepLines(dt, sp, car.boost > 0);
    return ev;
  }

  stepParticles(dt) {
    for (const p of this.puffs) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) { p.sp.visible = false; continue; }
      const t = 1 - p.life / p.max;
      const drag = Math.exp(-dt * 2.2);
      p.v[0] *= drag; p.v[2] *= drag; p.v[1] = p.v[1] * drag + 0.9 * dt;
      p.sp.position.x += p.v[0] * dt; p.sp.position.y += p.v[1] * dt; p.sp.position.z += p.v[2] * dt;
      const s = p.size + p.grow * t;
      p.sp.scale.set(s, s, 1);
      p.sp.material.opacity = p.alpha * (1 - t) * Math.min(1, t * 8);
    }
    const P = this.sparkPos, C = this.sparkCol;
    for (let i = 0; i < MAX_SPARKS; i++) {
      const s = this.sparkData[i];
      if (s.life <= 0) continue;
      s.life -= dt;
      const k = Math.max(0, s.life / s.max);
      s.v[1] -= 9.81 * dt;
      P[i * 3] += s.v[0] * dt; P[i * 3 + 1] += s.v[1] * dt; P[i * 3 + 2] += s.v[2] * dt;
      C[i * 3] = k; C[i * 3 + 1] = 0.75 * k * k; C[i * 3 + 2] = 0.3 * k * k * k;
    }
    this.sparks.geometry.attributes.position.needsUpdate = true;
    this.sparks.geometry.attributes.color.needsUpdate = true;
  }

  stepLines(dt, speed, boosting) {
    const strength = Math.min(1, Math.max(0, (speed - 55) / 45)) + (boosting ? 0.5 : 0);
    this.lines.material.opacity = Math.min(0.5, strength * 0.32);
    this.lines.visible = strength > 0.01;
    if (!this.lines.visible) return;
    const len = 1.5 + speed * 0.06;
    const P = this.linePos;
    for (let i = 0; i < SPEED_LINES; i++) {
      const l = this.lineData[i];
      l.z += speed * 0.9 * dt;
      if (l.z > -3) this.newLine(l);
      P.set([l.x, l.y, l.z, l.x, l.y, l.z - len], i * 6);
    }
    this.lines.geometry.attributes.position.needsUpdate = true;
  }
}
