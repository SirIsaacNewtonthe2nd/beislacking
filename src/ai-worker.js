// Runs AI training off the main thread, so the page stays smooth.
import { parseTrack } from './pieces.js';
import { Trainer } from './ai.js';

let trainer = null, running = false;

self.onmessage = (e) => {
  const m = e.data;
  if (m.cmd === 'start') {
    trainer = new Trainer(parseTrack(m.track), { policy: m.policy, seed: m.seed });
    running = true;
    self.postMessage({ type: 'hello' });
    setTimeout(loop, 0);
  } else if (m.cmd === 'pause') running = false;
  else if (m.cmd === 'resume' && trainer && !running) { running = true; setTimeout(loop, 0); }
};

function loop() {
  if (!running) return;
  const found = trainer.step(150);
  self.postMessage({ type: 'report', report: trainer.report(found > 0) });
  if (trainer.best && !trainer.best.time) { running = false; return; }
  setTimeout(loop, 0);
}
