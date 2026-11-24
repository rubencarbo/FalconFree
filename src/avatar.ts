/**
 * Avatar del piloto: uno predefinido (emoji sobre color) o una foto recortada por la cara.
 * Se guarda como texto corto:
 *   - "e:<índice>"                       → avatar predefinido
 *   - "data:image/jpeg;base64,…"         → foto recortada (≈128 px, < 14 KB)
 * En multijugador viaja en rooms/{code}/players/{uid}/av (sin Storage: plan gratuito).
 */

export const AVATAR_PRESETS: { e: string; bg: string }[] = [
  { e: '🦅', bg: '#ff8a2a' },
  { e: '🦉', bg: '#7a5cff' },
  { e: '🐺', bg: '#4a6a8a' },
  { e: '🦊', bg: '#ff6a3a' },
  { e: '🐯', bg: '#ffb020' },
  { e: '🦁', bg: '#d89a30' },
  { e: '🐼', bg: '#60c090' },
  { e: '🐸', bg: '#40b060' },
  { e: '🐵', bg: '#b07850' },
  { e: '🐲', bg: '#30a080' },
  { e: '🦈', bg: '#3a80d0' },
  { e: '🐙', bg: '#e05090' },
  { e: '🤖', bg: '#7890a8' },
  { e: '👽', bg: '#50c0a0' },
  { e: '👾', bg: '#9050e0' },
  { e: '🧑‍✈️', bg: '#2e9ad8' },
  { e: '👩‍✈️', bg: '#d0407a' },
  { e: '😎', bg: '#f0c030' },
  { e: '🤠', bg: '#c08040' },
  { e: '🥷', bg: '#404858' },
];

/** Tamaño máximo del texto del avatar (también lo limitan las reglas de la base de datos) */
export const AVATAR_MAX_LEN = 14000;

const KEY = 'ff.avatar';

export function loadAvatar(): string {
  try {
    const v = localStorage.getItem(KEY) ?? '';
    return isAvatar(v) ? v : '';
  } catch {
    return '';
  }
}

export function saveAvatar(v: string) {
  try {
    if (v) localStorage.setItem(KEY, v);
    else localStorage.removeItem(KEY);
  } catch {
    /* sin almacenamiento */
  }
}

export function isAvatar(v: unknown): v is string {
  if (typeof v !== 'string' || !v || v.length > AVATAR_MAX_LEN) return false;
  if (/^e:\d{1,2}$/.test(v)) return Number(v.slice(2)) < AVATAR_PRESETS.length;
  return /^data:image\/(jpeg|webp|png);base64,[A-Za-z0-9+/=]+$/.test(v);
}

const cache = new Map<string, string>();

/** URL que se puede poner en un <img> (los predefinidos se dibujan una vez en un canvas) */
export function avatarSrc(v: string | undefined | null): string | null {
  if (!v || !isAvatar(v)) return null;
  if (v.startsWith('data:')) return v;
  let url = cache.get(v);
  if (url) return url;
  const p = AVATAR_PRESETS[Number(v.slice(2))];
  const c = document.createElement('canvas');
  c.width = c.height = 96;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(40, 32, 8, 48, 48, 60);
  g.addColorStop(0, lighten(p.bg));
  g.addColorStop(1, p.bg);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(48, 48, 48, 0, Math.PI * 2);
  ctx.fill();
  ctx.font = '58px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(p.e, 48, 54);
  url = c.toDataURL('image/png');
  cache.set(v, url);
  return url;
}

function lighten(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, ((n >> 16) & 255) + 60);
  const g = Math.min(255, ((n >> 8) & 255) + 60);
  const b = Math.min(255, (n & 255) + 60);
  return `rgb(${r},${g},${b})`;
}

/**
 * Herramienta de recorte: la foto se mueve arrastrando y se amplía con el deslizador,
 * la rueda del ratón o pellizcando. Lo que queda dentro del círculo es el avatar.
 */
export class AvatarCropper {
  private ctx: CanvasRenderingContext2D;
  private img: HTMLImageElement | null = null;
  private size = 280;
  private r = 118;
  private minScale = 1;
  private zoom = 1;
  /** posición del centro de la imagen en el lienzo */
  private cx = 140;
  private cy = 140;
  private pointers = new Map<number, { x: number; y: number }>();
  private pinch = 0;

  constructor(
    canvas: HTMLCanvasElement,
    private slider: HTMLInputElement,
  ) {
    this.ctx = canvas.getContext('2d')!;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = canvas.height = this.size * dpr;
    this.ctx.scale(dpr, dpr);
    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.pinch = this.pinchDist();
    });
    canvas.addEventListener('pointermove', (e) => {
      const prev = this.pointers.get(e.pointerId);
      if (!prev) return;
      const k = this.size / canvas.getBoundingClientRect().width;
      if (this.pointers.size === 1) {
        this.cx += (e.clientX - prev.x) * k;
        this.cy += (e.clientY - prev.y) * k;
      }
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 2) {
        const d = this.pinchDist();
        if (this.pinch > 0) this.setZoom(this.zoom * (d / this.pinch));
        this.pinch = d;
      }
      this.draw();
    });
    const up = (e: PointerEvent) => {
      this.pointers.delete(e.pointerId);
      this.pinch = this.pinchDist();
    };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.setZoom(this.zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08));
        this.draw();
      },
      { passive: false },
    );
    slider.addEventListener('input', () => {
      this.setZoom(Number(slider.value) / 100);
      this.draw();
    });
  }

  private pinchDist() {
    if (this.pointers.size < 2) return 0;
    const [a, b] = [...this.pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  private setZoom(z: number) {
    this.zoom = Math.min(5, Math.max(1, z));
    this.slider.value = String(Math.round(this.zoom * 100));
  }

  get ready() {
    return !!this.img;
  }

  /** Carga una foto (archivo elegido por el usuario) */
  async load(file: File) {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.decoding = 'async';
      img.src = url;
      await img.decode();
      this.img = img;
      // Escala mínima: la imagen cubre el círculo
      this.minScale = (this.r * 2) / Math.min(img.naturalWidth, img.naturalHeight);
      this.zoom = 1;
      this.slider.value = '100';
      this.cx = this.cy = this.size / 2;
      this.draw();
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }

  private clampPos() {
    const img = this.img!;
    const s = this.minScale * this.zoom;
    const hw = (img.naturalWidth * s) / 2;
    const hh = (img.naturalHeight * s) / 2;
    const c = this.size / 2;
    this.cx = Math.min(c - this.r + hw, Math.max(c + this.r - hw, this.cx));
    this.cy = Math.min(c - this.r + hh, Math.max(c + this.r - hh, this.cy));
  }

  draw() {
    const ctx = this.ctx;
    const S = this.size;
    ctx.clearRect(0, 0, S, S);
    ctx.fillStyle = '#10141e';
    ctx.fillRect(0, 0, S, S);
    if (!this.img) return;
    this.clampPos();
    const s = this.minScale * this.zoom;
    const w = this.img.naturalWidth * s;
    const h = this.img.naturalHeight * s;
    ctx.drawImage(this.img, this.cx - w / 2, this.cy - h / 2, w, h);
    // Oscurece fuera del círculo
    ctx.save();
    ctx.fillStyle = 'rgba(8, 10, 16, 0.62)';
    ctx.beginPath();
    ctx.rect(0, 0, S, S);
    ctx.arc(S / 2, S / 2, this.r, 0, Math.PI * 2, true);
    ctx.fill('evenodd');
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, this.r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  /** Recorta lo que hay dentro del círculo y lo devuelve como JPEG pequeño */
  export(): string | null {
    if (!this.img) return null;
    const s = this.minScale * this.zoom;
    const c = this.size / 2;
    // rectángulo del círculo en coordenadas de la imagen original
    const sx = (c - this.r - (this.cx - (this.img.naturalWidth * s) / 2)) / s;
    const sy = (c - this.r - (this.cy - (this.img.naturalHeight * s) / 2)) / s;
    const sw = (this.r * 2) / s;
    for (const [px, q] of [
      [128, 0.82],
      [112, 0.72],
      [96, 0.65],
      [80, 0.55],
    ] as const) {
      const out = document.createElement('canvas');
      out.width = out.height = px;
      const o = out.getContext('2d')!;
      o.imageSmoothingQuality = 'high';
      o.drawImage(this.img, sx, sy, sw, sw, 0, 0, px, px);
      const url = out.toDataURL('image/jpeg', q);
      if (url.length <= AVATAR_MAX_LEN) return url;
    }
    return null;
  }

  reset() {
    this.img = null;
    this.pointers.clear();
    this.draw();
  }
}
