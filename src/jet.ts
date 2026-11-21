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
    this.roll += (targetRoll - this.roll) * Math.min(1, dt * 3.2);

    // Cabeceo
    const py = input.climb ? 1 : input.y;
    const pitchRate = 0.95 * (0.6 + 0.4 * Math.min(1, this.speed / (CRUISE_KMH / KMH)));
    this.pitch += py * pitchRate * dt;
    // Ligera recuperación hacia el horizonte sin input
    if (Math.abs(py) < 0.05) this.pitch *= 1 - Math.min(1, dt * 0.25);
    const maxPitch = THREE.MathUtils.degToRad(80);
    this.pitch = THREE.MathUtils.clamp(this.pitch, -maxPitch, maxPitch);

    // Giro coordinado por alabeo
    this.yaw += Math.sin(this.roll) * 0.95 * dt;

    // Velocidad: empuje + gravedad
    const target = (this.burst > 0 ? MAX_KMH : input.boost ? BOOST_KMH : CRUISE_KMH) / KMH;
    const accel = this.burst > 0 ? 260 : input.boost ? 110 : 45;
    if (this.speed < target) this.speed = Math.min(target, this.speed + accel * dt);
    else this.speed = Math.max(target, this.speed - 35 * dt);
    this.speed -= Math.sin(this.pitch) * 9.81 * 1.6 * dt;
    this.speed = THREE.MathUtils.clamp(this.speed, MIN_KMH / KMH, MAX_KMH / KMH);
    this.thrust += ((input.boost || this.burst > 0 ? 1 : 0.55) - this.thrust) * Math.min(1, dt * 3);

    const f = this.forward(_v);
    this.pos.addScaledVector(f, this.speed * dt);
    if (this.pos.y > 4500) this.pos.y = 4500;

    this.verticalSpeed = (this.pos.y - this.prevY) / Math.max(dt, 1e-4);
    this.prevY = this.pos.y;
    this.maxSpeedKmh = Math.max(this.maxSpeedKmh, this.speedKmh);
  }
}
const _v = new THREE.Vector3();

/** Caza vóxel construido con cajas. Mira hacia -Z. */
export class JetModel {
  group = new THREE.Group();
  private flames: THREE.Mesh[] = [];
  readonly wingTips = [new THREE.Vector3(-7.2, 0.1, 3.6), new THREE.Vector3(7.2, 0.1, 3.6)];

  constructor(accentColor = 0xff7a1a, bodyColor = 0x40454e) {
    const body = new THREE.MeshLambertMaterial({ color: bodyColor });
    const dark = new THREE.MeshLambertMaterial({ color: 0x2a2d33 });
    const wingMat = new THREE.MeshLambertMaterial({ color: 0x4d535d });
    const glass = new THREE.MeshLambertMaterial({ color: 0x66c8ff, emissive: 0x113355 });
    const red = new THREE.MeshBasicMaterial({ color: 0xff3030 });
    const green = new THREE.MeshBasicMaterial({ color: 0x30ff60 });
    const accent = new THREE.MeshLambertMaterial({ color: accentColor });

    const add = (w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
      mesh.position.set(x, y, z);
      this.group.add(mesh);
      return mesh;
    };

    // Fuselaje
    add(2.4, 2, 11, 0, 0, 0.5, body);
    add(1.8, 1.6, 3, 0, 0, -6.5, body);
    add(1.1, 1.1, 2, 0, -0.1, -9, body);
    add(0.6, 0.6, 1.2, 0, -0.1, -10.5, dark);
    // Cabina
    add(1.3, 0.9, 3.2, 0, 1.3, -4.4, glass);
    add(1.4, 0.7, 2, 0, 1.15, -2.2, body);
    // Tomas de aire
    add(0.9, 1.4, 3, -1.6, -0.2, -1.5, dark);
    add(0.9, 1.4, 3, 1.6, -0.2, -1.5, dark);
    // Alas en delta escalonada
    const steps: [number, number][] = [
      [5, -2.2],
      [8.5, -0.6],
      [11.5, 1],
      [14.4, 2.6],
      [14.4, 4],
    ];
    for (const [span, z] of steps) add(span, 0.35, 1.7, 0, -0.2, z, wingMat);
    // Franjas de color en las alas
    add(1.2, 0.4, 1.4, -6.6, -0.15, 3.3, accent);
    add(1.2, 0.4, 1.4, 6.6, -0.15, 3.3, accent);
    add(1.9, 0.3, 0.8, 0, 1.05, -0.6, accent);
    add(0.35, 0.8, 1.4, -1.35, 3.4, 5.4, accent).rotation.z = 0.25;
    add(0.35, 0.8, 1.4, 1.35, 3.4, 5.4, accent).rotation.z = -0.25;
    // Estabilizadores horizontales
    add(8, 0.3, 1.6, 0, 0, 6.2, wingMat);
    // Derivas dobles
    const finL = add(0.3, 3.2, 2.6, -1.1, 2, 5, wingMat);
    const finR = add(0.3, 3.2, 2.6, 1.1, 2, 5, wingMat);
    finL.rotation.z = 0.25;
    finR.rotation.z = -0.25;
    // Toberas
    add(1.1, 1.1, 1.2, -0.6, 0, 6.6, dark);
    add(1.1, 1.1, 1.2, 0.6, 0, 6.6, dark);
    // Luces de navegación
    add(0.4, 0.4, 0.4, -7.3, -0.1, 3.4, red);
    add(0.4, 0.4, 0.4, 7.3, -0.1, 3.4, green);

    // Llamas de postcombustión
    const flameGeo = new THREE.ConeGeometry(0.55, 4, 6);
    flameGeo.rotateX(Math.PI / 2);
    flameGeo.translate(0, 0, 2);
    const flameOuter = new THREE.MeshBasicMaterial({
      color: 0xff6a10,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const coreGeo = new THREE.ConeGeometry(0.3, 2.5, 6);
    coreGeo.rotateX(Math.PI / 2);
    coreGeo.translate(0, 0, 1.25);
    const flameCore = new THREE.MeshBasicMaterial({ color: 0xfff0a0, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
    for (const x of [-0.6, 0.6]) {
      const f = new THREE.Mesh(flameGeo, flameOuter);
      f.position.set(x, 0, 7.2);
      const c = new THREE.Mesh(coreGeo, flameCore);
      f.add(c);
      this.group.add(f);
      this.flames.push(f);
    }
  }

  update(flight: Flight, time: number) {
    this.group.position.copy(flight.pos);
    flight.quaternion(this.group.quaternion);
    const t = flight.thrust;
    for (let i = 0; i < this.flames.length; i++) {
      const flicker = 0.85 + Math.sin(time * 60 + i * 2.1) * 0.08 + Math.random() * 0.1;
      const len = (0.35 + t * 1.3) * flicker;
      this.flames[i].scale.set(0.8 + t * 0.4, 0.8 + t * 0.4, len);
    }
  }
}
