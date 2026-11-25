export type StageId = 'metropolis' | 'archipelago' | 'dusk' | 'jungle' | 'warzone' | 'canyon' | 'glacier' | 'cyber';

/** Tipo de mundo: ciudad o escenarios naturales / en ruinas */
export type Biome = 'city' | 'jungle' | 'war' | 'canyon' | 'ice' | 'cyber';

type WeatherOption = ['clear' | 'rain' | 'fog' | 'storm' | 'snow', number];

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
  biome?: Biome;
  /** Climas posibles y su probabilidad (si no, los de siempre) */
  weather?: WeatherOption[];
  /** Aurora boreal permanente */
  aurora?: boolean;
  /** Etiqueta corta para tarjetas */
  tag?: string;
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
      buildings: ['#4a5272', '#3a4058', '#5c6080', '#6a5470', '#34506a', '#565878', '#4a3e58', '#607088', '#3e5a5e', '#6a5a50'],
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
  {
    id: 'jungle',
    name: 'Selva amazónica',
    tag: 'Nuevo',
    description: 'Ríos que serpentean bajo árboles gigantes, tepuyes con cascadas, templos y aldeas en los claros.',
    seed: 7311,
    biome: 'jungle',
    waterLevel: 0.36,
    waterScale: 1400,
    parkChance: 0,
    heightMul: 1,
    night: false,
    weather: [['clear', 0.45], ['rain', 0.3], ['fog', 0.15], ['storm', 0.1]],
    sky: { top: '#4a90d0', horizon: '#d6ecd8', fog: '#c6dcc4' },
    fogDensity: 0.00042,
    sun: { color: '#fff2d0', intensity: 2.3, dir: [0.35, 0.85, 0.4] },
    hemi: { sky: '#d6f0d8', ground: '#3a5a2a', intensity: 1.35 },
    palette: {
      buildings: ['#7a6a58'],
      water: ['#3a5a3a', '#4a6e48', '#6a8a58'],
      grass: ['#2e5e24', '#28531f'],
      road: '#6a5038',
      sidewalk: '#8a6a48',
      sand: '#9a7a50',
      lot: '#2a5222',
      window: '#2c4f73',
      tree: ['#2f7a2a', '#3a8a30'],
      cloud: '#ffffff',
    },
  },
  {
    id: 'warzone',
    name: 'Zona de guerra',
    tag: 'Nuevo',
    description: 'Ciudad en ruinas: rascacielos partidos, losas caídas para pasar por debajo, humo y cráteres.',
    seed: 1944,
    biome: 'war',
    waterLevel: 0.3,
    waterScale: 1700,
    parkChance: 0.08,
    heightMul: 0.85,
    night: false,
    weather: [['clear', 0.55], ['fog', 0.25], ['storm', 0.2]],
    sky: { top: '#5c6068', horizon: '#c8a478', fog: '#a08c74' },
    fogDensity: 0.00048,
    sun: { color: '#ffd8a0', intensity: 1.9, dir: [-0.6, 0.55, 0.4] },
    hemi: { sky: '#c8b8a0', ground: '#4a4034', intensity: 1.15 },
    palette: {
      buildings: ['#9a948a', '#8a8478', '#7a746a', '#a09888', '#6e6a62', '#8e8070'],
      water: ['#3a4448', '#46525a', '#5a666a'],
      grass: ['#5a5a3a', '#4e4e32'],
      road: '#3a3834',
      sidewalk: '#7a7268',
      sand: '#9a8a6a',
      lot: '#6a6052',
      window: '#1a1a1c',
      tree: ['#3a3a26', '#46442c'],
      cloud: '#8a8278',
    },
  },
  {
    id: 'canyon',
    name: 'Cañones del desierto',
    tag: 'Nuevo',
    description: 'Mesetas rojas, gargantas estrechas con un río al fondo, arcos de roca y oasis.',
    seed: 6060,
    biome: 'canyon',
    waterLevel: 0.31,
    waterScale: 1400,
    parkChance: 0,
    heightMul: 1,
    night: false,
    weather: [['clear', 0.75], ['fog', 0.15], ['storm', 0.1]],
    sky: { top: '#2f7fd8', horizon: '#f4d8b0', fog: '#ecd2ac' },
    fogDensity: 0.00026,
    sun: { color: '#fff0d0', intensity: 2.6, dir: [0.55, 0.7, -0.35] },
    hemi: { sky: '#ffe8c8', ground: '#a0603a', intensity: 1.3 },
    palette: {
      buildings: ['#b8643c'],
      water: ['#2a6a7a', '#3a8a90', '#5aaaa0'],
      grass: ['#c89a62', '#bf8f58'],
      road: '#6a4a30',
      sidewalk: '#c09060',
      sand: '#e0b47a',
      lot: '#d6a46a',
      window: '#2c4f73',
      tree: ['#4a8a3a', '#3a9a3a'],
      cloud: '#ffffff',
    },
  },
  {
    id: 'glacier',
    name: 'Glaciar polar',
    tag: 'Nuevo',
    description: 'Crepúsculo polar con auroras: icebergs, arcos de hielo, montañas nevadas y una base científica.',
    seed: 9090,
    biome: 'ice',
    waterLevel: 0.47,
    waterScale: 1800,
    parkChance: 0,
    heightMul: 1,
    night: true,
    aurora: true,
    weather: [['clear', 0.55], ['snow', 0.35], ['fog', 0.1]],
    sky: { top: '#0c1a3a', horizon: '#c890b0', fog: '#5a6a8e' },
    fogDensity: 0.00032,
    sun: { color: '#ffc8a8', intensity: 1.7, dir: [0.8, 0.22, -0.3] },
    hemi: { sky: '#b0c8f0', ground: '#5a6a8a', intensity: 1.5 },
    palette: {
      buildings: ['#e8f4ff'],
      water: ['#0a1a34', '#123060', '#2a5a8a'],
      grass: ['#e8f0fa', '#dce8f6'],
      road: '#606a7a',
      sidewalk: '#c8d4e4',
      sand: '#b8c8dc',
      lot: '#dfe9f6',
      window: '#2c4f73',
      tree: ['#2a4a3a', '#34503e'],
      cloud: '#c8d0e8',
    },
  },
  {
    id: 'cyber',
    name: 'Ciudad cyberpunk',
    tag: 'Nuevo',
    description: 'Noche eterna y lluvia: megatorres con neón, hologramas gigantes, pasarelas aéreas y tráfico de coches voladores.',
    seed: 2077,
    biome: 'cyber',
    waterLevel: 0.3,
    waterScale: 1800,
    parkChance: 0.04,
    heightMul: 1.7,
    night: true,
    weather: [['rain', 0.45], ['clear', 0.25], ['fog', 0.15], ['storm', 0.15]],
    sky: { top: '#0a0620', horizon: '#5a1e6a', fog: '#2a1640' },
    fogDensity: 0.00046,
    sun: { color: '#b070ff', intensity: 0.7, dir: [-0.5, 0.35, 0.6] },
    hemi: { sky: '#5a3a9a', ground: '#140a20', intensity: 0.95 },
    palette: {
      buildings: ['#1c1e2c', '#222536', '#181a26', '#2a2440', '#1a2230', '#26202e'],
      water: ['#08101e', '#0e1a30', '#1a2a4a'],
      grass: ['#14261c', '#102018'],
      road: '#101016',
      sidewalk: '#2a2632',
      sand: '#3a3440',
      lot: '#1c1a24',
      window: '#ffcf7a',
      tree: ['#163a2a', '#1a4a34'],
      cloud: '#6a4a8a',
    },
  },
];

export function getStage(id: string | null | undefined): Stage {
  return STAGES.find((s) => s.id === id) ?? STAGES[0];
}
