// Fully procedural sound: every effect is synthesised with WebAudio at runtime
// (no audio files). Spatialised with panners, glued together with a shared reverb and compressor.

export class Audio {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.last = new Map();
    this.loops = new Map();
  }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { this.enabled = false; return; }
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = 0.8;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 10;
    comp.ratio.value = 6;
    comp.attack.value = 0.003;
    comp.release.value = 0.25;
    this.master.connect(comp).connect(ctx.destination);
    // city-scale reverb
    this.verb = ctx.createConvolver();
    this.verb.buffer = this._impulse(2.8, 2.2);
    this.verbGain = ctx.createGain();
    this.verbGain.gain.value = 0.32;
    this.verb.connect(this.verbGain).connect(this.master);
    this.white = this._noise(2, 'white');
    this.brown = this._noise(4, 'brown');
    this._startAmbience();
  }

  _noise(sec, kind) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * sec);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === 'brown') { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
      else d[i] = w;
    }
    return buf;
  }

  _impulse(sec, decay) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * sec);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        // early slap echoes off buildings + diffuse tail
        const slap = (i % Math.floor(ctx.sampleRate * 0.083) < 40) ? 0.6 : 0;
        d[i] = ((Math.random() * 2 - 1) + slap * (Math.random() - 0.5)) * Math.pow(1 - t, decay);
      }
    }
    return buf;
  }

  // Rate limiting so a collapse doesn't spawn a thousand voices.
  _ok(key, gap) {
    const now = this.ctx.currentTime;
    const l = this.last.get(key) || 0;
    if (now - l < gap) return false;
    this.last.set(key, now);
    return true;
  }

  setListener(cam) {
    if (!this.ctx) return;
    const L = this.ctx.listener;
    const p = cam.position;
    const dir = cam.matrixWorld.elements;
    const fx = -dir[8], fy = -dir[9], fz = -dir[10];
    if (L.positionX) {
      const t = this.ctx.currentTime;
      L.positionX.setTargetAtTime(p.x, t, 0.02);
      L.positionY.setTargetAtTime(p.y, t, 0.02);
      L.positionZ.setTargetAtTime(p.z, t, 0.02);
      L.forwardX.setTargetAtTime(fx, t, 0.02);
      L.forwardY.setTargetAtTime(fy, t, 0.02);
      L.forwardZ.setTargetAtTime(fz, t, 0.02);
      L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0;
    } else {
      L.setPosition(p.x, p.y, p.z);
      L.setOrientation(fx, fy, fz, 0, 1, 0);
    }
  }

  // Output chain for one sound: [panner] -> gain -> master (+ reverb send)
  _out(pos, gain = 1, verb = 0.5, ref = 25) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.value = gain;
    let head = g;
    if (pos) {
      const p = ctx.createPanner();
      p.panningModel = 'equalpower';
      p.distanceModel = 'inverse';
      p.refDistance = ref;
      p.rolloffFactor = 1.1;
      p.maxDistance = 2000;
      if (p.positionX) { p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z; }
      else p.setPosition(pos.x, pos.y, pos.z);
      p.connect(g);
      head = p;
    }
    g.connect(this.master);
    if (verb > 0) {
      const s = ctx.createGain();
      s.gain.value = verb;
      g.connect(s).connect(this.verb);
    }
    return head;
  }

  _noiseSrc(buf = this.white, rate = 1) {
    const s = this.ctx.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    s.playbackRate.value = rate;
    s.loopStart = Math.random() * 1.5;
    return s;
  }

  _env(node, t0, a, peak, d, end = 0.0001) {
    const g = node.gain;
    g.cancelScheduledValues(t0);
    g.setValueAtTime(0.0001, t0);
    g.exponentialRampToValueAtTime(peak, t0 + a);
    g.exponentialRampToValueAtTime(end, t0 + a + d);
  }

  _thump(out, t, f0, f1, dur, peak) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    this._env(g, t, 0.005, peak, dur);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  _burst(out, t, type, freq, q, dur, peak, buf, attack = 0.003) {
    const ctx = this.ctx;
    const n = this._noiseSrc(buf);
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    this._env(g, t, attack, peak, dur);
    n.connect(f).connect(g).connect(out);
    n.start(t, Math.random());
    n.stop(t + attack + dur + 0.05);
    return f;
  }

  // ---------------- effects ----------------
  punch(pos, power = 1) {
    if (!this.ctx || !this._ok('punch', 0.04)) return;
    const t = this.ctx.currentTime;
    const out = this._out(pos, 1.0, 0.5, 30);
    this._thump(out, t, 140 * (0.9 + Math.random() * 0.2), 38, 0.4, 1.0 * power);
    this._burst(out, t, 'lowpass', 1400, 0.7, 0.18, 0.8 * power);
    this._burst(out, t, 'highpass', 2500, 0.7, 0.05, 0.4 * power);
  }

  whoosh(pos, heavy = false) {
    if (!this.ctx || !this._ok('whoosh', 0.08)) return;
    const t = this.ctx.currentTime;
    const out = this._out(pos, 0.5, 0.1, 20);
    const f = this._burst(out, t, 'bandpass', 300, 1.5, heavy ? 0.45 : 0.3, heavy ? 0.7 : 0.45, this.white, 0.12);
    f.frequency.setValueAtTime(250, t);
    f.frequency.exponentialRampToValueAtTime(heavy ? 900 : 1400, t + (heavy ? 0.35 : 0.22));
  }

  concrete(pos, power = 1) {
    if (!this.ctx || !this._ok('concrete', 0.05)) return;
    const t = this.ctx.currentTime;
    const out = this._out(pos, Math.min(1.4, 0.6 + power * 0.4), 0.6, 35);
    const n = Math.round(5 + power * 6);
    for (let i = 0; i < n; i++) {
      const tt = t + Math.random() * 0.35 * (0.5 + power * 0.5);
      this._burst(out, tt, 'bandpass', 300 + Math.random() * 1800, 1.2, 0.04 + Math.random() * 0.12, 0.5 + Math.random() * 0.5);
    }
    this._burst(out, t, 'lowpass', 500, 0.8, 0.5 * power, 0.7 * power, this.brown);
  }

  glass(pos, amount = 1) {
    if (!this.ctx || !this._ok('glass', 0.07)) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const out = this._out(pos, 0.55, 0.7, 30);
    this._burst(out, t, 'highpass', 3500, 0.7, 0.18, 0.7);
    const n = Math.min(18, 5 + amount * 3);
    for (let i = 0; i < n; i++) {
      const tt = t + Math.random() * 0.45 + (i > n / 2 ? 0.25 : 0); // second wave: shards landing
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = 2200 + Math.random() * 5000;
      const g = ctx.createGain();
      this._env(g, tt, 0.001, 0.12 + Math.random() * 0.1, 0.08 + Math.random() * 0.2);
      o.connect(g).connect(out);
      o.start(tt);
      o.stop(tt + 0.35);
    }
  }

  metal(pos, power = 1) {
    if (!this.ctx || !this._ok('metal', 0.05)) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const out = this._out(pos, 0.7, 0.5, 30);
    for (const f of [180, 297, 463, 811, 1290]) {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f * (0.95 + Math.random() * 0.1);
      const g = ctx.createGain();
      this._env(g, t, 0.002, 0.25 * power, 0.5 + Math.random() * 0.6);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + 1.3);
    }
    this._burst(out, t, 'bandpass', 1800, 1, 0.1, 0.6);
  }

  rumble(pos, power = 1, dur = 3) {
    if (!this.ctx || !this._ok('rumble', 0.4)) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const out = this._out(pos, Math.min(2, 0.8 + power * 0.5), 0.8, 70);
    const n = this._noiseSrc(this.brown, 0.7);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 220;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(1.2, t + 0.4);
    g.gain.setValueAtTime(1.2, t + dur * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 1.5);
    n.connect(f).connect(g).connect(out);
    n.start(t);
    n.stop(t + dur + 1.6);
    // sub rumble
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(42, t);
    o.frequency.linearRampToValueAtTime(30, t + dur);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(0.6 * power, t + 0.6);
    og.gain.exponentialRampToValueAtTime(0.0001, t + dur + 1.2);
    o.connect(og).connect(out);
    o.start(t);
    o.stop(t + dur + 1.3);
    // crashing chunks through the rumble
    for (let i = 0; i < 8 * power; i++) {
      const tt = t + Math.random() * dur;
      this._burst(out, tt, 'bandpass', 200 + Math.random() * 700, 1, 0.15 + Math.random() * 0.3, 0.4 + Math.random() * 0.4);
    }
  }

  // Structural groan: low detuned sawtooth through resonant filters with slow pitch wobble.
  groan(pos, power = 1) {
    if (!this.ctx || !this._ok('groan', 0.9)) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const dur = 1.4 + Math.random() * 1.2;
    const out = this._out(pos, 0.5 + power * 0.35, 0.9, 50);
    const base = 45 + Math.random() * 35;
    for (const det of [1, 1.013, 1.49]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(base * det, t);
      o.frequency.linearRampToValueAtTime(base * det * (0.75 + Math.random() * 0.2), t + dur * 0.6);
      o.frequency.linearRampToValueAtTime(base * det * (0.9 + Math.random() * 0.3), t + dur);
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 180 + Math.random() * 300;
      f.Q.value = 6;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.4, t + dur * 0.3);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(f).connect(g).connect(out);
      o.start(t);
      o.stop(t + dur + 0.1);
    }
    // creaks
    for (let i = 0; i < 4; i++) this._burst(out, t + Math.random() * dur, 'bandpass', 900 + Math.random() * 900, 12, 0.08, 0.35);
  }

  explosion(pos, power = 1) {
    if (!this.ctx || !this._ok('explosion', 0.06)) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const out = this._out(pos, Math.min(1.8, 0.8 + power * 0.6), 0.8, 45);
    const f = this._burst(out, t, 'lowpass', 3000, 0.5, 1.4, 1.2, this.white, 0.005);
    f.frequency.setValueAtTime(4000, t);
    f.frequency.exponentialRampToValueAtTime(180, t + 1.2);
    this._thump(out, t, 90, 28, 1.0, 1.2 * power);
    this._burst(out, t + 0.02, 'lowpass', 300, 0.7, 1.6, 0.8, this.brown);
  }

  gunshot(pos, heli = false) {
    if (!this.ctx || !this._ok(heli ? 'gunH' : 'gun', 0.05)) return;
    const t = this.ctx.currentTime;
    const out = this._out(pos, heli ? 0.55 : 0.4, 0.6, 18);
    const n = heli ? 3 : 1;
    for (let i = 0; i < n; i++) {
      this._burst(out, t + i * 0.07, 'highpass', 900, 0.6, 0.07, 0.9);
      this._burst(out, t + i * 0.07, 'lowpass', 400, 0.6, 0.12, 0.6);
    }
  }

  cannon(pos) {
    if (!this.ctx || !this._ok('cannon', 0.1)) return;
    const t = this.ctx.currentTime;
    const out = this._out(pos, 1.3, 0.9, 40);
    this._thump(out, t, 110, 30, 0.9, 1.3);
    this._burst(out, t, 'lowpass', 1200, 0.6, 0.6, 1.0, this.white, 0.002);
    this._burst(out, t, 'highpass', 1500, 0.6, 0.08, 0.8);
  }

  rocket(pos) {
    if (!this.ctx || !this._ok('rocket', 0.15)) return;
    const t = this.ctx.currentTime;
    const out = this._out(pos, 0.6, 0.4, 25);
    const f = this._burst(out, t, 'bandpass', 600, 1.2, 1.0, 0.7, this.white, 0.05);
    f.frequency.setValueAtTime(1800, t);
    f.frequency.exponentialRampToValueAtTime(400, t + 1);
  }

  step(pos, power = 0.5) {
    if (!this.ctx || !this._ok('step', 0.08)) return;
    const t = this.ctx.currentTime;
    const out = this._out(pos, 0.6 + power * 0.6, 0.35, 30);
    this._thump(out, t, 75, 28, 0.35, 0.9 * power + 0.2);
    this._burst(out, t, 'lowpass', 260, 0.6, 0.25, 0.5 * power, this.brown);
    if (power > 0.6) this._burst(out, t + 0.02, 'bandpass', 900, 1, 0.12, 0.25);
  }

  slam(pos, power = 1) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const out = this._out(pos, 1.4, 0.9, 50);
    this._thump(out, t, 80, 22, 1.2, 1.4 * power);
    this._burst(out, t, 'lowpass', 900, 0.5, 0.9, 1.0 * power, this.brown, 0.004);
    this.concrete(pos, power);
  }

  // Gorilla roar: formant-filtered buzz with a pitch contour, plus chest beats.
  roar(pos, chest = true) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + 0.25;
    const out = this._out(pos, 1.1, 0.9, 40);
    const dur = 1.6;
    const src = ctx.createGain();
    const oscs = [];
    for (const d of [1, 1.007, 0.5]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(70 * d, t);
      o.frequency.linearRampToValueAtTime(115 * d, t + 0.35);
      o.frequency.linearRampToValueAtTime(95 * d, t + dur * 0.8);
      o.frequency.linearRampToValueAtTime(60 * d, t + dur);
      o.connect(src);
      oscs.push(o);
    }
    const n = this._noiseSrc(this.white);
    const ng = ctx.createGain();
    ng.gain.value = 0.35;
    n.connect(ng).connect(src);
    // growl tremolo
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 22;
    const lg = ctx.createGain();
    lg.gain.value = 0.35;
    const trem = ctx.createGain();
    trem.gain.value = 0.7;
    lfo.connect(lg).connect(trem.gain);
    src.connect(trem);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(0.9, t + 0.12);
    env.gain.setValueAtTime(0.9, t + dur * 0.7);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    for (const [f, q, gq] of [[520, 4, 1], [1050, 5, 0.6], [2400, 6, 0.25], [180, 2, 0.8]]) {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = f;
      bp.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = gq;
      trem.connect(bp).connect(g).connect(env);
    }
    env.connect(out);
    const end = t + dur + 0.1;
    for (const o of oscs) { o.start(t); o.stop(end); }
    n.start(t); n.stop(end);
    lfo.start(t); lfo.stop(end);
    if (chest) {
      for (let i = 0; i < 9; i++) {
        const tt = t + 0.35 + i * 0.13;
        this._thump(out, tt, 120, 55, 0.12, 0.7);
        this._burst(out, tt, 'lowpass', 500, 0.7, 0.06, 0.4);
      }
    }
  }

  grunt(pos) {
    if (!this.ctx || !this._ok('grunt', 0.3)) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const out = this._out(pos, 0.6, 0.4, 30);
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(95, t);
    o.frequency.exponentialRampToValueAtTime(60, t + 0.25);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = 450; f.Q.value = 3;
    const g = ctx.createGain();
    this._env(g, t, 0.02, 0.8, 0.25);
    o.connect(f).connect(g).connect(out);
    o.start(t); o.stop(t + 0.35);
  }

  munch(pos) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const out = this._out(pos, 0.9, 0.3, 30);
    for (let i = 0; i < 4; i++) this._burst(out, t + 0.38 + i * 0.13, 'bandpass', 700 + Math.random() * 500, 1.5, 0.07, 0.8);
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(320, t + 0.95);
    o.frequency.exponentialRampToValueAtTime(110, t + 1.2);
    const g = ctx.createGain();
    this._env(g, t + 0.95, 0.02, 0.6, 0.25);
    o.connect(g).connect(out);
    o.start(t + 0.9); o.stop(t + 1.3);
  }

  scream(pos) {
    if (!this.ctx || !this._ok('scream', 0.12)) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const out = this._out(pos, 0.18, 0.4, 10);
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    const f0 = 650 + Math.random() * 450;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.linearRampToValueAtTime(f0 * 1.25, t + 0.15);
    o.frequency.linearRampToValueAtTime(f0 * 0.85, t + 0.6);
    const vib = ctx.createOscillator();
    vib.frequency.value = 7;
    const vg = ctx.createGain();
    vg.gain.value = 18;
    vib.connect(vg).connect(o.frequency);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 1400; bp.Q.value = 2;
    const g = ctx.createGain();
    this._env(g, t, 0.04, 0.5, 0.6);
    o.connect(bp).connect(g).connect(out);
    o.start(t); o.stop(t + 0.7);
    vib.start(t); vib.stop(t + 0.7);
  }

  hurt() {
    if (!this.ctx || !this._ok('hurt', 0.25)) return;
    this.grunt(null);
  }

  ui(kind = 'level') {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const out = this._out(null, 0.25, 0.2);
    const notes = kind === 'level' ? [440, 330] : kind === 'win' ? [392, 523, 659, 784] : [330, 262, 196];
    notes.forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = f;
      const g = ctx.createGain();
      this._env(g, t + i * 0.16, 0.01, 0.4, 0.25);
      o.connect(g).connect(out);
      o.start(t + i * 0.16); o.stop(t + i * 0.16 + 0.3);
    });
  }

  // ---------------- loops ----------------
  heliLoop(id, pos) {
    if (!this.ctx) return;
    let L = this.loops.get(id);
    if (!L) {
      const ctx = this.ctx;
      const panner = ctx.createPanner();
      panner.panningModel = 'equalpower';
      panner.distanceModel = 'inverse';
      panner.refDistance = 30;
      panner.rolloffFactor = 1.2;
      const g = ctx.createGain();
      g.gain.value = 0;
      g.gain.linearRampToValueAtTime(0.55, ctx.currentTime + 2);
      panner.connect(g).connect(this.master);
      const n = this._noiseSrc(this.brown, 1.4);
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass'; f.frequency.value = 650;
      const chop = ctx.createGain();
      chop.gain.value = 0.5;
      const lfo = ctx.createOscillator();
      lfo.type = 'square';
      lfo.frequency.value = 13 + Math.random() * 3;
      const lg = ctx.createGain();
      lg.gain.value = 0.5;
      lfo.connect(lg).connect(chop.gain);
      n.connect(f).connect(chop).connect(panner);
      const whine = ctx.createOscillator();
      whine.type = 'sawtooth';
      whine.frequency.value = 220 + Math.random() * 30;
      const wf = ctx.createBiquadFilter();
      wf.type = 'bandpass'; wf.frequency.value = 900; wf.Q.value = 4;
      const wg = ctx.createGain(); wg.gain.value = 0.05;
      whine.connect(wf).connect(wg).connect(panner);
      n.start(); lfo.start(); whine.start();
      L = { panner, g, nodes: [n, lfo, whine] };
      this.loops.set(id, L);
    }
    const p = L.panner;
    if (p.positionX) { p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z; }
    else p.setPosition(pos.x, pos.y, pos.z);
    L.seen = true;
  }

  sweepLoops() {
    if (!this.ctx) return;
    for (const [id, L] of this.loops) {
      if (!L.seen) {
        L.g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.3);
        setTimeout(() => L.nodes.forEach((n) => { try { n.stop(); } catch { /* already stopped */ } }), 1500);
        this.loops.delete(id);
      } else L.seen = false;
    }
  }

  _startAmbience() {
    const ctx = this.ctx;
    // distant traffic hum
    const n = this._noiseSrc(this.brown, 0.5);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 380;
    const g = ctx.createGain();
    g.gain.value = 0.05;
    n.connect(f).connect(g).connect(this.master);
    n.start();
    this.ambGain = g;
    // siren (silent until the military shows up)
    const s = ctx.createOscillator();
    s.type = 'triangle';
    s.frequency.value = 700;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.35;
    const lg = ctx.createGain();
    lg.gain.value = 180;
    lfo.connect(lg).connect(s.frequency);
    const sg = ctx.createGain();
    sg.gain.value = 0;
    const sv = ctx.createGain();
    sv.gain.value = 0.4;
    s.connect(sg).connect(this.master);
    sg.connect(sv).connect(this.verb);
    s.start(); lfo.start();
    this.sirenGain = sg;
  }

  setSiren(level) {
    if (!this.sirenGain) return;
    this.sirenGain.gain.setTargetAtTime(Math.min(0.035, level * 0.008), this.ctx.currentTime, 1.5);
  }

  horn(pos) {
    if (!this.ctx || !this._ok('horn', 1.2)) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const out = this._out(pos, 0.25, 0.5, 20);
    for (const f of [392, 494]) {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = f;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 1500;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.3, t + 0.02);
      g.gain.setValueAtTime(0.3, t + 0.5);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
      o.connect(lp).connect(g).connect(out);
      o.start(t); o.stop(t + 0.65);
    }
  }
}
