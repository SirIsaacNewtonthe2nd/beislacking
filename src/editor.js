// Track editor: chain pieces from a start block, test drive, save, share.
/* global THREE */

import { PIECES, SURFACEABLE, BLOCK, LEVEL, DIRS, cursorEntry } from './pieces.js';
import { buildTrack } from './geometry.js';
import { trackKey, fmtTime } from './storage.js';
import * as store from './storage.js';

const PALETTE = [
  ['Gates', ['CP', 'FIN', 'RING']],
  ['Road', ['S', 'T', 'T2']],
  ['Effects', ['NE', 'NS', 'RS']],
  ['Turns', ['L1', 'R1', 'L2', 'R2', 'L3', 'R3', 'BL2', 'BR2', 'BL3', 'BR3', 'WL', 'WR']],
  ['Slopes', ['U1', 'D1', 'U2', 'D2', 'US', 'DS']],
  ['Jumps and loops', ['K', 'K2', 'G', 'LOOPL', 'LOOPR']],
  ['Height', ['UP', 'DN']],
];
const SHORT = {
  CP: 'Checkpoint', FIN: 'Finish', NE: 'Engine off', NS: 'No steering', RS: 'Reset effects', RING: 'Air checkpoint', S: 'Straight', T: 'Turbo', T2: 'Super turbo',
  L1: 'Left tight', R1: 'Right tight', L2: 'Left medium', R2: 'Right medium', L3: 'Left wide', R3: 'Right wide',
  BL2: 'Banked left', BR2: 'Banked right', BL3: 'Banked left wide', BR3: 'Banked right wide', WL: 'Wall left', WR: 'Wall right',
  U1: 'Slope up', D1: 'Slope down', U2: 'Long up', D2: 'Long down', US: 'Steep up', DS: 'Steep down',
  K: 'Kicker', K2: 'Big kicker', G: 'Gap', LOOPL: 'Loop, exit left', LOOPR: 'Loop, exit right', UP: 'Raise next', DN: 'Lower next',
};

function icon(type) {
  const p = (d) => `<svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const mirror = (d) => `<g transform="translate(18 0) scale(-1 1)">${d}</g>`;
  if (type === 'S') return p('<path d="M9 16V2"/>');
  if (type === 'T' || type === 'T2') return p('<path d="M5 11l4-4 4 4M5 15l4-4 4 4"/>');
  if (type === 'CP') return p('<path d="M3 16V4h12v12"/>');
  if (type === 'NE') return p('<circle cx="9" cy="9" r="6"/><path d="M5 13l8-8"/>');
  if (type === 'NS') return p('<circle cx="9" cy="9" r="6"/><path d="M3 9h12"/>');
  if (type === 'RS') return p('<path d="M14 9a5 5 0 1 1-2-4M12 2v3h3"/>');
  if (type === 'FIN') return p('<path d="M3 16V4h12v12M3 7h12"/>');
  if (type === 'RING') return p('<rect x="3" y="3" width="12" height="12" rx="1"/>');
  if (/^[BW]?[LR]\d$/.test(type)) {
    const left = type.replace(/^[BW]/, '')[0] === 'L';
    const d = type.startsWith('W') ? '<path d="M5 16C5 9 9 4 16 4"/><path d="M8 16c0-5 3-8 8-8" opacity=".5"/>' : type.startsWith('B') ? '<path d="M5 16C5 9 9 4 16 4"/><path d="M2 16h4" />' : '<path d="M5 16C5 9 9 4 16 4"/>';
    return p(left ? mirror(d) : d);
  }
  if (type[0] === 'U') return p('<path d="M2 15h4l6-8h4"/>');
  if (type[0] === 'D') return p('<path d="M2 7h4l6 8h4"/>');
  if (type === 'K' || type === 'K2') return p('<path d="M2 15h6c3 0 5-3 6-7"/>');
  if (type === 'G') return p('<path d="M9 16v-2M9 10V8M9 4V2"/>');
  if (type.startsWith('LOOP')) return p('<path d="M3 15h5a5 5 0 1 0-1-5"/>');
  if (type === 'UP') return p('<path d="M9 15V3M4 8l5-5 5 5"/>');
  if (type === 'DN') return p('<path d="M9 3v12M4 10l5 5 5-5"/>');
  return p('<circle cx="9" cy="9" r="5"/>');
}

export class Editor {
  constructor({ renderer, onTest, onExit, onShare }) {
    this.R = renderer;
    this.onTest = onTest;
    this.onExit = onExit;
    this.onShare = onShare;
    this.el = document.getElementById('editor');
    this.track = null;
    this.sel = null;
    this.surf = 'road';
    this.walls = true;
    this.history = [];
    this.active = false;
    this.cam = { target: new THREE.Vector3(), az: 0.7, el: 0.85, dist: 300, goal: null };
    this.marker = this.makeMarker();
    this.buildPalette();
    this.bindUI();
  }

  makeMarker() {
    const g = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: 0xffc42e, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthTest: false });
    const shape = new THREE.Shape();
    shape.moveTo(-6, 0); shape.lineTo(0, 9); shape.lineTo(6, 0); shape.lineTo(2.2, 0); shape.lineTo(2.2, -8); shape.lineTo(-2.2, -8); shape.lineTo(-2.2, 0); shape.closePath();
    const arrow = new THREE.Mesh(new THREE.ShapeGeometry(shape), mat);
    arrow.rotation.x = -Math.PI / 2; // shape +y -> world -z... fixed by group yaw below
    arrow.rotation.z = Math.PI;
    arrow.position.y = 0.6;
    arrow.renderOrder = 10;
    g.add(arrow);
    const box = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(BLOCK, LEVEL, BLOCK)), new THREE.LineBasicMaterial({ color: 0xffc42e, transparent: true, opacity: 0.7 }));
    box.position.set(0, LEVEL / 2, BLOCK / 2);
    g.add(box);
    g.visible = false;
    this.R.scene.add(g);
    return g;
  }

  buildPalette() {
    const pal = document.getElementById('ed-palette');
    let html = '';
    html += `<div class="group"><div class="eyebrow">Surface for new pieces</div><div class="chips" id="ed-surf">${['road', 'dirt', 'ice', 'grass'].map((s) => `<button class="chip" data-surf="${s}" aria-pressed="${s === 'road'}">${s[0].toUpperCase() + s.slice(1)}</button>`).join('')}</div>
      <label class="toggle" style="font-size:13px">Borders <input type="checkbox" id="ed-walls" checked></label></div>`;
    for (const [group, types] of PALETTE) {
      html += `<div class="group"><div class="eyebrow">${group}</div><div class="pieces">${types.map((t) => `<button class="pbtn" data-piece="${t}" title="${PIECES[t].name}">${icon(t)}<span>${SHORT[t]}</span></button>`).join('')}</div></div>`;
    }
    pal.innerHTML = html;
    pal.addEventListener('click', (e) => {
      const b = e.target.closest('[data-piece]');
      if (b) { this.add(b.dataset.piece); return; }
      const s = e.target.closest('[data-surf]');
      if (s) {
        this.surf = s.dataset.surf;
        pal.querySelectorAll('[data-surf]').forEach((c) => c.setAttribute('aria-pressed', String(c === s)));
      }
    });
    document.getElementById('ed-walls').addEventListener('change', (e) => { this.walls = e.target.checked; });
  }

  bindUI() {
    const $ = (id) => document.getElementById(id);
    $('ed-undo').onclick = () => this.undo();
    $('ed-test').onclick = () => this.test();
    $('ed-save').onclick = () => this.save();
    $('ed-exit').onclick = () => this.exit();
    $('ed-export').onclick = () => this.onShare(this.track);
    $('ed-name').addEventListener('input', (e) => { this.track.name = e.target.value.trim() || 'Untitled'; this.autosave(); });
    $('ed-laps').addEventListener('change', (e) => { this.snapshot(); this.track.laps = +e.target.value; this.changed(); });
    $('ed-selbox').addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const act = b.dataset.act;
      if (act === 'delete') this.remove();
      else if (act === 'deselect') this.select(null);
      else if (act === 'walls') this.setSelWalls();
      else if (act.startsWith('surf:')) this.setSelSurface(act.slice(5));
      else if (act.startsWith('start:')) this.moveStart(act.slice(6));
    });

    window.addEventListener('keydown', (e) => {
      if (!this.active || e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') { e.preventDefault(); this.undo(); }
      else if (e.code === 'Delete' || e.code === 'Backspace') { e.preventDefault(); this.remove(); }
      else if (e.code === 'Escape') this.select(null);
      else if (e.code === 'KeyT') this.test();
    });

    // orbit camera + picking
    const canvas = this.R.canvas;
    let drag = null;
    const pointers = new Map();
    canvas.addEventListener('pointerdown', (e) => {
      if (!this.active) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      drag = { x: e.clientX, y: e.clientY, moved: 0, pan: e.button === 2 || e.shiftKey, pinch: pointers.size === 2 ? this.pinchDist(pointers) : 0 };
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!this.active || !drag) return;
      const prev = pointers.get(e.pointerId);
      if (!prev) return;
      const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      drag.moved += Math.abs(dx) + Math.abs(dy);
      if (pointers.size === 2) {
        const d = this.pinchDist(pointers);
        if (drag.pinch) this.cam.dist = Math.min(1600, Math.max(40, this.cam.dist * (drag.pinch / d)));
        drag.pinch = d;
        return;
      }
      this.cam.goal = null;
      if (drag.pan) {
        const s = this.cam.dist * 0.0016;
        const right = new THREE.Vector3(Math.cos(this.cam.az), 0, -Math.sin(this.cam.az));
        const fwd = new THREE.Vector3(Math.sin(this.cam.az), 0, Math.cos(this.cam.az));
        this.cam.target.addScaledVector(right, dx * s).addScaledVector(fwd, dy * s);
      } else {
        this.cam.az -= dx * 0.006;
        this.cam.el = Math.min(1.5, Math.max(0.12, this.cam.el + dy * 0.005));
      }
    });
    const end = (e) => {
      if (!this.active) return;
      pointers.delete(e.pointerId);
      if (drag && drag.moved < 6 && pointers.size === 0 && e.type === 'pointerup' && e.button === 0) this.pick(e);
      if (pointers.size === 0) drag = null;
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('contextmenu', (e) => { if (this.active) e.preventDefault(); });
    canvas.addEventListener('wheel', (e) => {
      if (!this.active) return;
      e.preventDefault();
      this.cam.dist = Math.min(1600, Math.max(40, this.cam.dist * Math.exp(e.deltaY * 0.0012)));
    }, { passive: false });
    this.raycaster = new THREE.Raycaster();
  }

  pinchDist(pointers) {
    const [a, b] = [...pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y) || 1;
  }

  open(track, { userId = null } = {}) {
    this.track = track;
    this.userId = userId;
    this.history = [];
    this.sel = null;
    document.getElementById('ed-name').value = track.name;
    this.show();
    this.rebuild();
    this.fit();
  }

  show() {
    this.active = true;
    this.el.hidden = false;
    this.marker.visible = true;
    this.R.car.visible = false;
    this.R.ghost.visible = false;
    this.R.shadow.visible = false;
  }
  hide() {
    this.active = false;
    this.el.hidden = true;
    this.marker.visible = false;
    this.R.car.visible = true;
  }
  resume() { this.show(); this.rebuild(); }

  fit() {
    const b = this.built.bounds;
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (const x of b) for (let k = 0; k < 3; k++) { if (isFinite(x.min[k])) min[k] = Math.min(min[k], x.min[k]); if (isFinite(x.max[k])) max[k] = Math.max(max[k], x.max[k]); }
    const e = cursorEntry(this.layoutEnd());
    for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], e[k]); max[k] = Math.max(max[k], e[k]); }
    this.cam.target.set((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
    this.cam.dist = Math.min(1400, Math.max(140, Math.max(max[0] - min[0], max[2] - min[2]) * 1.1 + 80));
  }

  layoutEnd() {
    const lay = this.built.layout;
    if (this.sel != null && lay.placed[this.sel]) return lay.placed[this.sel].exit;
    return lay.end;
  }

  frame(dt = 0.016) {
    const c = this.cam;
    if (c.goal) {
      c.target.lerp(c.goal, 1 - Math.exp(-dt * 6));
      if (c.target.distanceTo(c.goal) < 0.5) c.goal = null;
    }
    const cam = this.R.camera;
    cam.up.set(0, 1, 0);
    cam.position.set(
      c.target.x + Math.sin(c.az) * Math.cos(c.el) * c.dist,
      c.target.y + Math.sin(c.el) * c.dist,
      c.target.z + Math.cos(c.az) * Math.cos(c.el) * c.dist,
    );
    cam.lookAt(c.target);
    if (cam.fov !== 55) { cam.fov = 55; cam.updateProjectionMatrix(); }
    this.R.shadow.visible = false;
  }

  snapshot() {
    this.history.push(JSON.stringify({ pieces: this.track.pieces, start: this.track.start, laps: this.track.laps }));
    if (this.history.length > 200) this.history.shift();
  }
  undo() {
    const h = this.history.pop();
    if (!h) return;
    const s = JSON.parse(h);
    Object.assign(this.track, s);
    if (this.sel != null && this.sel >= this.track.pieces.length) this.sel = null;
    this.changed();
  }

  add(type) {
    if (type === 'START') return;
    this.snapshot();
    const piece = { type, surf: SURFACEABLE.has(type) ? this.surf : 'road', walls: this.walls };
    if (this.sel == null) this.track.pieces.push(piece);
    else { this.track.pieces.splice(this.sel + 1, 0, piece); this.sel++; }
    this.changed();
  }

  remove() {
    const ps = this.track.pieces;
    if (this.sel == null) {
      if (ps.length <= 1) return;
      this.snapshot();
      ps.pop();
    } else {
      if (this.sel === 0) return;
      this.snapshot();
      ps.splice(this.sel, 1);
      this.sel = this.sel - 1 > 0 ? this.sel - 1 : null;
    }
    this.changed();
  }

  select(i) {
    this.sel = i;
    this.rebuild();
  }

  setSelSurface(s) {
    const p = this.track.pieces[this.sel];
    if (!p || !SURFACEABLE.has(p.type)) return;
    this.snapshot();
    p.surf = s;
    this.changed();
  }
  setSelWalls() {
    const p = this.track.pieces[this.sel];
    if (!p) return;
    this.snapshot();
    p.walls = p.walls === false;
    this.changed();
  }

  moveStart(dir) {
    this.snapshot();
    const s = this.track.start;
    if (dir === 'w') s.i++;
    else if (dir === 'e') s.i--;
    else if (dir === 'n') s.j++;
    else if (dir === 's') s.j--;
    else if (dir === 'up') s.k = Math.min(10, s.k + 1);
    else if (dir === 'down') s.k = Math.max(0, s.k - 1);
    else if (dir === 'rot') s.h = (s.h + 1) % 4;
    this.changed();
  }

  changed() {
    this.rebuild();
    this.autosave();
    this.follow();
  }

  // glide the view toward the insertion arrow if it is drifting off screen
  follow() {
    const p = this.marker.position.clone();
    const v = p.clone().project(this.R.camera);
    if (Math.abs(v.x) > 0.55 || Math.abs(v.y) > 0.6 || v.z > 1) this.cam.goal = new THREE.Vector3(p.x, Math.max(0, p.y), p.z);
  }

  autosave() {
    store.save('draft', { userId: this.userId, track: { ...this.track, pieces: this.track.pieces.map((p) => ({ ...p })) } });
  }

  rebuild() {
    this.built = buildTrack(this.track, { highlight: this.sel != null ? new Set([this.sel]) : new Set() });
    this.R.setTrack(this.built);
    const cur = this.layoutEnd();
    const e = cursorEntry(cur);
    this.marker.position.set(e[0], e[1] + 0.1, e[2]);
    const [fx, fz] = DIRS[cur.h];
    this.marker.rotation.y = Math.atan2(fx, fz);
    this.updateStatus();
    this.renderSelBox();
  }

  validation() {
    const t = this.track;
    const lay = this.built.layout;
    const hasFinish = t.pieces.some((p) => p.type === 'FIN');
    const laps = t.laps > 1 && lay.closed;
    const key = trackKey(t);
    const author = t.medals && t.medals.key === key ? t.medals.author : null;
    return { problems: lay.problems.size, hasFinish, closed: lay.closed, laps, key, author, raceable: lay.problems.size === 0 && (hasFinish || laps) };
  }

  updateStatus() {
    const v = this.validation();
    const el = document.getElementById('ed-status');
    const lapsSel = document.getElementById('ed-laps');
    lapsSel.disabled = !v.closed;
    lapsSel.value = String(v.closed ? this.track.laps : 1);
    let cls = 'good', msg;
    if (v.problems) { cls = 'bad'; msg = `<b>${v.problems} piece${v.problems > 1 ? 's' : ''} overlap or leave the stadium.</b> They are shown in red.`; }
    else if (!v.hasFinish && !v.laps) { cls = ''; msg = v.closed ? '<b>Closed circuit.</b> Set laps to 2 or more, or add a Finish.' : '<b>Add a Finish</b> to make the track raceable.'; }
    else msg = `<b>Raceable.</b> ` + (v.author ? `Author time ${fmtTime(v.author)}.` : 'Finish a test drive to set the author time.');
    el.className = 'status ' + cls;
    el.innerHTML = msg + ` <span style="opacity:.7">${this.track.pieces.length} pieces</span>`;
  }

  renderSelBox() {
    const box = document.getElementById('ed-selbox');
    const p = this.sel != null ? this.track.pieces[this.sel] : null;
    if (!p) {
      box.innerHTML = `<div class="eyebrow">Placing at the end of the track</div>
        <p class="note">Pick a piece on the left to add it at the yellow arrow. Click a placed piece to insert after it instead.</p>
        <div class="eyebrow">Move start</div>
        <div class="startpad">
          <button class="btn small" data-act="start:w" title="Move west">◀</button>
          <button class="btn small" data-act="start:n" title="Move north">▲</button>
          <button class="btn small" data-act="start:s" title="Move south">▼</button>
          <button class="btn small" data-act="start:e" title="Move east">▶</button>
          <button class="btn small" data-act="start:up">Up</button>
          <button class="btn small" data-act="start:down">Down</button>
          <button class="btn small" data-act="start:rot" style="grid-column: span 2">Rotate</button>
        </div>`;
      return;
    }
    const def = PIECES[p.type];
    const surfOk = SURFACEABLE.has(p.type);
    box.innerHTML = `<div class="eyebrow">Piece ${this.sel + 1} of ${this.track.pieces.length}</div>
      <div style="font:700 18px/1.1 var(--display);text-transform:uppercase">${def.name}</div>
      ${surfOk ? `<div class="chips">${['road', 'dirt', 'ice', 'grass'].map((s) => `<button class="chip" data-act="surf:${s}" aria-pressed="${p.surf === s}">${s[0].toUpperCase() + s.slice(1)}</button>`).join('')}</div>` : ''}
      <div class="row">
        ${def.build(p).paths.length ? `<button class="btn small" data-act="walls">${p.walls === false ? 'Add borders' : 'Remove borders'}</button>` : ''}
        ${this.sel > 0 ? '<button class="btn small danger" data-act="delete">Delete</button>' : ''}
        <button class="btn small" data-act="deselect">Done</button>
      </div>
      <p class="note">New pieces go in after this one.</p>`;
  }

  pick(e) {
    const rect = this.R.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.R.camera);
    const meshes = this.R.trackGroup.children;
    const hits = this.raycaster.intersectObjects(meshes, false);
    const bufs = [this.built.render.surface, this.built.render.solid, this.built.render.decal];
    for (const h of hits) {
      const k = meshes.indexOf(h.object);
      const buf = bufs.filter((b) => b.pos.length)[k];
      if (!buf || h.faceIndex == null) continue;
      const idx = buf.ids[h.faceIndex];
      if (idx != null && idx >= 0) { this.select(idx === this.sel ? null : idx); return; }
    }
    this.select(null);
  }

  test() {
    if (!this.track) return;
    this.hide();
    this.onTest(this.track);
  }

  onValidated(time) {
    const key = trackKey(this.track);
    const m = this.track.medals;
    if (!m || m.key !== key || time < m.author) {
      this.track.medals = { author: time, key };
      this.autosave();
      return true;
    }
    return false;
  }

  save() {
    const list = store.getUserTracks();
    const entry = { id: this.userId || 'u' + Date.now().toString(36), name: this.track.name, track: { ...this.track, pieces: this.track.pieces.map((p) => ({ ...p })) }, saved: Date.now() };
    const i = list.findIndex((x) => x.id === entry.id);
    if (i >= 0) list[i] = entry; else list.push(entry);
    this.userId = entry.id;
    const ok = store.setUserTracks(list);
    const el = document.getElementById('ed-status');
    el.className = 'status ' + (ok ? 'good' : 'bad');
    el.innerHTML = ok ? '<b>Saved to My tracks.</b>' : '<b>Could not save:</b> this browser is blocking storage.';
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.active && this.updateStatus(), 2200);
    this.autosave();
  }

  exit() {
    this.hide();
    this.onExit();
  }
}
