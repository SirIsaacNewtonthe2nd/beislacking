// App controller: menu, races, HUD, finish screen and the editor hand-off.

import { parseTrack, serializeTrack } from './pieces.js';
import { buildTrack } from './geometry.js';
import { World } from './collision.js';
import { Race, DT, COUNTDOWN, ghostAt } from './race.js';
import { Renderer } from './render.js';
import { Input } from './input.js';
import { Sound } from './audio.js';
import { Bot } from './bot.js';
import { CAMPAIGN } from './tracks.js';
import { Editor } from './editor.js';
import { randomTrack } from './generator.js';
import * as store from './storage.js';
import { fmtTime, medalsFor, medalOf, trackKey } from './storage.js';
import { qslerp, vlerp } from './math.js';

const $ = (id) => document.getElementById(id);
const R = new Renderer($('view'));
const input = new Input();
const sound = new Sound();
const settings = store.getSettings();
R.camMode = settings.camera || 0;
sound.setMuted(!settings.sound);

const MEDALS = ['author', 'gold', 'silver', 'bronze'];
const MEDAL_NAME = { author: 'Author', gold: 'Gold', silver: 'Silver', bronze: 'Bronze' };
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
const AUTOPILOT = /[?&]autopilot\b/.test(location.search); // lets the bot drive real races, for testing

const app = { mode: 'menu', paused: false, session: null, attract: null, attractIdx: 0, overlay: null };

const editor = new Editor({
  renderer: R,
  onTest: (track) => startRace(cloneTrack(track), { kind: 'test', name: track.name }),
  onExit: () => showMenu(),
  onShare: (track) => openCode('export', track),
});

// ---------------------------------------------------------------- tracks
function campaignTrack(i) {
  const def = CAMPAIGN[i];
  const t = parseTrack(def);
  t.campaignId = def.id;
  return t;
}
function campaignMeta(i) {
  const def = CAMPAIGN[i];
  return { kind: 'campaign', index: i, key: 'c' + def.id, name: def.name, code: def.id, medals: medalsFor(def.author) };
}
function cloneTrack(t) {
  return { ...t, start: { ...t.start }, pieces: t.pieces.map((p) => ({ ...p })), medals: t.medals ? { ...t.medals } : null };
}
function userMedals(track) {
  const key = trackKey(track);
  return track.medals && track.medals.key === key ? medalsFor(track.medals.author) : null;
}

// ---------------------------------------------------------------- sessions
function makeSession(track, meta, bot = false) {
  const built = buildTrack(track);
  const world = new World(built.tris);
  const race = new Race(built, world);
  const s = { track, built, world, race, meta, acc: 0, prevP: [...race.car.p], prevQ: [...race.car.q], snap: true, bot: bot ? new Bot(built) : null, pilot: !bot && AUTOPILOT ? new Bot(built) : null, pb: null, split: null, banner: null, lastCount: null, finishedAt: 0 };
  if (!bot) {
    meta.key = meta.key || trackKey(track);
    if (meta.kind !== 'campaign') meta.medals = userMedals(track);
    s.pb = loadPB(meta);
  }
  race.on((ev) => onRaceEvent(s, ev));
  return s;
}

function startRace(track, meta) {
  stopAttract();
  hideAll();
  app.session = makeSession(track, meta);
  app.mode = 'race';
  app.paused = false;
  R.setTrack(app.session.built);
  R.car.visible = true;
  $('hud').hidden = false;
  if (isTouch) $('touch').hidden = false;
  $('hud-name').textContent = meta.name;
  renderTargets(app.session);
  if (settings.sound) sound.start();
}

function retry() {
  const s = app.session;
  if (!s) return;
  hideOverlay();
  s.pb = loadPB(s.meta);
  if (s.meta.kind === 'test') s.meta.medals = userMedals(editor.track);
  renderTargets(s);
  s.race.reset();
  app.paused = false;
}

function renderTargets(s) {
  const m = s.meta.medals;
  const pb = s.pb ? `<span>PB <b class="num">${fmtTime(s.pb.time)}</b></span>` : '';
  if (!m) { $('hud-targets').innerHTML = pb || (s.meta.kind === 'test' ? '<span>Test drive</span>' : ''); return; }
  $('hud-targets').innerHTML = MEDALS.slice(0, 2).map((k) => `<span><i class="medal ${k}"></i><b class="num">${fmtTime(m[k])}</b></span>`).join('') + pb;
}

function onRaceEvent(s, ev) {
  if (s.bot) {
    if (ev.type === 'finish') s.finishedAt = performance.now();
    if (ev.type === 'reset' || ev.type === 'respawn') s.snap = true;
    return;
  }
  if (ev.type === 'reset' || ev.type === 'respawn') { s.snap = true; s.split = null; }
  if (ev.type === 'go') sound.count(true);
  if (ev.type === 'cp' || ev.type === 'lap') {
    const ref = s.pb && s.pb.cps ? s.pb.cps[ev.index] : null;
    const delta = ref != null ? ev.time - ref : null;
    s.split = { delta, time: ev.time, until: performance.now() + 2600 };
    sound.checkpoint(delta != null && delta < 0);
    if (ev.type === 'lap') s.banner = { text: `Lap ${ev.lap} / ${s.race.laps}`, until: performance.now() + 1800 };
  }
  if (ev.type === 'finish') onFinish(s, ev);
}

function onFinish(s, ev) {
  sound.finish();
  const prev = s.pb;
  const improved = !prev || ev.time < prev.time;
  let note = '';
  if (s.meta.kind === 'test' && editor.onValidated(ev.time)) {
    s.meta.medals = userMedals(editor.track);
    note = `Author time set to ${fmtTime(ev.time)}. Save the track to keep it.`;
  }
  if (improved) savePB(s.meta, { time: ev.time, cps: ev.cpTimes, ghost: s.race.ghost, date: Date.now() });
  const delta = prev ? ev.time - prev.time : null;
  s.split = { delta: delta, time: ev.time, until: performance.now() + 4000 };
  setTimeout(() => {
    if (app.session !== s || s.race.phase !== 'finished' || app.mode !== 'race') return;
    showFinish(s, ev, prev, note);
  }, 1300);
}

function showFinish(s, ev, prev, note) {
  const m = s.meta.medals;
  const best = Math.min(ev.time, prev ? prev.time : Infinity);
  $('fin-track').textContent = (s.meta.code ? s.meta.code + ' · ' : '') + s.meta.name;
  $('fin-time').textContent = fmtTime(ev.time);
  const d = $('fin-delta');
  if (!prev) { d.className = 'delta'; d.textContent = 'First finish'; }
  else if (ev.time < prev.time) { d.className = 'delta ahead'; d.textContent = `${fmtTime(ev.time - prev.time, true)} · new best`; }
  else { d.className = 'delta behind'; d.textContent = `${fmtTime(ev.time - prev.time, true)} vs best ${fmtTime(prev.time)}`; }
  const got = medalOf(ev.time, m);
  const was = medalOf(prev && prev.time, m);
  const better = got && (!was || MEDALS.indexOf(got) < MEDALS.indexOf(was));
  if (better) { sound.medal(MEDALS.indexOf(got)); confetti(got, 110); }
  else if (prev && ev.time < prev.time) confetti(null, 40);
  $('fin-earned').innerHTML = got ? `<i class="medal ${got}"></i>${MEDAL_NAME[got]} medal` : m ? '<i class="medal none"></i>No medal this run' : '';
  const bestMedal = medalOf(best, m);
  $('fin-medals').innerHTML = m ? MEDALS.map((k) => {
    const have = bestMedal && MEDALS.indexOf(bestMedal) <= MEDALS.indexOf(k);
    return `<div class="${have ? 'got' : ''}"><i class="medal ${have ? k : 'none'}"></i><b>${MEDAL_NAME[k]}</b>${fmtTime(m[k])}</div>`;
  }).join('') : '';
  const resp = ev.respawns ? `${ev.respawns} respawn${ev.respawns > 1 ? 's' : ''}. ` : '';
  $('fin-note').textContent = resp + (note || (!m && s.meta.kind !== 'campaign' ? 'This track has no author time yet. Validate it from the editor.' : ''));
  const random = s.meta.kind === 'random';
  const hasNext = random || (s.meta.kind === 'campaign' && s.meta.index < CAMPAIGN.length - 1);
  $('btn-next').hidden = !hasNext;
  $('btn-next').textContent = random ? 'New random track' : 'Next track';
  $('btn-save-random').hidden = !random;
  $('btn-save-random').textContent = s.meta.saved ? 'Saved' : 'Save track';
  $('btn-save-random').disabled = !!s.meta.saved;
  $('btn-fin-exit').textContent = s.meta.kind === 'test' ? 'Back to editor' : 'Menu';
  showOverlay('finish');
  $('btn-retry').focus({ preventScroll: true });
}

function confetti(medal, count) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const box = $('confetti');
  box.textContent = '';
  const colors = medal ? [`var(--${medal})`, 'var(--accent)', '#ffffff', `var(--${medal})`] : ['var(--ahead)', '#ffffff', 'var(--accent)'];
  for (let i = 0; i < count; i++) {
    const c = document.createElement('i');
    c.style.left = Math.random() * 100 + '%';
    c.style.background = colors[i % colors.length];
    c.style.animationDuration = 1.6 + Math.random() * 1.6 + 's';
    c.style.animationDelay = Math.random() * 0.4 + 's';
    c.style.setProperty('--dx', (Math.random() - 0.5) * 220 + 'px');
    c.style.setProperty('--rot', (Math.random() - 0.5) * 1440 + 'deg');
    box.appendChild(c);
  }
  clearTimeout(confetti.timer);
  confetti.timer = setTimeout(() => { box.textContent = ''; }, 3800);
}

// ---------------------------------------------------------------- attract mode (bot laps behind the menu)
function startAttract() {
  stopAttract();
  const i = app.attractIdx % CAMPAIGN.length;
  const s = makeSession(campaignTrack(i), campaignMeta(i), true);
  app.attract = s;
  R.setTrack(s.built);
  R.car.visible = true;
}
function stopAttract() { app.attract = null; }

// ---------------------------------------------------------------- frame loop
function stepSession(s, inp, dt) {
  s.acc += dt;
  let n = 0;
  const race = s.race, car = race.car;
  while (s.acc >= DT && n < 40) {
    s.prevP[0] = car.p[0]; s.prevP[1] = car.p[1]; s.prevP[2] = car.p[2];
    s.prevQ = [...car.q];
    let i = inp;
    const bot = s.bot || s.pilot;
    if (bot) {
      i = bot.input(car, DT);
      if (i.wantRespawn) { race.respawn(); bot.stuck = 0; }
    }
    race.tick(i);
    s.acc -= DT;
    n++;
  }
  if (n >= 40) s.acc = 0;
  if (s.snap) { s.prevP = [...car.p]; s.prevQ = [...car.q]; }
}

function drawSession(s, dt, camMode) {
  const race = s.race, car = race.car;
  const a = Math.min(1, s.acc / DT);
  const p = vlerp(s.prevP, car.p, a);
  const q = qslerp(s.prevQ, car.q, a);
  R.updateCar(p, q, car, s.world);
  const ev = R.fx.update(dt, car, s.snap);
  if (ev.landed) R.kick(0.25 + 0.6 * ev.landed);
  if (ev.wallHit) R.kick(0.25 + ev.wallHit);
  if (!s.bot) onEffects(s, ev);
  const ghost = !s.bot && settings.ghost && s.pb && s.pb.ghost && race.phase !== 'finished' ? ghostAt(s.pb.ghost, race.phase === 'countdown' ? 0 : race.time + a * DT) : null;
  R.updateGhost(ghost);
  let up = [0, 0, 0];
  for (const w of car.wheels) if (w.contact) { up[0] += w.n[0]; up[1] += w.n[1]; up[2] += w.n[2]; }
  if (!car.grounded) up = [0, 1, 0];
  const saved = R.camMode;
  if (camMode != null) R.camMode = camMode;
  R.updateCamera(p, q, car.v, dt, s.snap, up, car.boost > 0);
  R.camMode = saved;
  s.snap = false;
}

function onEffects(s, ev) {
  if (ev.boostStart) sound.boost(s.race.car.boostForce > 9000);
  if (ev.landed) sound.land(ev.landed);
  if (ev.wallHit) sound.crash(ev.wallHit);
  if (ev.air > 1 && s.race.phase === 'running') s.stunt = { text: `Air ${ev.air.toFixed(1)} s`, until: performance.now() + 1500 };
}

function updateHUD(s, inp) {
  const race = s.race, car = race.car;
  const now = performance.now();
  const t = race.phase === 'countdown' ? 0 : race.phase === 'finished' ? race.finishTime : race.time;
  $('timer').textContent = fmtTime(t);
  const kmh = Math.round(car.speed * 3.6);
  $('speed').textContent = kmh;
  $('gear').textContent = car.gear < 0 ? 'R' : car.gear;
  const bar = $('speedbar').firstElementChild;
  bar.style.width = Math.min(100, (car.rpm / 12800) * 100) + '%';
  bar.className = car.boost > 0 ? 'boost' : car.rpm > 12000 ? 'shift' : '';
  const total = race.cps.length;
  $('hud-cp').innerHTML = total ? `<small>CP</small>${race.taken.size}/${total}` : '';
  $('hud-lap').innerHTML = race.multilap ? `<small>LAP</small>${race.lap}/${race.laps}` : '';
  $('hud-resp').textContent = race.respawns ? `${race.respawns} respawn${race.respawns > 1 ? 's' : ''}` : '';
  // countdown
  const cd = $('countdown');
  if (race.phase === 'countdown') {
    const n = Math.ceil((race.countdown / COUNTDOWN) * 3);
    cd.hidden = false; cd.className = ''; cd.textContent = n;
    if (s.lastCount !== n) { s.lastCount = n; sound.count(false); }
    s.goUntil = 0;
  } else if (race.phase === 'running' && race.time < 0.6) {
    cd.hidden = false; cd.className = 'go'; cd.textContent = 'GO';
  } else cd.hidden = true;
  if (race.phase !== 'countdown') s.lastCount = null;
  // split
  const sp = $('split');
  if (s.split && now < s.split.until) {
    sp.hidden = false;
    const d = s.split.delta;
    sp.className = d == null ? 'even num' : d < 0 ? 'ahead num' : d > 0 ? 'behind num' : 'even num';
    sp.innerHTML = (d == null ? fmtTime(s.split.time) : fmtTime(d, true)) + (d != null ? `<span class="cpt">${fmtTime(s.split.time)}</span>` : '');
  } else sp.hidden = true;
  const fx = $('effects');
  const fxHtml = (car.noEngine > 0 ? `<span class="noengine">Engine off ${car.noEngine.toFixed(1)}</span>` : '') + (car.noSteer > 0 ? `<span class="nosteer">No steering ${car.noSteer.toFixed(1)}</span>` : '');
  fx.hidden = !fxHtml;
  if (fx.innerHTML !== fxHtml) fx.innerHTML = fxHtml;
  const bn = $('banner');
  if (s.banner && now < s.banner.until) { bn.hidden = false; bn.textContent = s.banner.text; } else bn.hidden = true;
  const st = $('stunt');
  if (s.stunt && now < s.stunt.until) {
    if (st.hidden || st.textContent !== s.stunt.text) { st.textContent = s.stunt.text; st.hidden = false; st.classList.remove('pop'); void st.offsetWidth; st.classList.add('pop'); }
  } else st.hidden = true;
  const active = race.phase === 'running' && !app.paused;
  sound.engine(car.rpm, inp.throttle, active, car.grounded ? car.tyreSlip : 0, car.speed);
  sound.ambient(car.speed, car.scrape, active);
}

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const inp = input.read();
  inp.assists = settings.assists;
  if (app.mode === 'race' && app.session) {
    if (!app.paused) stepSession(app.session, inp, dt);
    drawSession(app.session, app.paused ? 0 : dt);
    updateHUD(app.session, app.paused ? { throttle: 0 } : inp);
  } else if (app.mode === 'menu' && app.attract) {
    const s = app.attract;
    stepSession(s, null, dt);
    drawSession(s, dt, 1);
    if (s.race.phase === 'finished' && performance.now() - s.finishedAt > 2500) { app.attractIdx++; startAttract(); }
  } else if (app.mode === 'editor') {
    editor.frame(dt);
  }
  R.render();
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- actions
input.on((action) => {
  if (app.mode !== 'race') {
    if (action === 'pause' && app.overlay === 'controls') hideOverlay();
    if (action === 'pause' && app.overlay === 'codebox') hideOverlay();
    return;
  }
  const s = app.session;
  if (action === 'pause') {
    if (app.overlay === 'controls') { showOverlay('pause'); return; }
    if (app.overlay === 'finish') { exitRace(); return; }
    togglePause();
  } else if (action === 'respawn') {
    if (app.paused) return;
    if (s.race.phase === 'finished') retry(); else s.race.respawn();
  } else if (action === 'restart') {
    retry();
  } else if (action === 'camera' || action.startsWith('cam')) {
    R.camMode = action === 'camera' ? (R.camMode + 1) % 3 : +action.slice(3);
    settings.camera = R.camMode;
    store.setSettings(settings);
  } else if (action === 'ghost') {
    settings.ghost = !settings.ghost;
    store.setSettings(settings);
    $('set-ghost').checked = settings.ghost;
  } else if (action === 'mute') {
    settings.sound = !settings.sound;
    store.setSettings(settings);
    $('set-sound').checked = settings.sound;
    sound.setMuted(!settings.sound);
    if (settings.sound) sound.start();
  }
});

function togglePause(force) {
  const p = force != null ? force : !app.paused;
  if (p === app.paused && app.overlay === (p ? 'pause' : null)) return;
  app.paused = p;
  if (p) {
    const s = app.session;
    $('pause-track').textContent = s.meta.name;
    $('btn-exit').textContent = s.meta.kind === 'test' ? 'Back to editor' : 'Exit to menu';
    showOverlay('pause');
    $('btn-resume').focus({ preventScroll: true });
  } else hideOverlay();
}

function exitRace() {
  const s = app.session;
  app.session = null;
  app.paused = false;
  hideAll();
  sound.engine(0, 0, false);
  sound.ambient(0, 0, false);
  if (s && s.meta.kind === 'test') { app.mode = 'editor'; editor.resume(); }
  else showMenu();
}

function showOverlay(id) {
  for (const o of ['pause', 'finish', 'controls', 'codebox', 'building']) $(o).hidden = o !== id;
  app.overlay = id;
}
function hideOverlay() {
  for (const o of ['pause', 'finish', 'controls', 'codebox', 'building']) $(o).hidden = true;
  app.overlay = null;
}
function hideAll() {
  hideOverlay();
  for (const id of ['menu', 'hud', 'touch', 'editor']) $(id).hidden = true;
}

// ---------------------------------------------------------------- menu
function showMenu() {
  hideAll();
  app.mode = 'menu';
  $('menu').hidden = false;
  renderMenu();
  startAttract();
}

function renderMenu() {
  let medals = 0;
  $('campaign').innerHTML = CAMPAIGN.map((def, i) => {
    const pb = store.getPB('c' + def.id);
    const m = medalOf(pb && pb.time, medalsFor(def.author));
    if (m) medals += 4 - MEDALS.indexOf(m);
    return `<button class="card" data-play="${i}">
      <div class="row"><span class="code">${def.id}</span><span class="tier ${def.tier}">${def.tier}</span></div>
      <div class="name">${def.name}${def.laps > 1 ? ` <span style="color:var(--muted);font-size:14px">· ${def.laps} laps</span>` : ''}</div>
      <div class="row"><span class="pb ${pb ? '' : 'empty'}">${pb ? fmtTime(pb.time) : 'No time yet'}</span><i class="medal ${m || 'none'}" title="${m ? MEDAL_NAME[m] + ' medal' : 'No medal'}"></i></div>
    </button>`;
  }).join('');
  $('medal-count').textContent = `${medals} / ${CAMPAIGN.length * 4} medals`;
  const list = store.getUserTracks();
  $('mytracks').innerHTML = list.length ? list.map((e) => {
    const t = parseTrack(e.track);
    const pb = store.getPB(trackKey(t));
    const m = medalOf(pb && pb.time, userMedals(t));
    return `<div class="myrow panel">
      <i class="medal ${m || 'none'}"></i>
      <span class="name">${escapeHtml(e.name)}</span>
      <span class="pb">${pb ? fmtTime(pb.time) : ''}</span>
      <button class="btn small primary" data-uplay="${e.id}">Race</button>
      <button class="btn small" data-uedit="${e.id}">Edit</button>
      <button class="btn small" data-ucode="${e.id}">Code</button>
      <button class="btn small danger" data-udel="${e.id}">Delete</button>
    </div>`;
  }).join('') : '<div class="empty-state">Tracks you build and save appear here. Start with <b>Build a track</b>.</div>';
}

$('campaign').addEventListener('click', (e) => {
  const b = e.target.closest('[data-play]');
  if (b) { const i = +b.dataset.play; startRace(campaignTrack(i), campaignMeta(i)); }
});
$('mytracks').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  const list = store.getUserTracks();
  const id = b.dataset.uplay || b.dataset.uedit || b.dataset.ucode || b.dataset.udel;
  const entry = list.find((x) => x.id === id);
  if (!entry) return;
  const t = parseTrack(entry.track);
  if (b.dataset.uplay) startRace(t, { kind: 'user', name: entry.name });
  else if (b.dataset.uedit) openEditor(t, entry.id);
  else if (b.dataset.ucode) openCode('export', t);
  else if (b.dataset.udel) {
    if (b.dataset.armed) {
      store.setUserTracks(list.filter((x) => x.id !== id));
      renderMenu();
    } else {
      b.dataset.armed = '1';
      b.textContent = 'Confirm delete';
      setTimeout(() => { if (b.isConnected) { delete b.dataset.armed; b.textContent = 'Delete'; } }, 3000);
    }
  }
});

function openEditor(track, userId = null) {
  stopAttract();
  hideAll();
  app.mode = 'editor';
  editor.open(track, { userId });
}

function newTrack() {
  const draft = store.load('draft', null);
  if (draft && draft.track && !draft.userId && draft.track.pieces && draft.track.pieces.length > 1) {
    const t = parseTrack(draft.track);
    return t;
  }
  return parseTrack({ name: 'My track', start: { i: 20, j: 4, k: 1, h: 0 }, pieces: 'START' });
}

$('btn-new').onclick = () => openEditor(newTrack());
$('btn-import').onclick = () => openCode('import');
$('btn-controls').onclick = () => showOverlay('controls');
$('btn-controls-close').onclick = () => (app.mode === 'race' && app.paused ? showOverlay('pause') : hideOverlay());
$('set-ghost').checked = settings.ghost;
$('set-sound').checked = settings.sound;
$('set-assists').checked = settings.assists;
$('set-assists').onchange = (e) => { settings.assists = e.target.checked; store.setSettings(settings); };
$('set-ghost').onchange = (e) => { settings.ghost = e.target.checked; store.setSettings(settings); };
$('set-sound').onchange = (e) => { settings.sound = e.target.checked; store.setSettings(settings); sound.setMuted(!settings.sound); if (settings.sound) sound.start(); };
$('btn-resume').onclick = () => togglePause(false);
$('btn-restart').onclick = () => retry();
$('btn-pause-controls').onclick = () => showOverlay('controls');
$('btn-exit').onclick = () => exitRace();
$('btn-retry').onclick = () => retry();
$('btn-fin-exit').onclick = () => exitRace();
$('btn-next').onclick = () => {
  const s = app.session;
  if (s && s.meta.kind === 'random') { playRandom(); return; }
  if (!s || s.meta.kind !== 'campaign') return;
  const i = s.meta.index + 1;
  if (i < CAMPAIGN.length) startRace(campaignTrack(i), campaignMeta(i));
};

// ---------------------------------------------------------------- personal bests
// Random tracks keep their records in memory until saved, so playing lots of
// them doesn't fill the browser's storage.
function loadPB(meta) {
  return meta.kind === 'random' && !meta.saved ? meta.pb || null : store.getPB(meta.key);
}
function savePB(meta, rec) {
  if (meta.kind === 'random' && !meta.saved) meta.pb = rec;
  else store.setPB(meta.key, rec);
}

// ---------------------------------------------------------------- random tracks
const tick = () => new Promise((r) => setTimeout(r, 0));

// Drives a track with the bot without drawing it; resolves to the finish
// time of a clean run (no respawns), or null.
async function botTime(track, margin, onProgress) {
  const built = buildTrack(track);
  const race = new Race(built, new World(built.tris));
  const bot = new Bot(built, { margin });
  let ticks = 0;
  while (race.phase !== 'finished' && ticks < 120 / DT) {
    const end = performance.now() + 12;
    while (race.phase !== 'finished' && ticks < 120 / DT && performance.now() < end) {
      const inp = bot.input(race.car, DT);
      if (inp.wantRespawn) { race.respawn(); bot.stuck = 0; }
      race.tick(inp);
      ticks++;
      if (race.respawns) return null;
    }
    onProgress(bot.idx / built.line.length);
    await tick();
  }
  return race.finishTime;
}

let building = false;
async function playRandom() {
  if (building) return;
  building = true;
  showOverlay('building');
  const bar = $('building-bar');
  bar.style.width = '0%';
  try {
    for (let attempt = 0; attempt < 8; attempt++) {
      const def = randomTrack((Math.random() * 2 ** 31) >>> 0);
      if (!def) continue;
      const t = parseTrack(def);
      const first = await botTime(t, 0.66, (f) => { bar.style.width = (f * 55).toFixed(1) + '%'; });
      if (!first) continue;
      // a bolder second run usually sets a quicker author time
      const bold = await botTime(t, 0.78, (f) => { bar.style.width = (55 + f * 45).toFixed(1) + '%'; });
      t.medals = { author: bold ? Math.min(first, bold) : first, key: trackKey(t) };
      startRace(t, { kind: 'random', name: t.name, code: 'Random' });
      return;
    }
    hideOverlay();
  } finally {
    building = false;
  }
}

$('btn-random').onclick = () => playRandom();
$('btn-save-random').onclick = () => {
  const s = app.session;
  if (!s || s.meta.kind !== 'random' || s.meta.saved) return;
  const list = store.getUserTracks();
  list.push({ id: 'u' + Date.now().toString(36), name: s.track.name, track: serializeTrack(s.track), saved: Date.now() });
  if (!store.setUserTracks(list)) { $('fin-note').textContent = 'Could not save: this browser is blocking storage.'; return; }
  if (s.meta.pb) store.setPB(s.meta.key, s.meta.pb);
  s.meta.saved = true;
  $('btn-save-random').textContent = 'Saved';
  $('btn-save-random').disabled = true;
};

// ---------------------------------------------------------------- share codes
function encodeTrack(track) {
  const json = JSON.stringify(serializeTrack(track));
  return 'GR1.' + btoa(unescape(encodeURIComponent(json))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function decodeTrack(code) {
  const body = code.trim().replace(/^GR1\./, '').replace(/-/g, '+').replace(/_/g, '/');
  const json = decodeURIComponent(escape(atob(body)));
  const def = JSON.parse(json);
  const t = parseTrack(def);
  if (!t.pieces.length || t.pieces[0].type !== 'START') throw new Error('no start');
  return t;
}

function openCode(mode, track) {
  const ta = $('code-text'), err = $('code-err');
  err.hidden = true;
  if (mode === 'export') {
    $('code-title').textContent = 'Share code';
    $('code-note').textContent = 'Anyone can paste this code into Import to race your track. The author time travels with it.';
    ta.value = encodeTrack(track);
    ta.readOnly = true;
    $('btn-code-go').textContent = 'Copy';
    $('btn-code-go').onclick = () => {
      const done = () => { $('btn-code-go').textContent = 'Copied'; };
      try {
        navigator.clipboard.writeText(ta.value).then(done, () => { ta.select(); });
      } catch { ta.select(); }
    };
  } else {
    $('code-title').textContent = 'Import a track';
    $('code-note').textContent = 'Paste a track code. The track is added to My tracks.';
    ta.value = '';
    ta.readOnly = false;
    $('btn-code-go').textContent = 'Import';
    $('btn-code-go').onclick = () => {
      try {
        const t = decodeTrack(ta.value);
        const list = store.getUserTracks();
        list.push({ id: 'u' + Date.now().toString(36), name: t.name, track: serializeTrack(t), saved: Date.now() });
        store.setUserTracks(list);
        hideOverlay();
        renderMenu();
      } catch {
        err.hidden = false;
        err.textContent = 'That code could not be read. Check that it was copied in full, starting with GR1.';
      }
    };
  }
  showOverlay('codebox');
  if (mode === 'import') ta.focus();
}
$('btn-code-close').onclick = () => hideOverlay();

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// ---------------------------------------------------------------- touch controls
for (const el of document.querySelectorAll('#touch .tbtn')) {
  const t = el.dataset.t;
  const set = (on) => {
    el.classList.toggle('on', on);
    if (t === 'left') input.touch.steer = on ? -1 : input.touch.steer === -1 ? 0 : input.touch.steer;
    if (t === 'right') input.touch.steer = on ? 1 : input.touch.steer === 1 ? 0 : input.touch.steer;
    if (t === 'gas') input.touch.gas = on ? 1 : 0;
    if (t === 'brake') input.touch.brake = on ? 1 : 0;
  };
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (t === 'respawn' || t === 'pause') { input.fire(t); return; }
    el.setPointerCapture(e.pointerId);
    set(true);
    if (settings.sound) sound.start();
  });
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) el.addEventListener(ev, () => set(false));
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden && app.mode === 'race' && app.session && app.session.race.phase === 'running' && !app.paused) togglePause(true);
});
document.addEventListener('pointerdown', () => { if (settings.sound && app.mode === 'race') sound.start(); }, { capture: true });

if (AUTOPILOT) window.gridrun = { app, editor, R };
showMenu();
requestAnimationFrame(frame);
