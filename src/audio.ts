/** Sonido sintetizado con WebAudio (sin archivos) */
export class GameAudio {
  private ctx?: AudioContext;
  private master?: GainNode;
  private engineGain?: GainNode;
  private engineFilter?: BiquadFilterNode;
  private hum?: OscillatorNode;
  private humGain?: GainNode;
  private noiseBuf?: AudioBuffer;
  muted = false;

  init() {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.6;
    this.master.connect(ctx.destination);

    // Ruido marrón para el motor
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02;
      d[i] = last * 3.5;
    }
    this.noiseBuf = buf;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 400;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    src.connect(this.engineFilter).connect(this.engineGain).connect(this.master);
    src.start();

    this.hum = ctx.createOscillator();
    this.hum.type = 'sawtooth';
    this.hum.frequency.value = 60;
    const humFilter = ctx.createBiquadFilter();
    humFilter.type = 'lowpass';
    humFilter.frequency.value = 300;
    this.humGain = ctx.createGain();
    this.humGain.gain.value = 0;
    this.hum.connect(humFilter).connect(this.humGain).connect(this.master);
    this.hum.start();
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.6, this.ctx.currentTime, 0.05);
  }

  /** speed01: 0..1, thrust: 0..1, active: si el motor suena */
  engine(speed01: number, thrust: number, active: boolean) {
    if (!this.ctx || !this.engineGain || !this.engineFilter || !this.hum || !this.humGain) return;
    const t = this.ctx.currentTime;
    const g = active ? 0.25 + thrust * 0.35 : 0;
    this.engineGain.gain.setTargetAtTime(g, t, 0.1);
    this.engineFilter.frequency.setTargetAtTime(250 + speed01 * 900 + thrust * 700, t, 0.1);
    this.hum.frequency.setTargetAtTime(50 + speed01 * 40 + thrust * 30, t, 0.1);
    this.humGain.gain.setTargetAtTime(active ? 0.04 + thrust * 0.04 : 0, t, 0.1);
  }

  ring() {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    [880, 1320, 1760].forEach((f, i) => {
      const o = this.ctx!.createOscillator();
      const g = this.ctx!.createGain();
      o.type = 'triangle';
      o.frequency.value = f;
      g.gain.setValueAtTime(0, t + i * 0.07);
      g.gain.linearRampToValueAtTime(0.25, t + i * 0.07 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.07 + 0.35);
      o.connect(g).connect(this.master!);
      o.start(t + i * 0.07);
      o.stop(t + i * 0.07 + 0.4);
    });
  }

  explosion() {
    if (!this.ctx || !this.master || !this.noiseBuf) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(1800, t);
    f.frequency.exponentialRampToValueAtTime(80, t + 1.8);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(1.6, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 2);
    src.connect(f).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + 2.1);
  }

  warning() {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'square';
    o.frequency.value = 1100;
    g.gain.setValueAtTime(0.06, t);
    g.gain.setValueAtTime(0, t + 0.12);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.15);
  }

  private tone(freq: number, dur: number, type: OscillatorType, gain: number, delay = 0, slideTo?: number) {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private noise(dur: number, freq: number, gain: number, q = 1) {
    if (!this.ctx || !this.master || !this.noiseBuf) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.02);
  }

  shot() {
    this.noise(0.07, 1800, 0.5, 0.8);
    this.tone(180, 0.06, 'square', 0.05, 0, 60);
  }

  hitMarker() {
    this.tone(2400, 0.05, 'square', 0.05);
  }

  lockOn() {
    this.tone(1400, 0.06, 'sine', 0.08);
    this.tone(1900, 0.08, 'sine', 0.08, 0.07);
  }

  empty() {
    this.tone(300, 0.08, 'square', 0.06);
    this.tone(220, 0.1, 'square', 0.06, 0.09);
  }

  scrape() {
    this.noise(0.5, 3200, 0.9, 0.6);
    this.tone(90, 0.3, 'sawtooth', 0.15, 0, 40);
  }

  damaged() {
    this.noise(0.12, 900, 0.5, 1.2);
  }

  countdown(final: boolean) {
    this.tone(final ? 1320 : 660, final ? 0.5 : 0.18, 'square', 0.09);
  }

  gate(best: boolean) {
    this.tone(best ? 1046 : 784, 0.12, 'triangle', 0.2);
    this.tone(best ? 1568 : 1046, 0.2, 'triangle', 0.2, 0.1);
  }

  boostRing() {
    this.tone(300, 0.5, 'sawtooth', 0.08, 0, 1200);
  }

  reload() {
    this.tone(520, 0.06, 'square', 0.06);
    this.tone(780, 0.08, 'square', 0.06, 0.08);
  }

  /** Trueno: retumbo grave con retardo según la distancia del rayo */
  thunder(distance: number) {
    if (!this.ctx || !this.master || !this.noiseBuf) return;
    const delay = Math.min(4, distance / 343);
    const t = this.ctx.currentTime + delay;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(400, t);
    f.frequency.exponentialRampToValueAtTime(60, t + 3);
    const g = this.ctx.createGain();
    const vol = Math.max(0.3, 1.4 - distance / 2500);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.15);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 3.2);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + 3.3);
  }
}
