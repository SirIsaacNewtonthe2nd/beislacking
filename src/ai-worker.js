// Runs AI training off the main thread, so the page stays smooth. Several of
// these can work on one track at once: each sends its new bests (with the
// saved states needed to carry on from them) straight to the others.
import { parseTrack } from './pieces.js';
import { Trainer } from './ai.js';

let trainer = null, running = false;
const peers = [];

self.onmessage = (e) => {
  const m = e.data;
  if (m.cmd === 'start') {
    trainer = new Trainer(parseTrack(m.track), { policy: m.policy, seed: m.seed, runs: m.runs, part: m.part, parts: m.parts });
    running = true;
    self.postMessage({ type: 'hello' });
    setTimeout(loop, 0);
  } else if (m.cmd === 'peer') {
    const port = e.ports[0];
    port.onmessage = (ev) => { if (trainer) trainer.adopt(ev.data); };
    peers.push(port);
  } else if (m.cmd === 'pause') running = false;
  else if (m.cmd === 'resume' && trainer && !running) { running = true; setTimeout(loop, 0); }
};

function loop() {
  if (!running) return;
  const found = trainer.step(150);
  if (found > 0 && trainer.best.time) {
    const rec = trainer.record();
    for (const p of peers) p.postMessage(rec);
  }
  self.postMessage({ type: 'report', report: trainer.report(found > 0) });
  if (trainer.best && !trainer.best.time) { running = false; return; }
  setTimeout(loop, 0);
}
