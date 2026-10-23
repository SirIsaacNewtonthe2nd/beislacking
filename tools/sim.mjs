// Drives every campaign track with the bot and reports times.
// Usage: node tools/sim.mjs [trackId] [--verbose]
import { parseTrack } from '../src/pieces.js';
import { buildTrack } from '../src/geometry.js';
import { World } from '../src/collision.js';
import { Race, DT } from '../src/race.js';
import { Bot } from '../src/bot.js';
import { CAMPAIGN } from '../src/tracks.js';
import { readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const verbose = args.includes('--verbose');
const write = args.includes('--write'); // store bot times as author medals in src/tracks.js
const only = args.find((a) => !a.startsWith('--'));

export function simulate(def, { log = false, maxTime = 240, margin } = {}) {
  const track = parseTrack(def);
  const built = buildTrack(track);
  if (built.layout.problems.size) return { error: 'layout problems at pieces ' + [...built.layout.problems].join(',') };
  const world = new World(built.tris);
  const race = new Race(built, world);
  const bot = new Bot(built, margin ? { margin } : {});
  const events = [];
  race.on((e) => events.push(e));
  let lastLog = -1;
  let ticks = 0;
  while (race.phase !== 'finished' && ticks++ < maxTime / DT) {
    const inp = bot.input(race.car, DT);
    if (inp.wantRespawn) { race.respawn(); bot.stuck = 0; }
    race.tick(inp);
    if (log && race.phase === 'running' && Math.floor(race.time) !== lastLog) {
      lastLog = Math.floor(race.time);
      const c = race.car;
      console.log(`t=${race.time.toFixed(1)} idx=${bot.idx}/${built.line.length} piece=${built.line[bot.idx].piece} speed=${(c.speed * 3.6).toFixed(0)} pos=${c.p.map((x) => x.toFixed(1)).join(',')} grounded=${c.grounded} surf=${c.surfaceName} drift=${c.drift}`);
    }
  }
  return { time: race.finishTime, respawns: race.respawns, top: race.topSpeed * 3.6, events, cps: race.cps.length, tris: built.tris.length };
}

if (process.argv[1].endsWith('sim.mjs')) {
  const times = {};
  for (const def of CAMPAIGN) {
    if (only && def.id !== only) continue;
    const t0 = Date.now();
    const r = simulate(def, { log: verbose });
    const ms = Date.now() - t0;
    if (r.error) { console.log(`${def.id} ${def.name}: ${r.error}`); continue; }
    console.log(`${def.id.padEnd(4)} ${def.name.padEnd(18)} time=${r.time ?? 'DNF'} respawns=${r.respawns} cps=${r.cps} top=${r.top.toFixed(0)}km/h tris=${r.tris} (${ms}ms)`);
    if (r.time && !r.respawns) times[def.id] = r.time;
    if (write) {
      // author time: the fastest clean run from a bolder driver
      for (const margin of [0.82, 0.78, 0.74, 0.7]) {
        const b = simulate(def, { margin });
        if (b.time && !b.respawns && (!times[def.id] || b.time < times[def.id])) times[def.id] = b.time;
      }
      console.log(`     author ${times[def.id] ?? '-'}`);
    }
  }
  if (write) {
    const file = new URL('../src/tracks.js', import.meta.url);
    let src = readFileSync(file, 'utf8');
    for (const [id, t] of Object.entries(times)) {
      src = src.replace(new RegExp(`(id: '${id}',[^\\n]*?)(, author: [\\d.]+)?,\\n`), `$1, author: ${t},\n`);
    }
    writeFileSync(file, src);
    console.log('author times written for', Object.keys(times).join(' '));
  }
}
