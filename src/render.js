// Three.js scene: stadium floor, track meshes, car, ghost and cameras.
/* global THREE */

import { GRID, BLOCK } from './pieces.js';
import { FLOOR_Y } from './collision.js';
import { WHEEL_RADIUS } from './car.js';

const SKY = 0x9fc6e8;

function gridTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#5f8f4a';
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#679852';
  g.fillRect(0, 0, 64, 64);
  g.fillRect(64, 64, 64, 64);
  g.strokeStyle = 'rgba(255,255,255,0.18)';
  g.lineWidth = 2;
  g.strokeRect(1, 1, 126, 126);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(GRID, GRID);
  t.anisotropy = 8;
  return t;
}

function roadTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#e8e8e8';
  g.fillRect(0, 0, 128, 256);
  // subtle panels so speed reads well
  g.fillStyle = '#d6d6d6';
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = 'rgba(0,0,0,0.12)';
  g.fillRect(0, 0, 128, 2);
  g.fillRect(0, 128, 128, 2);
  g.fillRect(63, 0, 2, 256);
  // edge lines
  g.fillStyle = '#ffffff';
  g.fillRect(4, 0, 4, 256);
  g.fillRect(120, 0, 4, 256);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

function bufferGeometry(buf) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(buf.pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(buf.nrm, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(buf.col, 3));
  if (buf.uv) geo.setAttribute('uv', new THREE.Float32BufferAttribute(buf.uv, 2));
  geo.computeBoundingSphere();
  return geo;
}

// An open-wheel racer: narrow tub, exposed wheels, front and rear wings.
// Local axes: +z forward, +y up, +x left.
export function buildCarModel(color, ghost = false) {
  const group = new THREE.Group();
  const mat = (c) => new THREE.MeshLambertMaterial({ color: c, transparent: ghost, opacity: ghost ? 0.38 : 1, depthWrite: !ghost });
  const body = mat(color), white = mat(0xf3f4f6), dark = mat(0x1b2027), carbon = mat(0x2b313a), helmet = mat(0xffd23f);
  const box = (w, h, d, m, x, y, z, rx = 0, ry = 0) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    mesh.position.set(x, y, z);
    mesh.rotation.set(rx, ry, 0);
    group.add(mesh);
    return mesh;
  };
  // tub and nose
  box(0.78, 0.4, 2.3, body, 0, -0.02, -0.25);
  box(0.56, 0.32, 1.1, body, 0, -0.08, 1.4, 0.1);
  box(0.36, 0.22, 0.6, white, 0, -0.18, 2.15, 0.16);
  // cockpit, driver, airbox fin
  box(0.5, 0.06, 0.9, dark, 0, 0.19, 0.2);
  box(0.34, 0.3, 0.34, helmet, 0, 0.36, 0.05);
  box(0.4, 0.42, 0.8, body, 0, 0.3, -0.6, -0.15);
  box(0.06, 0.32, 0.9, white, 0, 0.52, -1.0, -0.2);
  // side pods between the wheels
  box(0.4, 0.3, 1.25, body, 0.55, -0.1, -0.1);
  box(0.4, 0.3, 1.25, body, -0.55, -0.1, -0.1);
  box(0.42, 0.06, 1.27, white, 0.55, 0.06, -0.1);
  box(0.42, 0.06, 1.27, white, -0.55, 0.06, -0.1);
  // front wing with end plates
  box(2.05, 0.05, 0.42, carbon, 0, -0.32, 2.2);
  box(1.9, 0.04, 0.2, body, 0, -0.24, 2.1, -0.25);
  box(0.04, 0.22, 0.48, carbon, 1.02, -0.26, 2.2);
  box(0.04, 0.22, 0.48, carbon, -1.02, -0.26, 2.2);
  // rear wing on struts
  box(0.06, 0.55, 0.3, carbon, 0.3, 0.3, -1.82);
  box(0.06, 0.55, 0.3, carbon, -0.3, 0.3, -1.82);
  box(1.75, 0.06, 0.5, body, 0, 0.6, -1.88, -0.12);
  box(1.75, 0.05, 0.22, white, 0, 0.72, -2.08, -0.35);
  box(0.05, 0.42, 0.66, carbon, 0.9, 0.55, -1.92);
  box(0.05, 0.42, 0.66, carbon, -0.9, 0.55, -1.92);
  // diffuser
  box(1.0, 0.16, 0.4, carbon, 0, -0.26, -1.65, 0.3);

  const wheels = [];
  const tyreGeo = new THREE.CylinderGeometry(WHEEL_RADIUS, WHEEL_RADIUS, 0.42, 18);
  tyreGeo.rotateZ(Math.PI / 2);
  const rimGeo = new THREE.CylinderGeometry(WHEEL_RADIUS * 0.62, WHEEL_RADIUS * 0.62, 0.44, 12);
  rimGeo.rotateZ(Math.PI / 2);
  const spokeGeo = new THREE.BoxGeometry(0.45, 0.08, WHEEL_RADIUS * 1.15);
  const rimMat = mat(0xb9c0c9);
  const positions = [[0.86, -0.22, 1.38], [-0.86, -0.22, 1.38], [0.88, -0.22, -1.32], [-0.88, -0.22, -1.32]];
  for (const p of positions) {
    const pivot = new THREE.Group();
    pivot.position.set(p[0], p[1], p[2]);
    const spin = new THREE.Group();
    spin.add(new THREE.Mesh(tyreGeo, dark));
    spin.add(new THREE.Mesh(rimGeo, rimMat));
    spin.add(new THREE.Mesh(spokeGeo, carbon));
    pivot.add(spin);
    group.add(pivot);
    wheels.push({ pivot, spin, base: p[1] });
    // suspension arms from the tub to the wheel hub
    const arm = new THREE.Mesh(new THREE.BoxGeometry(Math.abs(p[0]) - 0.3, 0.04, 0.06), carbon);
    arm.position.set(p[0] / 2 + Math.sign(p[0]) * 0.1, -0.12, p[2]);
    group.add(arm);
  }
  group.userData.wheels = wheels;
  return group;
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.gl.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(SKY);
    this.scene.fog = new THREE.Fog(SKY, 400, 1900);
    this.camera = new THREE.PerspectiveCamera(70, 1, 0.3, 4000);
    this.scene.add(new THREE.HemisphereLight(0xdfefff, 0x4a5a3a, 0.75));
    const sun = new THREE.DirectionalLight(0xfff4e0, 0.75);
    sun.position.set(0.5, 1, 0.3);
    this.scene.add(sun);

    const size = GRID * BLOCK;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshLambertMaterial({ map: gridTexture() }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(size / 2, FLOOR_Y, size / 2);
    this.scene.add(floor);
    const outer = new THREE.Mesh(new THREE.PlaneGeometry(size * 5, size * 5), new THREE.MeshLambertMaterial({ color: 0x4d6e3e }));
    outer.rotation.x = -Math.PI / 2;
    outer.position.set(size / 2, FLOOR_Y - 0.4, size / 2);
    this.scene.add(outer);
    // stadium stands: simple boxes around the edge
    const standMat = new THREE.MeshLambertMaterial({ color: 0x7a8494 });
    for (let k = 0; k < 4; k++) {
      const stand = new THREE.Mesh(new THREE.BoxGeometry(size + 80, 24, 30), standMat);
      const off = size / 2 + 25;
      stand.position.set(size / 2 + (k === 1 ? off : k === 3 ? -off : 0), 12, size / 2 + (k === 0 ? off : k === 2 ? -off : 0));
      if (k % 2) stand.rotation.y = Math.PI / 2;
      this.scene.add(stand);
    }

    this.roadMat = new THREE.MeshLambertMaterial({ vertexColors: true, map: roadTexture(), side: THREE.DoubleSide });
    this.solidMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    this.decalMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.trackGroup = new THREE.Group();
    this.scene.add(this.trackGroup);

    this.car = buildCarModel(0xff5a1f);
    this.scene.add(this.car);
    this.ghost = buildCarModel(0xbfe3ff, true);
    this.ghost.visible = false;
    this.scene.add(this.ghost);
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(1.9, 20), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.32, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
    shadow.scale.set(0.75, 1.2, 1);
    this.shadow = shadow;
    this.scene.add(shadow);

    this.camMode = 0;
    this.camPos = new THREE.Vector3();
    this.camUp = new THREE.Vector3(0, 1, 0);
    this.camFwd = new THREE.Vector3(0, 0, 1);
    this.camInit = false;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth, h = this.canvas.clientHeight || window.innerHeight;
    this.gl.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  setTrack(built) {
    for (const m of [...this.trackGroup.children]) { m.geometry.dispose(); this.trackGroup.remove(m); }
    const { surface, solid, decal } = built.render;
    if (surface.pos.length) this.trackGroup.add(new THREE.Mesh(bufferGeometry(surface), this.roadMat));
    if (solid.pos.length) this.trackGroup.add(new THREE.Mesh(bufferGeometry(solid), this.solidMat));
    if (decal.pos.length) this.trackGroup.add(new THREE.Mesh(bufferGeometry(decal), this.decalMat));
    this.camInit = false;
  }

  // p, q are interpolated physics state; car carries wheel info
  updateCar(p, q, car, world) {
    this.car.position.set(p[0], p[1], p[2]);
    this.car.quaternion.set(q[0], q[1], q[2], q[3]);
    const wheels = this.car.userData.wheels;
    for (let i = 0; i < 4; i++) {
      const w = car.wheels[i];
      const comp = w.contact ? Math.min(w.comp, 0.36) : 0;
      wheels[i].pivot.position.y = wheels[i].base - (0.42 - comp);
      wheels[i].pivot.rotation.y = i < 2 ? -car.steer * 0.42 : 0;
      wheels[i].spin.rotation.x = w.spin;
    }
    // blob shadow on whatever is below
    const hit = world.raycast(p, [0, -1, 0], 200, {});
    if (hit) {
      const n = new THREE.Vector3(...hit.n);
      this.shadow.visible = true;
      this.shadow.position.set(p[0], p[1] - hit.t + 0.06, p[2]);
      this.shadow.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
      const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(this.car.quaternion);
      const yaw = Math.atan2(fwd.x, fwd.z);
      this.shadow.rotateZ(-yaw);
      const s = Math.max(0.3, 1 - hit.t / 40);
      this.shadow.material.opacity = 0.32 * s;
    } else this.shadow.visible = false;
  }

  updateGhost(state) {
    if (!state) { this.ghost.visible = false; return; }
    this.ghost.visible = true;
    this.ghost.position.set(state.p[0], state.p[1], state.p[2]);
    this.ghost.quaternion.set(state.q[0], state.q[1], state.q[2], state.q[3]);
  }

  // Chase cameras. mode 0: chase, 1: far chase, 2: bumper
  // groundUp: the road normal under the car, or world up when airborne
  updateCamera(p, q, v, dt, snap = false, groundUp = [0, 1, 0]) {
    const quat = new THREE.Quaternion(q[0], q[1], q[2], q[3]);
    const F = new THREE.Vector3(0, 0, 1).applyQuaternion(quat);
    const U = new THREE.Vector3(groundUp[0], groundUp[1], groundUp[2]).normalize();
    const vel = new THREE.Vector3(v[0], v[1], v[2]);
    const speed = vel.length();
    const pos = new THREE.Vector3(p[0], p[1], p[2]);
    if (!this.camInit || snap) {
      this.camFwd.copy(F); this.camUp.copy(U); this.camInit = true;
    }
    // follow heading, leaning toward travel direction when sliding
    const want = F.clone();
    if (speed > 8) want.lerp(vel.clone().normalize(), 0.35).normalize();
    const k = 1 - Math.exp(-dt * (this.camMode === 2 ? 20 : 7));
    this.camFwd.lerp(want, snap ? 1 : k).normalize();
    this.camUp.lerp(U, snap ? 1 : 1 - Math.exp(-dt * 5)).normalize();
    // keep the view direction perpendicular-ish to up so the horizon stays put
    if (Math.abs(this.camFwd.dot(this.camUp)) > 0.8) this.camFwd.addScaledVector(this.camUp, -this.camFwd.dot(this.camUp) * 0.5).normalize();
    const modes = [
      { back: 7.2, up: 2.4, look: 4, lookUp: 1.1, fov: 70 },
      { back: 12, up: 4.2, look: 6, lookUp: 1.2, fov: 66 },
      { back: -0.6, up: 0.75, look: 20, lookUp: 0.6, fov: 78 },
    ];
    const m = modes[this.camMode];
    const target = pos.clone().addScaledVector(this.camFwd, -m.back).addScaledVector(this.camUp, m.up);
    if (this.camMode === 2) this.camPos.copy(target);
    else this.camPos.lerp(target, snap ? 1 : 1 - Math.exp(-dt * 14));
    this.camera.position.copy(this.camPos);
    this.camera.up.copy(this.camUp);
    this.camera.lookAt(pos.clone().addScaledVector(this.camFwd, m.look).addScaledVector(this.camUp, m.lookUp));
    const fov = m.fov + Math.min(16, speed * 0.07);
    if (Math.abs(this.camera.fov - fov) > 0.05) { this.camera.fov += (fov - this.camera.fov) * Math.min(1, dt * 3); this.camera.updateProjectionMatrix(); }
    this.car.visible = this.camMode !== 2;
  }

  render() { this.gl.render(this.scene, this.camera); }
}
