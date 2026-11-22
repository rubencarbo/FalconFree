import * as THREE from 'three';
import type { Stage } from './stages';
import type { CityGen, RingKind, RingSpawn } from './world/city';

/** Cúpula de cielo con degradado, sol y estrellas (de noche) */
export class Sky {
  mesh: THREE.Mesh;
  constructor(stage: Stage) {
    const sunDir = new THREE.Vector3(...stage.sun.dir).normalize();
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uTop: { value: new THREE.Color(stage.sky.top) },
        uHorizon: { value: new THREE.Color(stage.sky.horizon) },
        uSun: { value: sunDir },
        uSunColor: { value: new THREE.Color(stage.sun.color) },
        uNight: { value: stage.night ? 1 : 0 },
      },
      vertexShader: `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position = p.xyww;
        }`,
      fragmentShader: `
        uniform vec3 uTop; uniform vec3 uHorizon; uniform vec3 uSun; uniform vec3 uSunColor; uniform float uNight;
        varying vec3 vDir;
        float h(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
        void main() {
          float y = max(vDir.y, 0.0);
          vec3 col = mix(uHorizon, uTop, pow(y, 0.55));
          if (vDir.y < 0.0) col = uHorizon;
          float s = max(dot(normalize(vDir), uSun), 0.0);
          col += uSunColor * (pow(s, 600.0) * 1.6 + pow(s, 12.0) * 0.2);
          if (uNight > 0.5 && vDir.y > 0.05) {
            vec3 cell = floor(vDir * 260.0);
            float st = step(0.9965, h(cell));
            col += vec3(st) * 0.9 * smoothstep(0.05, 0.4, vDir.y);
          }
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1000, 32, 16), mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1;
  }
  update(camera: THREE.Camera) {
    this.mesh.position.copy(camera.position);
  }
  dispose() {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

/** Plano lejano para que no se vea el vacío más allá de los chunks */
export class FarGround {
  mesh: THREE.Mesh;
  constructor(stage: Stage) {
    const mat = new THREE.MeshLambertMaterial({
      color: new THREE.Color(stage.palette.lot).lerp(new THREE.Color(stage.palette.water[1]), 0.35),
      polygonOffset: true,
      polygonOffsetFactor: 4,
      polygonOffsetUnits: 4,
    });
    const geo = new THREE.PlaneGeometry(60000, 60000);
    geo.rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.position.y = -0.5;
  }
  update(pos: THREE.Vector3) {
    this.mesh.position.x = Math.round(pos.x / 1000) * 1000;
    this.mesh.position.z = Math.round(pos.z / 1000) * 1000;
  }
  dispose() {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

/** Estelas blancas desde las puntas de las alas */
export class Contrails {
  lines: THREE.Line[] = [];
  private points: THREE.Vector3[][] = [[], []];
  private readonly max = 90;
  private last = [new THREE.Vector3(), new THREE.Vector3()];

  constructor(scene: THREE.Scene) {
    for (let i = 0; i < 2; i++) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.max * 3), 3));
      geo.setDrawRange(0, 0);
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 }));
      line.frustumCulled = false;
      scene.add(line);
      this.lines.push(line);
    }
  }

  reset() {
    this.points = [[], []];
    for (const l of this.lines) l.geometry.setDrawRange(0, 0);
  }

  update(tipsWorld: THREE.Vector3[]) {
    for (let i = 0; i < 2; i++) {
      const pts = this.points[i];
      const tip = tipsWorld[i];
      if (!pts.length || this.last[i].distanceTo(tip) > 5) {
        pts.unshift(tip.clone());
        this.last[i].copy(tip);
        if (pts.length > this.max) pts.pop();
      } else {
        pts[0].copy(tip);
      }
      const attr = this.lines[i].geometry.getAttribute('position') as THREE.BufferAttribute;
      for (let k = 0; k < pts.length; k++) attr.setXYZ(k, pts[k].x, pts[k].y, pts[k].z);
      attr.needsUpdate = true;
      this.lines[i].geometry.setDrawRange(0, pts.length);
    }
  }

  setVisible(v: boolean) {
    for (const l of this.lines) l.visible = v;
  }

  dispose(scene: THREE.Scene) {
    for (const l of this.lines) {
      scene.remove(l);
      l.geometry.dispose();
      (l.material as THREE.Material).dispose();
    }
  }
}

/** Explosión de cubos */
export class Explosion {
  mesh: THREE.InstancedMesh;
  private vel: THREE.Vector3[] = [];
  private pos: THREE.Vector3[] = [];
  private rot: THREE.Vector3[] = [];
  private size: number[] = [];
  private t = 0;
  active = false;
  private readonly n = 80;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private s = new THREE.Vector3();
  light: THREE.PointLight;

  constructor(scene: THREE.Scene) {
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xffffff }), this.n);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    const palette = [0xffd040, 0xff8a1a, 0xff4a10, 0x555555, 0x333333, 0xfff0b0];
    const c = new THREE.Color();
    for (let i = 0; i < this.n; i++) {
      c.setHex(palette[i % palette.length]);
      this.mesh.setColorAt(i, c);
      this.vel.push(new THREE.Vector3());
      this.pos.push(new THREE.Vector3());
      this.rot.push(new THREE.Vector3());
      this.size.push(1);
    }
    this.light = new THREE.PointLight(0xff8a30, 0, 400, 1.2);
    scene.add(this.mesh);
    scene.add(this.light);
  }

  trigger(at: THREE.Vector3, vel: THREE.Vector3) {
    this.active = true;
    this.t = 0;
    this.mesh.visible = true;
    this.light.position.copy(at);
    for (let i = 0; i < this.n; i++) {
      this.pos[i].copy(at);
      const dir = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8, Math.random() - 0.5).normalize();
      this.vel[i].copy(dir).multiplyScalar(20 + Math.random() * 60).addScaledVector(vel, 0.15);
      this.rot[i].set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      this.size[i] = 1.5 + Math.random() * 4;
    }
  }

  update(dt: number) {
    if (!this.active) return;
    this.t += dt;
    const life = 2.6;
    const k = Math.max(0, 1 - this.t / life);
    this.light.intensity = Math.max(0, 1 - this.t / 0.8) * 400000;
    for (let i = 0; i < this.n; i++) {
      this.vel[i].y -= 25 * dt;
      this.vel[i].multiplyScalar(1 - dt * 0.8);
      this.pos[i].addScaledVector(this.vel[i], dt);
      if (this.pos[i].y < 0.5) {
        this.pos[i].y = 0.5;
        this.vel[i].y *= -0.3;
      }
      this.e.set(this.rot[i].x * this.t, this.rot[i].y * this.t, this.rot[i].z * this.t);
      this.q.setFromEuler(this.e);
      const s = this.size[i] * (0.4 + k);
      this.s.set(s, s, s);
      this.m.compose(this.pos[i], this.q, this.s);
      this.mesh.setMatrixAt(i, this.m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.t > life) {
      this.active = false;
      this.mesh.visible = false;
      this.light.intensity = 0;
    }
  }

  dispose(scene: THREE.Scene) {
    scene.remove(this.mesh);
    scene.remove(this.light);
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.dispose();
  }
}

export interface RingInfo {
  label: string;
  /** cuántos anillos vale */
  value: number;
  radius: number;
  tube: number;
  color: number;
  emissive: number;
  css: string;
}

export const RING_INFO: Record<RingKind, RingInfo> = {
  normal: { label: 'Anillo', value: 1, radius: 24, tube: 3.2, color: 0xffa020, emissive: 0xff6a00, css: '#ff9a2a' },
  ammo: { label: 'Munición completa', value: 1, radius: 20, tube: 3.2, color: 0xffe040, emissive: 0xc8a000, css: '#ffe040' },
  repair: { label: 'Reparación', value: 1, radius: 20, tube: 3.2, color: 0x5cff8a, emissive: 0x18a040, css: '#5cff8a' },
  missile: { label: '+1 misil', value: 1, radius: 20, tube: 3.2, color: 0xc070ff, emissive: 0x7020c0, css: '#c070ff' },
  turbo: { label: 'Acelerón', value: 1, radius: 22, tube: 3.2, color: 0xff4a4a, emissive: 0xc01010, css: '#ff5a5a' },
  gold: { label: 'Aro dorado ×5', value: 5, radius: 15, tube: 2.6, color: 0xffe9a0, emissive: 0xffc020, css: '#ffd040' },
  sea: { label: 'Aro marino ×3', value: 3, radius: 46, tube: 4.5, color: 0x9ff0ff, emissive: 0x2aa0c8, css: '#7fe8ff' },
};

export interface RingPickup {
  id: string;
  kind: RingKind;
}

interface RingObj {
  kind: RingKind;
  spawn: RingSpawn;
  mesh: THREE.Mesh;
  collecting: number; // >0 durante la animación de recogida
}

/** Anillos que hay que atravesar */
export class Rings {
  private rings = new Map<string, RingObj>();
  collected = new Set<string>();
  private geos = new Map<RingKind, THREE.TorusGeometry>();
  private mats = new Map<RingKind, THREE.MeshLambertMaterial>();
  private inv = new THREE.Matrix4();
  private local = new THREE.Vector3();

  constructor(
    private scene: THREE.Scene,
    private gen: CityGen,
  ) {
    for (const [k, info] of Object.entries(RING_INFO) as [RingKind, RingInfo][]) {
      this.geos.set(k, new THREE.TorusGeometry(info.radius, info.tube, k === 'sea' ? 10 : 6, k === 'sea' ? 40 : 20));
      this.mats.set(k, new THREE.MeshLambertMaterial({ color: info.color, emissive: info.emissive, emissiveIntensity: k === 'gold' ? 1.1 : 0.6 }));
    }
  }

  /** false en modo carrera: no aparecen anillos libres */
  enabled = true;

  addChunk(cx: number, cz: number) {
    if (!this.enabled) return;
    for (const s of this.gen.ringsForChunk(cx, cz)) {
      if (this.rings.has(s.id) || this.collected.has(s.id)) continue;
      const mesh = new THREE.Mesh(this.geos.get(s.kind)!, this.mats.get(s.kind)!);
      mesh.position.set(s.x, s.y, s.z);
      mesh.rotation.y = s.yaw;
      mesh.updateMatrixWorld();
      this.scene.add(mesh);
      this.rings.set(s.id, { kind: s.kind, spawn: s, mesh, collecting: 0 });
    }
  }

  removeChunk(cx: number, cz: number) {
    for (const id of [`${cx}_${cz}`, `s${cx}_${cz}`]) {
      const r = this.rings.get(id);
      if (r) {
        this.scene.remove(r.mesh);
        this.rings.delete(id);
      }
    }
  }

  /** Un compañero ha recogido el anillo: desaparece sin contar para mí */
  takenByOther(id: string) {
    this.collected.add(id);
    const r = this.rings.get(id);
    if (r && r.collecting === 0) {
      this.scene.remove(r.mesh);
      this.rings.delete(id);
    }
  }

  /** Último anillo recogido en update() */
  lastCollected: string[] = [];

  /** Devuelve los anillos recogidos en este frame */
  update(dt: number, prev: THREE.Vector3, cur: THREE.Vector3): RingPickup[] {
    const got: RingPickup[] = [];
    this.lastCollected = [];
    for (const [id, r] of this.rings) {
      if (r.collecting > 0) {
        r.collecting += dt;
        const k = r.collecting / 0.5;
        r.mesh.scale.setScalar(1 + k * 1.5);
        r.mesh.rotation.z += dt * 8;
        if (k >= 1) {
          this.scene.remove(r.mesh);
          this.rings.delete(id);
        }
        continue;
      }
      if (r.kind !== 'sea') r.mesh.rotation.z += dt * (r.kind === 'gold' ? 2 : 0.6);
      // Comprobar si el segmento prev->cur cruza el plano del anillo dentro del radio
      const rad = RING_INFO[r.kind].radius + 3;
      if (cur.distanceToSquared(r.mesh.position) > (rad + 100) * (rad + 100)) continue;
      this.inv.copy(r.mesh.matrixWorld).invert();
      const a = this.local.copy(prev).applyMatrix4(this.inv);
      const az = a.z, ax = a.x, ay = a.y;
      const b = this.local.copy(cur).applyMatrix4(this.inv);
      if ((az <= 0 && b.z >= 0) || (az >= 0 && b.z <= 0)) {
        const t = az / (az - b.z || 1e-6);
        const ix = ax + (b.x - ax) * t;
        const iy = ay + (b.y - ay) * t;
        if (ix * ix + iy * iy < rad * rad) {
          got.push({ id, kind: r.kind });
          this.collected.add(id);
          this.lastCollected.push(id);
          r.collecting = 0.0001;
          r.mesh.material = new THREE.MeshBasicMaterial({ color: RING_INFO[r.kind].color, transparent: true, opacity: 0.7 });
        }
      }
    }
    return got;
  }

  nearest(pos: THREE.Vector3): THREE.Vector3 | null {
    let best: THREE.Vector3 | null = null;
    let bd = Infinity;
    for (const r of this.rings.values()) {
      if (r.collecting > 0) continue;
      const d = r.mesh.position.distanceToSquared(pos);
      if (d < bd) {
        bd = d;
        best = r.mesh.position;
      }
    }
    return best;
  }

  /** Anillos visibles con su tipo (para el radar) */
  list(): { pos: THREE.Vector3; kind: RingKind }[] {
    const out: { pos: THREE.Vector3; kind: RingKind }[] = [];
    for (const r of this.rings.values()) if (r.collecting === 0) out.push({ pos: r.mesh.position, kind: r.kind });
    return out;
  }

  /** Vuelve a colocar todos los anillos (nuevo vuelo) */
  respawnAll(chunks: Iterable<[number, number]>) {
    for (const r of this.rings.values()) this.scene.remove(r.mesh);
    this.rings.clear();
    this.collected.clear();
    for (const [cx, cz] of chunks) this.addChunk(cx, cz);
  }

  dispose() {
    for (const r of this.rings.values()) this.scene.remove(r.mesh);
    this.rings.clear();
    for (const g of this.geos.values()) g.dispose();
    for (const m of this.mats.values()) m.dispose();
  }
}
