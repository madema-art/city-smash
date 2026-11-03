// Unified input: keyboard + mouse (pointer lock) and gamepads (standard mapping).
// Game code reads *actions* (move, look, punch, smash...) so both devices share one path.
//
// Gamepad (standard layout, e.g. Xbox / PlayStation):
//   Left stick   move (analog: walk speed scales with tilt)   L3 / LB  sprint
//   Right stick  camera                                       R3       recentre camera
//   RT  punch          LT  heavy smash (in the air: ground slam)
//   A   jump           B   ground stomp
//   X   grab / eat / throw                Y   climb / let go
//   RB  chest-beat roar                   Start pause · Back restart

const KEYMAP = {
  jump: ['Space'],
  stomp: ['KeyF'],
  grab: ['KeyE'],
  climb: ['KeyC'],
  roar: ['KeyQ'],
  sprint: ['ShiftLeft', 'ShiftRight'],
};
const PADMAP = {
  jump: [0], stomp: [1], grab: [2], climb: [3], roar: [5], punch: [7], smash: [6], sprint: [4, 10], recenter: [11], pause: [9], restart: [8],
};
const MOUSEMAP = { punch: 0, smash: 2 };

const DEAD = 0.18;
function deadzone(x, y) {
  const m = Math.hypot(x, y);
  if (m < DEAD) return [0, 0, 0];
  const k = Math.min(1, (m - DEAD) / (1 - DEAD));
  return [(x / m) * k, (y / m) * k, k];
}

export class Input {
  constructor(dom) {
    this.dom = dom;
    this.held = new Set();
    this.pressedQ = new Set();
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.buttons = new Set();
    this.buttonPressedQ = new Set();
    this.locked = false;
    this.sensitivity = 0.0022;
    this.padLookSpeed = 2.6; // rad/s at full right-stick tilt
    this.invertY = false;
    this.enabled = true;
    this.padIndex = -1;
    this.padPrev = [];
    this.padHeld = new Set();
    this.padPressed = new Set();
    this.lastDevice = 'kbm';
    this.move = { x: 0, y: 0, mag: 0 };
    this.lookDX = 0; this.lookDY = 0;
    this.listeners = new Set();
    this.sprintToggle = false;

    window.addEventListener('keydown', (e) => {
      this.lastDevice = 'kbm';
      if (e.repeat) return;
      this.held.add(e.code);
      this.pressedQ.add(e.code);
      if (['Space', 'Tab'].includes(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.held.delete(e.code));
    window.addEventListener('blur', () => { this.held.clear(); this.buttons.clear(); });
    dom.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      this.lastDevice = 'kbm';
      this.buttons.add(e.button);
      this.buttonPressedQ.add(e.button);
    });
    window.addEventListener('mouseup', (e) => this.buttons.delete(e.button));
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      const dx = Math.max(-300, Math.min(300, e.movementX || 0));
      const dy = Math.max(-300, Math.min(300, e.movementY || 0));
      this.mouseDX += dx;
      this.mouseDY += dy;
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === dom;
      if (!this.locked) this.buttons.clear();
    });
    window.addEventListener('gamepadconnected', (e) => {
      this.padIndex = e.gamepad.index;
      this.lastDevice = 'pad';
      for (const fn of this.listeners) fn('connected', e.gamepad);
    });
    window.addEventListener('gamepaddisconnected', (e) => {
      if (e.gamepad.index === this.padIndex) this.padIndex = -1;
      for (const fn of this.listeners) fn('disconnected', e.gamepad);
    });
  }

  onPad(fn) { this.listeners.add(fn); }

  requestLock() {
    if (!this.locked && this.dom.requestPointerLock) {
      try {
        const p = this.dom.requestPointerLock({ unadjustedMovement: true });
        if (p && p.catch) p.catch(() => { try { this.dom.requestPointerLock(); } catch { /* ignore */ } });
      } catch { try { this.dom.requestPointerLock(); } catch { /* ignore */ } }
    }
  }

  get pad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    if (this.padIndex >= 0 && pads[this.padIndex]) return pads[this.padIndex];
    for (const p of pads) if (p && p.connected) { this.padIndex = p.index; return p; }
    return null;
  }

  // Called once per rendered frame before game logic.
  beginFrame(dt = 1 / 60) {
    this.pressed = this.pressedQ;
    this.pressedQ = new Set();
    this.buttonPressed = this.buttonPressedQ;
    this.buttonPressedQ = new Set();
    let lx = this.mouseDX, ly = this.mouseDY;
    this.mouseDX = 0; this.mouseDY = 0;

    // keyboard movement
    let mx = (this.held.has('KeyD') ? 1 : 0) - (this.held.has('KeyA') ? 1 : 0);
    let my = (this.held.has('KeyW') ? 1 : 0) - (this.held.has('KeyS') ? 1 : 0);
    let mag = Math.min(1, Math.hypot(mx, my));
    if (mag > 0) { const l = Math.hypot(mx, my); mx /= l; my /= l; }

    // gamepad
    this.padPressed = new Set();
    this.padHeld = new Set();
    const pad = this.pad;
    if (pad) {
      const b = pad.buttons;
      for (let i = 0; i < b.length; i++) {
        const v = typeof b[i] === 'object' ? b[i].value > 0.35 || b[i].pressed : b[i] > 0.35;
        if (v) { this.padHeld.add(i); if (!this.padPrev[i]) this.padPressed.add(i); }
        this.padPrev[i] = v;
      }
      const [sx, sy, sm] = deadzone(pad.axes[0] || 0, pad.axes[1] || 0);
      if (sm > 0) { mx = sx; my = -sy; mag = sm; this.lastDevice = 'pad'; }
      const [rx, ry, rm] = deadzone(pad.axes[2] || 0, pad.axes[3] || 0);
      if (rm > 0) {
        // response curve: precise near centre, fast at the edge
        const curve = Math.pow(rm, 1.8) / rm;
        const rad = this.padLookSpeed * dt;
        lx += (rx * curve * rad) / this.sensitivity;
        ly += ((this.invertY ? -ry : ry) * curve * rad * 0.7) / this.sensitivity;
        this.lastDevice = 'pad';
      }
      if (this.padPressed.size) this.lastDevice = 'pad';
      // L3 toggles sprint (common on pads); it switches off when the stick is released
      if (this.padPressed.has(10)) this.sprintToggle = !this.sprintToggle;
      if (sm < 0.3) this.sprintToggle = false;
    }
    this.move.x = mx; this.move.y = my; this.move.mag = mag;
    this.lookDX = lx; this.lookDY = ly;
  }

  // ---- action queries ----
  down(action) {
    if (!this.enabled) return false;
    if (KEYMAP[action] && KEYMAP[action].some((k) => this.held.has(k))) return true;
    if (MOUSEMAP[action] !== undefined && this.buttons.has(MOUSEMAP[action])) return true;
    if (PADMAP[action] && PADMAP[action].some((i) => this.padHeld.has(i))) return true;
    if (action === 'sprint' && this.sprintToggle) return true;
    return false;
  }

  hit(action) {
    if (!this.enabled) return false;
    if (KEYMAP[action] && this.pressed && KEYMAP[action].some((k) => this.pressed.has(k))) return true;
    if (MOUSEMAP[action] !== undefined && this.buttonPressed && this.buttonPressed.has(MOUSEMAP[action])) return true;
    if (PADMAP[action] && PADMAP[action].some((i) => this.padPressed.has(i))) return true;
    return false;
  }

  // System-level pad buttons (pause/restart) usable outside gameplay.
  padHit(action) { return PADMAP[action] ? PADMAP[action].some((i) => this.padPressed.has(i)) : false; }
  anyPadHit() { return this.padPressed.size > 0; }

  // Haptics: strong = low-frequency motor, weak = high-frequency motor.
  rumble(strong, weak, ms) {
    const pad = this.pad;
    const act = pad && pad.vibrationActuator;
    if (!act || this.lastDevice !== 'pad') return;
    const now = performance.now();
    // don't let tiny rumbles cut off a big one that's still playing
    if (this.rumbleUntil && now < this.rumbleUntil && strong < this.rumbleStrong) return;
    this.rumbleUntil = now + ms;
    this.rumbleStrong = strong;
    try {
      act.playEffect(act.effects?.includes?.('dual-rumble') === false ? 'trigger-rumble' : 'dual-rumble', {
        duration: ms, strongMagnitude: Math.min(1, strong), weakMagnitude: Math.min(1, weak),
      })?.catch?.(() => {});
    } catch { /* unsupported */ }
  }

  // Legacy raw queries (debug / tests).
  key(code) { return this.enabled && this.held.has(code); }
  keyPressed(code) { return this.enabled && this.pressed && this.pressed.has(code); }

  // Automation hooks for tests: simulate a press as if typed/clicked.
  inject(code, holdMs = 120) {
    this.held.add(code);
    this.pressedQ.add(code);
    setTimeout(() => this.held.delete(code), holdMs);
  }
  injectButton(b, holdMs = 80) {
    this.buttons.add(b);
    this.buttonPressedQ.add(b);
    setTimeout(() => this.buttons.delete(b), holdMs);
  }
}

// Fake input used when the player has no control (title screen, end screens).
export const NULL_INPUT = {
  move: { x: 0, y: 0, mag: 0 }, lookDX: 0, lookDY: 0, sensitivity: 0,
  down: () => false, hit: () => false, rumble() {},
};
