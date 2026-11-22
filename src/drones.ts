import * as THREE from 'three';
import type { Target } from './combat';
import type { CityGen } from './world/city';

const MAX_HP = 24;

interface Drone extends Target {
  hp: number;
  mesh: THREE.Group;
  center: THREE.Vector3;
  radiusPath: number;
  angle: number;
  angSpeed: number;
  bob: number;
  respawn: number;
  flash: number;
  rotors: THREE.Object3D[];
  bodyMat: THREE.MeshLambertMaterial;
}

export function buildDrone(): { group: THREE.Group; rotors: THREE.Object3D[]; bodyMat: THREE.MeshLambertMaterial } {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshLambertMaterial({ color: 0xd8323a, emissive: 0x000000 });
  const dark = new THREE.MeshLambertMaterial({ color: 0x24262b });
  const eye = new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.6, 0.3) });
  const add = (w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material, parent: THREE.Object3D = g) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  };
  add(4, 1.6, 4, 0, 0, 0, bodyMat);
  add(2.4, 1, 2.4, 0, 1.2, 0, dark);
  add(1, 0.6, 0.3, 0, 0, -2.1, eye);
  const rotors: THREE.Object3D[] = [];
  for (const [x, z] of [
    [-3, -3],
    [3, -3],
    [-3, 3],
    [3, 3],
  ]) {
    add(Math.abs(x) * 0.9, 0.4, 0.5, x / 2, 0.3, z / 2, dark).rotation.y = Math.atan2(z, x) * -1;
    const hub = new THREE.Object3D();
    hub.position.set(x, 0.9, z);
    g.add(hub);
    add(3.6, 0.15, 0.5, 0, 0, 0, dark, hub);
    rotors.push(hub);
  }
  return { group: g, rotors, bodyMat };
}

/** Drones de práctica para el modo vuelo libre en solitario */
export class Drones {
  list: Drone[] = [];
  private _v = new THREE.Vector3();

  constructor(
    private scene: THREE.Scene,
    private gen: CityGen,
    count = 6,
  ) {
    for (let i = 0; i < count; i++) {
      const { group, rotors, bodyMat } = buildDrone();
      group.visible = false;
      scene.add(group);
      this.list.push({
        id: `drone-${i}`,
        name: 'Dron',
        pos: new THREE.Vector3(),
        vel: new THREE.Vector3(),
        radius: 7,
        alive: false,
        hp: MAX_HP,
        mesh: group,
        center: new THREE.Vector3(),
        radiusPath: 100,
        angle: 0,
        angSpeed: 0.3,
        bob: Math.random() * 10,
        respawn: i * 0.6,
        flash: 0,
        rotors,
        bodyMat,
      });
    }
  }

  /** En modo oleadas los drones no reaparecen solos */
  autoRespawn = true;

  /** Activa n drones de golpe alrededor del jugador (modo oleadas) */
  spawnWave(n: number, player: THREE.Vector3, forward: THREE.Vector3, hp = MAX_HP) {
    this.active = true;
    this.autoRespawn = false;
    this.list.forEach((d, i) => {
      if (i < n) {
        this.place(d, player, forward);
        d.hp = hp;
      } else {
        d.alive = false;
        d.mesh.visible = false;
      }
    });
  }

  get aliveCount() {
    return this.list.filter((d) => d.alive).length;
  }

  /** Cuántos drones mantiene el vuelo libre */
  freeCount = 6;

  setActive(v: boolean) {
    this.autoRespawn = true;
    this.list.forEach((d, i) => {
      if (!v || i >= this.freeCount) {
        d.alive = false;
        d.mesh.visible = false;
        d.respawn = 0.5 + Math.random() + i * 0.3;
      } else d.mesh.visible = d.alive;
    });
    this.active = v;
  }
  active = false;

  private place(d: Drone, player: THREE.Vector3, forward: THREE.Vector3) {
    const ang = Math.atan2(forward.x, forward.z) + (Math.random() - 0.5) * 2.2;
    const dist = 600 + Math.random() * 900;
    const cx = player.x + Math.sin(ang) * dist;
    const cz = player.z + Math.cos(ang) * dist;
    const floor = this.gen.maxHeightNear(cx, cz, 200) + 60;
    const cy = Math.max(floor, 150 + Math.random() * 350);
    d.center.set(cx, cy, cz);
    d.radiusPath = 80 + Math.random() * 160;
    d.angSpeed = (Math.random() < 0.5 ? -1 : 1) * (55 + Math.random() * 35) / d.radiusPath;
    d.angle = Math.random() * Math.PI * 2;
    d.hp = MAX_HP;
    d.alive = true;
    d.mesh.visible = true;
  }

  /** Aplica daño. Devuelve true si se destruye. */
  damage(id: string, dmg: number): boolean {
    const d = this.list.find((x) => x.id === id);
    if (!d || !d.alive) return false;
    d.hp -= dmg;
    d.flash = 0.08;
    if (d.hp <= 0) {
      d.alive = false;
      d.mesh.visible = false;
      d.respawn = 4 + Math.random() * 3;
      return true;
    }
    return false;
  }

  hp01(id: string) {
    const d = this.list.find((x) => x.id === id);
    return d ? Math.max(0, d.hp / MAX_HP) : 0;
  }

  update(dt: number, player: THREE.Vector3, forward: THREE.Vector3, time: number) {
    if (!this.active) return;
    for (const d of this.list) {
      if (!d.alive) {
        if (!this.autoRespawn || this.list.indexOf(d) >= this.freeCount) continue;
        d.respawn -= dt;
        if (d.respawn <= 0) this.place(d, player, forward);
        continue;
      }
      if (d.center.distanceTo(player) > 2600) {
        this.place(d, player, forward);
        continue;
      }
      d.angle += d.angSpeed * dt;
      const prev = this._v.copy(d.pos);
      d.pos.set(
        d.center.x + Math.cos(d.angle) * d.radiusPath,
        d.center.y + Math.sin(time * 0.8 + d.bob) * 12,
        d.center.z + Math.sin(d.angle) * d.radiusPath,
      );
      if (dt > 0) d.vel.subVectors(d.pos, prev).divideScalar(dt);
      d.mesh.position.copy(d.pos);
      d.mesh.rotation.y = -d.angle + (d.angSpeed > 0 ? Math.PI : 0);
      d.mesh.rotation.z = Math.sin(time * 2 + d.bob) * 0.1;
      for (const r of d.rotors) r.rotation.y += dt * 40;
      d.flash = Math.max(0, d.flash - dt);
      d.bodyMat.emissive.setRGB(d.flash > 0 ? 1.5 : 0, d.flash > 0 ? 1.2 : 0, d.flash > 0 ? 1 : 0);
    }
  }

  dispose() {
    for (const d of this.list) this.scene.remove(d.mesh);
  }
}
