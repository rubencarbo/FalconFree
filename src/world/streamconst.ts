/** Medidas y mensajes del mundo abierto (compartidos con el worker de teselas) */
export const REGION = 1920;
export const CELL_C = 4;
export const CELL_B = 4;
export const CELL_E = 16;
export const NC = REGION / CELL_C;
export const NE = REGION / CELL_E + 1;
/** Teselas lejanas: z10 (~30 km, horizonte) y z12 (~7 km, alrededores con calles principales) */
export const COARSE_Z = 10;
export const MID_Z = 12;
export const COARSE_N = 65;
export const COARSE_TEX = 256;
export const MID_TEX = 512;

/** Lugar con nombre (ciudad, pueblo, barrio…) */
export interface Place {
  name: string;
  cls: string;
  x: number;
  z: number;
}


export type WorkIn = { type: 'init'; lat0: number; lon0: number } | { type: 'region'; rx: number; rz: number } | { type: 'coarse'; x: number; y: number; z: number };
/** Diagnóstico de descargas (se muestra en pantalla en el mundo abierto) */
export interface Diag {
  osmOk: number;
  osmFail: number;
  demOk: number;
  demFail: number;
  err: string;
  /** tiempo medio (ms) de preparar una zona con detalle */
  regionMs: number;
}

export type WorkOut =
  | { type: 'region'; rx: number; rz: number; elev: Float32Array; cls: Uint8Array; rects: Float32Array; places?: Place[]; error?: string; diag?: Diag }
  | { type: 'coarse'; x: number; y: number; z: number; places?: Place[]; raw: Float32Array; low: Float32Array; rgba: Uint8ClampedArray; error?: string; diag?: Diag };

