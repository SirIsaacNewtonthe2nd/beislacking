// Trains the AI driver on a campaign track and prints its progress.
// Usage: node tools/ai.mjs <trackId> [seconds]
import { parseTrack } from '../src/pieces.js';
import { CAMPAIGN } from '../src/tracks.js';
import { Trainer, compilePolicy } from '../src/ai.js';

const id = process.argv[2] || '01', secs = +(process.argv[3] || 30);
const def = CAMPAIGN.find((t) => t.id === id);
const t0 = Date.now();
const tr = new Trainer(parseTrack(def));
tr.init();
console.log(`${def.id} ${def.name}: start ${tr.best.time} (author ${def.author}) in ${Date.now() - t0} ms`);
// a resumed run must match the full run exactly
const b = tr.best, mid = b.snaps[Math.floor(b.snaps.length / 2)];
const noCmp = { t: new Float64Array(b.cross.t.length).fill(NaN), lat: b.cross.lat, spd: b.cross.spd };
const resumed = tr.drive(b.pol, compilePolicy(tr.built, b.pol), mid, { ...b, cross: noCmp, lastDiff: 0 });
console.log('determinism: resumed', resumed && resumed.time, 'full', b.time);
let last = Date.now();
while (Date.now() - t0 < secs * 1000) {
  tr.step(1000);
  if (Date.now() - last > 5000) { last = Date.now(); console.log(`${((Date.now() - t0) / 1000).toFixed(0)} s  attempts ${tr.attempts}  bests ${tr.improvements}  time ${tr.best.time}  margin ${tr.best.pol.margin.toFixed(3)}`); }
}
console.log(`final ${tr.best.time} after ${tr.attempts} attempts (${(tr.attempts / secs).toFixed(0)}/s), author ${def.author}`);
