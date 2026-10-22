// Prints a top-down map of a track's occupied cells (highest level shown).
// Usage: node tools/map.mjs <trackId>   or   node tools/map.mjs --pieces "START S R2 ..." [--start i,j,k,h]
import { parseTrack, layoutTrack } from '../src/pieces.js';
import { CAMPAIGN } from '../src/tracks.js';

const args = process.argv.slice(2);
let def;
if (args[0] === '--pieces') {
  const st = (args[args.indexOf('--start') + 1] || '20,20,1,0').split(',').map(Number);
  def = { pieces: args[1], start: { i: st[0], j: st[1], k: st[2], h: st[3] } };
} else def = CAMPAIGN.find((t) => t.id === args[0]);
const track = parseTrack(def);
const lay = layoutTrack(track);
const top = new Map();
let mi = 99, mj = 99, Mi = -1, Mj = -1;
for (const [key, idx] of lay.occupied) {
  const [i, j, k] = key.split(',').map(Number);
  const prev = top.get(i + ',' + j);
  if (!prev || prev.k < k) top.set(i + ',' + j, { k, idx });
  mi = Math.min(mi, i); mj = Math.min(mj, j); Mi = Math.max(Mi, i); Mj = Math.max(Mj, j);
}
console.log('problems:', [...lay.problems].join(',') || 'none', ' closed:', lay.closed, ' end:', JSON.stringify(lay.end));
// print with +X to the right is confusing because right turn from +Z is -X; print x descending so the view matches a driver facing +Z
for (let j = Mj; j >= mj; j--) {
  let row = String(j).padStart(3) + ' ';
  for (let i = Mi; i >= mi; i--) {
    const c = top.get(i + ',' + j);
    row += c ? (lay.problems.has(c.idx) ? ' XX' : String(c.idx).padStart(3)) : '  .';
  }
  console.log(row);
}
let foot = '    ';
for (let i = Mi; i >= mi; i--) foot += String(i).padStart(3);
console.log(foot);
