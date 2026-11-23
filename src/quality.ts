import { store, type QualityLevel, type QualitySetting } from './settings';

export interface QualityPreset {
  /** Resolución interna máxima (pixel ratio) */
  maxPixelRatio: number;
  /** Bloom (brillo de luces) y fracción de resolución con la que se calcula */
  bloom: boolean;
  bloomScale: number;
  /** Partículas extra (chispas, humo, fuego) */
  fxHigh: boolean;
  /** Distancia de dibujado (chunks de ciudad alrededor) */
  radius: number;
}

export const QUALITY_LEVELS: QualityLevel[] = ['low', 'medium', 'high'];

export const QUALITY_LABELS: Record<QualitySetting, string> = {
  auto: 'Automática',
  low: 'Baja',
  medium: 'Media',
  high: 'Alta',
};

export function qualityPreset(level: QualityLevel, touch: boolean): QualityPreset {
  switch (level) {
    case 'low':
      return { maxPixelRatio: 1, bloom: false, bloomScale: 0.25, fxHigh: false, radius: 4 };
    case 'medium':
      return { maxPixelRatio: 1.5, bloom: true, bloomScale: 0.25, fxHigh: false, radius: 5 };
    default:
      return { maxPixelRatio: 2, bloom: true, bloomScale: 0.5, fxHigh: true, radius: touch ? 6 : 7 };
  }
}

/**
 * Calidad automática: mide los FPS mientras se juega y baja (o sube) un nivel
 * cuando hace falta. Una vez que baja de un nivel no vuelve a subir a él en la sesión.
 */
export class AutoQuality {
  level: QualityLevel;
  private cap: number;
  private frames = 0;
  private time = 0;
  private goodWindows = 0;
  private warmup = 3;
  onChange?: (level: QualityLevel, reason: 'down' | 'up') => void;

  constructor(touch: boolean) {
    const saved = store.get('gfx.auto') as QualityLevel | null;
    this.level = saved && QUALITY_LEVELS.includes(saved) ? saved : touch ? 'medium' : 'high';
    this.cap = QUALITY_LEVELS.length - 1;
  }

  /** Reinicia la medición (p. ej. al empezar una partida o tras un cambio) */
  restart() {
    this.frames = 0;
    this.time = 0;
    this.goodWindows = 0;
    this.warmup = 3;
  }

  /** Llamar cada frame mientras se juega. dt real sin recortar. */
  sample(dt: number) {
    if (this.warmup > 0) {
      this.warmup -= dt;
      return;
    }
    this.frames++;
    this.time += dt;
    if (this.time < 4) return;
    const fps = this.frames / this.time;
    this.frames = 0;
    this.time = 0;
    const i = QUALITY_LEVELS.indexOf(this.level);
    if (fps < 38 && i > 0) {
      this.cap = i - 1;
      this.set(QUALITY_LEVELS[i - 1], 'down');
    } else if (fps > 57 && i < this.cap) {
      this.goodWindows++;
      if (this.goodWindows >= 3) this.set(QUALITY_LEVELS[i + 1], 'up');
    } else this.goodWindows = 0;
  }

  private set(level: QualityLevel, reason: 'down' | 'up') {
    this.level = level;
    store.set('gfx.auto', level);
    this.restart();
    this.onChange?.(level, reason);
  }
}
