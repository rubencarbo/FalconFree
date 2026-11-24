/**
 * Mensajes de voz «pulsa y habla» (3 s).
 * Se graba con WebAudio, se reduce a 8 kHz y se codifica en µ-law (calidad telefónica,
 * ~8 KB por segundo). Así funciona igual en iPhone y Android sin depender de códecs.
 */
export const VOICE_MAX_MS = 3000;
const RATE = 8000;
/** Duración de cada trozo enviado mientras se habla (s) */
const CHUNK_S = 0.4;
/** El primero sale antes para que se empiece a oír cuanto antes */
const FIRST_CHUNK_S = 0.25;
/** Colchón al empezar a reproducir un mensaje en directo (s) */
const JITTER_S = 0.25;
/** Frecuencia de reproducción (Safari no acepta buffers de 8 kHz) */
const PLAY_RATE = 24000;

export class VoiceRecorder {
  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private node: ScriptProcessorNode | null = null;
  private chunks: Float32Array[] = [];
  private inRate = 48000;
  private timer = 0;
  recording = false;
  startedAt = 0;
  /** Se llama al terminar (por tiempo o al soltar) con el clip codificado */
  onDone?: (clip: { data: string; ms: number } | null) => void;
  /**
   * Envío por trozos mientras se graba (baja latencia): se llama cada ~0,4 s con el audio
   * codificado; «last» = último trozo.
   */
  onChunk?: (data: string, index: number, last: boolean) => void;
  private pending: Float32Array[] = [];
  private pendingLen = 0;
  private chunkIndex = 0;
  private runPeak = 0.05;

  static get supported() {
    return !!navigator.mediaDevices?.getUserMedia && !!(window.AudioContext || (window as unknown as { webkitAudioContext?: unknown }).webkitAudioContext);
  }

  /** Hay micro abierto y listo (permiso concedido) */
  get ready() {
    return !!this.node;
  }

  /**
   * Abre el micro. Llamar DIRECTAMENTE desde el toque del usuario: el contexto de audio
   * se crea antes del primer «await», como exigen Safari (iPhone) y Chrome en Android.
   */
  async open() {
    if (this.node) return;
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    this.ctx = ctx;
    const resumed = ctx.resume();
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (e) {
      this.cleanup();
      throw e;
    }
    await resumed.catch(() => undefined);
    this.inRate = ctx.sampleRate;
    const src = ctx.createMediaStreamSource(this.stream);
    this.node = ctx.createScriptProcessor(2048, 1, 1);
    this.chunks = [];
    this.node.onaudioprocess = (e) => {
      if (!this.recording) return;
      const buf = new Float32Array(e.inputBuffer.getChannelData(0));
      this.chunks.push(buf);
      if (this.onChunk) {
        this.pending.push(buf);
        this.pendingLen += buf.length;
        if (this.pendingLen >= this.inRate * (this.chunkIndex === 0 ? FIRST_CHUNK_S : CHUNK_S)) this.flush(false);
      }
    };
    // Conectar a un destino mudo (si no, algunos navegadores no procesan)
    const mute = ctx.createGain();
    mute.gain.value = 0;
    src.connect(this.node);
    this.node.connect(mute).connect(ctx.destination);
  }

  /** Empieza a grabar (el micro ya está abierto); se para solo a los 5 s */
  begin(ms = VOICE_MAX_MS) {
    if (!this.node || this.recording) return;
    this.chunks = [];
    this.pending = [];
    this.pendingLen = 0;
    this.chunkIndex = 0;
    this.runPeak = 0.05;
    this.recording = true;
    this.duration = ms;
    this.startedAt = performance.now();
    this.timer = window.setTimeout(() => this.stop(), ms);
  }

  /** Duración de la grabación en curso (ms) */
  duration = VOICE_MAX_MS;

  /** Abre el micro y graba (atajo) */
  async start() {
    await this.open();
    this.begin();
  }

  /** Codifica y entrega lo acumulado como un trozo */
  private flush(last: boolean) {
    if (!this.onChunk) return;
    const pcm = concat(this.pending);
    this.pending = [];
    this.pendingLen = 0;
    if (!pcm.length && !last) return;
    const down = downsample(pcm, this.inRate, RATE);
    // Ganancia automática suave (como «normalize» pero sobre la marcha)
    let peak = 0;
    for (const v of down) peak = Math.max(peak, Math.abs(v));
    this.runPeak = Math.max(this.runPeak * 0.9, peak);
    const g = Math.min(4, Math.max(1, 0.9 / Math.max(this.runPeak, 0.01)));
    if (g !== 1) for (let i = 0; i < down.length; i++) down[i] = Math.max(-1, Math.min(1, down[i] * g));
    this.onChunk(encodeMuLaw(down), this.chunkIndex++, last);
  }

  /** Termina la grabación y entrega el clip */
  stop() {
    if (!this.recording) return;
    this.recording = false;
    clearTimeout(this.timer);
    this.flush(true);
    const ms = Math.min(VOICE_MAX_MS, performance.now() - this.startedAt);
    this.cleanup();
    const pcm = concat(this.chunks);
    this.chunks = [];
    if (ms < 400 || pcm.length < this.inRate * 0.3) {
      this.onDone?.(null);
      return;
    }
    const down = downsample(pcm, this.inRate, RATE).subarray(0, Math.round((RATE * VOICE_MAX_MS) / 1000));
    this.onDone?.({ data: encodeMuLaw(normalize(down)), ms: Math.round((down.length / RATE) * 1000) });
  }

  cancel() {
    this.onChunk = undefined;
    this.pending = [];
    this.pendingLen = 0;
    this.recording = false;
    clearTimeout(this.timer);
    this.cleanup();
    this.chunks = [];
  }

  /** Nivel de entrada actual 0..1 (para el indicador del micro) */
  level() {
    const c = this.chunks[this.chunks.length - 1];
    if (!c) return 0;
    let peak = 0;
    for (let i = 0; i < c.length; i += 16) peak = Math.max(peak, Math.abs(c[i]));
    return Math.min(1, peak * 2);
  }

  private cleanup() {
    this.node?.disconnect();
    this.node = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    void this.ctx?.close();
    this.ctx = null;
  }
}

/** Reproduce clips de uno en uno (nunca se solapan) */
export class VoicePlayer {
  private queue: { data: string; onStart?: () => void; onEnd?: () => void }[] = [];
  private isPlaying = false;
  private ctx: AudioContext | null = null;
  enabled = true;

  /** Llamar tras un gesto del usuario para que el navegador permita el sonido */
  unlock() {
    const c = this.context();
    if (!c) return;
    void c.resume();
    // Safari (iPhone) necesita reproducir algo dentro del toque para desbloquear el audio
    if (!this.unlocked) {
      this.unlocked = true;
      try {
        const b = c.createBuffer(1, 1, 22050);
        const s = c.createBufferSource();
        s.buffer = b;
        s.connect(c.destination);
        s.start();
      } catch {
        /* nada */
      }
    }
  }
  private unlocked = false;

  get playing() {
    return this.isPlaying || this.streams.size > 0;
  }

  private streams = new Map<string, { cursor: number; timer: number; onEnd?: () => void }>();

  /**
   * Reproduce un trozo de un mensaje en directo. Los trozos de la misma clave se encadenan
   * sin huecos; el primero espera un pequeño colchón por si la red va a tirones.
   */
  playChunk(key: string, data: string, last: boolean, onStart?: () => void, onEnd?: () => void) {
    if (!this.enabled) return;
    const ctx = this.context();
    if (!ctx) return;
    void ctx.resume();
    const now = ctx.currentTime;
    let st = this.streams.get(key);
    if (!st) {
      st = { cursor: now + JITTER_S, timer: 0, onEnd };
      this.streams.set(key, st);
      onStart?.();
    }
    // Si un trozo llega tarde, se reengancha sin acumular retraso
    if (st.cursor < now + 0.03) st.cursor = now + 0.06;
    try {
      const pcm = upsample(decodeMuLaw(data), RATE, PLAY_RATE);
      if (pcm.length) {
        const buf = ctx.createBuffer(1, pcm.length, PLAY_RATE);
        buf.getChannelData(0).set(pcm);
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.connect(this.chain(ctx));
        src.start(st.cursor);
        st.cursor += buf.duration;
      }
    } catch {
      /* trozo dañado: se salta */
    }
    clearTimeout(st.timer);
    const s = st;
    st.timer = window.setTimeout(
      () => {
        this.streams.delete(key);
        s.onEnd?.();
      },
      (st.cursor - now) * 1000 + (last ? 80 : 1600),
    );
  }

  /** Filtro «de radio» compartido */
  private chainNode: AudioNode | null = null;
  private chain(ctx: AudioContext) {
    if (!this.chainNode) {
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 280;
      const gain = ctx.createGain();
      gain.gain.value = 1.4;
      hp.connect(gain).connect(ctx.destination);
      this.chainNode = hp;
    }
    return this.chainNode;
  }

  private context() {
    if (!this.ctx) {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return null;
      this.ctx = new Ctx();
    }
    return this.ctx;
  }

  play(data: string, onStart?: () => void, onEnd?: () => void) {
    if (!this.enabled) return;
    this.queue.push({ data, onStart, onEnd });
    if (!this.isPlaying) this.next();
  }

  private next() {
    const item = this.queue.shift();
    const ctx = this.context();
    if (!item || !ctx) {
      this.isPlaying = false;
      return;
    }
    this.isPlaying = true;
    try {
      const pcm = upsample(decodeMuLaw(item.data), RATE, PLAY_RATE);
      const buf = ctx.createBuffer(1, pcm.length, PLAY_RATE);
      buf.getChannelData(0).set(pcm);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      // Un toque de «radio»: filtro de banda telefónica
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 280;
      const gain = ctx.createGain();
      gain.gain.value = 1.4;
      src.connect(hp).connect(gain).connect(ctx.destination);
      void ctx.resume();
      item.onStart?.();
      src.onended = () => {
        item.onEnd?.();
        this.next();
      };
      src.start();
    } catch {
      item.onEnd?.();
      this.next();
    }
  }
}

// ------------------------------------------------------------ Utilidades de audio
function concat(chunks: Float32Array[]) {
  const n = chunks.reduce((a, c) => a + c.length, 0);
  const out = new Float32Array(n);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

function downsample(pcm: Float32Array, from: number, to: number) {
  if (from === to) return pcm;
  const ratio = from / to;
  const n = Math.floor(pcm.length / ratio);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.floor(i * ratio);
    const b = Math.min(pcm.length, Math.floor((i + 1) * ratio));
    let s = 0;
    for (let k = a; k < b; k++) s += pcm[k];
    out[i] = s / Math.max(1, b - a);
  }
  return out;
}

function upsample(pcm: Float32Array, from: number, to: number) {
  const ratio = to / from;
  const out = new Float32Array(Math.floor(pcm.length * ratio));
  for (let i = 0; i < out.length; i++) {
    const x = i / ratio;
    const a = Math.floor(x);
    const k = x - a;
    out[i] = (pcm[a] ?? 0) * (1 - k) + (pcm[a + 1] ?? pcm[a] ?? 0) * k;
  }
  return out;
}

/** Sube el volumen de las voces bajas (sin saturar) */
function normalize(pcm: Float32Array) {
  let peak = 0;
  for (const v of pcm) peak = Math.max(peak, Math.abs(v));
  const g = peak > 0.01 ? Math.min(4, 0.9 / peak) : 1;
  if (g !== 1) for (let i = 0; i < pcm.length; i++) pcm[i] *= g;
  return pcm;
}

export function encodeMuLaw(pcm: Float32Array) {
  const bytes = new Uint8Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) {
    let s = Math.max(-1, Math.min(1, pcm[i])) * 32767;
    const sign = s < 0 ? 0x80 : 0;
    if (sign) s = -s;
    s = Math.min(32635, s + 132);
    let exp = 7;
    for (let mask = 0x4000; (s & mask) === 0 && exp > 0; mask >>= 1) exp--;
    const man = (s >> (exp + 3)) & 0x0f;
    bytes[i] = ~(sign | (exp << 4) | man) & 0xff;
  }
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function decodeMuLaw(b64: string) {
  const bin = atob(b64);
  const out = new Float32Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    const u = ~bin.charCodeAt(i) & 0xff;
    const sign = u & 0x80;
    const exp = (u >> 4) & 0x07;
    const man = u & 0x0f;
    let s = ((man << 3) + 132) << exp;
    s -= 132;
    out[i] = (sign ? -s : s) / 32768;
  }
  return out;
}
