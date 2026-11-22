import * as THREE from 'three';
import type { Flight } from './jet';
import type { CityGen } from './world/city';

/** Ventana (s) para encadenar acrobacias antes de cobrar el combo */
const COMBO_WINDOW = 4;
const MAX_MULT = 8;

export interface ComboState {
  /** acrobacia más reciente */
  last: string;
  mult: number;
  points: number;
  /** 0..1 tiempo que queda para encadenar */
  timeLeft: number;
}

export interface StuntEvents {
  /** combo terminado y cobrado */
  onBank?: (points: number, mult: number) => void;
  /** combo perdido (choque) */
  onLost?: (points: number) => void;
  /** nueva acrobacia dentro del combo */
  onTrick?: (name: string, points: number, mult: number) => void;
}

/**
 * Acrobacias con combos: vuelo rasante, entre rascacielos, «por poco», picado in extremis,
 * giro cerrado, aro a velocidad supersónica, esquivar misiles…
 */
export class Stunts {
  combo: ComboState | null = null;
  /** puntos de estilo acumulados en la sesión */
  total = 0;
  bestMult = 1;
  private window = 0;
  private lowT = 0;
  private canyonT = 0;
  private bankT = 0;
  private nearCd = 0;
  private diveArmed = false;
  private lowTick = 0;
  private canyonTick = 0;
  private _r = new THREE.Vector3();
  private _f = new THREE.Vector3();
  enabled = true;

  constructor(
    private gen: CityGen,
    private ev: StuntEvents = {},
  ) {}

  reset() {
    this.combo = null;
    this.total = 0;
    this.bestMult = 1;
    this.window = 0;
  }

  /** Suma una acrobacia (también la usan otros sistemas: aros, misiles…) */
  trick(name: string, base: number) {
    if (!this.enabled) return;
    if (!this.combo) this.combo = { last: name, mult: 1, points: 0, timeLeft: 1 };
    else this.combo.mult = Math.min(MAX_MULT, this.combo.mult + 1);
    this.combo.last = name;
    const pts = Math.round(base * this.combo.mult);
    this.combo.points += pts;
    this.bestMult = Math.max(this.bestMult, this.combo.mult);
    this.window = COMBO_WINDOW;
    this.ev.onTrick?.(name, pts, this.combo.mult);
  }

  /** Puntos continuos (vuelo rasante…) sin subir el multiplicador */
  private flow(name: string, pts: number) {
    if (!this.combo) {
      this.trick(name, pts);
      return;
    }
    this.combo.last = name;
    this.combo.points += Math.round(pts * this.combo.mult);
    this.window = COMBO_WINDOW;
  }

  /** Choque o derribo: se pierde el combo en curso */
  crash() {
    if (this.combo) this.ev.onLost?.(this.combo.points);
    this.combo = null;
    this.window = 0;
  }

  update(dt: number, f: Flight) {
    if (!this.enabled) return;
    const kmh = f.speedKmh;
    const ground = this.gen.heightAt(f.pos.x, f.pos.z);
    const agl = f.pos.y - ground;
    this.nearCd = Math.max(0, this.nearCd - dt);

    // Rasante: muy cerca del suelo/agua y rápido
    if (agl < 28 && kmh > 600) {
      this.lowT += dt;
      this.lowTick += dt;
      if (this.lowT > 0.6 && this.lowTick > 0.5) {
        this.lowTick = 0;
        this.flow('Rasante', agl < 12 ? 60 : 35);
      }
    } else {
      this.lowT = 0;
    }

    // Entre rascacielos: edificios más altos que el avión a ambos lados
    const right = this._r.set(Math.cos(f.yaw), 0, -Math.sin(f.yaw));
    const hl = this.gen.heightAt(f.pos.x - right.x * 22, f.pos.z - right.z * 22);
    const hr = this.gen.heightAt(f.pos.x + right.x * 22, f.pos.z + right.z * 22);
    if (hl > f.pos.y + 5 && hr > f.pos.y + 5) {
      this.canyonT += dt;
      this.canyonTick += dt;
      if (this.canyonT > 0.4 && this.canyonTick > 0.6) {
        this.canyonTick = 0;
        this.flow('Entre rascacielos', 70);
      }
    } else {
      this.canyonT = 0;
    }

    // ¡Por poco!: un edificio a pocos metros a la altura del avión
    if (this.nearCd <= 0 && kmh > 500) {
      const fwd = this._f.set(-Math.sin(f.yaw), 0, -Math.cos(f.yaw));
      for (const [ox, oz] of [
        [right.x * 9, right.z * 9],
        [-right.x * 9, -right.z * 9],
        [fwd.x * 6 + right.x * 7, fwd.z * 6 + right.z * 7],
        [fwd.x * 6 - right.x * 7, fwd.z * 6 - right.z * 7],
      ]) {
        const h = this.gen.heightAt(f.pos.x + ox, f.pos.z + oz);
        if (h > f.pos.y + 1 && ground < f.pos.y - 2) {
          this.nearCd = 1.2;
          this.trick('¡Por poco!', 150);
          break;
        }
      }
    }

    // Picado in extremis: bajar fuerte y remontar cerca del suelo
    if (f.pitch < -0.75 && agl > 120) this.diveArmed = true;
    if (this.diveArmed && f.pitch > 0.05) {
      this.diveArmed = false;
      if (agl < 80) this.trick('Picado in extremis', 250);
    }
    if (agl < 3) this.diveArmed = false;

    // Giro cerrado: mucho alabeo a gran velocidad
    if (Math.abs(f.roll) > 1.05 && kmh > 800) {
      this.bankT += dt;
      if (this.bankT > 1.6) {
        this.bankT = -1.5;
        this.trick('Giro cerrado', 90);
      }
    } else if (this.bankT > 0) this.bankT = 0;
    else this.bankT = Math.min(0, this.bankT + dt);

    // Ventana del combo
    if (this.combo) {
      this.window -= dt;
      this.combo.timeLeft = Math.max(0, this.window / COMBO_WINDOW);
      if (this.window <= 0) {
        this.total += this.combo.points;
        this.ev.onBank?.(this.combo.points, this.combo.mult);
        this.combo = null;
      }
    }
  }
}
