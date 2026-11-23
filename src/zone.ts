import * as THREE from 'three';
import type { CityGen } from './world/city';
import { hash3 } from './world/noise';

export const ZONE_RADIUS = 140;
export const ZONE_HEIGHT = 170;
/** Segundos que permanece la zona en cada sitio */
export const ZONE_PERIOD = 60;

/** Zona del Rey del cielo: cilindro luminoso que se mueve cada minuto */
export class KothZone {
  center = new THREE.Vector3();
  index = -1;
  private group = new THREE.Group();
  private wallMat: THREE.MeshBasicMaterial;
  private ringMat: THREE.MeshBasicMaterial;
  private target = new THREE.Vector3();
  /** 'free' | 'mine' | 'enemy' | 'contested' */
  status: 'free' | 'mine' | 'enemy' | 'contested' = 'free';

  constructor(
    private scene: THREE.Scene,
    private gen: CityGen,
  ) {
    this.wallMat = new THREE.MeshBasicMaterial({ color: 0xffd040, transparent: true, opacity: 0.14, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(ZONE_RADIUS, ZONE_RADIUS, ZONE_HEIGHT, 48, 1, true), this.wallMat);
    this.ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 2.4, 0.6), side: THREE.DoubleSide, fog: false });
    const ringGeo = new THREE.TorusGeometry(ZONE_RADIUS, 1.6, 6, 64);
    for (const y of [-ZONE_HEIGHT / 2, ZONE_HEIGHT / 2]) {
      const r = new THREE.Mesh(ringGeo, this.ringMat);
      r.rotation.x = Math.PI / 2;
      r.position.y = y;
      this.group.add(r);
    }
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(4, 4, 1400, 8, 1, true), new THREE.MeshBasicMaterial({ color: 0xffd040, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    beam.position.y = 700 + ZONE_HEIGHT / 2;
    this.group.add(wall, beam);
    scene.add(this.group);
  }

  /** Posición determinista de la zona número i (igual para todos los jugadores) */
  private spot(i: number, seed: number) {
    const a = hash3(i, 3, 7, seed) * Math.PI * 2;
    const r = 300 + hash3(i, 5, 9, seed) * 1000;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const y = Math.max(this.gen.maxHeightNear(x, z, ZONE_RADIUS) + ZONE_HEIGHT / 2 + 30, 260 + hash3(i, 1, 2, seed) * 200);
    return new THREE.Vector3(x, y, z);
  }

  update(dt: number, elapsed: number, seed: number, time: number) {
    const i = Math.max(0, Math.floor(elapsed / ZONE_PERIOD));
    if (i !== this.index) {
      this.index = i;
      this.target.copy(this.spot(i, seed));
      if (this.center.lengthSq() === 0) this.center.copy(this.target);
    }
    this.center.lerp(this.target, 1 - Math.exp(-dt * 0.8));
    this.group.position.copy(this.center);
    const c = this.status === 'mine' ? [0.4, 3, 0.8] : this.status === 'enemy' ? [3, 0.5, 0.4] : this.status === 'contested' ? [3, 1.2, 3] : [3, 2.4, 0.6];
    this.ringMat.color.setRGB(c[0], c[1], c[2]);
    this.wallMat.color.setRGB(c[0] / 3, c[1] / 3, c[2] / 3);
    this.wallMat.opacity = 0.1 + 0.06 * Math.sin(time * 3);
  }

  /** Segundos hasta que la zona cambie de sitio */
  timeToMove(elapsed: number) {
    return ZONE_PERIOD - (elapsed % ZONE_PERIOD);
  }

  contains(p: THREE.Vector3) {
    const dx = p.x - this.center.x;
    const dz = p.z - this.center.z;
    return dx * dx + dz * dz < ZONE_RADIUS * ZONE_RADIUS && Math.abs(p.y - this.center.y) < ZONE_HEIGHT / 2;
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }
    });
  }
}

/** Radio inicial y mínimo de la zona segura de Supervivencia */
export const STORM_START = 2600;
export const STORM_MIN = 150;
/** Segundos antes de empezar a cerrarse */
export const STORM_GRACE = 20;

/**
 * Supervivencia: zona segura que se encoge. Fuera de ella la tormenta hace daño.
 * Determinista a partir de la semilla y el tiempo, igual para todos los jugadores.
 */
export class StormZone {
  center = new THREE.Vector3();
  radius = STORM_START;
  private group = new THREE.Group();
  private wall: THREE.Mesh;
  private wallMat: THREE.MeshBasicMaterial;
  private edgeMat: THREE.MeshBasicMaterial;
  private edge: THREE.Mesh;

  constructor(
    private scene: THREE.Scene,
    seed: number,
    private duration: number,
  ) {
    const a = hash3(seed, 11, 4, 1) * Math.PI * 2;
    const r = hash3(seed, 2, 8, 1) * 600;
    this.center.set(Math.cos(a) * r, 0, Math.sin(a) * r);
    this.wallMat = new THREE.MeshBasicMaterial({ color: 0x7a3cff, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    this.wall = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 2400, 96, 1, true), this.wallMat);
    this.wall.position.y = 1200;
    this.edgeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 0.6, 3), fog: false });
    this.edge = new THREE.Mesh(new THREE.TorusGeometry(1, 0.004, 4, 128), this.edgeMat);
    this.edge.rotation.x = Math.PI / 2;
    this.edge.position.y = 6;
    this.group.add(this.wall, this.edge);
    this.group.position.copy(this.center);
    scene.add(this.group);
  }

  /** Radio de la zona segura en el segundo t de partida */
  radiusAt(t: number) {
    const k = THREE.MathUtils.clamp((t - STORM_GRACE) / Math.max(1, this.duration - STORM_GRACE), 0, 1);
    const r = STORM_START + (STORM_MIN - STORM_START) * k;
    // Prórroga: tras el tiempo límite se cierra del todo en 30 s
    const over = THREE.MathUtils.clamp((t - this.duration) / 30, 0, 1);
    return Math.max(5, r * (1 - over));
  }

  /** Daño por segundo fuera de la zona */
  damageAt(t: number) {
    return t >= this.duration ? 22 : 6 + (t / 60) * 4;
  }

  /** Segundos para que empiece a cerrarse (0 si ya lo hace) */
  graceLeft(t: number) {
    return Math.max(0, STORM_GRACE - t);
  }

  update(t: number, time: number) {
    this.radius = this.radiusAt(Math.max(0, t));
    this.wall.scale.set(this.radius, 1, this.radius);
    this.edge.scale.setScalar(this.radius);
    this.wallMat.opacity = 0.16 + 0.06 * Math.sin(time * 2.4);
  }

  /** Distancia horizontal al borde: negativa dentro, positiva fuera */
  outside(p: THREE.Vector3) {
    return Math.hypot(p.x - this.center.x, p.z - this.center.z) - this.radius;
  }

  dispose() {
    this.scene.remove(this.group);
    this.wall.geometry.dispose();
    this.edge.geometry.dispose();
    this.wallMat.dispose();
    this.edgeMat.dispose();
  }
}
