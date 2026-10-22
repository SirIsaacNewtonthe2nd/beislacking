// Keyboard, gamepad and touch input merged into one driving state.

const STEER_L = ['ArrowLeft', 'KeyA'];
const STEER_R = ['ArrowRight', 'KeyD'];
const GAS = ['ArrowUp', 'KeyW'];
const BRAKE = ['ArrowDown', 'KeyS'];
const ACTIONS = {
  Enter: 'respawn', NumpadEnter: 'respawn',
  Backspace: 'restart', Delete: 'restart',
  Escape: 'pause', KeyP: 'pause',
  KeyC: 'camera', Digit1: 'cam0', Digit2: 'cam1', Digit3: 'cam2',
  KeyG: 'ghost', KeyM: 'mute',
};
const PAD_ACTIONS = { 1: 'respawn', 8: 'restart', 9: 'pause', 3: 'camera' };

export class Input {
  constructor() {
    this.keys = new Set();
    this.handlers = [];
    this.touch = { steer: 0, gas: 0, brake: 0 };
    this.padPrev = {};
    this.enabled = true;
    window.addEventListener('keydown', (e) => {
      if (!this.enabled || isTyping(e)) return;
      if ([...STEER_L, ...STEER_R, ...GAS, ...BRAKE, 'Backspace', 'Space'].includes(e.code)) e.preventDefault();
      if (!e.repeat && ACTIONS[e.code]) this.fire(ACTIONS[e.code]);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  on(fn) { this.handlers.push(fn); }
  fire(action) { for (const h of this.handlers) h(action); }
  any(codes) { return codes.some((c) => this.keys.has(c)); }

  read() {
    let steer = (this.any(STEER_R) ? 1 : 0) - (this.any(STEER_L) ? 1 : 0);
    let throttle = this.any(GAS) ? 1 : 0;
    let brake = this.any(BRAKE) ? 1 : 0;
    let analog = false;
    if (this.touch.steer || this.touch.gas || this.touch.brake) {
      steer = steer || this.touch.steer;
      throttle = Math.max(throttle, this.touch.gas);
      brake = Math.max(brake, this.touch.brake);
    }
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const pad of pads) {
      if (!pad) continue;
      const ax = pad.axes[0] || 0;
      if (Math.abs(ax) > 0.12) { steer = Math.sign(ax) * (Math.abs(ax) - 0.12) / 0.88; analog = true; }
      if (pad.buttons[14]?.pressed) steer = -1;
      if (pad.buttons[15]?.pressed) steer = 1;
      const rt = pad.buttons[7]?.value || 0, lt = pad.buttons[6]?.value || 0;
      throttle = Math.max(throttle, rt, pad.buttons[0]?.pressed ? 1 : 0);
      brake = Math.max(brake, lt, pad.buttons[2]?.pressed ? 1 : 0);
      for (const [b, action] of Object.entries(PAD_ACTIONS)) {
        const down = !!pad.buttons[b]?.pressed;
        const k = pad.index + ':' + b;
        if (down && !this.padPrev[k]) this.fire(action);
        this.padPrev[k] = down;
      }
    }
    return { steer, throttle, brake, analog };
  }
}

function isTyping(e) {
  const t = e.target;
  return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
}
