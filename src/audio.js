// Tiny synthesized sound: engine tone from speed, plus checkpoint / finish chimes.

const GEARS = [0, 55, 100, 145, 195, 250, 310, 9999]; // km/h shift points

export class Sound {
  constructor() {
    this.ctx = null;
    this.muted = false;
  }

  start() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.5;
    this.master.connect(ctx.destination);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 900;
    filter.connect(this.master);
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineGain.connect(filter);
    this.osc1 = ctx.createOscillator();
    this.osc1.type = 'sawtooth';
    this.osc2 = ctx.createOscillator();
    this.osc2.type = 'square';
    const g2 = ctx.createGain();
    g2.gain.value = 0.35;
    this.osc1.connect(this.engineGain);
    this.osc2.connect(g2).connect(this.engineGain);
    this.osc1.start();
    this.osc2.start();
    this.filter = filter;
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.5;
  }

  engine(kmh, throttle, active) {
    if (!this.ctx) return;
    let g = 1;
    while (g < GEARS.length - 1 && kmh > GEARS[g]) g++;
    const lo = GEARS[g - 1], hi = GEARS[g];
    const rpm = Math.min(1, (kmh - lo) / Math.max(1, hi - lo));
    const f = 55 + rpm * 110 + g * 8;
    const t = this.ctx.currentTime;
    this.osc1.frequency.setTargetAtTime(f, t, 0.03);
    this.osc2.frequency.setTargetAtTime(f * 0.5, t, 0.03);
    this.filter.frequency.setTargetAtTime(500 + throttle * 900 + rpm * 400, t, 0.05);
    this.engineGain.gain.setTargetAtTime(active ? 0.12 + throttle * 0.1 : 0, t, 0.08);
  }

  beep(freqs, dur = 0.12, type = 'sine', vol = 0.25) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    freqs.forEach((f, i) => {
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = type;
      o.frequency.value = f;
      const s = t0 + i * dur * 0.9;
      g.gain.setValueAtTime(0, s);
      g.gain.linearRampToValueAtTime(vol, s + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, s + dur);
      o.connect(g).connect(this.master);
      o.start(s);
      o.stop(s + dur + 0.02);
    });
  }

  checkpoint(ahead) { this.beep(ahead ? [880, 1320] : [880], 0.11); }
  finish() { this.beep([660, 880, 1320], 0.16, 'triangle', 0.3); }
  count(final) { this.beep([final ? 1046 : 523], final ? 0.25 : 0.1, 'square', 0.12); }
}
