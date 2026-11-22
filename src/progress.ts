import { store } from './settings';

import { STANDARD_WEAPON, type WeaponDef } from './combat';

import type { PlaneVariant } from './jet';

export type PlaneId = PlaneVariant;
export type UpgradeId = 'engine' | 'armor' | 'ammo';

export interface PlaneDef {
  id: PlaneId;
  name: string;
  tier: 'basic' | 'advanced';
  description: string;
  speed: number;
  agility: number;
  armor: number;
  cost: number;
  weapon: WeaponDef;
  /** Logro que también lo desbloquea */
  achievement?: string;
  /** Color del fuego del motor */
  flame?: number;
}

export const PLANES: PlaneDef[] = [
  // Básicos
  { id: 'falcon', tier: 'basic', name: 'Halcón', description: 'Equilibrado. El caza de siempre.', speed: 1, agility: 1, armor: 1, cost: 0, weapon: STANDARD_WEAPON },
  { id: 'sparrow', tier: 'basic', name: 'Gorrión', description: 'Avioneta de entrenamiento: ligera y muy manejable.', speed: 0.94, agility: 1.18, armor: 0.85, cost: 250, weapon: STANDARD_WEAPON },
  { id: 'raptor', tier: 'basic', name: 'Raptor', description: 'El más rápido de los básicos, algo frágil.', speed: 1.12, agility: 0.94, armor: 0.85, cost: 800, weapon: STANDARD_WEAPON },
  { id: 'typhoon', tier: 'basic', name: 'Tifón', description: 'Un tanque volador: aguanta mucho más.', speed: 0.95, agility: 0.88, armor: 1.6, cost: 1200, weapon: STANDARD_WEAPON },
  // Avanzados: diseños elaborados y mejores armas
  {
    id: 'specter',
    tier: 'advanced',
    name: 'Espectro',
    description: 'Ala volante furtiva con luces cian.',
    speed: 1.1,
    agility: 1.1,
    armor: 1,
    cost: 3000,
    achievement: 'imparable',
    flame: 0x40e0ff,
    weapon: { ...STANDARD_WEAPON, name: 'Cañón láser', description: 'Disparos lentos pero muy rápidos y dañinos.', fireRate: 9, damage: 6, speed: 1500, tracer: [0.6, 2.4, 3.4], lockRange: 1500 },
  },
  {
    id: 'phoenix',
    tier: 'advanced',
    name: 'Fénix',
    description: 'Alas en flecha invertida. Gira como nadie.',
    speed: 1.08,
    agility: 1.28,
    armor: 1.05,
    cost: 3500,
    flame: 0xff4a10,
    weapon: { ...STANDARD_WEAPON, name: 'Ametralladoras cuádruples', description: 'Cuatro cañones y cadencia altísima.', fireRate: 22, damage: 2.8, barrels: 4, tracer: [3.4, 1.2, 0.4] },
  },
  {
    id: 'mantis',
    tier: 'advanced',
    name: 'Mantis',
    description: 'Doble fuselaje con lanzamisiles múltiple.',
    speed: 1.0,
    agility: 1.15,
    armor: 1.25,
    cost: 4000,
    achievement: 'diario_7',
    flame: 0xc070ff,
    weapon: { ...STANDARD_WEAPON, name: 'Lanzamisiles múltiple', description: 'Hasta 6 misiles y cañones reforzados.', damage: 4.2, missiles: 6, tracer: [2.6, 1.2, 3.4] },
  },
  {
    id: 'storm',
    tier: 'advanced',
    name: 'Tormenta',
    description: 'Cañonera pesada de cuatro motores.',
    speed: 0.95,
    agility: 0.92,
    armor: 1.9,
    cost: 4500,
    flame: 0xffc040,
    weapon: { ...STANDARD_WEAPON, name: 'Cañón triple', description: 'Tres cañones en abanico: difícil fallar.', fireRate: 15, damage: 4.2, barrels: 3, spread: 0.9, tracer: [1.2, 3.4, 1.0], cone: 24 },
  },
  {
    id: 'comet',
    tier: 'advanced',
    name: 'Cometa',
    description: 'Interceptor de morro de aguja: el más veloz.',
    speed: 1.24,
    agility: 1.05,
    armor: 0.95,
    cost: 5000,
    flame: 0x6a8aff,
    weapon: { ...STANDARD_WEAPON, name: 'Cañón de riel', description: 'Proyectiles supersónicos de largo alcance.', fireRate: 7, damage: 8.5, speed: 2100, tracer: [2.8, 2.8, 3.6], lockRange: 1800, cone: 14 },
  },
];

export interface PaintDef {
  id: string;
  name: string;
  body: number;
  accent: number;
  cost?: number;
  achievement?: string;
}

export const PAINTS: PaintDef[] = [
  { id: 'standard', name: 'Acero', body: 0x40454e, accent: 0xff7a1a },
  { id: 'arctic', name: 'Ártico', body: 0xd0d8e2, accent: 0x2ec5ff, cost: 300 },
  { id: 'desert', name: 'Desierto', body: 0xb8935c, accent: 0x5a3f22, cost: 300 },
  { id: 'navy', name: 'Marina', body: 0x2a3f6a, accent: 0xffe04a, cost: 500 },
  { id: 'camo', name: 'Camuflaje', body: 0x4a5a3a, accent: 0x2a3020, achievement: 'carrera_1' },
  { id: 'night', name: 'Nocturno', body: 0x1a1d24, accent: 0xff3b3b, achievement: 'as' },
  { id: 'neon', name: 'Neón', body: 0x2a1a40, accent: 0x5cff8a, achievement: 'rasante' },
  { id: 'gold', name: 'Oro', body: 0xc89a30, accent: 0xfff2b0, achievement: 'imparable' },
];

export const UPGRADES: { id: UpgradeId; name: string; per: string; costs: number[] }[] = [
  { id: 'engine', name: 'Motor', per: '+4 % velocidad', costs: [300, 600, 1000] },
  { id: 'armor', name: 'Blindaje', per: '+10 % blindaje', costs: [300, 600, 1000] },
  { id: 'ammo', name: 'Cargador', per: '+20 balas', costs: [250, 500, 900] },
];

export interface Stats {
  rings: number;
  drones: number;
  kills: number;
  deaths: number;
  races: number;
  battlesWon: number;
  battles: number;
  missileHits: number;
  flaresDodged: number;
  scrapes: number;
  powerups: number;
  ghostBeaten: number;
  dailies: number;
  mpGames: number;
  bestStreak: number;
  maxSpeed: number;
  lowFlight: number;
  timeBonuses: number;
}

export interface Achievement {
  id: string;
  name: string;
  description: string;
  reward: number;
  done: (s: Stats) => boolean;
}

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'anillo_1', name: 'Primer anillo', description: 'Atraviesa un anillo.', reward: 50, done: (s) => s.rings >= 1 },
  { id: 'anillos_100', name: 'Coleccionista', description: 'Atraviesa 100 anillos en total.', reward: 300, done: (s) => s.rings >= 100 },
  { id: 'dron_1', name: 'Cazador', description: 'Derriba un dron.', reward: 50, done: (s) => s.drones >= 1 },
  { id: 'dron_25', name: 'Exterminador', description: 'Derriba 25 drones.', reward: 300, done: (s) => s.drones >= 25 },
  { id: 'carrera_1', name: 'Bautismo de carrera', description: 'Completa una carrera.', reward: 100, done: (s) => s.races >= 1 },
  { id: 'ruta_baja', name: 'Ruta baja', description: 'Consigue 10 anillos de −1 s en carreras.', reward: 150, done: (s) => s.timeBonuses >= 10 },
  { id: 'fantasma', name: 'Supérate', description: 'Bate a tu fantasma en una carrera.', reward: 150, done: (s) => s.ghostBeaten >= 1 },
  { id: 'diario', name: 'Constante', description: 'Completa un desafío diario.', reward: 200, done: (s) => s.dailies >= 1 },
  { id: 'diario_7', name: 'Disciplina', description: 'Completa 7 desafíos diarios.', reward: 500, done: (s) => s.dailies >= 7 },
  { id: 'rozadura', name: 'Por los pelos', description: 'Sobrevive a 10 rozaduras.', reward: 100, done: (s) => s.scrapes >= 10 },
  { id: 'rasante', name: 'Rasante', description: 'Vuela 5 s a menos de 30 m del suelo a más de 900 km/h.', reward: 200, done: (s) => s.lowFlight >= 5 },
  { id: 'velocidad', name: 'A toda máquina', description: 'Supera los 1800 km/h.', reward: 100, done: (s) => s.maxSpeed >= 1800 },
  { id: 'misil', name: 'Fuego y olvido', description: 'Acierta con un misil.', reward: 100, done: (s) => s.missileHits >= 1 },
  { id: 'bengalas', name: 'Ilusionista', description: 'Esquiva un misil con bengalas.', reward: 150, done: (s) => s.flaresDodged >= 1 },
  { id: 'recompensas', name: 'Recolector', description: 'Recoge 15 recompensas.', reward: 150, done: (s) => s.powerups >= 15 },
  { id: 'as', name: 'As del aire', description: 'Consigue 10 derribos en batallas.', reward: 300, done: (s) => s.kills >= 10 },
  { id: 'imparable', name: 'Imparable', description: '5 derribos seguidos sin caer.', reward: 400, done: (s) => s.bestStreak >= 5 },
  { id: 'victoria', name: 'Victoria', description: 'Gana una batalla.', reward: 200, done: (s) => s.battlesWon >= 1 },
  { id: 'escuadron', name: 'Escuadrón', description: 'Juega una partida multijugador.', reward: 100, done: (s) => s.mpGames >= 1 },
];

export interface Profile {
  credits: number;
  stats: Stats;
  achievements: Record<string, number>;
  plane: PlaneId;
  paint: string;
  planes: PlaneId[];
  paints: string[];
  upgrades: Record<UpgradeId, number>;
  daily: Record<string, number>;
}

function emptyStats(): Stats {
  return {
    rings: 0, drones: 0, kills: 0, deaths: 0, races: 0, battlesWon: 0, battles: 0, missileHits: 0, flaresDodged: 0,
    scrapes: 0, powerups: 0, ghostBeaten: 0, dailies: 0, mpGames: 0, bestStreak: 0, maxSpeed: 0, lowFlight: 0, timeBonuses: 0,
  };
}

function defaults(): Profile {
  return {
    credits: 0,
    stats: emptyStats(),
    achievements: {},
    plane: 'falcon',
    paint: 'standard',
    planes: ['falcon'],
    paints: ['standard'],
    upgrades: { engine: 0, armor: 0, ammo: 0 },
    daily: {},
  };
}

export class Progress {
  p: Profile;
  onUnlock?: (a: Achievement) => void;
  onCredits?: (amount: number, reason: string) => void;
  private dirty = false;

  constructor() {
    const d = defaults();
    try {
      const raw = store.get('profile');
      const s = raw ? (JSON.parse(raw) as Partial<Profile>) : {};
      this.p = {
        ...d,
        ...s,
        stats: { ...d.stats, ...(s.stats ?? {}) },
        upgrades: { ...d.upgrades, ...(s.upgrades ?? {}) },
        achievements: { ...(s.achievements ?? {}) },
        daily: { ...(s.daily ?? {}) },
        planes: Array.from(new Set(['falcon', ...(s.planes ?? []).map((x) => ((x as string) === 'colibri' ? 'phoenix' : x))])).filter((x) => PLANES.some((pl) => pl.id === x)) as PlaneId[],
        paints: Array.from(new Set(['standard', ...(s.paints ?? [])])),
      };
      if ((this.p.plane as string) === 'colibri') this.p.plane = 'phoenix';
      if (!PLANES.some((pl) => pl.id === this.p.plane)) this.p.plane = 'falcon';
    } catch {
      this.p = d;
    }
    // Guardado periódico
    setInterval(() => this.flush(), 4000);
    window.addEventListener('pagehide', () => this.flush());
  }

  flush() {
    if (!this.dirty) return;
    this.dirty = false;
    store.set('profile', JSON.stringify(this.p));
  }

  save() {
    this.dirty = true;
  }

  get plane(): PlaneDef {
    return PLANES.find((x) => x.id === this.p.plane) ?? PLANES[0];
  }

  get paint(): PaintDef {
    return PAINTS.find((x) => x.id === this.p.paint) ?? PAINTS[0];
  }

  /** Multiplicadores finales (avión + mejoras) */
  get modifiers() {
    const pl = this.plane;
    const u = this.p.upgrades;
    return {
      speed: pl.speed * (1 + u.engine * 0.04),
      agility: pl.agility,
      armor: pl.armor * (1 + u.armor * 0.1),
      ammoBonus: u.ammo * 20,
    };
  }

  credit(amount: number, reason: string) {
    if (amount <= 0) return;
    this.p.credits += Math.round(amount);
    this.save();
    this.onCredits?.(Math.round(amount), reason);
  }

  add(stat: keyof Stats, n = 1) {
    this.p.stats[stat] += n;
    this.save();
    this.check();
  }

  max(stat: keyof Stats, v: number) {
    if (v > this.p.stats[stat]) {
      this.p.stats[stat] = v;
      this.save();
      this.check();
    }
  }

  check() {
    for (const a of ACHIEVEMENTS) {
      if (this.p.achievements[a.id] || !a.done(this.p.stats)) continue;
      this.p.achievements[a.id] = Date.now();
      this.p.credits += a.reward;
      // Desbloqueos ligados al logro
      for (const pt of PAINTS) if (pt.achievement === a.id && !this.p.paints.includes(pt.id)) this.p.paints.push(pt.id);
      for (const pl of PLANES) if (pl.achievement === a.id && !this.p.planes.includes(pl.id)) this.p.planes.push(pl.id);
      this.save();
      this.onUnlock?.(a);
    }
  }

  buyPlane(id: PlaneId) {
    const pl = PLANES.find((x) => x.id === id);
    if (!pl || this.p.planes.includes(id) || this.p.credits < pl.cost) return false;
    this.p.credits -= pl.cost;
    this.p.planes.push(id);
    this.p.plane = id;
    this.save();
    return true;
  }

  buyPaint(id: string) {
    const pt = PAINTS.find((x) => x.id === id);
    if (!pt || this.p.paints.includes(id) || pt.cost === undefined || this.p.credits < pt.cost) return false;
    this.p.credits -= pt.cost;
    this.p.paints.push(id);
    this.p.paint = id;
    this.save();
    return true;
  }

  buyUpgrade(id: UpgradeId) {
    const up = UPGRADES.find((u) => u.id === id)!;
    const lvl = this.p.upgrades[id];
    const cost = up.costs[lvl];
    if (cost === undefined || this.p.credits < cost) return false;
    this.p.credits -= cost;
    this.p.upgrades[id] = lvl + 1;
    this.save();
    return true;
  }

  select(kind: 'plane' | 'paint', id: string) {
    if (kind === 'plane' && this.p.planes.includes(id as PlaneId)) this.p.plane = id as PlaneId;
    if (kind === 'paint' && this.p.paints.includes(id)) this.p.paint = id;
    this.save();
  }
}
