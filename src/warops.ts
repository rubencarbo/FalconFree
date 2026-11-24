import * as THREE from 'three';
import type { CityGen } from './world/city';
import type { Target } from './combat';
import type { StageId } from './stages';
import type { WeatherKind } from './weather';
import { fbm, mulberry32 } from './world/noise';
import { canyonFloor, canyonH, jungleClearing, nunatakH } from './world/biomes';

/**
 * Misiones de guerra: episodios inspirados en la historia de la aviación (sin nombres de bandos
 * ni insignias reales) y operaciones inventadas. Todo lo que se mueve depende solo del reloj
 * de la misión, así que en grupo cada piloto ve lo mismo; lo destruido se comparte con
 * «claim» (rooms/{code}/rings/w_…).
 */
export type WarKind = 'raid' | 'airlift' | 'escort' | 'dam' | 'sites' | 'rescue';

export interface WarMission {
  id: string;
  title: string;
  /** año o «Inventada» */
  year: string;
  /** episodio real en que se inspira (o null si es inventada) */
  inspired: string | null;
  stage: StageId;
  kind: WarKind;
  /** objetivo en una frase */
  brief: string;
  /** un poco de historia para la sesión informativa */
  history: string;
  /** tiempo límite (s) */
  time: number;
  weather?: WeatherKind;
  /** variante de «sites»: radares, depósitos ocultos… */
  variant?: 'radar' | 'depots';
}

export const WAR_MISSIONS: WarMission[] = [
  {
    id: 'batalla',
    title: 'La batalla del cielo',
    year: '1940',
    inspired: 'la Batalla de Inglaterra',
    stage: 'warzone',
    kind: 'raid',
    brief: 'Derriba 8 bombarderos antes de que 4 lleguen al centro de la ciudad.',
    history: 'En el verano de 1940 unos pocos pilotos de caza defendieron su país durante semanas de ataques aéreos constantes. Despegaban varias veces al día para interceptar formaciones de bombarderos antes de que alcanzaran las ciudades.',
    time: 240,
  },
  {
    id: 'puente',
    title: 'Puente aéreo',
    year: '1948',
    inspired: 'el puente aéreo de Berlín',
    stage: 'warzone',
    kind: 'airlift',
    brief: 'Lanza 6 cargas de suministros sobre las zonas verdes, en vuelo bajo y esquivando los cables de los globos de barrera.',
    history: 'Durante casi un año, aviones de transporte llevaron comida, carbón y medicinas a una ciudad aislada por tierra: llegó a aterrizar un avión cada pocos minutos. Algunos pilotos lanzaban caramelos con pequeños paracaídas para los niños.',
    time: 270,
  },
  {
    id: 'escolta',
    title: 'Escolta',
    year: '1943',
    inspired: 'las misiones de escolta de bombarderos',
    stage: 'warzone',
    kind: 'escort',
    brief: 'Protege la formación de 4 bombarderos aliados hasta el final de la ruta: al menos 2 tienen que llegar.',
    history: 'Los bombarderos pesados volaban en formaciones cerradas y sufrían enormes pérdidas cuando iban sin protección. Los cazas de escolta de largo alcance cambiaron el curso de la guerra aérea al acompañarlos durante todo el viaje.',
    time: 200,
  },
  {
    id: 'presa',
    title: 'Los rompepresas',
    year: '1943',
    inspired: 'la Operación Chastise',
    stage: 'canyon',
    kind: 'dam',
    brief: 'Vuela por el cañón pegado al río y suelta la bomba rebotante sobre el agua: menos de 40 m de altura, a menos de 800 km/h y a 200–480 m de la presa.',
    history: 'Una escuadrilla voló de noche a solo 18 m sobre el agua para lanzar una bomba que rebotaba sobre la superficie, como una piedra plana, hasta chocar con el muro de la presa. Hacía falta una altura, una velocidad y una distancia exactas.',
    time: 300,
  },
  {
    id: 'radares',
    title: 'Cazadores de radares',
    year: '1942',
    inspired: 'la Operación Biting',
    stage: 'warzone',
    kind: 'sites',
    variant: 'radar',
    brief: 'Destruye las 6 estaciones de radar. Si un reflector te ilumina, llega el fuego antiaéreo: sal del haz.',
    history: 'Los primeros radares podían detectar aviones a decenas de kilómetros. Varias operaciones arriesgadas se organizaron para estudiar esos aparatos o dejarlos fuera de servicio antes de las grandes incursiones.',
    time: 300,
  },
  {
    id: 'escarcha',
    title: 'Operación Escarcha',
    year: 'Inventada',
    inspired: null,
    stage: 'glacier',
    kind: 'rescue',
    brief: 'Recoge a 4 tripulaciones perdidas en el hielo (bajo y despacio sobre las bengalas) y llévalas a la base.',
    history: 'Una ventisca ha dejado aisladas a cuatro tripulaciones de la base científica. Sus bengalas rojas son la única pista en la nieve. El tiempo corre: el frío no espera.',
    time: 360,
    weather: 'snow',
  },
  {
    id: 'liana',
    title: 'Operación Liana',
    year: 'Inventada',
    inspired: null,
    stage: 'jungle',
    kind: 'sites',
    variant: 'depots',
    brief: 'Encuentra y destruye 5 depósitos de combustible escondidos bajo la selva: solo se ven de cerca.',
    history: 'Una red de contrabando ha escondido depósitos de combustible en los claros, junto al río. Desde arriba la selva lo tapa todo: hay que bajar y buscar con la vista.',
    time: 300,
  },
];

export interface WarHooks {
  damage(n: number, what: string): void;
  crash(what: string): void;
  toast(text: string, ms?: number): void;
  big(text: string, tone?: 'good' | 'bad' | 'neutral'): void;
  sound(k: 'boom' | 'hit' | 'drop' | 'alarm' | 'win' | 'pickup' | 'flak'): void;
  explosion(pos: THREE.Vector3, scale: number): void;
  /** compartir con el equipo que algo ha caído / se ha recogido */
  claim(id: string): void;
  score(name: string, pts: number): void;
}

interface Ent {
  id: string;
  kind: 'bomber' | 'fighter' | 'ally' | 'attacker' | 'site' | 'balloon' | 'depot' | 'zone' | 'crew';
  mesh: THREE.Object3D;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  hp: number;
  alive: boolean;
  radius: number;
  target: Target;
  /** datos propios */
  a: THREE.Vector3;
  b: THREE.Vector3;
  t0: number;
  t1: number;
  n: number;
  done: boolean;
  /** reflector (sites) */
  beam?: THREE.Mesh;
  beamDir?: THREE.Vector3;
  spot?: number;
  flakT?: number;
  dish?: THREE.Object3D;
  extra?: THREE.Object3D;
}

const UP = new THREE.Vector3(0, 1, 0);

// ------------------------------------------------------------------ Modelos de cajas
function box(w: number, h: number, d: number, color: number, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color }));
  m.position.set(x, y, z);
  return m;
}

/** Avión de cajas con el morro hacia +z */
function planeModel(kind: 'bomber' | 'fighter' | 'ally' | 'attacker' | 'transport') {
  const g = new THREE.Group();
  const big = kind === 'bomber' || kind === 'ally' || kind === 'transport';
  const body = kind === 'ally' ? 0x5c6a3e : kind === 'transport' ? 0x9aa0a6 : kind === 'bomber' ? 0x4a4e56 : 0x3e4248;
  const stripe = kind === 'ally' ? 0xe8e4d8 : kind === 'transport' ? 0x2a5aa0 : 0x9a2a22;
  if (big) {
    g.add(box(4, 4, 26, body));
    g.add(box(44, 1, 6, body, 0, 0.5, 1));
    g.add(box(16, 0.8, 4, body, 0, 1, -11));
    g.add(box(1, 6, 5, body, 0, 3.5, -11));
    g.add(box(4.2, 1, 3, stripe, 0, 0, -6));
    for (const x of [-14, -7, 7, 14]) g.add(box(2.2, 2.2, 5, 0x2a2c30, x, -0.6, 3));
    g.add(box(2.6, 2, 3, 0x9ac0d8, 0, 1.4, 11));
  } else {
    g.add(box(2, 2, 11, body));
    g.add(box(15, 0.6, 3.4, body, 0, 0, 1));
    g.add(box(6, 0.5, 2, body, 0, 0.4, -4.5));
    g.add(box(0.6, 3, 2.4, body, 0, 1.6, -4.5));
    g.add(box(2.1, 0.8, 2.2, stripe, 0, 0.6, 3.5));
    g.add(box(1.4, 1, 2, 0x9ac0d8, 0, 1.2, 1));
  }
  return g;
}

function puffGeo() {
  return new THREE.IcosahedronGeometry(1, 0);
}

export class WarOps {
  state: 'running' | 'won' | 'lost' = 'running';
  reason = '';
  /** progreso del objetivo */
  count = 0;
  goal = 0;
  /** fallos (bombarderos que llegan, bombarderos aliados caídos, pasadas fallidas…) */
  fails = 0;
  failMax = 99;
  timeLeft: number;
  /** posición y rumbo de salida del jugador */
  start = new THREE.Vector3();
  startYaw = 0;
  private group = new THREE.Group();
  private ents: Ent[] = [];
  private center = new THREE.Vector3();
  private rand: () => number;
  private puffs: { m: THREE.Mesh; life: number; max: number; s: number }[] = [];
  private puffMat = new THREE.MeshBasicMaterial({ color: 0x2a2826, transparent: true, opacity: 0.8, depthWrite: false });
  private flashMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.6, 0.2) });
  private beamMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.95, 0.7), transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  private puffG = puffGeo();
  private tracers: { line: THREE.Line; life: number }[] = [];
  private tracerMat = new THREE.LineBasicMaterial({ color: new THREE.Color(1, 0.8, 0.3) });
  private claimed = new Set<string>();
  /** presa */
  private dam: { pos: THREE.Vector3; dir: THREE.Vector3; side: THREE.Vector3; w: number; h: number; mesh: THREE.Group; breach?: THREE.Mesh; floorY: number } | null = null;
  private path: THREE.Vector3[] = [];
  private bomb: { m: THREE.Mesh; pos: THREE.Vector3; vel: THREE.Vector3; bounces: number } | null = null;
  private passArmed = true;
  private highT = 0;
  /** escolta */
  private route: THREE.Vector3[] = [];
  private routeLen = 0;
  private allyHp: number[] = [];
  /** rescate */
  private base = new THREE.Vector3();
  private baseMesh: THREE.Object3D | null = null;
  private wonT = 0;
  private lastT = 0;
  /** objetivo de la flecha */
  nav: THREE.Vector3 | null = null;
  navLabel = '';

  constructor(
    private scene: THREE.Scene,
    private gen: CityGen,
    public def: WarMission,
    private hooks: WarHooks,
  ) {
    this.timeLeft = def.time;
    let h = 0;
    for (const c of def.id) h = (h * 31 + c.charCodeAt(0)) | 0;
    this.rand = mulberry32(h ^ gen.stage.seed);
    scene.add(this.group);
    switch (def.kind) {
      case 'raid':
        this.setupRaid();
        break;
      case 'airlift':
        this.setupAirlift();
        break;
      case 'escort':
        this.setupEscort();
        break;
      case 'dam':
        this.setupDam();
        break;
      case 'sites':
        this.setupSites();
        break;
      case 'rescue':
        this.setupRescue();
        break;
    }
  }

  // ================================================================ Utilidades
  private ent(kind: Ent['kind'], id: string, mesh: THREE.Object3D, hp: number, radius: number): Ent {
    const pos = mesh.position;
    const e: Ent = {
      id,
      kind,
      mesh,
      pos,
      vel: new THREE.Vector3(),
      hp,
      alive: true,
      radius,
      target: { id, pos, vel: new THREE.Vector3(), radius, alive: true, name: '' },
      a: new THREE.Vector3(),
      b: new THREE.Vector3(),
      t0: 0,
      t1: 0,
      n: 0,
      done: false,
    };
    e.target.vel = e.vel;
    this.group.add(mesh);
    this.ents.push(e);
    return e;
  }

  private ground(x: number, z: number) {
    return this.gen.heightAt(x, z);
  }

  private safeY(x: number, z: number, above: number) {
    return this.gen.maxHeightNear(x, z, 60) + above;
  }

  private kill(e: Ent, share = true) {
    if (!e.alive) return;
    e.alive = false;
    e.target.alive = false;
    e.mesh.visible = false;
    if (e.beam) e.beam.visible = false;
    if (share && !this.claimed.has(e.id)) {
      this.claimed.add(e.id);
      this.hooks.claim(e.id);
    }
  }

  /** Otro piloto del equipo ha destruido / recogido esto */
  markDestroyed(id: string) {
    if (this.claimed.has(id)) return;
    this.claimed.add(id);
    const e = this.ents.find((x) => x.id === id);
    if (!e || !e.alive) {
      if (id === 'w_dam' && this.state === 'running') this.breachDam();
      return;
    }
    if (e.kind === 'zone' || e.kind === 'crew') {
      e.alive = false;
      e.mesh.visible = false;
      this.count++;
      this.hooks.toast(e.kind === 'zone' ? 'Un compañero ha lanzado una carga' : 'Un compañero ha rescatado a una tripulación', 1500);
    } else {
      this.hooks.explosion(e.pos.clone(), e.kind === 'bomber' || e.kind === 'site' ? 1.4 : 0.8);
      this.kill(e, false);
      if (e.kind === 'bomber' || e.kind === 'depot' || (e.kind === 'site' && e.n === 1)) this.count++;
    }
  }

  /** Objetivos que se pueden disparar */
  targets(): Target[] {
    const out: Target[] = [];
    for (const e of this.ents) if (e.alive && e.mesh.visible && (e.kind === 'bomber' || e.kind === 'fighter' || e.kind === 'attacker' || e.kind === 'site' || e.kind === 'balloon' || e.kind === 'depot')) out.push(e.target);
    return out;
  }

  /** Daño de mis balas o misiles. Devuelve true si lo destruye */
  hit(id: string, dmg: number): boolean {
    const e = this.ents.find((x) => x.id === id);
    if (!e || !e.alive) return false;
    e.hp -= dmg;
    if (e.hp > 0) return false;
    this.kill(e);
    this.hooks.explosion(e.pos.clone(), e.kind === 'bomber' || e.kind === 'site' || e.kind === 'depot' ? 1.5 : 0.8);
    this.hooks.sound('boom');
    const name: Record<string, [string, number]> = {
      bomber: ['Bombardero derribado', 250],
      fighter: ['Caza derribado', 120],
      attacker: ['Atacante derribado', 150],
      site: [this.def.variant === 'radar' ? 'Radar destruido' : 'Antiaéreo destruido', 220],
      balloon: ['Globo de barrera', 60],
      depot: ['Depósito destruido', 250],
    };
    const [label, pts] = name[e.kind] ?? ['Objetivo', 100];
    this.hooks.score(label, pts);
    if (e.kind === 'bomber' || e.kind === 'depot' || (e.kind === 'site' && e.n === 1)) {
      this.count++;
      this.hooks.toast(`${label} · ${this.count}/${this.goal}`, 1400);
    } else this.hooks.toast(label, 1000);
    return true;
  }

  // ================================================================ Batalla del cielo
  private setupRaid() {
    this.goal = 8;
    this.failMax = 4;
    this.center.set(0, 0, 0);
    const a0 = this.rand() * Math.PI * 2;
    this.startYaw = a0 + Math.PI;
    this.start.set(Math.cos(a0) * 900, 0, Math.sin(a0) * 900);
    this.start.y = this.safeY(this.start.x, this.start.z, 260);
    this.startYaw = Math.atan2(this.start.x, this.start.z);
    for (let w = 0; w < 4; w++) {
      const ang = a0 + 0.9 + w * 1.7 + (this.rand() - 0.5) * 0.4;
      const dir = new THREE.Vector3(Math.cos(ang), 0, Math.sin(ang));
      const side = new THREE.Vector3(-dir.z, 0, dir.x);
      for (let i = 0; i < 3; i++) {
        const e = this.ent('bomber', `w_b${w}${i}`, planeModel('bomber'), 150, 16);
        e.a.copy(dir).multiplyScalar(4200).addScaledVector(side, (i - 1) * 130).setY(480 + this.rand() * 140 + i * 20);
        e.b.set(0, e.a.y, 0).addScaledVector(side, (i - 1) * 130);
        e.t0 = 8 + w * 30 + i * 1.5;
        e.t1 = e.t0 + e.a.distanceTo(e.b) / 62;
        e.mesh.visible = false;
        if (w > 0) {
          const f = this.ent('fighter', `w_f${w}${i}`, planeModel('fighter'), 45, 8);
          f.n = w * 3 + i;
          f.t0 = e.t0;
          f.t1 = e.t1;
          f.extra = e.mesh;
          f.mesh.visible = false;
        }
      }
    }
  }

  private updateRaid(t: number, dt: number, me: THREE.Vector3, alive: boolean) {
    let nextT: Ent | null = null;
    let bd = Infinity;
    for (const e of this.ents) {
      if (e.kind === 'bomber') {
        if (!e.alive || e.done) continue;
        const k = (t - e.t0) / (e.t1 - e.t0);
        if (k < 0) continue;
        e.mesh.visible = true;
        const p = e.a.clone().lerp(e.b, Math.min(k, 1.3));
        e.vel.copy(e.b).sub(e.a).normalize().multiplyScalar(62);
        e.pos.copy(p);
        e.mesh.lookAt(p.clone().add(e.vel));
        if (k >= 1) {
          e.done = true;
          e.mesh.visible = false;
          e.target.alive = false;
          this.fails++;
          this.hooks.big(`💥 ¡UN BOMBARDERO HA LLEGADO A LA CIUDAD! (${this.fails}/${this.failMax})`, 'bad');
          this.hooks.explosion(new THREE.Vector3(e.b.x, this.ground(e.b.x, e.b.z) + 10, e.b.z), 3);
          this.hooks.sound('alarm');
          continue;
        }
        const d = e.pos.distanceTo(me);
        if (d < bd) {
          bd = d;
          nextT = e;
        }
      } else if (e.kind === 'fighter') {
        if (!e.alive) continue;
        const host = this.ents.find((x) => x.mesh === e.extra);
        const active = !!host && host.alive && !host.done && t >= e.t0 && host.mesh.visible;
        e.mesh.visible = active;
        e.target.alive = active;
        if (!active || !host) continue;
        const w = 0.9 + (e.n % 3) * 0.15;
        const ph = t * w + e.n;
        const p = host.pos.clone().add(new THREE.Vector3(Math.cos(ph) * 110, 20 + Math.sin(ph * 2) * 15, Math.sin(ph) * 110));
        e.vel.copy(p).sub(e.pos).divideScalar(Math.max(dt, 0.001));
        if (e.vel.lengthSq() > 250 * 250) e.vel.setLength(250);
        e.pos.copy(p);
        e.mesh.lookAt(p.clone().add(new THREE.Vector3(-Math.sin(ph), 0, Math.cos(ph))));
        // Ametralla si estás cerca
        if (alive && e.pos.distanceTo(me) < 280) {
          e.flakT = (e.flakT ?? 0) - dt;
          if (e.flakT <= 0) {
            e.flakT = 0.35;
            this.tracer(e.pos, me);
            if (this.rand() < 0.55) this.hooks.damage(2, 'Te disparan los cazas de escolta');
          }
        }
      }
    }
    this.nav = nextT ? nextT.pos : null;
    this.navLabel = 'BOMBARDERO';
    if (this.count >= this.goal) this.win('¡Has salvado la ciudad!');
    else if (this.fails >= this.failMax) this.lose('Demasiados bombarderos han llegado a la ciudad');
    else if (this.ents.every((e) => e.kind !== 'bomber' || !e.alive || e.done) && t > 20) {
      if (this.count >= this.goal) this.win('¡Has salvado la ciudad!');
      else this.lose('No has derribado suficientes bombarderos');
    }
  }

  // ================================================================ Puente aéreo
  private setupAirlift() {
    this.goal = 6;
    let p = new THREE.Vector3(0, 0, 0);
    let ang = this.rand() * Math.PI * 2;
    this.startYaw = Math.atan2(-Math.cos(ang), -Math.sin(ang));
    this.start.set(-Math.cos(ang) * 700, 0, -Math.sin(ang) * 700);
    this.start.y = this.safeY(this.start.x, this.start.z, 160);
    this.startYaw = Math.atan2(-(p.x - this.start.x), -(p.z - this.start.z));
    const zones: THREE.Vector3[] = [];
    for (let i = 0; i < 6; i++) {
      const d = i === 0 ? 300 : 900 + this.rand() * 400;
      ang += i === 0 ? 0 : (this.rand() - 0.5) * 2.2;
      p = p.clone().add(new THREE.Vector3(Math.cos(ang) * d, 0, Math.sin(ang) * d));
      p.y = this.safeY(p.x, p.z, 55);
      zones.push(p);
      const g = new THREE.Group();
      const ring = new THREE.Mesh(new THREE.TorusGeometry(34, 2, 6, 32), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 1, 0.5) }));
      ring.rotation.x = Math.PI / 2;
      g.add(ring);
      // humo verde de señalización
      const smokeMat = new THREE.MeshBasicMaterial({ color: 0x60d070, transparent: true, opacity: 0.35, depthWrite: false });
      const gy = this.ground(p.x, p.z) - p.y;
      for (let k = 0; k < 7; k++) {
        const s = 5 + k * 2;
        const m = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), smokeMat);
        m.position.set(k * 1.5, gy + 3 + k * 9, 0);
        g.add(m);
      }
      g.position.copy(p);
      const e = this.ent('zone', `w_z${i}`, g, 1, 40);
      e.n = i;
    }
    // Globos de barrera con cable
    for (let i = 0; i < 16; i++) {
      const a = zones[i % zones.length];
      const b = zones[(i + 1) % zones.length];
      const k = 0.25 + this.rand() * 0.5;
      const q = a.clone().lerp(b, k);
      const side = new THREE.Vector3(-(b.z - a.z), 0, b.x - a.x).normalize().multiplyScalar((this.rand() - 0.5) * 260);
      q.add(side);
      const gy = this.ground(q.x, q.z);
      const y = Math.max(gy + 90, 160 + this.rand() * 160);
      const g = new THREE.Group();
      const bal = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), new THREE.MeshLambertMaterial({ color: 0xb8bcc2 }));
      bal.scale.set(6, 6, 14);
      g.add(bal);
      g.add(box(0.4, 5, 4, 0xa0a4aa, 0, 4, -11));
      g.add(box(5, 0.4, 4, 0xa0a4aa, 0, 0, -11));
      const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, y - gy, 4), new THREE.MeshBasicMaterial({ color: 0x303030 }));
      cable.position.y = -(y - gy) / 2;
      g.add(cable);
      g.position.set(q.x, y, q.z);
      const e = this.ent('balloon', `w_g${i}`, g, 15, 14);
      e.a.set(q.x, gy, q.z);
    }
  }

  private updateAirlift(t: number, dt: number, prev: THREE.Vector3, me: THREE.Vector3, alive: boolean) {
    let next: Ent | null = null;
    for (const e of this.ents) {
      if (e.kind === 'zone') {
        if (!e.alive) continue;
        e.mesh.children[0].rotation.z = t;
        if (!next || e.n < next.n) next = e;
        if (alive && segDist(prev, me, e.pos) < 42) {
          this.kill(e);
          this.count++;
          this.hooks.sound('drop');
          this.hooks.score('Carga lanzada', 200);
          this.hooks.big(`📦 CARGA LANZADA · ${this.count}/${this.goal}`, 'good');
          this.dropCrate(e.pos);
        }
      } else if (e.kind === 'balloon') {
        if (!e.alive) continue;
        e.mesh.position.y = e.pos.y;
        e.mesh.rotation.y = Math.sin(t * 0.2 + e.n) * 0.3;
        // Cable: línea vertical desde el suelo hasta el globo
        if (alive && me.y < e.pos.y && Math.hypot(me.x - e.pos.x, me.z - e.pos.z) < 4) {
          this.kill(e);
          this.hooks.damage(35, '¡Has chocado con el cable de un globo!');
          this.hooks.sound('hit');
        }
      }
    }
    this.nav = next ? next.pos : null;
    this.navLabel = 'LANZAMIENTO';
    void dt;
    if (this.count >= this.goal) this.win('¡Todos los suministros han llegado!');
  }

  private crates: { m: THREE.Group; v: number; y0: number }[] = [];
  private dropCrate(at: THREE.Vector3) {
    const g = new THREE.Group();
    g.add(box(4, 4, 4, 0xa07a4a));
    const chute = new THREE.Mesh(new THREE.SphereGeometry(6, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0xf0f0e8, side: THREE.DoubleSide }));
    chute.position.y = 10;
    g.add(chute);
    g.position.copy(at);
    this.group.add(g);
    this.crates.push({ m: g, v: 6, y0: this.ground(at.x, at.z) });
  }

  // ================================================================ Escolta
  private setupEscort() {
    this.goal = 1;
    this.failMax = 3;
    const a0 = this.rand() * Math.PI * 2;
    let p = new THREE.Vector3(Math.cos(a0) * -2500, 520, Math.sin(a0) * -2500);
    let ang = a0;
    this.route = [p.clone()];
    for (let i = 0; i < 7; i++) {
      ang += (this.rand() - 0.5) * 0.7;
      p = p.clone().add(new THREE.Vector3(Math.cos(ang) * 1000, 0, Math.sin(ang) * 1000));
      this.route.push(p);
    }
    this.routeLen = 0;
    for (let i = 1; i < this.route.length; i++) this.routeLen += this.route[i].distanceTo(this.route[i - 1]);
    for (let i = 0; i < 4; i++) {
      const e = this.ent('ally', `w_a${i}`, planeModel('ally'), 100, 16);
      e.n = i;
      this.allyHp.push(100);
    }
    const s0 = this.routeAt(0);
    this.start.copy(s0.pos).addScaledVector(s0.dir, -320).add(new THREE.Vector3(0, 40, 0));
    this.startYaw = Math.atan2(-s0.dir.x, -s0.dir.z);
    // Pasadas de cazas enemigos
    let k = 0;
    for (let T = 14; T < this.routeLen / 70 - 4; T += 10 + (k % 3)) {
      const n = k % 3 === 2 ? 2 : 1;
      for (let i = 0; i < n; i++) {
        const e = this.ent('attacker', `w_x${k}${i}`, planeModel('attacker'), 32, 8);
        e.t0 = T;
        e.t1 = T + 9;
        e.n = (k * 3 + i) % 4;
        e.mesh.visible = false;
        e.target.alive = false;
        const off = (this.rand() - 0.5) * 2.6;
        e.a.set(Math.sin(off), (this.rand() - 0.3) * 0.25, Math.cos(off));
      }
      k++;
    }
  }

  private routeAt(s: number): { pos: THREE.Vector3; dir: THREE.Vector3 } {
    let acc = 0;
    for (let i = 1; i < this.route.length; i++) {
      const a = this.route[i - 1];
      const b = this.route[i];
      const L = a.distanceTo(b);
      if (s <= acc + L || i === this.route.length - 1) {
        const k = Math.min(1, Math.max(0, (s - acc) / L));
        return { pos: a.clone().lerp(b, k), dir: b.clone().sub(a).normalize() };
      }
      acc += L;
    }
    return { pos: this.route[0].clone(), dir: new THREE.Vector3(0, 0, 1) };
  }

  private allyPos(i: number, t: number) {
    const r = this.routeAt(Math.max(0, t) * 70);
    const side = new THREE.Vector3(-r.dir.z, 0, r.dir.x);
    const offs = [
      [0, 0, 0],
      [-55, -8, -45],
      [55, -8, -45],
      [0, -16, -90],
    ][i];
    return { pos: r.pos.clone().addScaledVector(side, offs[0]).add(new THREE.Vector3(0, offs[1], 0)).addScaledVector(r.dir, offs[2]), dir: r.dir };
  }

  private updateEscort(t: number, dt: number) {
    const allies = this.ents.filter((e) => e.kind === 'ally');
    for (const e of allies) {
      if (!e.alive) continue;
      const p = this.allyPos(e.n, t);
      e.pos.copy(p.pos);
      e.vel.copy(p.dir).multiplyScalar(70);
      e.mesh.lookAt(p.pos.clone().add(p.dir));
    }
    let threat: Ent | null = null;
    for (const e of this.ents) {
      if (e.kind !== 'attacker' || e.done) continue;
      if (t < e.t0) continue;
      // objetivo: el aliado e.n (o el siguiente vivo)
      let tgt = allies[e.n];
      for (let k = 0; k < 4 && !tgt.alive; k++) tgt = allies[(e.n + k) % 4];
      const B = this.allyPos(tgt.n, e.t1).pos;
      const A = B.clone().add(new THREE.Vector3(e.a.x, e.a.y, e.a.z).multiplyScalar(1700));
      const k = (t - e.t0) / (e.t1 - e.t0);
      if (!e.alive) {
        e.done = true;
        continue;
      }
      if (k > 1.35) {
        e.done = true;
        this.kill(e, false);
        continue;
      }
      e.mesh.visible = true;
      e.target.alive = true;
      const p = A.clone().lerp(B, k);
      e.vel.copy(B).sub(A).divideScalar(e.t1 - e.t0);
      e.pos.copy(p);
      e.mesh.lookAt(p.clone().add(e.vel));
      if (k >= 1 && e.n >= 0 && tgt.alive && e.b.x === 0) {
        e.b.x = 1;
        this.tracer(e.pos, tgt.pos);
        this.allyHp[tgt.n] -= 34;
        this.hooks.sound('hit');
        if (this.allyHp[tgt.n] <= 0) {
          this.hooks.explosion(tgt.pos.clone(), 1.6);
          this.kill(tgt, false);
          this.fails++;
          this.hooks.big(`💥 ¡HAN DERRIBADO UN BOMBARDERO ALIADO! (quedan ${4 - this.fails})`, 'bad');
        } else this.hooks.toast(`Un bombardero aliado ha recibido daños (${Math.max(0, this.allyHp[tgt.n])} %)`, 1300);
      }
      if (k < 1 && (!threat || e.t1 < threat.t1)) threat = e;
    }
    this.count = allies.filter((a) => a.alive).length;
    this.goal = 2;
    this.nav = threat ? threat.pos : allies.find((a) => a.alive)?.pos ?? null;
    this.navLabel = threat ? 'ATACANTE' : 'FORMACIÓN';
    void dt;
    if (this.fails >= this.failMax || this.count < 2) this.lose('La formación ha sufrido demasiadas pérdidas');
    else if (t * 70 >= this.routeLen) this.win(`¡${this.count} bombarderos han llegado a su destino!`);
  }

  // ================================================================ Los rompepresas
  private setupDam() {
    this.goal = 1;
    this.failMax = 3;
    const gen = this.gen;
    // Seguir el río por el centro del cañón (curvas de nivel del ruido); solo vale un
    // recorrido que se mantenga dentro del cañón al menos ~2,5 km
    const seed = gen.stage.seed + 11;
    const nAt = (x: number, z: number) => fbm(x / 1500, z / 1500, seed, 3);
    const trace = (s: THREE.Vector3, sign: number) => {
      let p = s.clone();
      let dir: THREE.Vector3 | null = null;
      const pts = [p.clone()];
      for (let i = 0; i < 90; i++) {
        const e = 8;
        const gx = (nAt(p.x + e, p.z) - nAt(p.x - e, p.z)) / (2 * e);
        const gz = (nAt(p.x, p.z + e) - nAt(p.x, p.z - e)) / (2 * e);
        const gl = Math.hypot(gx, gz) || 1;
        let d = new THREE.Vector3((-gz / gl) * sign, 0, (gx / gl) * sign);
        if (dir && d.dot(dir) < 0) d.negate();
        dir = dir ? dir.lerp(d, 0.5).normalize() : d;
        const off = (nAt(p.x, p.z) - 0.5) / gl;
        p = p.clone().addScaledVector(dir, 50).add(new THREE.Vector3(-(gx / gl) * off * 0.5, 0, -(gz / gl) * off * 0.5));
        if (!canyonFloor(gen, p.x, p.z)) break;
        if (i % 3 === 2) pts.push(p.clone());
      }
      return pts;
    };
    let best: THREE.Vector3[] = [];
    for (let r = 0; r < 70 && best.length < 17; r++)
      for (let k = 0; k < 24 && best.length < 17; k++) {
        const a = (k / 24) * Math.PI * 2;
        const x = Math.cos(a) * r * 120;
        const z = Math.sin(a) * r * 120;
        if (!canyonFloor(gen, x, z) || !gen.isWater(x, z)) continue;
        for (const sign of [1, -1]) {
          const pts = trace(new THREE.Vector3(x, 0, z), sign);
          if (pts.length > best.length) best = pts;
        }
      }
    this.path = best.length >= 4 ? best : [new THREE.Vector3(), new THREE.Vector3(0, 0, 150), new THREE.Vector3(0, 0, 300), new THREE.Vector3(0, 0, 450)];
    const end = this.path[this.path.length - 1];
    const pre = this.path[this.path.length - 3];
    const ddir = end.clone().sub(pre).setY(0).normalize();
    const side = new THREE.Vector3(-ddir.z, 0, ddir.x);
    let w = 40;
    while (w < 320 && (canyonH(gen, end.x + side.x * w, end.z + side.z * w) === 0 || canyonH(gen, end.x - side.x * w, end.z - side.z * w) === 0)) w += 10;
    const wallH = Math.max(50, Math.min(140, Math.min(canyonH(gen, end.x + side.x * (w + 20), end.z + side.z * (w + 20)), canyonH(gen, end.x - side.x * (w + 20), end.z - side.z * (w + 20))) - 10));
    const g = new THREE.Group();
    const conc = 0xb8b4aa;
    const wall = box(w * 2 + 40, wallH, 16, conc, 0, wallH / 2, 0);
    g.add(wall);
    g.add(box(w * 2 + 40, 3, 20, 0x8a867e, 0, wallH + 1.5, 0));
    for (let k = -2; k <= 2; k++) g.add(box(10, 8, 6, 0x9a968e, k * (w / 2.5), wallH + 5, 0));
    // Embalse detrás
    const water = new THREE.Mesh(new THREE.BoxGeometry(w * 2 + 120, 2, 500), new THREE.MeshLambertMaterial({ color: 0x2a7a90 }));
    water.position.set(0, wallH * 0.82, 258);
    g.add(water);
    g.position.copy(end).setY(0);
    g.lookAt(end.clone().add(ddir));
    this.group.add(g);
    this.dam = { pos: end.clone().setY(0), dir: ddir, side, w: w + 20, h: wallH, mesh: g, floorY: 0 };
    // Aros guía por el cañón
    const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.85, 0.35) });
    for (let i = 2; i < this.path.length - 4; i += 3) {
      const q = this.path[i];
      const m = new THREE.Mesh(new THREE.TorusGeometry(26, 1.4, 6, 32), ringMat);
      m.position.set(q.x, 32, q.z);
      const nx = this.path[i + 1];
      m.lookAt(new THREE.Vector3(nx.x, 32, nx.z));
      this.group.add(m);
    }
    // Defensas en el borde del cañón cerca de la presa
    for (const sgn of [1, -1]) {
      const q = end.clone().addScaledVector(ddir, -350).addScaledVector(side, sgn * (w + 40));
      q.y = canyonH(gen, q.x, q.z) || this.ground(q.x, q.z);
      this.addSite(q, `w_s${sgn > 0 ? 'a' : 'b'}`, false);
    }
    const s0 = this.path[0];
    const s1 = this.path[2];
    const sd = s1.clone().sub(s0).setY(0).normalize();
    this.start.copy(s0).setY(55);
    this.startYaw = Math.atan2(-sd.x, -sd.z);
  }

  private updateDam(t: number, dt: number, me: THREE.Vector3, speedKmh: number, alive: boolean) {
    const dam = this.dam!;
    this.nav = dam.pos.clone().setY(30);
    this.navLabel = 'PRESA';
    // Siguiente aro del camino
    let best = 0;
    let bd = Infinity;
    for (let i = 0; i < this.path.length; i++) {
      const d = this.path[i].distanceToSquared(me.clone().setY(0));
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    if (best < this.path.length - 3) this.nav = this.path[Math.min(this.path.length - 1, best + 3)].clone().setY(32);
    // Choque contra el muro
    const rel = me.clone().sub(dam.pos);
    const along = rel.dot(dam.dir);
    const lat = rel.dot(dam.side);
    if (alive && Math.abs(along) < 9 && Math.abs(lat) < dam.w && me.y < dam.h + 2 && !dam.breach) this.hooks.crash('¡Te has estrellado contra la presa!');
    // Muy alto durante el vuelo por el cañón → te ven las defensas
    const agl = me.y - this.ground(me.x, me.z);
    if (alive && best > 2 && agl > 110 && this.bomb === null) {
      this.highT += dt;
      if (this.highT > 2 && Math.floor(this.highT) !== Math.floor(this.highT - dt)) this.hooks.toast('⚠️ ¡Demasiado alto! Te ven las defensas: baja al río', 1300);
    } else this.highT = Math.max(0, this.highT - dt);
    // Ventana de lanzamiento
    const dist = -along;
    if (alive && !this.bomb && this.passArmed && dist > 0 && dist < 480 && Math.abs(lat) < dam.w) {
      if (dist >= 200 && agl < 40 && speedKmh < 800) {
        this.releaseBomb(me, dam.dir, speedKmh);
      } else if (dist < 200) {
        this.passArmed = false;
        this.fails++;
        const why = agl >= 40 ? 'demasiado alto' : speedKmh >= 800 ? 'demasiado rápido' : 'demasiado cerca';
        this.hooks.big(`❌ PASADA FALLIDA: ${why.toUpperCase()} (quedan ${this.failMax - this.fails})`, 'bad');
        this.hooks.toast('Sube, da la vuelta y vuelve a intentarlo', 2200);
      }
    }
    if (!this.passArmed && (dist > 900 || dist < -150)) this.passArmed = true;
    // Bomba rebotante
    if (this.bomb) {
      const b = this.bomb;
      b.vel.y -= 9.8 * dt * 3;
      b.pos.addScaledVector(b.vel, dt);
      const wy = this.ground(b.pos.x, b.pos.z) + 1.5;
      if (b.pos.y < wy && b.vel.y < 0) {
        b.pos.y = wy;
        b.vel.y = Math.abs(b.vel.y) * 0.62 + 6;
        b.bounces++;
        this.hooks.explosion(b.pos.clone(), 0.3);
      }
      b.m.position.copy(b.pos);
      b.m.rotation.x += dt * 20;
      if (b.pos.clone().sub(dam.pos).dot(dam.dir) > -9) {
        this.group.remove(b.m);
        this.bomb = null;
        this.hooks.claim('w_dam');
        this.claimed.add('w_dam');
        this.breachDam();
      }
    }
    if (this.fails >= this.failMax && !this.bomb) this.lose('Sin más bombas: la presa sigue en pie');
    void t;
  }

  private releaseBomb(me: THREE.Vector3, dir: THREE.Vector3, speedKmh: number) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.6, 2.4, 10), new THREE.MeshLambertMaterial({ color: 0x3a3a3a }));
    m.rotation.z = Math.PI / 2;
    this.group.add(m);
    this.bomb = { m, pos: me.clone().add(new THREE.Vector3(0, -3, 0)), vel: dir.clone().multiplyScalar((speedKmh / 3.6) * 0.8).add(new THREE.Vector3(0, 4, 0)), bounces: 0 };
    this.hooks.sound('drop');
    this.hooks.big('💣 ¡BOMBA FUERA! ¡SUBE YA!', 'good');
  }

  private breachDam() {
    const dam = this.dam;
    if (!dam || dam.breach) return;
    this.hooks.explosion(dam.pos.clone().setY(dam.h * 0.5), 4);
    this.hooks.sound('boom');
    // Abrir un hueco en el centro del muro y una cascada
    const gap = new THREE.Mesh(new THREE.BoxGeometry(60, dam.h * 0.9, 24), new THREE.MeshBasicMaterial({ color: 0x9ad4e8, transparent: true, opacity: 0.85 }));
    gap.position.set(0, dam.h * 0.45, 0);
    dam.mesh.add(gap);
    dam.breach = gap;
    this.count = 1;
    this.win('¡La presa ha caído! Misión cumplida');
  }

  // ================================================================ Radares y depósitos
  private addSite(at: THREE.Vector3, id: string, counts: boolean, radar = false) {
    const g = new THREE.Group();
    g.add(box(10, 3, 10, 0x8a7a5a, 0, 1.5, 0));
    const gun = new THREE.Group();
    gun.add(box(3, 3, 3, 0x3a3e40, 0, 4.5, 0));
    gun.add(box(0.6, 0.6, 8, 0x2a2c2e, -0.8, 6, 3));
    gun.add(box(0.6, 0.6, 8, 0x2a2c2e, 0.8, 6, 3));
    g.add(gun);
    let dish: THREE.Object3D | undefined;
    if (radar) {
      dish = new THREE.Group();
      (dish as THREE.Group).add(box(0.8, 12, 0.8, 0x6a6e72, 0, 6, 0));
      const d = box(12, 7, 0.6, 0xc8ccd0, 0, 13, 0);
      (dish as THREE.Group).add(d);
      dish.position.set(6, 3, -3);
      g.add(dish);
    }
    // Reflector
    const lamp = box(2, 2, 2, 0xe8e0b0, -4, 4, -3);
    g.add(lamp);
    g.position.copy(at);
    const e = this.ent('site', id, g, radar ? 110 : 80, 9);
    e.n = counts ? 1 : 0;
    e.dish = dish;
    const L = 1500;
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(70, 1.5, L, 16, 1, true), this.beamMat);
    beam.geometry.translate(0, L / 2, 0);
    beam.position.copy(at).add(new THREE.Vector3(-4, 5, -3));
    this.group.add(beam);
    e.beam = beam;
    e.beamDir = new THREE.Vector3(0, 1, 0);
    e.spot = 0;
    e.flakT = 0;
    return e;
  }

  private setupSites() {
    const depots = this.def.variant === 'depots';
    this.goal = depots ? 5 : 6;
    const a0 = this.rand() * Math.PI * 2;
    const spots: THREE.Vector3[] = [];
    for (let i = 0; spots.length < this.goal && i < 400; i++) {
      const a = a0 + (spots.length / this.goal) * Math.PI * 2 + (this.rand() - 0.5) * 0.6;
      const d = 900 + this.rand() * 1700;
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      if (this.gen.isWater(x, z)) continue;
      if (depots) {
        // en un claro o junto al río
        if (!jungleClearing(this.gen, x, z) && this.gen.waterValue(x, z) > this.gen.stage.waterLevel + 0.03) continue;
        spots.push(new THREE.Vector3(x, 0, z));
      } else {
        const top = this.gen.heightAt(x, z);
        spots.push(new THREE.Vector3(x, top, z));
      }
    }
    for (const [i, s] of spots.entries()) {
      if (depots) {
        const g = new THREE.Group();
        for (let k = 0; k < 6; k++) g.add(box(2.2, 3, 2.2, k % 2 ? 0x5a6a3a : 0x6a5a3a, (k % 3) * 3 - 3, 1.5, Math.floor(k / 3) * 3 - 1.5));
        g.add(box(9, 4, 6, 0x4a5a3a, 0, 2, 7));
        g.position.copy(s);
        const e = this.ent('depot', `w_d${i}`, g, 70, 9);
        e.mesh.visible = false;
        e.target.alive = false;
        if (i % 2 === 0) this.addSite(s.clone().add(new THREE.Vector3(60, 0, -40)), `w_s${i}`, false);
      } else {
        this.addSite(s, `w_r${i}`, true, true);
      }
    }
    this.start.set(Math.cos(a0 + Math.PI) * 1800, 0, Math.sin(a0 + Math.PI) * 1800);
    this.start.y = this.safeY(this.start.x, this.start.z, 220);
    this.startYaw = Math.atan2(this.start.x, this.start.z);
  }

  private updateSites(t: number, dt: number, me: THREE.Vector3, vel: THREE.Vector3, alive: boolean) {
    let next: Ent | null = null;
    let bd = Infinity;
    for (const e of this.ents) {
      if (e.kind === 'depot') {
        if (!e.alive) continue;
        const d = e.pos.distanceTo(me);
        const seen = d < 950;
        e.mesh.visible = seen;
        e.target.alive = seen;
        // La flecha señala una zona de búsqueda (no el punto exacto)
        const q = e.pos.clone().add(new THREE.Vector3(Math.sin(e.pos.x) * 220, 0, Math.cos(e.pos.z) * 220));
        if (d < bd) {
          bd = d;
          next = seen ? e : ({ ...e, pos: q } as Ent);
        }
      } else if (e.kind === 'site' && e.n === 1 && e.alive) {
        const d = e.pos.distanceTo(me);
        if (d < bd) {
          bd = d;
          next = e;
        }
      }
    }
    this.nav = next ? next.pos : null;
    this.navLabel = this.def.variant === 'depots' ? (next && next.mesh.visible ? 'DEPÓSITO' : 'ZONA DE BÚSQUEDA') : 'RADAR';
    if (this.count >= this.goal) this.win(this.def.variant === 'depots' ? '¡Todos los depósitos destruidos!' : '¡Todas las estaciones de radar fuera de servicio!');
    void t;
    void dt;
    void vel;
    void alive;
  }

  /** Reflectores y fuego antiaéreo (radares, depósitos y presa) */
  private updateFlak(t: number, dt: number, me: THREE.Vector3, vel: THREE.Vector3, alive: boolean) {
    for (const e of this.ents) {
      if (e.kind !== 'site' || !e.alive || !e.beam || !e.beamDir) continue;
      if (e.dish) e.dish.rotation.y = t * 1.2;
      const lamp = e.beam.position;
      const to = me.clone().sub(lamp);
      const d = to.length();
      to.normalize();
      // Barrido o seguimiento
      if ((e.spot ?? 0) > 0) e.beamDir.lerp(to, Math.min(1, dt * 3)).normalize();
      else {
        const a = t * 0.45 + e.id.length * 1.3 + e.pos.x * 0.01;
        e.beamDir.set(Math.cos(a) * 0.55, 0.83, Math.sin(a) * 0.55).normalize();
      }
      e.beam.quaternion.setFromUnitVectors(UP, e.beamDir);
      const inBeam = alive && d < 1500 && e.beamDir.angleTo(to) < 0.06 + 40 / Math.max(d, 60);
      if (inBeam || (alive && d < 220)) e.spot = 4;
      else e.spot = Math.max(0, (e.spot ?? 0) - dt);
      this.beamMat.opacity = 0.1;
      if ((e.spot ?? 0) > 2.6 && alive && d < 1700) {
        e.flakT = (e.flakT ?? 0) - dt;
        if (e.flakT <= 0) {
          e.flakT = 0.75;
          const at = me.clone().addScaledVector(vel, 0.5).add(new THREE.Vector3((this.rand() - 0.5) * 50, (this.rand() - 0.5) * 30, (this.rand() - 0.5) * 50));
          this.flak(at, me);
        }
      }
    }
  }

  private flak(at: THREE.Vector3, me: THREE.Vector3) {
    const m = new THREE.Mesh(this.puffG, this.puffMat);
    m.position.copy(at);
    this.group.add(m);
    this.puffs.push({ m, life: 1.2, max: 1.2, s: 9 + this.rand() * 5 });
    const fl = new THREE.Mesh(this.puffG, this.flashMat);
    fl.position.copy(at);
    fl.scale.setScalar(4);
    this.group.add(fl);
    this.puffs.push({ m: fl, life: 0.12, max: 0.12, s: 6 });
    this.hooks.sound('flak');
    if (at.distanceTo(me) < 24) this.hooks.damage(9, '¡Fuego antiaéreo! Sal del reflector');
  }

  // ================================================================ Operación Escarcha
  private setupRescue() {
    this.goal = 4;
    // Base en tierra firme cerca del origen
    let base: THREE.Vector3 | null = null;
    for (let r = 0; r < 40 && !base; r++)
      for (let k = 0; k < 16 && !base; k++) {
        const a = (k / 16) * Math.PI * 2;
        const x = Math.cos(a) * r * 100;
        const z = Math.sin(a) * r * 100;
        if (!this.gen.isWater(x, z) && nunatakH(this.gen, x, z) === 0 && this.gen.maxHeightNear(x, z, 60) < 5) base = new THREE.Vector3(x, 0, z);
      }
    this.base.copy(base ?? new THREE.Vector3());
    const bg = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.TorusGeometry(70, 3, 6, 40), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 0.9, 1) }));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 40;
    bg.add(ring);
    bg.add(box(14, 6, 10, 0xd04030, -20, 3, 0), box(14, 6, 10, 0xe06a30, 0, 3, 0), box(14, 6, 10, 0xd04030, 20, 3, 0), box(1.5, 30, 1.5, 0xcccccc, 34, 15, 0));
    bg.position.copy(this.base);
    this.group.add(bg);
    this.baseMesh = bg;
    const a0 = this.rand() * Math.PI * 2;
    let i = 0;
    for (let tries = 0; i < 4 && tries < 400; tries++) {
      const a = a0 + (i / 4) * Math.PI * 2 + (this.rand() - 0.5) * 0.8;
      const d = 1300 + this.rand() * 1800;
      const x = this.base.x + Math.cos(a) * d;
      const z = this.base.z + Math.sin(a) * d;
      if (this.gen.isWater(x, z) || nunatakH(this.gen, x, z) > 0 || this.gen.maxHeightNear(x, z, 70) > 5) continue;
      const g = new THREE.Group();
      g.add(box(6, 3.5, 6, 0xe86a20, 0, 1.75, 0));
      const flare = box(1.2, 1.2, 1.2, 0xffffff, 6, 1, 4);
      (flare.material as THREE.MeshLambertMaterial).emissive = new THREE.Color(1, 0.15, 0.1);
      g.add(flare);
      const smokeMat = new THREE.MeshBasicMaterial({ color: 0xff5a40, transparent: true, opacity: 0.3, depthWrite: false });
      for (let k = 0; k < 8; k++) {
        const s = 4 + k * 2.4;
        const m = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), smokeMat);
        m.position.set(6 + k * 2.2, 4 + k * 10, 4);
        g.add(m);
      }
      g.position.set(x, 0, z);
      const e = this.ent('crew', `w_c${i}`, g, 1, 70);
      e.extra = flare;
      i++;
    }
    this.goal = i;
    this.start.copy(this.base).add(new THREE.Vector3(0, 160, 300));
    this.startYaw = Math.atan2(this.base.x - this.start.x, this.base.z - this.start.z) + Math.PI;
  }

  private updateRescue(t: number, dt: number, me: THREE.Vector3, speedKmh: number, alive: boolean) {
    let next: Ent | null = null;
    let bd = Infinity;
    const agl = me.y - this.ground(me.x, me.z);
    for (const e of this.ents) {
      if (e.kind !== 'crew' || !e.alive) continue;
      if (e.extra) e.extra.visible = Math.floor(t * 4 + e.pos.x) % 2 === 0;
      const h = Math.hypot(me.x - e.pos.x, me.z - e.pos.z);
      if (h < bd) {
        bd = h;
        next = e;
      }
      if (alive && h < 70) {
        if (agl < 50 && speedKmh < 450) {
          this.kill(e);
          this.count++;
          this.hooks.sound('pickup');
          this.hooks.score('Tripulación rescatada', 250);
          this.hooks.big(`🧑‍✈️ TRIPULACIÓN A BORDO · ${this.count}/${this.goal}`, 'good');
        } else if ((e.flakT ?? 0) <= 0) {
          e.flakT = 2.5;
          this.hooks.toast(agl >= 50 ? 'Baja más (menos de 50 m) para recogerlos' : 'Frena (menos de 450 km/h) para recogerlos', 1600);
        }
      }
      e.flakT = Math.max(0, (e.flakT ?? 0) - dt);
    }
    if (this.count >= this.goal) {
      this.nav = this.base.clone().setY(40);
      this.navLabel = 'BASE';
      const h = Math.hypot(me.x - this.base.x, me.z - this.base.z);
      if (alive && h < 90 && agl < 90) this.win('¡Todas las tripulaciones a salvo en la base!');
    } else {
      this.nav = next ? next.pos.clone().setY(20) : null;
      this.navLabel = 'BENGALA';
    }
    if (this.baseMesh) this.baseMesh.children[0].rotation.z = t * 0.5;
  }

  // ================================================================ Bucle
  /** t: segundos desde el inicio (reloj compartido) */
  update(dt: number, t: number, prev: THREE.Vector3, me: THREE.Vector3, vel: THREE.Vector3, speedKmh: number, alive: boolean) {
    this.lastT = t;
    if (this.state !== 'running') {
      this.wonT += dt;
      this.updateFx(dt);
      return;
    }
    if (t >= 0) this.timeLeft = Math.max(0, this.def.time - t);
    switch (this.def.kind) {
      case 'raid':
        this.updateRaid(t, dt, me, alive);
        break;
      case 'airlift':
        this.updateAirlift(t, dt, prev, me, alive);
        break;
      case 'escort':
        this.updateEscort(t, dt);
        break;
      case 'dam':
        this.updateDam(t, dt, me, speedKmh, alive);
        break;
      case 'sites':
        this.updateSites(t, dt, me, vel, alive);
        break;
      case 'rescue':
        this.updateRescue(t, dt, me, speedKmh, alive);
        break;
    }
    this.updateFlak(t, dt, me, vel, alive);
    this.updateFx(dt);
    if (this.state === 'running' && t > 0 && this.timeLeft <= 0) this.lose('Se ha acabado el tiempo');
  }

  private updateFx(dt: number) {
    for (const p of [...this.puffs]) {
      p.life -= dt;
      const k = 1 - p.life / p.max;
      p.m.scale.setScalar(p.s * (0.4 + k));
      if (p.life <= 0) {
        this.group.remove(p.m);
        this.puffs.splice(this.puffs.indexOf(p), 1);
      }
    }
    this.puffMat.opacity = 0.75;
    for (const tr of [...this.tracers]) {
      tr.life -= dt;
      if (tr.life <= 0) {
        this.group.remove(tr.line);
        tr.line.geometry.dispose();
        this.tracers.splice(this.tracers.indexOf(tr), 1);
      }
    }
    for (const c of [...this.crates]) {
      c.m.position.y -= c.v * dt;
      if (c.m.position.y < c.y0 + 2) {
        this.group.remove(c.m);
        this.crates.splice(this.crates.indexOf(c), 1);
      }
    }
  }

  private tracer(from: THREE.Vector3, to: THREE.Vector3) {
    const geo = new THREE.BufferGeometry().setFromPoints([from.clone(), from.clone().lerp(to, 0.85 + this.rand() * 0.1)]);
    const line = new THREE.Line(geo, this.tracerMat);
    this.group.add(line);
    this.tracers.push({ line, life: 0.1 });
  }

  private win(why: string) {
    if (this.state !== 'running') return;
    this.state = 'won';
    this.reason = why;
    this.hooks.sound('win');
  }

  private lose(why: string) {
    if (this.state !== 'running') return;
    this.state = 'lost';
    this.reason = why;
  }

  /** Dónde reaparecer tras caer (null = encima de donde caíste) */
  respawnPoint(): { pos: THREE.Vector3; yaw: number } | null {
    if (this.def.kind === 'dam') return { pos: this.start.clone(), yaw: this.startYaw };
    if (this.def.kind === 'escort') {
      const lead = this.ents.find((e) => e.kind === 'ally' && e.alive);
      const a = this.allyPos(lead?.n ?? 0, this.lastT);
      return { pos: a.pos.clone().addScaledVector(a.dir, -320).add(new THREE.Vector3(0, 40, 0)), yaw: Math.atan2(-a.dir.x, -a.dir.z) };
    }
    return null;
  }

  /** Puntos para el radar */
  radar(): { pos: THREE.Vector3; kind: 'enemy' | 'gate' | 'ally'; color?: string }[] {
    const out: { pos: THREE.Vector3; kind: 'enemy' | 'gate' | 'ally'; color?: string }[] = [];
    for (const e of this.ents) {
      if (!e.alive) continue;
      if ((e.kind === 'bomber' || e.kind === 'fighter' || e.kind === 'attacker') && e.mesh.visible) out.push({ pos: e.pos, kind: 'enemy' });
      else if (e.kind === 'site' || (e.kind === 'depot' && e.mesh.visible) || e.kind === 'balloon') out.push({ pos: e.pos, kind: 'enemy' });
      else if (e.kind === 'zone') out.push({ pos: e.pos, kind: 'gate', color: '#60e070' });
      else if (e.kind === 'crew') out.push({ pos: e.pos, kind: 'gate', color: '#ff6a4a' });
      else if (e.kind === 'ally') out.push({ pos: e.pos, kind: 'ally' });
    }
    if (this.dam) out.push({ pos: this.dam.pos, kind: 'gate', color: '#ffd040' });
    return out;
  }

  /** Texto del objetivo para el marcador */
  objective(): string {
    switch (this.def.kind) {
      case 'raid':
        return `Derribados ${this.count}/${this.goal} · en la ciudad ${this.fails}/${this.failMax}`;
      case 'airlift':
        return `Cargas ${this.count}/${this.goal}`;
      case 'escort':
        return `Bombarderos aliados ${this.count}/4 · ruta ${Math.min(100, Math.round(((this.lastT * 70) / Math.max(1, this.routeLen)) * 100))} %`;
      case 'dam':
        return this.bomb ? 'Bomba rebotando…' : `Pasadas restantes ${this.failMax - this.fails}`;
      case 'sites':
        return `${this.def.variant === 'depots' ? 'Depósitos' : 'Radares'} ${this.count}/${this.goal}`;
      case 'rescue':
        return this.count >= this.goal ? 'Vuelve a la base' : `Rescatados ${this.count}/${this.goal}`;
    }
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh || (o as THREE.Line).isLine) {
        m.geometry?.dispose();
        const mat = m.material as THREE.Material | THREE.Material[];
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
        else mat?.dispose();
      }
    });
    this.puffG.dispose();
  }
}

/** Distancia de un punto al segmento a-b */
function segDist(a: THREE.Vector3, b: THREE.Vector3, p: THREE.Vector3) {
  const ab = b.clone().sub(a);
  const L = ab.lengthSq();
  const k = L > 0 ? Math.max(0, Math.min(1, p.clone().sub(a).dot(ab) / L)) : 0;
  return a.clone().addScaledVector(ab, k).distanceTo(p);
}

export function warMission(id: string | null | undefined) {
  return WAR_MISSIONS.find((m) => m.id === id) ?? null;
}

/** Medallas guardadas de una misión (0..3) */
export function warStarsKey(id: string) {
  return `war.${id}`;
}

