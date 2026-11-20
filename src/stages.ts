export type StageId = 'metropolis' | 'archipelago' | 'dusk';

export interface Stage {
  id: StageId;
  name: string;
  description: string;
  seed: number;
  /** Umbral de agua (0..1): más alto = más agua */
  waterLevel: number;
  /** Escala del ruido de agua en metros */
  waterScale: number;
  /** Probabilidad de que una manzana sea parque */
  parkChance: number;
  /** Multiplicador de alturas de edificios */
  heightMul: number;
  night: boolean;
  sky: { top: string; horizon: string; fog: string };
  fogDensity: number;
  sun: { color: string; intensity: number; dir: [number, number, number] };
  hemi: { sky: string; ground: string; intensity: number };
  palette: {
    buildings: string[];
    water: [string, string, string];
    grass: [string, string];
    road: string;
    sidewalk: string;
    sand: string;
    lot: string;
    window: string;
    tree: [string, string];
    cloud: string;
  };
}

export const STAGES: Stage[] = [
  {
    id: 'metropolis',
    name: 'Metrópolis',
    description: 'Una enorme ciudad junto a la bahía. Rascacielos en el centro.',
    seed: 1337,
    waterLevel: 0.36,
    waterScale: 1400,
    parkChance: 0.14,
    heightMul: 1,
    night: false,
    sky: { top: '#3d82d6', horizon: '#bcd9f2', fog: '#c4dcef' },
    fogDensity: 0.00032,
    sun: { color: '#fff4e0', intensity: 2.2, dir: [0.5, 0.8, 0.3] },
    hemi: { sky: '#cfe6ff', ground: '#6b7a5a', intensity: 1.3 },
    palette: {
      buildings: ['#d8d2c4', '#bfc5cc', '#9aa6b2', '#c86b4f', '#a85240', '#e2dccd', '#7f8fa3', '#5f86b8', '#88b6d8', '#cfb994', '#efefef', '#6e7a86'],
      water: ['#1f5fb8', '#2f78d0', '#4f98e2'],
      grass: ['#4fa83a', '#3e9330'],
      road: '#2b2d31',
      sidewalk: '#d9cfb5',
      sand: '#e3d29a',
      lot: '#b9b3a3',
      window: '#2c4f73',
      tree: ['#2f8a2a', '#3fa236'],
      cloud: '#ffffff',
    },
  },
  {
    id: 'archipelago',
    name: 'Archipiélago',
    description: 'Islas urbanas unidas por puentes sobre aguas turquesa.',
    seed: 4242,
    waterLevel: 0.52,
    waterScale: 1000,
    parkChance: 0.22,
    heightMul: 0.7,
    night: false,
    sky: { top: '#2a9ae0', horizon: '#c9eefc', fog: '#cdeefa' },
    fogDensity: 0.00028,
    sun: { color: '#fffbe8', intensity: 2.4, dir: [-0.4, 0.85, 0.35] },
    hemi: { sky: '#d6f3ff', ground: '#6d8a5c', intensity: 1.35 },
    palette: {
      buildings: ['#f4efe2', '#f2d6b3', '#e8a87c', '#f7f7f2', '#9fd3c7', '#ffd6a5', '#d5e4ea', '#c1a37f', '#e07a5f', '#81b29a'],
      water: ['#0f6e9e', '#1b9ac2', '#4cc6d6'],
      grass: ['#5cb840', '#49a535'],
      road: '#34363a',
      sidewalk: '#e8dfc8',
      sand: '#f0dfa4',
      lot: '#cdc5b0',
      window: '#2f6377',
      tree: ['#2f9a3a', '#47b54a'],
      cloud: '#ffffff',
    },
  },
  {
    id: 'dusk',
    name: 'Ciudad nocturna',
    description: 'Atardecer violeta y miles de ventanas encendidas.',
    seed: 9001,
    waterLevel: 0.33,
    waterScale: 1600,
    parkChance: 0.1,
    heightMul: 1.25,
    night: true,
    sky: { top: '#141a3c', horizon: '#c0607a', fog: '#4a3556' },
    fogDensity: 0.0004,
    sun: { color: '#ff9a6a', intensity: 0.9, dir: [0.8, 0.25, -0.4] },
    hemi: { sky: '#6c5aa0', ground: '#201828', intensity: 0.9 },
    palette: {
      buildings: ['#3a3f55', '#2e3245', '#4b4f66', '#5a4a5e', '#2a3a4f', '#454560', '#383040', '#50586e'],
      water: ['#121a3a', '#1b2752', '#2a3a6e'],
      grass: ['#24402a', '#1d3522'],
      road: '#17181c',
      sidewalk: '#4a4650',
      sand: '#6e5e5a',
      lot: '#3a3842',
      window: '#ffcf7a',
      tree: ['#1a3a22', '#244a2c'],
      cloud: '#b89ab8',
    },
  },
];

export function getStage(id: string | null | undefined): Stage {
  return STAGES.find((s) => s.id === id) ?? STAGES[0];
}
