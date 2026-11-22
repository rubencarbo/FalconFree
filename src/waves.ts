/** Modo Oleadas: composición de cada oleada y mejoras entre oleadas */

export type UpgradeKey = 'damage' | 'rate' | 'armor' | 'regen' | 'missiles' | 'vampire' | 'speed' | 'shield' | 'aim' | 'ammo';

export interface WaveUpgrade {
  key: UpgradeKey;
  name: string;
  description: string;
  max: number;
}

export const WAVE_UPGRADES: WaveUpgrade[] = [
  { key: 'damage', name: 'Munición pesada', description: '+25 % de daño', max: 4 },
  { key: 'rate', name: 'Cañones rápidos', description: '+20 % de cadencia', max: 3 },
  { key: 'armor', name: 'Blindaje reforzado', description: '+25 % de blindaje y reparación total', max: 3 },
  { key: 'regen', name: 'Autorreparación', description: 'Recupera 2 de blindaje por segundo', max: 3 },
  { key: 'missiles', name: 'Arsenal', description: '+2 misiles y más capacidad', max: 3 },
  { key: 'vampire', name: 'Vampiro', description: 'Cada derribo repara 15', max: 3 },
  { key: 'speed', name: 'Motor turbo', description: '+8 % de velocidad', max: 3 },
  { key: 'shield', name: 'Escudo pulsante', description: 'Escudo de 4 s cada 20 s', max: 1 },
  { key: 'aim', name: 'Puntería', description: 'Apuntado asistido más amplio y lejano', max: 2 },
  { key: 'ammo', name: 'Cinta de munición', description: '+80 balas y recarga 4 por segundo', max: 2 },
];

export interface WavePlan {
  drones: number;
  bots: number;
  droneHp: number;
  botSkill: number;
}

/** Cuántos enemigos trae la oleada n (1, 2, 3…) */
export function wavePlan(n: number): WavePlan {
  return {
    drones: Math.min(14, 2 + n * 2),
    bots: n < 3 ? 0 : Math.min(6, Math.floor((n - 1) / 2)),
    droneHp: 24 + n * 3,
    botSkill: Math.min(0.95, 0.45 + n * 0.05),
  };
}

/** Tres mejoras al azar que aún se puedan subir */
export function pickUpgrades(levels: Partial<Record<UpgradeKey, number>>, n = 3): WaveUpgrade[] {
  const pool = WAVE_UPGRADES.filter((u) => (levels[u.key] ?? 0) < u.max);
  const out: WaveUpgrade[] = [];
  while (out.length < n && pool.length) out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  return out;
}
