import * as THREE from 'three';

export type WeatherKind = 'clear' | 'rain' | 'fog' | 'storm' | 'snow';

export const WEATHER_LABELS: Record<WeatherKind, string> = {
  clear: 'Despejado',
  rain: 'Lluvia',
  fog: 'Niebla',
  storm: 'Tormenta',
  snow: 'Nieve',
};

interface WeatherSpec {
  fog: number;
  darken: number;
  precip: 'none' | 'rain' | 'snow';
  amount: number;
  lightning: boolean;
  turbulence: number;
}

const SPECS: Record<WeatherKind, WeatherSpec> = {
  clear: { fog: 1, darken: 0, precip: 'none', amount: 0, lightning: false, turbulence: 0 },
  rain: { fog: 1.7, darken: 0.3, precip: 'rain', amount: 1, lightning: false, turbulence: 0.15 },
  fog: { fog: 3.2, darken: 0.12, precip: 'none', amount: 0, lightning: false, turbulence: 0 },
  storm: { fog: 2.1, darken: 0.5, precip: 'rain', amount: 1.6, lightning: true, turbulence: 0.5 },
  snow: { fog: 2, darken: 0.15, precip: 'snow', amount: 1, lightning: false, turbulence: 0.1 },
};

const N = 1400;
const BOX = 140;

export interface WeatherTargets {
  scene: THREE.Scene;
  fog: THREE.FogExp2;
  baseFogDensity: number;
  baseFogColor: THREE.Color;
  hemi: THREE.HemisphereLight;
  sun: THREE.DirectionalLight;
  baseHemi: number;
  baseSun: number;
  skyUniforms: { uTop: { value: THREE.Color }; uHorizon: { value: THREE.Color } };
  baseTop: THREE.Color;
  baseHorizon: THREE.Color;
}

/** Clima: niebla, oscuridad, lluvia/nieve, relámpagos y turbulencias */
export class Weather {
  kind: WeatherKind = 'clear';
  private spec = SPECS.clear;
  private rain: THREE.LineSegments;
  private snow: THREE.Points;
  private drops = new Float32Array(N * 3);
  private flash = 0;
  private nextBolt = 8;
  private turbT = 0;
  /** Se llama cuando cae un rayo (para el trueno) */
  onLightning?: (distance: number) => void;

  constructor(private t: WeatherTargets) {
    const rg = new THREE.BufferGeometry();
    rg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 6), 3));
    this.rain = new THREE.LineSegments(
      rg,
      new THREE.LineBasicMaterial({ color: 0xbfd4ee, transparent: true, opacity: 0.55, fog: false, depthWrite: false }),
    );
    this.rain.frustumCulled = false;
    this.rain.visible = false;
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    this.snow = new THREE.Points(
      sg,
      new THREE.PointsMaterial({ color: 0xffffff, size: 0.9, transparent: true, opacity: 0.9, fog: false, depthWrite: false }),
    );
    this.snow.frustumCulled = false;
    this.snow.visible = false;
    for (let i = 0; i < N * 3; i++) this.drops[i] = (Math.random() - 0.5) * BOX;
    t.scene.add(this.rain, this.snow);
  }

  /** Elige un clima al azar (o despejado si está desactivado) */
  randomize(enabled: boolean, night: boolean, custom?: [WeatherKind, number][]) {
    if (!enabled) return this.set('clear');
    const r = Math.random();
    const options: [WeatherKind, number][] = custom ? custom : night
      ? [['clear', 0.45], ['rain', 0.2], ['fog', 0.15], ['storm', 0.2]]
      : [['clear', 0.42], ['rain', 0.2], ['fog', 0.15], ['storm', 0.13], ['snow', 0.1]];
    let acc = 0;
    for (const [k, w] of options) {
      acc += w;
      if (r < acc) return this.set(k);
    }
    return this.set('clear');
  }

  set(kind: WeatherKind) {
    this.kind = kind;
    this.spec = SPECS[kind];
    const t = this.t;
    t.fog.density = t.baseFogDensity * this.spec.fog;
    const grey = new THREE.Color(0x5a6270);
    t.fog.color.copy(t.baseFogColor).lerp(grey, this.spec.darken);
    t.skyUniforms.uTop.value.copy(t.baseTop).lerp(new THREE.Color(0x3a4250), this.spec.darken * 1.2);
    t.skyUniforms.uHorizon.value.copy(t.baseHorizon).lerp(grey, this.spec.darken);
    if (t.scene.background instanceof THREE.Color) t.scene.background.copy(t.fog.color);
    t.hemi.intensity = t.baseHemi * (1 - this.spec.darken * 0.45);
    t.sun.intensity = t.baseSun * (1 - this.spec.darken * 0.8);
    this.rain.visible = this.spec.precip === 'rain';
    this.snow.visible = this.spec.precip === 'snow';
    this.nextBolt = 4 + Math.random() * 6;
    return kind;
  }

  /** Devuelve una perturbación de alabeo/cabeceo por turbulencia */
  update(dt: number, camera: THREE.Camera, planeVel: THREE.Vector3): { roll: number; pitch: number } {
    const s = this.spec;
    if (s.precip !== 'none') this.updatePrecip(dt, camera, planeVel);
    if (s.lightning) {
      this.nextBolt -= dt;
      if (this.nextBolt <= 0) {
        this.nextBolt = 5 + Math.random() * 10;
        this.flash = 0.35;
        this.onLightning?.(300 + Math.random() * 2500);
      }
    }
    if (this.flash > 0) {
      this.flash -= dt;
      // Doble destello
      const on = this.flash > 0.25 || (this.flash > 0.08 && this.flash < 0.16);
      const t = this.t;
      t.hemi.intensity = t.baseHemi * (1 - s.darken * 0.45) * (on ? 3.5 : 1);
      if (t.scene.background instanceof THREE.Color) t.scene.background.copy(on ? new THREE.Color(0xd8e0ff) : t.fog.color);
      t.skyUniforms.uHorizon.value.copy(on ? new THREE.Color(0xc8d0f0) : t.baseHorizon.clone().lerp(new THREE.Color(0x5a6270), s.darken));
    }
    if (s.turbulence <= 0) return { roll: 0, pitch: 0 };
    this.turbT += dt;
    const k = s.turbulence;
    return {
      roll: (Math.sin(this.turbT * 3.1) * 0.6 + Math.sin(this.turbT * 7.3) * 0.4) * k * 0.25 * dt * 10,
      pitch: (Math.sin(this.turbT * 2.3 + 1) * 0.5 + Math.sin(this.turbT * 5.7) * 0.5) * k * 0.08 * dt * 10,
    };
  }

  private updatePrecip(dt: number, camera: THREE.Camera, vel: THREE.Vector3) {
    const snow = this.spec.precip === 'snow';
    const fall = snow ? 8 : 60;
    const d = this.drops;
    const half = BOX / 2;
    const cp = camera.position;
    const active = Math.floor(N * Math.min(1, this.spec.amount));
    // Las gotas se mueven relativas a la cámara (incluido el viento del avance)
    const vx = -vel.x * 0.02;
    const vz = -vel.z * 0.02;
    for (let i = 0; i < active; i++) {
      const k = i * 3;
      d[k] += (vx + (snow ? Math.sin(i + performance.now() * 0.001) * 2 : 0)) * dt;
      d[k + 1] -= (fall + vel.y * 0.02) * dt;
      d[k + 2] += vz * dt;
      for (let a = 0; a < 3; a++) {
        if (d[k + a] < -half) d[k + a] += BOX;
        else if (d[k + a] > half) d[k + a] -= BOX;
      }
    }
    if (snow) {
      const pos = this.snow.geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < N; i++) {
        const k = i * 3;
        if (i >= active) pos.setXYZ(i, 0, -9999, 0);
        else pos.setXYZ(i, cp.x + d[k], cp.y + d[k + 1], cp.z + d[k + 2]);
      }
      pos.needsUpdate = true;
    } else {
      const pos = this.rain.geometry.getAttribute('position') as THREE.BufferAttribute;
      const len = 2.2 + this.spec.amount;
      for (let i = 0; i < N; i++) {
        const k = i * 3;
        if (i >= active) {
          pos.setXYZ(i * 2, 0, -9999, 0);
          pos.setXYZ(i * 2 + 1, 0, -9999, 0);
          continue;
        }
        const x = cp.x + d[k];
        const y = cp.y + d[k + 1];
        const z = cp.z + d[k + 2];
        pos.setXYZ(i * 2, x, y, z);
        pos.setXYZ(i * 2 + 1, x - vx * 0.05, y + len, z - vz * 0.05);
      }
      pos.needsUpdate = true;
    }
  }

  dispose() {
    this.t.scene.remove(this.rain, this.snow);
    this.rain.geometry.dispose();
    (this.rain.material as THREE.Material).dispose();
    this.snow.geometry.dispose();
    (this.snow.material as THREE.Material).dispose();
  }
}
