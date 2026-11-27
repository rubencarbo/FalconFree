/** Medidas y mensajes del mundo abierto (compartidos con el worker de teselas) */
export const REGION = 1920;
export const CELL_C = 4;
export const CELL_B = 4;
export const CELL_E = 16;
export const NC = REGION / CELL_C;
export const NE = REGION / CELL_E + 1;
export const COARSE_Z = 10;
export const COARSE_N = 65;
export const COARSE_TEX = 256;


export type WorkIn = { type: 'init'; lat0: number; lon0: number } | { type: 'region'; rx: number; rz: number } | { type: 'coarse'; x: number; y: number };
export type WorkOut =
  | { type: 'region'; rx: number; rz: number; elev: Float32Array; cls: Uint8Array; rects: Float32Array; error?: string }
  | { type: 'coarse'; x: number; y: number; raw: Float32Array; low: Float32Array; rgba: Uint8ClampedArray; error?: string };

