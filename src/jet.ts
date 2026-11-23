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

export type PlaneVariant = 'falcon' | 'sparrow' | 'raptor' | 'typhoon' | 'specter' | 'phoenix' | 'mantis' | 'storm' | 'comet' | 'aurora';

/** Color de las llamas y de las luces de cada avión */
const VARIANT_GLOW: Partial<Record<PlaneVariant, { flame: number; glow: [number, number, number] }>> = {
  specter: { flame: 0x40e0ff, glow: [0.4, 2.2, 3.2] },
  phoenix: { flame: 0xff4a10, glow: [3.2, 1.2, 0.3] },
  mantis: { flame: 0xc070ff, glow: [2.2, 0.8, 3.2] },
  storm: { flame: 0xffc040, glow: [2.6, 2.4, 0.6] },
  comet: { flame: 0x6a8aff, glow: [0.8, 1.4, 3.6] },
  aurora: { flame: 0xffc860, glow: [1.15, 0.92, 0.4] },
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
      case 'raptor':
        this.buildRaptor(add, m);
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
      case 'aurora':
        this.buildAurora(add, m);
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
    if (variant === 'typhoon') {
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

  // ---------------------------------------------------------------- Piezas con forma real
  /**
   * Plancha con la silueta en planta (alas, estabilizadores, quillas).
   * pts: contorno del lado derecho como [x, z]; se refleja en el lado izquierdo.
   */
  private plate(pts: [number, number][], t: number, y: number, mat: THREE.Material, mirror = true) {
    const make = (sx: number) => {
      const shape = new THREE.Shape();
      const p0 = pts[0];
      shape.moveTo(p0[0] * sx, p0[1]);
      for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i][0] * sx, pts[i][1]);
      shape.closePath();
      const geo = new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: false });
      geo.rotateX(Math.PI / 2);
      geo.translate(0, y + t / 2, 0);
      const mesh = new THREE.Mesh(geo, mat);
      this.group.add(mesh);
      return mesh;
    };
    make(1);
    if (mirror) make(-1);
  }

  /** Deriva vertical: contorno [z, y] desde su raíz; cant = inclinación lateral (rad) */
  private fin(pts: [number, number][], t: number, x: number, y: number, cant: number, mat: THREE.Material) {
    const shape = new THREE.Shape();
    shape.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i][0], pts[i][1]);
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: false });
    geo.rotateY(-Math.PI / 2);
    geo.translate(t / 2, 0, 0);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, 0);
    mesh.rotation.z = cant;
    this.group.add(mesh);
    return mesh;
  }

  /** Tubo a lo largo del eje Z (fuselajes redondos, góndolas, conos, misiles) */
  private tube(rFront: number, rBack: number, len: number, x: number, y: number, z: number, mat: THREE.Material, seg = 8) {
    const geo = new THREE.CylinderGeometry(rBack, rFront, len, seg);
    geo.rotateX(Math.PI / 2);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    this.group.add(mesh);
    return mesh;
  }

  // ---------------------------------------------------------------- Avanzados (basados en aviones reales)
  /** Caza furtivo de superioridad aérea (estilo F-22 Raptor) */
  private buildRaptor(add: AddFn, m: Mats) {
    add(2.6, 1.3, 11, 0, 0, 1.6, m.body);
    // Morro con aristas (chine) y cono
    this.plate([[0, -10.4], [0.9, -7.4], [1.5, -4], [1.7, -0.5], [1.7, 1], [0, 1]], 0.8, -0.35, m.body);
    this.tube(0.06, 0.55, 2.2, 0, 0, -10.6, m.body, 6);
    add(1, 0.75, 3.8, 0, 0.75, -5.2, m.glass);
    add(1.2, 0.5, 1.6, 0, 0.7, -2.6, m.body);
    // Tomas de aire laterales en diamante
    for (const sx of [-1, 1]) {
      const intake = add(1, 1.3, 3.2, sx * 1.75, -0.15, -2.4, m.dark);
      intake.rotation.z = sx * 0.2;
    }
    // Ala trapezoidal y estabilizadores
    this.plate([[1.3, -2.9], [7.5, 3.3], [7.5, 4.5], [1.3, 6.2]], 0.32, -0.25, m.wing);
    this.plate([[7, 3.0], [7.5, 3.3], [7.5, 4.5], [7, 4.6]], 0.36, -0.25, m.accent);
    this.plate([[1.2, 6.2], [4.6, 8.4], [4.6, 9.4], [1.2, 9.6]], 0.24, -0.2, m.wing);
    // Derivas gemelas inclinadas hacia fuera
    for (const sx of [-1, 1]) {
      this.fin([[5, 0], [7.6, 3.2], [8.8, 3.2], [8.7, 0]], 0.25, sx * 1.5, 0.55, -sx * 0.48, m.wing);
      this.fin([[7.7, 2.7], [7.9, 3.2], [8.8, 3.2], [8.75, 2.7]], 0.28, sx * 1.5, 0.55, -sx * 0.48, m.accent);
    }
    // Toberas vectoriales planas
    add(1.25, 0.75, 1.3, -0.68, 0, 8, m.dark);
    add(1.25, 0.75, 1.3, 0.68, 0, 8, m.dark);
    add(3, 0.12, 0.5, 0, 0.66, 1.2, m.accent);
    this.wingTips = [new THREE.Vector3(-7.5, -0.1, 4), new THREE.Vector3(7.5, -0.1, 4)];
    this.flame(-0.68, 0, 8.6);
    this.flame(0.68, 0, 8.6);
  }

  /** Ala volante furtiva (estilo B-2 Spirit, a escala de caza) */
  private buildSpecter(add: AddFn, m: Mats) {
    // Planta en W con borde de salida en dientes de sierra
    this.plate([[0, -7.2], [9.4, 2], [9.4, 2.8], [6.5, 5.4], [4.4, 3.5], [2.2, 5.6], [0, 3.9]], 0.55, -0.3, m.body);
    // Borde de ataque luminoso (fino)
    this.plate([[0.3, -6.95], [9.3, 1.9], [9.3, 2.12], [0.3, -6.7]], 0.12, 0.02, m.glow);
    // Joroba central, cabina y tomas de aire dorsales
    add(3.4, 1.1, 8, 0, 0.45, -1.6, m.body);
    add(2.2, 0.6, 3, 0, 1.05, -2.4, m.body);
    add(1.3, 0.45, 2, 0, 1.3, -3.8, m.glass);
    for (const sx of [-1, 1]) {
      add(1.3, 0.55, 2.2, sx * 2.1, 0.75, -0.2, m.dark);
      add(1.8, 0.2, 1, sx * 2.1, 0.45, 3.6, m.dark);
    }
    this.wingTips = [new THREE.Vector3(-9.4, 0, 2.4), new THREE.Vector3(9.4, 0, 2.4)];
    const c = VARIANT_GLOW.specter!.flame;
    this.flame(-2.1, 0.45, 4.1, 0.75, c);
    this.flame(2.1, 0.45, 4.1, 0.75, c);
  }

  /** Alas en flecha invertida y canards (estilo Su-47 Berkut) */
  private buildPhoenix(add: AddFn, m: Mats) {
    add(2.2, 1.7, 13, 0, 0.1, 0.2, m.body);
    this.tube(0.08, 0.85, 3.6, 0, 0, -8.1, m.body, 8);
    add(1.1, 0.85, 3.6, 0, 1.05, -4.2, m.glass);
    add(1.4, 0.5, 2.6, 0, 0.95, -1.6, m.body);
    for (const sx of [-1, 1]) {
      this.tube(0.75, 0.8, 9.5, sx * 1.55, -0.2, 3.6, m.body, 8);
      this.tube(0.7, 0.6, 1.2, sx * 1.55, -0.2, 8.9, m.dark, 8);
      add(1, 1.2, 1.4, sx * 1.55, -0.3, -1.7, m.dark);
    }
    // Ala en flecha invertida: la punta va por delante de la raíz
    this.plate([[2.1, 0.6], [8.6, -2.6], [8.6, -1], [2.1, 5.4]], 0.32, -0.3, m.wing);
    this.plate([[8, -2.3], [8.6, -2.6], [8.6, -1], [8, -0.7]], 0.36, -0.3, m.accent);
    // Canards y estabilizadores
    this.plate([[1.2, -5.6], [4, -4.3], [4, -3.5], [1.2, -3.6]], 0.2, 0.25, m.accent);
    this.plate([[2.2, 7], [5, 8.6], [5, 9.4], [2.2, 9.4]], 0.22, -0.2, m.wing);
    for (const sx of [-1, 1]) this.fin([[5.6, 0], [8.2, 3.1], [9.2, 3.1], [9.2, 0]], 0.25, sx * 1.9, 0.5, -sx * 0.18, m.wing);
    add(0.25, 0.12, 6, 0, 1.0, 2.4, m.glow);
    this.wingTips = [new THREE.Vector3(-8.6, -0.2, -1.8), new THREE.Vector3(8.6, -0.2, -1.8)];
    const c = VARIANT_GLOW.phoenix!.flame;
    this.flame(-1.55, -0.2, 9.5, 1, c);
    this.flame(1.55, -0.2, 9.5, 1, c);
  }

  /** Delta con canards cargado de misiles (estilo Eurofighter Typhoon) */
  private buildMantis(add: AddFn, m: Mats) {
    add(2.1, 1.7, 12.5, 0, 0.1, 0.8, m.body);
    this.tube(0.07, 0.8, 3.4, 0, 0.15, -7.1, m.body, 8);
    add(1, 0.85, 3.4, 0, 1.15, -4.2, m.glass);
    add(1.3, 0.55, 3, 0, 1.0, -1.6, m.body);
    // Toma de aire ventral «sonrisa»
    add(2.1, 1.1, 3.2, 0, -1.1, -1.6, m.dark);
    add(1.8, 0.9, 6, 0, -0.9, 2.6, m.body);
    // Delta recortado y canards
    this.plate([[1, -0.6], [6.2, 5.2], [6.2, 6.1], [1, 7]], 0.32, -0.3, m.wing);
    this.plate([[5.6, 4.6], [6.2, 5.2], [6.2, 6.1], [5.6, 6.2]], 0.36, -0.3, m.accent);
    this.plate([[1, -5.8], [3.1, -4.6], [3.1, -4.05], [1, -4.2]], 0.18, 0.3, m.accent);
    this.fin([[3.2, 0], [6.8, 3.5], [8.1, 3.5], [7.7, 0]], 0.28, 0, 0.8, 0, m.wing);
    this.fin([[6.6, 2.9], [6.85, 3.5], [8.1, 3.5], [8.0, 2.9]], 0.3, 0, 0.8, 0, m.accent);
    this.tube(0.62, 0.55, 1.2, -0.6, 0, 7.7, m.dark, 8);
    this.tube(0.62, 0.55, 1.2, 0.6, 0, 7.7, m.dark, 8);
    // Misiles: tres por ala y dos bajo el fuselaje
    for (const sx of [-1, 1]) {
      for (const [x, z] of [
        [2.4, 2.4],
        [3.6, 3.4],
        [4.8, 4.4],
      ]) {
        add(0.15, 0.35, 1.6, sx * x, -0.55, z, m.dark);
        this.tube(0.06, 0.2, 2.6, sx * x, -0.85, z, m.white, 6);
        this.tube(0.02, 0.2, 0.45, sx * x, -0.85, z - 1.5, m.red, 6);
      }
      this.tube(0.06, 0.2, 2.6, sx * 0.7, -1.75, 3.2, m.white, 6);
    }
    this.wingTips = [new THREE.Vector3(-6.2, -0.2, 5.6), new THREE.Vector3(6.2, -0.2, 5.6)];
    const c = VARIANT_GLOW.mantis!.flame;
    this.flame(-0.6, 0, 8.3, 0.9, c);
    this.flame(0.6, 0, 8.3, 0.9, c);
  }

  /** Avión de ataque blindado con cañón rotativo (estilo A-10 Thunderbolt II) */
  private buildStorm(add: AddFn, m: Mats) {
    add(2.3, 2.3, 11, 0, 0, 0.6, m.body);
    this.tube(0.7, 1.15, 3, 0, -0.2, -6.4, m.body, 8);
    add(1.4, 1.1, 2.8, 0, 1.35, -4.4, m.glass);
    // Cañón rotativo: tres cañones asomando bajo el morro
    this.tube(0.45, 0.45, 1.4, 0, -0.6, -8.4, m.dark, 8);
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2;
      this.tube(0.1, 0.1, 2.6, Math.cos(a) * 0.25, -0.6 + Math.sin(a) * 0.25, -9.9, m.dark, 5);
    }
    add(1.6, 1.2, 4, 0, -0.2, 7.4, m.body);
    // Ala recta, gruesa, con carga bajo las alas
    this.plate([[1.1, -0.9], [9.2, -0.1], [9.2, 1.8], [1.1, 2.4]], 0.45, -0.6, m.wing);
    this.plate([[8.5, -0.15], [9.2, -0.1], [9.2, 1.8], [8.5, 1.85]], 0.5, -0.6, m.accent);
    for (const sx of [-1, 1]) {
      for (const x of [3.4, 5, 6.6]) {
        add(0.2, 0.5, 1.4, sx * x, -0.9, 0.6, m.dark);
        this.tube(0.15, 0.32, 2.4, sx * x, -1.35, 0.5, m.white, 6);
      }
      // Motores altos en góndolas, junto a la cola
      this.tube(0.95, 0.85, 3.8, sx * 1.75, 1.55, 4.3, m.body, 10);
      this.tube(0.75, 0.75, 0.3, sx * 1.75, 1.55, 2.35, m.dark, 10);
      add(0.4, 0.9, 1.6, sx * 1.2, 1.05, 4.3, m.body);
      // Derivas en los extremos del estabilizador
      this.fin([[7.4, -1.1], [7.8, 2.3], [9.2, 2.3], [9.4, -1.1]], 0.3, sx * 3.7, 0.5, 0, m.wing);
      this.fin([[7.6, 1.6], [7.8, 2.3], [9.2, 2.3], [9.2, 1.6]], 0.34, sx * 3.7, 0.5, 0, m.accent);
    }
    this.plate([[0, 7.5], [3.8, 7.7], [3.8, 9], [0, 9.2]], 0.3, 0.45, m.wing);
    this.wingTips = [new THREE.Vector3(-9.2, -0.4, 0.8), new THREE.Vector3(9.2, -0.4, 0.8)];
    const c = VARIANT_GLOW.storm!.flame;
    this.flame(-1.75, 1.55, 6.3, 0.85, c);
    this.flame(1.75, 1.55, 6.3, 0.85, c);
  }

  /** Avión espía trisónico (estilo SR-71 Blackbird) */
  private buildComet(add: AddFn, m: Mats) {
    // Fuselaje larguísimo con aristas a los lados
    this.tube(0.75, 0.75, 17, 0, 0.1, -0.6, m.body, 8);
    this.tube(0.04, 0.75, 4.4, 0, 0.1, -11.3, m.body, 8);
    this.plate([[0, -12.6], [0.9, -8], [1.6, -3], [2, 1], [0, 1]], 0.3, -0.05, m.body);
    add(0.9, 0.55, 2.6, 0, 0.75, -7.2, m.glass);
    // Ala delta y góndolas de los motores a media ala con conos de admisión
    this.plate([[1.6, -4.5], [7.4, 6.6], [7.4, 7.9], [1.6, 8.3]], 0.28, -0.15, m.wing);
    this.plate([[6.8, 5.6], [7.4, 6.6], [7.4, 7.9], [6.8, 7.95]], 0.32, -0.15, m.accent);
    for (const sx of [-1, 1]) {
      this.tube(0.85, 0.95, 12.5, sx * 3.5, 0, 2.7, m.body, 10);
      this.tube(0.03, 0.62, 1.8, sx * 3.5, 0, -4.2, m.dark, 8);
      this.tube(0.85, 0.85, 0.3, sx * 3.5, 0, -3.5, m.accent, 10);
      this.tube(0.8, 0.75, 0.6, sx * 3.5, 0, 9.2, m.dark, 10);
      // Derivas sobre las góndolas, inclinadas hacia dentro
      this.fin([[5.6, 0], [7.6, 2.9], [8.6, 2.9], [8.9, 0]], 0.22, sx * 3.5, 0.75, sx * 0.26, m.wing);
    }
    add(0.18, 0.1, 9, 0, 0.88, -1.4, m.glow);
    this.wingTips = [new THREE.Vector3(-7.4, 0, 7.4), new THREE.Vector3(7.4, 0, 7.4)];
    const c = VARIANT_GLOW.comet!.flame;
    this.flame(-3.5, 0, 9.5, 1.05, c);
    this.flame(3.5, 0, 9.5, 1.05, c);
  }

  /** Avión legendario: caza de sexta generación sin derivas (como los prototipos NGAD) */
  private buildAurora(add: AddFn, m: Mats) {
    // Planta en cometa (ala de diamante) con borde de salida en W
    this.plate([[0, -10], [1.9, -4.5], [8.8, 3], [8.8, 3.9], [5.4, 5.6], [2.8, 4.2], [0, 6.6]], 0.45, -0.25, m.wing);
    this.plate([[0.3, -9.7], [1.95, -4.6], [8.75, 2.9], [8.75, 3.15], [1.8, -4.25], [0.3, -9.4]], 0.12, 0.05, m.glow);
    this.plate([[8.2, 2.5], [8.8, 3], [8.8, 3.9], [8.2, 4.2]], 0.5, -0.25, m.accent);
    // Fuselaje integrado, cabina y tomas dorsales
    add(2.6, 1.1, 11, 0, 0.35, -1, m.body);
    this.tube(0.05, 0.7, 2.4, 0, 0.3, -9.4, m.body, 6);
    add(1.05, 0.65, 3.4, 0, 1.05, -5, m.glass);
    add(1.5, 0.5, 2.2, 0, 1.0, -2.4, m.body);
    for (const sx of [-1, 1]) {
      add(1.1, 0.5, 2.6, sx * 1.4, 0.85, -0.6, m.dark);
      add(1.3, 0.35, 0.9, sx * 1, 0.25, 5.6, m.dark);
    }
    this.wingTips = [new THREE.Vector3(-8.8, -0.1, 3.4), new THREE.Vector3(8.8, -0.1, 3.4)];
    const c = VARIANT_GLOW.aurora!.flame;
    this.flame(-1, 0.25, 6.1, 0.85, c);
    this.flame(1, 0.25, 6.1, 0.85, c);
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
