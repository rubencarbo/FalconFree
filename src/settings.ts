/** Ajustes del jugador, guardados en el navegador */

export type QualityLevel = 'low' | 'medium' | 'high';
export type QualitySetting = 'auto' | QualityLevel;

/** Forma de la estela del camino (carreras y reparto) */
export type TrailStyleSetting = 'chevrons' | 'dots' | 'line' | 'near' | 'off';
export interface TrailTune {
  /** separación entre marcas (m) */
  gap: number;
  /** intensidad 0.15..1 */
  opacity: number;
}
export interface TrailSettings {
  style: TrailStyleSetting;
  /** ajustes propios de cada forma */
  tune: Partial<Record<TrailStyleSetting, TrailTune>>;
}

export type ControlId = 'joy' | 'boost' | 'fire' | 'missile' | 'brake' | 'talk';

export interface ControlLayout {
  /** Centro del control como fracción del ancho/alto de la pantalla */
  x: number;
  y: number;
  /** 0.6 .. 2 */
  scale: number;
  /** 0.2 .. 1 */
  opacity: number;
}

export interface Settings {
  name: string;
  invertY: boolean;
  muted: boolean;
  /** 0.5 .. 1.5 */
  sensitivity: number;
  aimAssist: boolean;
  /** Calidad gráfica: automática o fija */
  quality: QualitySetting;
  /** Clima variable (lluvia, niebla, tormenta…) */
  weather: boolean;
  vibration: boolean;
  /** Mostrar el fantasma de tu mejor vuelta */
  ghost: boolean;
  /** Oír los mensajes de voz de otros pilotos */
  voice: boolean;
  trail: TrailSettings;
  /** tamaño (px) de los avatares de otros pilotos; 0 = ocultos */
  avatarSize: number;
  /** estilo píxel (resolución baja + tramado de color) */
  pixel: boolean;
  /** estilo píxel elegido (1..5) */
  pixelMode: number;
  /** inclinación de la cámara con el alabeo, 0..100 % */
  camTilt: number;
  /** HUD clásico o compacto */
  hud: 'classic' | 'compact';
  controls: Record<ControlId, ControlLayout>;
}

export const CONTROL_IDS: ControlId[] = ['joy', 'fire', 'missile', 'boost', 'brake', 'talk'];

export const CONTROL_LABELS: Record<ControlId, string> = {
  joy: 'Joystick',
  fire: 'Disparo',
  boost: 'Turbo',
  missile: 'Misil',
  brake: 'Freno',
  talk: 'Hablar',
};

/** Tamaño base en px (a escala 1) */
export const CONTROL_BASE_SIZE: Record<ControlId, number> = {
  joy: 130,
  fire: 80,
  boost: 92,
  missile: 60,
  brake: 64,
  talk: 62,
};

export function defaultControls(): Record<ControlId, ControlLayout> {
  return {
    joy: { x: 0.2, y: 0.74, scale: 1, opacity: 0.9 },
    fire: { x: 0.64, y: 0.84, scale: 1, opacity: 0.95 },
    boost: { x: 0.84, y: 0.74, scale: 1, opacity: 0.95 },
    missile: { x: 0.58, y: 0.62, scale: 1, opacity: 0.95 },
    brake: { x: 0.9, y: 0.52, scale: 1, opacity: 0.95 },
    talk: { x: 0.74, y: 0.55, scale: 1, opacity: 0.95 },
  };
}


function defaults(): Settings {
  return {
    name: '',
    invertY: false,
    muted: false,
    sensitivity: 1,
    aimAssist: true,
    quality: 'auto',
    weather: true,
    vibration: true,
    ghost: true,
    voice: true,
    trail: { style: 'chevrons', tune: {} },
    avatarSize: 44,
    pixel: false,
    pixelMode: 4,
    camTilt: 28,
    hud: 'classic',
    controls: defaultControls(),
  };
}

const KEY = 'ff.settings';

export function loadSettings(): Settings {
  const d = defaults();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) {
      // Migrar claves de la versión anterior
      d.name = localStorage.getItem('ff.name') ?? '';
      d.invertY = localStorage.getItem('ff.invertY') === '1';
      d.muted = localStorage.getItem('ff.muted') === '1';
      return d;
    }
    const s = JSON.parse(raw) as Partial<Settings>;
    const controls = { ...d.controls };
    for (const id of CONTROL_IDS) {
      const c = s.controls?.[id];
      if (c && [c.x, c.y, c.scale, c.opacity].every((v) => typeof v === 'number' && isFinite(v))) {
        controls[id] = sanitize(c);
      }
    }
    return {
      name: typeof s.name === 'string' ? s.name.slice(0, 16) : d.name,
      invertY: !!s.invertY,
      muted: !!s.muted,
      sensitivity: clamp(Number(s.sensitivity ?? 1), 0.5, 1.5),
      aimAssist: s.aimAssist ?? true,
      quality: (['auto', 'low', 'medium', 'high'] as const).includes(s.quality as QualitySetting) ? (s.quality as QualitySetting) : d.quality,
      weather: s.weather ?? true,
      vibration: s.vibration ?? true,
      ghost: s.ghost ?? true,
      voice: s.voice ?? true,
      trail: sanitizeTrail(s.trail),
      avatarSize: clamp(Number(s.avatarSize ?? 44), 0, 96) || 0,
      pixel: !!s.pixel,
      pixelMode: [1, 3, 4, 5].includes(Number(s.pixelMode)) ? Number(s.pixelMode) : 4,
      camTilt: clamp(Number(s.camTilt ?? 28), 0, 100),
      hud: s.hud === 'compact' ? 'compact' : 'classic',
      controls,
    };
  } catch {
    return d;
  }
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* sin almacenamiento disponible */
  }
}

export function sanitize(c: ControlLayout): ControlLayout {
  return {
    x: clamp(c.x, 0, 1),
    y: clamp(c.y, 0, 1),
    scale: clamp(c.scale, 0.6, 2),
    opacity: clamp(c.opacity, 0.2, 1),
  };
}

export function clamp(v: number, a: number, b: number) {
  return v < a ? a : v > b ? b : v;
}

/** Almacén genérico (récords, etc.) con tolerancia a errores */
export const store = {
  get(k: string): string | null {
    try {
      return localStorage.getItem(`ff.${k}`);
    } catch {
      return null;
    }
  },
  set(k: string, v: string) {
    try {
      localStorage.setItem(`ff.${k}`, v);
    } catch {
      /* sin almacenamiento */
    }
  },
};

const TRAIL_IDS: TrailStyleSetting[] = ['chevrons', 'dots', 'line', 'near', 'off'];

function sanitizeTrail(t: Partial<TrailSettings> | undefined): TrailSettings {
  const style = t && TRAIL_IDS.includes(t.style as TrailStyleSetting) ? (t.style as TrailStyleSetting) : 'chevrons';
  const tune: TrailSettings['tune'] = {};
  for (const id of TRAIL_IDS) {
    const v = t?.tune?.[id];
    if (v && isFinite(v.gap) && isFinite(v.opacity)) tune[id] = { gap: clamp(v.gap, 15, 300), opacity: clamp(v.opacity, 0.15, 1) };
  }
  return { style, tune };
}
