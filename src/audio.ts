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
}
