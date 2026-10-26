// Runs AI training off the main thread, so the page stays smooth. Several of
// these can work on one track at once; the page passes each one's new bests
// to the others.
import { parseTrack } from './pieces.js';
import { Trainer } from './ai.js';

let trainer = null, running = false, pending = null, lastAdopt = 0;

self.onmessage = (e) => {
  const m = e.data;
  if (m.cmd === 'start') {
    trainer = new Trainer(parseTrack(m.track), { policy: m.policy, seed: m.seed, runs: m.runs, part: m.part, parts: m.parts });
    running = true;
    self.postMessage({ type: 'hello' });
    setTimeout(loop, 0);
  } else if (m.cmd === 'adopt') pending = m;
  else if (m.cmd === 'pause') running = false;
  else if (m.cmd === 'resume' && trainer && !running) { running = true; setTimeout(loop, 0); }
};

function loop() {
  if (!running) return;
  // take another trainer's better run now and then (re-driving it costs a lap)
  if (pending && trainer.best && Date.now() - lastAdopt > 1500) {
    trainer.adopt(pending.policy, pending.time);
    pending = null;
    lastAdopt = Date.now();
  }
  const found = trainer.step(150);
  self.postMessage({ type: 'report', report: trainer.report(found > 0) });
  if (trainer.best && !trainer.best.time) { running = false; return; }
  setTimeout(loop, 0);
}
