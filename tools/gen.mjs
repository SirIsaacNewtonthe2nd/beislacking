// Generates random tracks and drives each with the bot, to check how often
// they come out finishable. Usage: node tools/gen.mjs [count] [firstSeed]
import { randomTrack } from '../src/generator.js';
import { simulate } from './sim.mjs';

const count = +(process.argv[2] || 20), first = +(process.argv[3] || 1);
let ok = 0, genMs = 0, simMs = 0;
const times = [];
for (let seed = first; seed < first + count; seed++) {
  let t0 = Date.now();
  const def = randomTrack(seed);
  genMs += Date.now() - t0;
  if (!def) { console.log(seed, 'no track'); continue; }
  t0 = Date.now();
  const r = simulate(def, { maxTime: 120 });
  simMs += Date.now() - t0;
  const clean = r.time && !r.respawns;
  if (clean) { ok++; times.push(r.time); }
  const n = def.pieces.split(' ').length;
  console.log(String(seed).padStart(4), clean ? 'ok  ' : 'FAIL', `time=${r.time ?? 'DNF'} respawns=${r.respawns ?? '-'} pieces=${n} ${r.error || ''}`, clean ? '' : def.pieces);
}
console.log(`clean ${ok}/${count}, gen ${(genMs / count).toFixed(0)} ms, sim ${(simMs / count).toFixed(0)} ms per track, times ${Math.min(...times).toFixed(1)}-${Math.max(...times).toFixed(1)} s`);
