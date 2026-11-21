import * as THREE from 'three';
import type { CityGen } from './world/city';
import { CHUNK } from './world/city';
import { hash2, hash3 } from './world/noise';

export type PowerKind = 'shield' | 'ammo' | 'repair' | 'turbo' | 'damage';

export const POWER_INFO: Record<PowerKind, { name: string; color: number; css: string; duration: number }> = {
  shield: { name: 'Escudo', color: 0x40e0ff, css: '#40e0ff', duration: 10 },
  ammo: { name: 'Munición', color: 0xffd040, css: '#ffd040', duration: 0 },
  repair: { name: 'Reparación', color: 0x5cff8a, css: '#5cff8a', duration: 0 },
  turbo: { name: 'Turbo infinito', color: 0xff8a2a, css: '#ff8a2a', duration: 8 },
  damage: { name: 'Doble daño', color: 0xff4a6a, css: '#ff4a6a', duration: 10 },
};

const KINDS: PowerKind[] = ['shield', 'ammo', 'repair', 'turbo', 'damage'];
const RESPAWN = 35;

interface Crate {
  id: string;
  kind: PowerKind;
  group: THREE.Group;
  pos: THREE.Vector3;
}

/** Cajas de recompensa repartidas por el mundo */
export class PowerUps {
  enabled = true;
  private crates = new Map<string, Crate>();
  /** id -> segundos para reaparecer */
  private cooldown = new Map<string, number>();
  private box = new THREE.BoxGeometry(1, 1, 1);
  private mats = new Map<PowerKind, { shell: THREE.MeshBasicMaterial; core: THREE.MeshBasicMaterial }>();

  constructor(
    private scene: THREE.Scene,
    private gen: CityGen,
  ) {
    for (const k of KINDS) {
      const c = new THREE.Color(POWER_INFO[k].color);
      this.mats.set(k, {
        shell: new THREE.MeshBasicMaterial({ color: c.clone().multiplyScalar(0.9), transparent: true, opacity: 0.45, depthWrite: false }),
        core: new THREE.MeshBasicMaterial({ color: c.clone().multiplyScalar(1.6) }),
      });
    }
  }

  private spawnFor(cx: number, cz: number) {
    const seed = this.gen.stage.seed + 909;
    if (hash2(cx, cz, seed) > 0.16) return null;
    const x = (cx + 0.2 + hash3(cx, cz, 1, seed) * 0.6) * CHUNK;
    const z = (cz + 0.2 + hash3(cx, cz, 2, seed) * 0.6) * CHUNK;
    const y = Math.max(120 + hash3(cx, cz, 3, seed) * 300, this.gen.maxHeightNear(x, z, 30) + 40);
    const kind = KINDS[Math.floor(hash3(cx, cz, 4, seed) * KINDS.length)];
    return { id: `p${cx}_${cz}`, kind, pos: new THREE.Vector3(x, y, z) };
  }

  addChunk(cx: number, cz: number) {
    if (!this.enabled) return;
    const s = this.spawnFor(cx, cz);
    if (!s || this.crates.has(s.id) || this.cooldown.has(s.id)) return;
    const m = this.mats.get(s.kind)!;
    const g = new THREE.Group();
    const shell = new THREE.Mesh(this.box, m.shell);
    shell.scale.setScalar(9);
    const core = new THREE.Mesh(this.box, m.core);
    core.scale.setScalar(4.5);
    g.add(shell, core);
    g.position.copy(s.pos);
    this.scene.add(g);
    this.crates.set(s.id, { ...s, group: g });
  }

  removeChunk(cx: number, cz: number) {
    const id = `p${cx}_${cz}`;
    const c = this.crates.get(id);
    if (c) {
      this.scene.remove(c.group);
      this.crates.delete(id);
    }
  }

  setEnabled(v: boolean, loaded: Iterable<[number, number]>) {
    this.enabled = v;
    for (const c of this.crates.values()) this.scene.remove(c.group);
    this.crates.clear();
    this.cooldown.clear();
    if (v) for (const [cx, cz] of loaded) this.addChunk(cx, cz);
  }

  /** Devuelve la recompensa recogida (si la hay) */
  update(dt: number, time: number, player: THREE.Vector3 | null, loaded: () => Iterable<[number, number]>): PowerKind | null {
    let got: PowerKind | null = null;
    for (const [id, c] of this.crates) {
      c.group.rotation.y = time * 1.2;
      c.group.rotation.x = Math.sin(time * 0.8) * 0.3;
      c.group.position.y = c.pos.y + Math.sin(time * 1.5 + c.pos.x) * 2;
      if (player && !got && c.group.position.distanceToSquared(player) < 20 * 20) {
        got = c.kind;
        this.scene.remove(c.group);
        this.crates.delete(id);
        this.cooldown.set(id, RESPAWN);
      }
    }
    if (this.cooldown.size) {
      let respawned = false;
      for (const [id, t] of this.cooldown) {
        if (t - dt <= 0) {
          this.cooldown.delete(id);
          respawned = true;
        } else this.cooldown.set(id, t - dt);
      }
      if (respawned) for (const [cx, cz] of loaded()) this.addChunk(cx, cz);
    }
    return got;
  }

  positions(): { pos: THREE.Vector3; kind: PowerKind }[] {
    return [...this.crates.values()].map((c) => ({ pos: c.group.position, kind: c.kind }));
  }

  dispose() {
    for (const c of this.crates.values()) this.scene.remove(c.group);
    this.crates.clear();
    this.box.dispose();
    for (const m of this.mats.values()) {
      m.shell.dispose();
      m.core.dispose();
    }
  }
}
