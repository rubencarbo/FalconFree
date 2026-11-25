import * as THREE from 'three';

/**
 * Eyección: el piloto sale disparado hacia arriba y baja en paracaídas hasta el suelo.
 * En equipo, un compañero puede rescatarlo pasando cerca y despacio.
 */
export interface Chute {
  /** dueño: uid del jugador, «me» o id del bot */
  owner: string;
  name: string;
  /** ¿lo puede rescatar un compañero? */
  rescuable: boolean;
  start: THREE.Vector3;
  pos: THREE.Vector3;
  t: number;
  group: THREE.Group;
  canopy: THREE.Object3D;
  done: boolean;
  /** se ha visto al dueño caído (para quitar el paracaídas cuando reaparezca) */
  sawDead?: boolean;
}

const CANOPY_COLORS: [number, number][] = [
  [0xf05a28, 0xf4f4f4],
  [0x2a8ae0, 0xf4f4f4],
  [0x3ac070, 0xf4f4f4],
  [0xe0b020, 0x2a2a2a],
];

export class Parachutes {
  list: Chute[] = [];
  private group = new THREE.Group();

  constructor(private scene: THREE.Scene) {
    scene.add(this.group);
  }

  private model(colorIdx: number) {
    const g = new THREE.Group();
    // Piloto con casco
    const suit = new THREE.MeshLambertMaterial({ color: 0x3a4a3a });
    const helmet = new THREE.MeshLambertMaterial({ color: 0xe8e8e8 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.8, 0.8), suit);
    body.position.y = 0.9;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.8), helmet);
    head.position.y = 2.2;
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.3, 0.1), new THREE.MeshBasicMaterial({ color: 0x223040 }));
    visor.position.set(0, 2.25, 0.42);
    g.add(body, head, visor);
    // Paracaídas a gajos de dos colores
    const canopy = new THREE.Group();
    const [a, b] = CANOPY_COLORS[colorIdx % CANOPY_COLORS.length];
    const segs = 8;
    for (let i = 0; i < segs; i++) {
      const geo = new THREE.SphereGeometry(5, 4, 5, (i / segs) * Math.PI * 2, (Math.PI * 2) / segs, 0, Math.PI / 2.4);
      const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: i % 2 ? a : b, side: THREE.DoubleSide }));
      canopy.add(m);
    }
    canopy.scale.set(1, 0.7, 1);
    canopy.position.y = 7.5;
    // Cordajes
    const lineMat = new THREE.LineBasicMaterial({ color: 0xdddddd });
    for (let i = 0; i < 6; i++) {
      const ang = (i / 6) * Math.PI * 2;
      const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 2, 0), new THREE.Vector3(Math.cos(ang) * 4.2, 9.2, Math.sin(ang) * 4.2)]);
      canopy.add(new THREE.Line(geo, lineMat));
    }
    g.add(canopy);
    g.scale.setScalar(1.4);
    return { g, canopy };
  }

  add(owner: string, name: string, at: THREE.Vector3, rescuable: boolean, colorIdx = 0) {
    this.remove(owner);
    const { g, canopy } = this.model(colorIdx);
    g.position.copy(at);
    canopy.scale.set(0.1, 0.1, 0.1);
    this.group.add(g);
    const c: Chute = { owner, name, rescuable, start: at.clone(), pos: at.clone(), t: 0, group: g, canopy, done: false };
    this.list.push(c);
    return c;
  }

  remove(owner: string) {
    for (const c of [...this.list]) {
      if (c.owner !== owner) continue;
      this.group.remove(c.group);
      this.dispose(c.group);
      this.list.splice(this.list.indexOf(c), 1);
    }
  }

  /** groundAt: altura del suelo/azotea bajo un punto */
  update(dt: number, groundAt: (x: number, z: number) => number) {
    for (const c of [...this.list]) {
      c.t += dt;
      const t = c.t;
      // Salida hacia arriba (asiento eyectable) y luego descenso lento con algo de deriva
      const up = 30 * (1 - Math.exp(-t * 2.5));
      const fall = Math.max(0, t - 1.2) * 5.5;
      const ground = groundAt(c.pos.x, c.pos.z) + 0.5;
      c.pos.set(c.start.x + t * 1.6, Math.max(ground, c.start.y + up - fall), c.start.z + Math.sin(t * 0.4) * 6);
      c.group.position.copy(c.pos);
      c.group.rotation.y = t * 0.3;
      // El paracaídas se abre al segundo
      const open = THREE.MathUtils.clamp((t - 0.7) / 0.6, 0.1, 1);
      c.canopy.scale.set(open, open * 0.7, open);
      c.canopy.rotation.z = Math.sin(t * 1.3) * 0.08;
      if (c.pos.y <= ground + 0.01 && !c.done) c.done = true;
      // Tras tocar tierra se queda un rato y desaparece
      if (c.done && t > 25) this.remove(c.owner);
    }
  }

  private dispose(g: THREE.Object3D) {
    g.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | undefined;
      mat?.dispose?.();
    });
  }

  clear() {
    for (const c of [...this.list]) this.remove(c.owner);
  }

  disposeAll() {
    this.clear();
    this.scene.remove(this.group);
  }
}
