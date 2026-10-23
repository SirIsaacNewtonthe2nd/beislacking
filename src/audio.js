// Tiny synthesized sound: engine tone from the real engine speed, tyre squeal
// from tyre slip, plus checkpoint / finish chimes.

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
    // tyre squeal: band-passed noise
    const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    noise.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 1400;
    band.Q.value = 6;
    this.squeal = ctx.createGain();
    this.squeal.gain.value = 0;
    noise.connect(band).connect(this.squeal).connect(this.master);
    noise.start();
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.5;
  }

  engine(rpm, throttle, active, slip = 0, speed = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    // a four-stroke engine fires every other turn per cylinder; use a V8-ish tone
    const f = (rpm / 60) * 2;
    this.osc1.frequency.setTargetAtTime(Math.max(30, f), t, 0.02);
    this.osc2.frequency.setTargetAtTime(Math.max(15, f * 0.5), t, 0.02);
    this.filter.frequency.setTargetAtTime(400 + throttle * 1400 + rpm * 0.05, t, 0.04);
    this.engineGain.gain.setTargetAtTime(active ? 0.1 + throttle * 0.12 : 0, t, 0.06);
    const sq = active && speed > 3 ? Math.min(0.22, Math.max(0, slip - 1.05) * 0.25) : 0;
    this.squeal.gain.setTargetAtTime(sq, t, 0.05);
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
