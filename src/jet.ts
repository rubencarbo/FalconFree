import * as THREE from 'three';

export const KMH = 3.6;
export const CRUISE_KMH = 650;
export const BOOST_KMH = 1600;
export const MIN_KMH = 280;
export const MAX_KMH = 1900;

export interface FlightInput {
  /** -1 (izquierda) .. 1 (derecha) */
  x: number;
  /** -1 (morro abajo) .. 1 (morro arriba) */
  y: number;
  boost: boolean;
  climb: boolean;
  fire?: boolean;
}

/** Modelo de vuelo arcade: rumbo/cabeceo/alabeo (sin loopings) */
export class Flight {
  pos = new THREE.Vector3(0, 500, 0);
  yaw = 0;
  pitch = 0;
  roll = 0;
  /** m/s */
  speed = CRUISE_KMH / KMH;
  /** 0..1 empuje mostrado */
  thrust = 0.5;
  verticalSpeed = 0;
  maxSpeedKmh = 0;
  /** s restantes de aturdimiento tras un golpe (control reducido) */
  stun = 0;
  /** s restantes de acelerón (anillo de turbo) */
  burst = 0;
  /** congelado (cuenta atrás) */
  frozen = false;
  /** Multiplicadores del avión elegido y sus mejoras */
  speedMul = 1;
  agility = 1;
  /**
   * Tirón de emergencia (0..1): cuando el juego detecta un choque inminente y el piloto
   * tira del morro hacia arriba con fuerza, la subida se acentúa.
   */
  pullUpAssist = 0;
  private prevY = 500;

  reset(x: number, y: number, z: number, yaw: number) {
    this.pos.set(x, y, z);
    this.yaw = yaw;
    this.pitch = 0;
    this.roll = 0;
    this.speed = CRUISE_KMH / KMH;
    this.thrust = 0.5;
    this.maxSpeedKmh = 0;
    this.prevY = y;
    this.stun = 0;
    this.burst = 0;
    this.pullUpAssist = 0;
  }

  /** Cambia la dirección y velocidad a partir de un vector velocidad */
  setVelocity(v: THREE.Vector3) {
    const sp = v.length();
    if (sp < 1) return;
    this.speed = THREE.MathUtils.clamp(sp, MIN_KMH / KMH, MAX_KMH / KMH);
    this.yaw = Math.atan2(-v.x, -v.z);
    this.pitch = THREE.MathUtils.clamp(Math.asin(v.y / sp), -1.3, 1.3);
  }

  get speedKmh() {
    return this.speed * KMH;
  }

  forward(out = new THREE.Vector3()) {
    const cp = Math.cos(this.pitch);
    return out.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
  }

  quaternion(out = new THREE.Quaternion()) {
    return out.setFromEuler(new THREE.Euler(this.pitch, this.yaw, this.roll, 'YXZ'));
  }

  update(dt: number, input: FlightInput) {
    if (this.frozen) {
      this.verticalSpeed = 0;
      return;
    }
    this.stun = Math.max(0, this.stun - dt);
    this.burst = Math.max(0, this.burst - dt);
    const ctrl = this.stun > 0 ? 0.25 : 1;
    input = { ...input, x: input.x * ctrl, y: input.y * ctrl, climb: input.climb && this.stun <= 0 };
    if (this.stun > 0) this.roll += Math.sin(this.stun * 25) * dt * 2;
    // Alabeo: el stick fija el ángulo objetivo, vuelve a nivel al soltar
    const maxRoll = THREE.MathUtils.degToRad(72);
    const targetRoll = -input.x * maxRoll;
    this.roll += (targetRoll - this.roll) * Math.min(1, dt * 3.2 * this.agility);

    // Cabeceo
    const py = input.climb ? 1 : input.y;
    const pitchRate = 0.95 * (0.6 + 0.4 * Math.min(1, this.speed / (CRUISE_KMH / KMH)));
    const assist = py > 0 ? this.pullUpAssist : 0;
    // Con el tirón de emergencia el morro sube hasta 2,6 veces más rápido y las alas se nivelan
    this.pitch += py * pitchRate * this.agility * (1 + 1.6 * assist) * dt;
    if (assist > 0) this.roll *= 1 - Math.min(1, dt * 3 * assist);
    // Ligera recuperación hacia el horizonte sin input
    if (Math.abs(py) < 0.05) this.pitch *= 1 - Math.min(1, dt * 0.25);
    const maxPitch = THREE.MathUtils.degToRad(80);
    this.pitch = THREE.MathUtils.clamp(this.pitch, -maxPitch, maxPitch);

    // Giro coordinado por alabeo
    this.yaw += Math.sin(this.roll) * 0.95 * this.agility * dt;

    // Velocidad: empuje + gravedad
    const target = ((this.burst > 0 ? MAX_KMH : input.boost ? BOOST_KMH : CRUISE_KMH) / KMH) * (this.burst > 0 ? 1 : this.speedMul);
    const accel = this.burst > 0 ? 260 : input.boost ? 110 : 45;
    if (this.speed < target) this.speed = Math.min(target, this.speed + accel * dt);
    else this.speed = Math.max(target, this.speed - 35 * dt);
    this.speed -= Math.sin(this.pitch) * 9.81 * 1.6 * dt;
    // Sin turbo, un picado no pasa de ~1000 km/h (antes llegaba casi a la velocidad máxima
    // y parecía que el turbo se activaba solo)
    const diveCap = (1000 / KMH) * this.speedMul;
    if (!input.boost && this.burst <= 0 && this.pitch < -0.05 && this.speed > diveCap) this.speed = Math.max(diveCap, this.speed - 120 * dt);
    this.speed = THREE.MathUtils.clamp(this.speed, MIN_KMH / KMH, (MAX_KMH / KMH) * Math.max(1, this.speedMul));
    this.thrust += ((input.boost || this.burst > 0 ? 1 : 0.55) - this.thrust) * Math.min(1, dt * 3);

    const f = this.forward(_v);
    this.pos.addScaledVector(f, this.speed * dt);
    // Sustentación extra del tirón de emergencia (y sin perder tanta velocidad al subir)
    if (assist > 0) {
      this.pos.y += assist * py * 28 * dt;
      this.speed += Math.sin(Math.max(0, this.pitch)) * 9.81 * 0.8 * assist * dt;
    }
    if (this.pos.y > 4500) this.pos.y = 4500;

    this.verticalSpeed = (this.pos.y - this.prevY) / Math.max(dt, 1e-4);
    this.prevY = this.pos.y;
    this.maxSpeedKmh = Math.max(this.maxSpeedKmh, this.speedKmh);
  }
}
const _v = new THREE.Vector3();

export type PlaneVariant = 'falcon' | 'sparrow' | 'raptor' | 'typhoon' | 'specter' | 'phoenix' | 'mantis' | 'storm' | 'comet';

/** Color de las llamas y de las luces de cada avión */
const VARIANT_GLOW: Partial<Record<PlaneVariant, { flame: number; glow: [number, number, number] }>> = {
  specter: { flame: 0x40e0ff, glow: [0.4, 2.2, 3.2] },
  phoenix: { flame: 0xff4a10, glow: [3.2, 1.2, 0.3] },
  mantis: { flame: 0xc070ff, glow: [2.2, 0.8, 3.2] },
  storm: { flame: 0xffc040, glow: [2.6, 2.4, 0.6] },
  comet: { flame: 0x6a8aff, glow: [0.8, 1.4, 3.6] },
};

type AddFn = (w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material) => THREE.Mesh;

interface Mats {
  body: THREE.Material;
  dark: THREE.Material;
  wing: THREE.Material;
  glass: THREE.Material;
  accent: THREE.Material;
  glow: THREE.Material;
  white: THREE.Material;
  red: THREE.Material;
  green: THREE.Material;
}

/** Caza vóxel construido con cajas. Mira hacia -Z. */
export class JetModel {
  group = new THREE.Group();
  private flames: THREE.Mesh[] = [];
  wingTips = [new THREE.Vector3(-7.2, 0.1, 3.6), new THREE.Vector3(7.2, 0.1, 3.6)];

  constructor(accentColor = 0xff7a1a, bodyColor = 0x40454e, variant: PlaneVariant = 'falcon') {
    const g = VARIANT_GLOW[variant];
    const m: Mats = {
      body: new THREE.MeshLambertMaterial({ color: bodyColor }),
      dark: new THREE.MeshLambertMaterial({ color: 0x2a2d33 }),
      wing: new THREE.MeshLambertMaterial({ color: new THREE.Color(bodyColor).lerp(new THREE.Color(0x8a9098), 0.3) }),
      glass: new THREE.MeshLambertMaterial({ color: 0x66c8ff, emissive: 0x113355 }),
      accent: new THREE.MeshLambertMaterial({ color: accentColor }),
      glow: new THREE.MeshBasicMaterial({ color: g ? new THREE.Color(...g.glow) : new THREE.Color(accentColor) }),
      white: new THREE.MeshLambertMaterial({ color: 0xe8e8e8 }),
      red: new THREE.MeshBasicMaterial({ color: 0xff3030 }),
      green: new THREE.MeshBasicMaterial({ color: 0x30ff60 }),
    };
    const add: AddFn = (w, h, d, x, y, z, mat) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      mesh.position.set(x, y, z);
      this.group.add(mesh);
      return mesh;
    };
    switch (variant) {
      case 'sparrow':
        this.buildSparrow(add, m);
        break;
      case 'specter':
        this.buildSpecter(add, m);
        break;
      case 'phoenix':
        this.buildPhoenix(add, m);
        break;
      case 'mantis':
        this.buildMantis(add, m);
        break;
      case 'storm':
        this.buildStorm(add, m);
        break;
      case 'comet':
        this.buildComet(add, m);
        break;
      default:
        this.buildFalcon(add, m, variant);
    }
    // Luces de navegación en las puntas de las alas
    const [l, r] = this.wingTips;
    add(0.4, 0.4, 0.4, l.x - 0.1, l.y - 0.2, l.z - 0.2, m.red);
    add(0.4, 0.4, 0.4, r.x + 0.1, r.y - 0.2, r.z - 0.2, m.green);
  }

  private flame(x: number, y: number, z: number, size = 1, color = 0xff6a10) {
    const flameGeo = new THREE.ConeGeometry(0.55 * size, 4 * size, 6);
    flameGeo.rotateX(Math.PI / 2);
    flameGeo.translate(0, 0, 2 * size);
    const coreGeo = new THREE.ConeGeometry(0.3 * size, 2.5 * size, 6);
    coreGeo.rotateX(Math.PI / 2);
    coreGeo.translate(0, 0, 1.25 * size);
    const outer = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
    const core = new THREE.MeshBasicMaterial({ color: 0xfff0d0, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
    const f = new THREE.Mesh(flameGeo, outer);
    f.position.set(x, y, z);
    f.add(new THREE.Mesh(coreGeo, core));
    this.group.add(f);
    this.flames.push(f);
  }

  // ---------------------------------------------------------------- Básicos
  private buildFalcon(add: AddFn, m: Mats, variant: PlaneVariant) {
    add(2.4, 2, 11, 0, 0, 0.5, m.body);
    add(1.8, 1.6, 3, 0, 0, -6.5, m.body);
    add(1.1, 1.1, 2, 0, -0.1, -9, m.body);
    add(0.6, 0.6, 1.2, 0, -0.1, -10.5, m.dark);
    add(1.3, 0.9, 3.2, 0, 1.3, -4.4, m.glass);
    add(1.4, 0.7, 2, 0, 1.15, -2.2, m.body);
    add(0.9, 1.4, 3, -1.6, -0.2, -1.5, m.dark);
    add(0.9, 1.4, 3, 1.6, -0.2, -1.5, m.dark);
    const steps: [number, number][] = [
      [5, -2.2],
      [8.5, -0.6],
      [11.5, 1],
      [14.4, 2.6],
      [14.4, 4],
    ];
    for (const [span, z] of steps) add(span, 0.35, 1.7, 0, -0.2, z, m.wing);
    add(1.2, 0.4, 1.4, -6.6, -0.15, 3.3, m.accent);
    add(1.2, 0.4, 1.4, 6.6, -0.15, 3.3, m.accent);
    add(1.9, 0.3, 0.8, 0, 1.05, -0.6, m.accent);
    add(0.35, 0.8, 1.4, -1.35, 3.4, 5.4, m.accent).rotation.z = 0.25;
    add(0.35, 0.8, 1.4, 1.35, 3.4, 5.4, m.accent).rotation.z = -0.25;
    add(8, 0.3, 1.6, 0, 0, 6.2, m.wing);
    add(0.3, 3.2, 2.6, -1.1, 2, 5, m.wing).rotation.z = 0.25;
    add(0.3, 3.2, 2.6, 1.1, 2, 5, m.wing).rotation.z = -0.25;
    add(1.1, 1.1, 1.2, -0.6, 0, 6.6, m.dark);
    add(1.1, 1.1, 1.2, 0.6, 0, 6.6, m.dark);
    if (variant === 'raptor') {
      add(0.9, 0.9, 3, 0, -0.1, -11.5, m.body);
      add(0.4, 0.4, 1.2, 0, -0.1, -13.4, m.dark);
      add(16.5, 0.3, 1.2, 0, -0.25, 3.9, m.wing);
      add(1.2, 0.4, 1.4, -8, -0.2, 3.9, m.accent);
      add(1.2, 0.4, 1.4, 8, -0.2, 3.9, m.accent);
      this.wingTips = [new THREE.Vector3(-8.3, 0, 3.9), new THREE.Vector3(8.3, 0, 3.9)];
    } else if (variant === 'typhoon') {
      add(3.4, 2.6, 9, 0, -0.2, 1.5, m.body);
      add(1.6, 1.6, 1.6, -1.2, -0.2, 6.6, m.dark);
      add(1.6, 1.6, 1.6, 1.2, -0.2, 6.6, m.dark);
      add(17, 0.5, 2.2, 0, -0.3, 2.8, m.wing);
      add(2, 0.6, 1.6, -8.2, -0.25, 2.8, m.accent);
      add(2, 0.6, 1.6, 8.2, -0.25, 2.8, m.accent);
      this.wingTips = [new THREE.Vector3(-8.5, 0, 2.8), new THREE.Vector3(8.5, 0, 2.8)];
    }
    this.flame(-0.6, 0, 7.2);
    this.flame(0.6, 0, 7.2);
  }

  /** Entrenador de alas rectas y un solo motor */
  private buildSparrow(add: AddFn, m: Mats) {
    add(1.8, 1.7, 9, 0, 0, 0, m.body);
    add(1.3, 1.2, 2.4, 0, -0.1, -5.6, m.body);
    add(0.7, 0.7, 1, 0, -0.1, -7.2, m.accent);
    add(1.2, 1, 4, 0, 1.2, -2.2, m.glass);
    add(12.5, 0.35, 2.4, 0, -0.4, 0.2, m.wing);
    add(1.4, 0.4, 2.4, -5.6, -0.35, 0.2, m.accent);
    add(1.4, 0.4, 2.4, 5.6, -0.35, 0.2, m.accent);
    add(5.5, 0.3, 1.5, 0, 0.3, 4.2, m.wing);
    add(0.3, 2.6, 2, 0, 1.8, 3.9, m.accent);
    add(1.2, 1.2, 1, 0, 0, 4.9, m.dark);
    this.wingTips = [new THREE.Vector3(-6.2, -0.3, 0.2), new THREE.Vector3(6.2, -0.3, 0.2)];
    this.flame(0, 0, 5.4, 0.9);
  }

  // ---------------------------------------------------------------- Avanzados
  /** Ala volante furtiva */
  private buildSpecter(add: AddFn, m: Mats) {
    add(3, 1.3, 9, 0, 0, 0.5, m.body);
    add(1.6, 0.8, 3.2, 0, 0.9, -2.2, m.glass);
    add(1.8, 0.9, 2.4, 0, -0.1, -4.8, m.body);
    for (let k = 0; k < 7; k++) {
      const x = 1.8 + k * 1.35;
      const z = -2.4 + k * 1.05;
      const depth = 5.2 - k * 0.45;
      for (const sx of [-1, 1]) {
        add(1.45, 0.45, depth, sx * x, -0.1, z + depth / 2 - 1, m.body);
        add(1.45, 0.12, 0.25, sx * x, 0.18, z - 1, m.glow); // borde de ataque luminoso
      }
    }
    for (const sx of [-1, 1]) {
      add(1.3, 0.5, 1.2, sx * 1.6, 0.2, 5.4, m.dark);
      add(3.2, 0.1, 0.3, sx * 2.5, 0.42, 1.2, m.glow);
    }
    this.wingTips = [new THREE.Vector3(-10, 0, 3.8), new THREE.Vector3(10, 0, 3.8)];
    const c = VARIANT_GLOW.specter!.flame;
    this.flame(-1.6, 0.2, 6, 0.8, c);
    this.flame(1.6, 0.2, 6, 0.8, c);
  }

  /** Alas en flecha invertida, canards y tres derivas */
  private buildPhoenix(add: AddFn, m: Mats) {
    add(2.2, 1.9, 12, 0, 0, 0.6, m.body);
    add(1.6, 1.5, 3, 0, 0, -6.8, m.body);
    add(0.9, 0.9, 1.8, 0, -0.1, -9.2, m.accent);
    add(1.3, 1, 3.6, 0, 1.3, -4.2, m.glass);
    for (let k = 0; k < 6; k++) {
      const x = 1.6 + k * 1.3;
      const z = 2.4 - k * 0.85;
      for (const sx of [-1, 1]) {
        add(1.35, 0.35, 2.4, sx * x, -0.2, z, m.wing);
        if (k % 2 === 1) add(1.35, 0.1, 0.3, sx * x, 0.02, z + 1.15, m.glow);
      }
    }
    for (const sx of [-1, 1]) {
      add(2.6, 0.25, 1.1, sx * 2, 0.4, -5.6, m.accent);
      add(0.3, 2.8, 2.2, sx * 1.4, 1.8, 5.2, m.wing).rotation.z = sx * -0.35;
      add(3.2, 0.3, 1.5, sx * 2.4, 0, 6.4, m.wing);
    }
    add(0.3, 3, 2, 0, 2.2, 5.6, m.accent);
    add(1.4, 0.15, 6, 0, 1.0, 1.8, m.glow);
    add(1.1, 1.1, 1.2, -0.6, 0, 7, m.dark);
    add(1.1, 1.1, 1.2, 0.6, 0, 7, m.dark);
    this.wingTips = [new THREE.Vector3(-8.6, -0.2, -1.8), new THREE.Vector3(8.6, -0.2, -1.8)];
    const c = VARIANT_GLOW.phoenix!.flame;
    this.flame(-0.6, 0, 7.6, 1, c);
    this.flame(0.6, 0, 7.6, 1, c);
  }

  /** Doble fuselaje con lanzamisiles bajo las alas */
  private buildMantis(add: AddFn, m: Mats) {
    add(2.4, 2, 8, 0, 0, -1.5, m.body);
    add(1.4, 1.2, 2.2, 0, -0.1, -6.4, m.accent);
    add(1.4, 1, 3, 0, 1.3, -3, m.glass);
    add(17, 0.4, 3, 0, -0.1, 0.4, m.wing);
    for (const sx of [-1, 1]) {
      add(1.3, 1.3, 11, sx * 3.6, 0, 3, m.body);
      add(0.3, 2.6, 2, sx * 3.6, 1.6, 7.6, m.accent);
      add(1.4, 0.15, 7, sx * 3.6, 0.72, 2.5, m.glow);
      // Lanzamisiles: tres misiles por ala
      for (const dx of [5.4, 6.6, 7.8]) {
        add(0.45, 0.45, 2.8, sx * dx, -0.6, 0.2, m.white);
        add(0.45, 0.45, 0.5, sx * dx, -0.6, -1.45, m.red);
      }
    }
    add(8.6, 0.3, 1.4, 0, 0.9, 8.4, m.wing);
    add(1.2, 1.2, 1.2, 0, 0, 2.9, m.dark);
    this.wingTips = [new THREE.Vector3(-8.5, 0, 0.4), new THREE.Vector3(8.5, 0, 0.4)];
    const c = VARIANT_GLOW.mantis!.flame;
    this.flame(0, 0, 3.4, 0.9, c);
    this.flame(-3.6, 0, 8.6, 0.7, c);
    this.flame(3.6, 0, 8.6, 0.7, c);
  }

  /** Cañonera pesada de cuatro motores y cañón triple */
  private buildStorm(add: AddFn, m: Mats) {
    add(3.8, 3, 14, 0, 0, 0, m.body);
    add(2.8, 2.2, 3, 0, -0.2, -8, m.body);
    add(2, 1.2, 3.4, 0, 1.8, -4.4, m.glass);
    for (const x of [-0.9, 0, 0.9]) add(0.35, 0.35, 3.2, x, -0.8, -10.8, m.dark);
    add(23, 0.7, 4, 0, 0.2, 0.6, m.wing);
    for (const sx of [-1, 1]) {
      for (const x of [4.2, 8]) {
        add(1.7, 1.7, 4.4, sx * x, -0.6, 1.2, m.dark);
        add(1.7, 0.2, 0.4, sx * x, 0.3, -1, m.glow);
      }
      add(2, 0.8, 2.6, sx * 10.6, 0.2, 0.6, m.accent);
    }
    add(11, 0.4, 2.2, 0, 0.6, 7, m.wing);
    add(0.5, 4.6, 3.2, 0, 3.2, 6.4, m.accent);
    this.wingTips = [new THREE.Vector3(-11.4, 0.2, 0.6), new THREE.Vector3(11.4, 0.2, 0.6)];
    const c = VARIANT_GLOW.storm!.flame;
    for (const sx of [-1, 1]) for (const x of [4.2, 8]) this.flame(sx * x, -0.6, 3.4, 0.75, c);
  }

  /** Interceptor de morro de aguja y gran motor */
  private buildComet(add: AddFn, m: Mats) {
    add(1.7, 1.7, 14, 0, 0, 0, m.body);
    add(1.1, 1.1, 3, 0, 0, -8.4, m.body);
    add(0.5, 0.5, 3.4, 0, 0, -11.6, m.accent);
    add(1.1, 0.9, 3.4, 0, 1.15, -4.4, m.glass);
    const steps: [number, number][] = [
      [3.4, 1.4],
      [5.6, 2.6],
      [7.8, 3.8],
      [9.6, 5],
    ];
    for (const [span, z] of steps) add(span, 0.3, 1.25, 0, -0.2, z, m.wing);
    for (const sx of [-1, 1]) {
      add(2.2, 0.2, 0.8, sx * 1.4, 0.3, -6.2, m.accent);
      add(0.3, 2.4, 2.4, sx * 0.9, 1.5, 5.4, m.wing).rotation.z = sx * -0.3;
      add(0.2, 0.15, 9, sx * 0.9, 0.86, -0.5, m.glow);
    }
    add(2.6, 2.6, 2, 0, 0, 7.4, m.dark);
    add(2.8, 0.3, 0.3, 0, 1.35, 8.3, m.glow);
    add(2.8, 0.3, 0.3, 0, -1.35, 8.3, m.glow);
    this.wingTips = [new THREE.Vector3(-4.8, -0.2, 5), new THREE.Vector3(4.8, -0.2, 5)];
    this.flame(0, 0, 8.4, 1.6, VARIANT_GLOW.comet!.flame);
  }

  /** Posición en el mundo de cada tobera (para los efectos del turbo) */
  nozzles(): THREE.Vector3[] {
    this.group.updateMatrixWorld();
    return this.flames.map((f) => f.getWorldPosition(new THREE.Vector3()));
  }

  update(flight: Flight, time: number) {
    this.group.position.copy(flight.pos);
    flight.quaternion(this.group.quaternion);
    const t = flight.thrust;
    // 0 en crucero, 1 con el turbo a tope: llamas mucho más largas, anchas y brillantes
    const boost = THREE.MathUtils.clamp((t - 0.6) / 0.4, 0, 1);
    for (let i = 0; i < this.flames.length; i++) {
      const flicker = 0.85 + Math.sin(time * 60 + i * 2.1) * 0.08 + Math.random() * (0.1 + boost * 0.25);
      const len = (0.35 + t * 1.3) * (1 + boost * 1.1) * flicker;
      const wid = (0.8 + t * 0.4) * (1 + boost * 0.3);
      const fl = this.flames[i];
      fl.scale.set(wid, wid, len);
      const outer = fl.material as THREE.MeshBasicMaterial;
      outer.opacity = 0.45 + boost * 0.1;
      const core = fl.children[0] as THREE.Mesh | undefined;
      if (core) {
        // Núcleo azul-blanco con anillos de choque al ir a tope
        const cm = core.material as THREE.MeshBasicMaterial;
        // Sin pasar de 1: así el resplandor (bloom) no lo convierte en un fogonazo
        cm.color.setRGB(0.6 + boost * 0.15, 0.5 + boost * 0.15, 0.36 + boost * 0.3);
        core.scale.set(1, 1, 1 + boost * 0.4 + (boost > 0.5 ? Math.sin(time * 90 + i) * 0.15 : 0));
      }
    }
  }
}
