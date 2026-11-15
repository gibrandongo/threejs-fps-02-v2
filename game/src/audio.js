// Synthesized audio — every sound is built with WebAudio oscillators and
// filtered noise. No audio files, no network. Created lazily on first user
// gesture (browsers block AudioContext before interaction); every call is
// guarded so a missing context never throws.
export class Sfx {
  constructor() { this.ctx = null; this.master = null; this.enabled = true; }
  ensure() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return true; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      this.ctx = new AC();
      this.master = this.ctx.createGain(); this.master.gain.value = 0.35;
      this.master.connect(this.ctx.destination);
      return true;
    } catch (e) { return false; }
  }
  _noise(dur, filterFreq, type, gainVal, when = 0) {
    if (!this.ctx || !this.enabled) return;
    const t0 = this.ctx.currentTime + when;
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const f = this.ctx.createBiquadFilter(); f.type = type; f.frequency.value = filterFreq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gainVal, t0); g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(this.master); src.start(t0);
  }
  _tone(freq, dur, type, gainVal, slideTo = 0, when = 0) {
    if (!this.ctx || !this.enabled) return;
    const t0 = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t0 + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gainVal, t0); g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g); g.connect(this.master); o.start(t0); o.stop(t0 + dur + 0.02);
  }
  shot(kind) {
    if (!this.ensure()) return;
    if (kind === 'sniper') { this._noise(0.35, 900, 'lowpass', 0.9); this._tone(140, 0.25, 'sawtooth', 0.5, 40); }
    else if (kind === 'shotgun') { this._noise(0.3, 700, 'lowpass', 0.9); this._tone(110, 0.2, 'square', 0.4, 50); }
    else if (kind === 'smg') { this._noise(0.09, 1800, 'bandpass', 0.55); this._tone(220, 0.07, 'square', 0.25, 90); }
    else if (kind === 'pistol') { this._noise(0.12, 1400, 'bandpass', 0.6); this._tone(180, 0.09, 'square', 0.3, 70); }
    else { this._noise(0.14, 1200, 'bandpass', 0.7); this._tone(160, 0.1, 'sawtooth', 0.35, 60); }
  }
  distantShot() { if (this.ensure()) this._noise(0.18, 500, 'lowpass', 0.18); }
  reload() { this._tone(900, 0.05, 'square', 0.12); this._tone(600, 0.05, 'square', 0.12, 0, 0.18); this._tone(1200, 0.05, 'square', 0.12, 0, 0.4); }
  dryFire() { this._tone(1400, 0.04, 'square', 0.15); }
  hit() { this._tone(1800, 0.06, 'sine', 0.25); }
  kill() { this._tone(900, 0.08, 'sine', 0.3); this._tone(1400, 0.1, 'sine', 0.3, 0, 0.08); }
  hurt() { this._tone(120, 0.15, 'sawtooth', 0.4, 60); }
  step() { if (this.ensure()) this._noise(0.05, 400, 'lowpass', 0.06); }
  beep(final = false) { this._tone(final ? 1600 : 1100, 0.09, 'square', 0.22); }
  plantTick() { this._tone(1000, 0.05, 'square', 0.15); }
  explosion() {
    if (!this.ensure()) return;
    this._noise(1.1, 300, 'lowpass', 1.0); this._tone(70, 0.9, 'sine', 0.8, 28);
    this._noise(0.4, 2500, 'highpass', 0.3, 0.05);
  }
  grenadeBounce() { this._tone(300, 0.06, 'sine', 0.2, 180); }
  roundWin() { [523, 659, 784].forEach((f, i) => this._tone(f, 0.22, 'triangle', 0.3, 0, i * 0.14)); }
  roundLose() { [392, 330, 262].forEach((f, i) => this._tone(f, 0.25, 'triangle', 0.28, 0, i * 0.16)); }
  buy() { this._tone(700, 0.07, 'sine', 0.25); this._tone(1050, 0.09, 'sine', 0.25, 0, 0.07); }
  click() { this._tone(800, 0.04, 'square', 0.12); }
}
