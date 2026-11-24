import * as THREE from 'three';
import { store } from './settings';
import type { StageId } from './stages';
import type { Course, Gate } from './race';

export const MIN_GATES = 3;
export const MAX_GATES = 20;
/** Distancia mínima entre hitos (m) */
export const MIN_GATE_GAP = 200;

const STAGE_IDS: StageId[] = ['metropolis', 'archipelago', 'dusk', 'jungle', 'warzone', 'canyon', 'glacier'];
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export interface CircuitGate {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

export interface Circuit {
  /** id local */
  id: string;
  name: string;
  stage: StageId;
  gates: CircuitGate[];
  /** código corto compartido en Firebase (si se ha publicado) */
  code?: string;
  author?: string;
  /** creado por mí (se puede borrar) o descargado de un amigo */
  mine: boolean;
}

export function randomCode(n = 6) {
  let s = '';
  const buf = new Uint32Array(n);
  crypto.getRandomValues(buf);
  for (let i = 0; i < n; i++) s += ALPHABET[buf[i] % ALPHABET.length];
  return s;
}

/** Normaliza un código escrito por el jugador */
export function cleanCode(s: string) {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

// ------------------------------------------------------------ Codificación compacta
function toB64(bytes: Uint8Array) {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64(s: string) {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Hitos → texto (8 bytes por hito) */
export function encodeGates(gates: CircuitGate[]) {
  const buf = new DataView(new ArrayBuffer(gates.length * 8));
  gates.forEach((g, i) => {
    const o = i * 8;
    buf.setInt16(o, Math.round(g.x / 2));
    buf.setInt16(o + 2, Math.round(g.y));
    buf.setInt16(o + 4, Math.round(g.z / 2));
    buf.setInt16(o + 6, Math.round(g.yaw * 10000));
  });
  return toB64(new Uint8Array(buf.buffer));
}

export function decodeGates(s: string): CircuitGate[] {
  const bytes = fromB64(s);
  const view = new DataView(bytes.buffer);
  const out: CircuitGate[] = [];
  for (let o = 0; o + 8 <= bytes.length && out.length < MAX_GATES; o += 8) {
    out.push({ x: view.getInt16(o) * 2, y: view.getInt16(o + 2), z: view.getInt16(o + 4) * 2, yaw: view.getInt16(o + 6) / 10000 });
  }
  return out;
}

/** Código largo que funciona sin conexión: «FS1.escenario.hitos» */
export function longCode(c: Circuit) {
  return `FS1.${STAGE_IDS.indexOf(c.stage)}.${encodeGates(c.gates)}`;
}

export function parseLongCode(code: string): Pick<Circuit, 'stage' | 'gates'> | null {
  const m = /^FS1\.(\d)\.([A-Za-z0-9_-]+)$/.exec(code.trim());
  if (!m) return null;
  const stage = STAGE_IDS[Number(m[1])];
  if (!stage) return null;
  try {
    const gates = decodeGates(m[2]);
    return gates.length >= MIN_GATES ? { stage, gates } : null;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------ Almacén local
export function loadCircuits(): Circuit[] {
  try {
    const list = JSON.parse(store.get('circuits') ?? '[]') as Circuit[];
    return Array.isArray(list) ? list.filter((c) => c && Array.isArray(c.gates) && c.gates.length >= MIN_GATES) : [];
  } catch {
    return [];
  }
}

export function saveCircuits(list: Circuit[]) {
  store.set('circuits', JSON.stringify(list.slice(0, 40)));
}

export function upsertCircuit(c: Circuit) {
  const list = loadCircuits().filter((x) => x.id !== c.id && (!c.code || x.code !== c.code));
  list.unshift(c);
  saveCircuits(list);
}

export function deleteCircuit(id: string) {
  saveCircuits(loadCircuits().filter((c) => c.id !== id));
}

/** Identificador de circuito para récords y fantasmas */
export function circuitCourseId(c: Pick<Circuit, 'id' | 'code'>) {
  return c.code ? `custom-${c.code}` : `local-${c.id}`;
}

// ------------------------------------------------------------ Circuito → carrera
export function circuitCourse(c: Circuit): Course {
  const gates: Gate[] = c.gates.map((g) => ({ pos: new THREE.Vector3(g.x, g.y, g.z), yaw: g.yaw, w: 120, h: 80, low: false }));
  const g0 = gates[0];
  const d0 = new THREE.Vector3(-Math.sin(g0.yaw), 0, -Math.cos(g0.yaw));
  return {
    id: circuitCourseId(c),
    name: c.name,
    gates,
    bonuses: [],
    start: { pos: g0.pos.clone().addScaledVector(d0, -280), yaw: g0.yaw },
  };
}
