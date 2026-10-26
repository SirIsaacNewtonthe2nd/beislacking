// Trains the AI driver on a campaign track and prints its progress.
// Usage: node tools/ai.mjs <trackId> [seconds] [--attempts N]
import { parseTrack } from '../src/pieces.js';
import { CAMPAIGN } from '../src/tracks.js';
import { Trainer, compilePolicy } from '../src/ai.js';

const id = process.argv[2] || '01', secs = +(process.argv[3] || 30);
const ai = process.argv.indexOf('--attempts'), maxAttempts = ai > 0 ? +process.argv[ai + 1] : Infinity;
const def = CAMPAIGN.find((t) => t.id === id);
const t0 = Date.now();
const si = process.argv.indexOf('--seed');
const tr = new Trainer(parseTrack(def), si > 0 ? { seed: +process.argv[si + 1] } : {});
tr.init();
console.log(`${def.id} ${def.name}: start ${tr.best.time} (author ${def.author}) in ${Date.now() - t0} ms`);
// a resumed run must match the full run exactly
const b = tr.best, mid = b.snaps[Math.floor(b.snaps.length / 2)];
const noCmp = { t: new Float64Array(b.cross.t.length).fill(NaN), lat: b.cross.lat, spd: b.cross.spd };
const resumed = tr.drive(b.pol, compilePolicy(tr.built, b.pol), mid, { ...b, cross: noCmp, lastDiff: 0 });
console.log('determinism: resumed', resumed && resumed.time, 'full', b.time);
let last = Date.now();
while (Date.now() - t0 < secs * 1000 && tr.attempts < maxAttempts) {
  tr.attempt();
  if (Date.now() - last > 5000) { last = Date.now(); console.log(`${((Date.now() - t0) / 1000).toFixed(0)} s  attempts ${tr.attempts}  bests ${tr.improvements}  time ${tr.best.time}  margin ${tr.best.pol.margin.toFixed(3)}`); }
}
console.log(`final ${tr.best.time} after ${tr.attempts} attempts in ${((Date.now() - t0) / 1000).toFixed(0)} s, author ${def.author}${tr.best.respawns ? `, ${tr.best.respawns} respawns` : ''}`);
