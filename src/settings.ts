/** Ajustes del jugador, guardados en el navegador */

export type ControlId = 'joy' | 'boost' | 'fire' | 'missile' | 'flare';

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
  /** Bloom y partículas extra */
  effects: 'high' | 'low';
  /** Clima variable (lluvia, niebla, tormenta…) */
  weather: boolean;
  vibration: boolean;
  /** Mostrar el fantasma de tu mejor vuelta */
  ghost: boolean;
  controls: Record<ControlId, ControlLayout>;
}

export const CONTROL_IDS: ControlId[] = ['joy', 'fire', 'missile', 'flare', 'boost'];

export const CONTROL_LABELS: Record<ControlId, string> = {
  joy: 'Joystick',
  fire: 'Disparo',
  boost: 'Turbo',
  missile: 'Misil',
  flare: 'Bengalas',
};

/** Tamaño base en px (a escala 1) */
export const CONTROL_BASE_SIZE: Record<ControlId, number> = {
  joy: 130,
  fire: 80,
  boost: 92,
  missile: 60,
  flare: 54,
};

export function defaultControls(): Record<ControlId, ControlLayout> {
  return {
    joy: { x: 0.2, y: 0.74, scale: 1, opacity: 0.9 },
    fire: { x: 0.64, y: 0.84, scale: 1, opacity: 0.95 },
    boost: { x: 0.84, y: 0.74, scale: 1, opacity: 0.95 },
    missile: { x: 0.58, y: 0.62, scale: 1, opacity: 0.95 },
    flare: { x: 0.47, y: 0.93, scale: 1, opacity: 0.9 },
  };
}

const isTouch = typeof matchMedia !== 'undefined' && matchMedia('(hover: none), (pointer: coarse)').matches;

function defaults(): Settings {
  return {
    name: '',
    invertY: false,
    muted: false,
    sensitivity: 1,
    aimAssist: true,
    effects: isTouch ? 'low' : 'high',
    weather: true,
    vibration: true,
    ghost: true,
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
      effects: s.effects === 'low' || s.effects === 'high' ? s.effects : d.effects,
      weather: s.weather ?? true,
      vibration: s.vibration ?? true,
      ghost: s.ghost ?? true,
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
