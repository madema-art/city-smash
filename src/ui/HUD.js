import { GORILLA, DESTRUCTION } from '../config.js';

// Developer-only heads-up display. City Smash is played with NO on-screen UI: health, escalation and
// destruction are communicated by the world. This overlay exists only behind ?debug=1.
export class HUD {
  constructor(enabled = false) {
    this.enabled = enabled;
    const $ = (id) => document.getElementById(id);
    this.el = {
      hud: $('hud'), hf: $('health-fill'), hg: $('health-ghost'), ht: $('health-text'),
      dp: $('destroy-pct'), df: $('destroy-fill'), dg: $('destroy-goal'), gp: $('goal-pct'),
      threat: $('threat'), score: $('score'), tally: $('tally'), call: $('callouts'), hint: $('hint'), grab: $('grab-hint'),
    };
    this.el.gp.textContent = DESTRUCTION.winPercent;
    this.el.dg.style.left = `${DESTRUCTION.winPercent}%`;
    this.el.threat.innerHTML = Array.from({ length: 6 }, () => '<div class="pip"></div>').join('');
    this.pips = [...this.el.threat.children];
    this.last = {};
    this.hintTimer = 0;
  }

  show(v) { this.el.hud.classList.toggle('hidden', !(v && this.enabled)); }

  callout(text, cls = '') {
    if (!this.enabled) return;
    const d = document.createElement('div');
    d.className = `callout ${cls}`;
    d.textContent = text;
    this.el.call.appendChild(d);
    while (this.el.call.children.length > 3) this.el.call.firstChild.remove();
    setTimeout(() => d.remove(), 2300);
  }

  hint(text, secs = 4) {
    if (!this.enabled) return;
    this.el.hint.innerHTML = text;
    this.hintTimer = secs;
  }

  update(dt, s) {
    if (!this.enabled) return;
    const hp = Math.max(0, s.health) / GORILLA.maxHealth * 100;
    if (this.last.hp !== Math.round(hp)) {
      this.el.hf.style.width = `${hp}%`;
      this.el.hg.style.width = `${hp}%`;
      this.el.ht.textContent = Math.ceil(s.health);
      this.last.hp = Math.round(hp);
    }
    const dp = s.destroyed;
    const dps = dp.toFixed(1);
    if (this.last.dp !== dps) {
      this.el.dp.textContent = dps;
      this.el.df.style.width = `${Math.min(100, dp / DESTRUCTION.winPercent * DESTRUCTION.winPercent)}%`;
      this.last.dp = dps;
    }
    if (this.last.level !== s.level) {
      this.pips.forEach((p, i) => p.classList.toggle('on', i < s.level));
      this.last.level = s.level;
    }
    const score = Math.round(s.score).toLocaleString();
    if (this.last.score !== score) { this.el.score.textContent = score; this.last.score = score; }
    const tally = `🏢 ${s.collapsed} toppled · 🪖 ${s.soldiers} · 🚁 ${s.helis} · 🛡 ${s.tanks} · 😋 ${s.eaten}`;
    if (this.last.tally !== tally) { this.el.tally.textContent = tally; this.last.tally = tally; }
    const grab = s.grabHint || '';
    if (this.last.grab !== grab) { this.el.grab.textContent = grab; this.last.grab = grab; }
    if (this.hintTimer > 0) {
      this.hintTimer -= dt;
      if (this.hintTimer <= 0) this.el.hint.innerHTML = '';
    }
  }
}
