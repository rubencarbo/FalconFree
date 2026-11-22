import * as THREE from 'three';
import { PERIOD, S_DETAIL, S_ROOF, type CityGen } from './world/city';

export interface DeliveryEvent {
  type: 'pickup' | 'deliver' | 'timeout';
  reward?: number;
  tip?: number;
  label?: string;
}

const START_TIME = 90;
const TIME_PER_DELIVERY = 25;
const PAD_R = 30;

/** Modo Mensajero urbano: recoger y entregar paquetes en azoteas contra reloj */
export class Delivery {
  state: 'pickup' | 'deliver' = 'pickup';
  target = new THREE.Vector3();
  timeLeft = START_TIME;
  delivered = 0;
  score = 0;
  over = false;
  private legTime = 0;
  private legDist = 1;
  private lowTime = 0;
  private group = new THREE.Group();
  private pad: THREE.Mesh;
  private beam: THREE.Mesh;
  private padMat: THREE.MeshBasicMaterial;
  private beamMat: THREE.MeshBasicMaterial;
  pkg: THREE.Mesh;
  private rand = Math.random;

  constructor(
    private scene: THREE.Scene,
    private gen: CityGen,
  ) {
    this.padMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.35, 0.95, 0.5), transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false });
    this.pad = new THREE.Mesh(new THREE.RingGeometry(PAD_R - 5, PAD_R, 40), this.padMat);
    this.pad.rotation.x = -Math.PI / 2;
    this.beamMat = new THREE.MeshBasicMaterial({ color: 0x5cff8a, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    this.beam = new THREE.Mesh(new THREE.CylinderGeometry(6, 6, 1200, 8, 1, true), this.beamMat);
    this.beam.position.y = 600;
    this.group.add(this.pad, this.beam);
    scene.add(this.group);
    this.pkg = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.4, 2.4), new THREE.MeshLambertMaterial({ color: 0xc8904a, emissive: 0x2a1600 }));
    this.pkg.visible = false;
    scene.add(this.pkg);
  }

  /** Busca una azotea a una distancia razonable */
  private pickRoof(from: THREE.Vector3, minD: number, maxD: number): THREE.Vector3 {
    for (let attempt = 0; attempt < 60; attempt++) {
      const a = this.rand() * Math.PI * 2;
      const d = minD + this.rand() * (maxD - minD);
      const x = from.x + Math.cos(a) * d;
      const z = from.z + Math.sin(a) * d;
      const b = this.gen.block(Math.floor(x / PERIOD), Math.floor(z / PERIOD));
      const roofs = b.buildings.filter((bx) => bx.style !== S_DETAIL && bx.style !== S_ROOF && bx.h > 8 && bx.x1 - bx.x0 > 14 && bx.z1 - bx.z0 > 14);
      if (!roofs.length) continue;
      const r = roofs[Math.floor(this.rand() * roofs.length)];
      // la caja más alta que cubre el centro de esa azotea
      const cx = (r.x0 + r.x1) / 2;
      const cz = (r.z0 + r.z1) / 2;
      return new THREE.Vector3(cx, this.gen.heightAt(cx, cz), cz);
    }
    // Sin azoteas cerca (agua): punto elevado sobre el suelo
    const a = this.rand() * Math.PI * 2;
    return new THREE.Vector3(from.x + Math.cos(a) * minD, 0, from.z + Math.sin(a) * minD);
  }

  start(from: THREE.Vector3) {
    this.state = 'pickup';
    this.timeLeft = START_TIME;
    this.delivered = 0;
    this.score = 0;
    this.over = false;
    this.pkg.visible = false;
    this.setTarget(this.pickRoof(from, 450, 900));
  }

  private setTarget(p: THREE.Vector3) {
    this.target.copy(p);
    this.group.position.copy(p).setY(p.y + 0.6);
    const deliver = this.state === 'deliver';
    this.padMat.color.setRGB(deliver ? 1 : 0.35, deliver ? 0.6 : 0.95, deliver ? 0.2 : 0.5);
    this.beamMat.color.setHex(deliver ? 0xffa040 : 0x5cff8a);
    this.legTime = 0;
    this.lowTime = 0;
  }

  update(dt: number, pos: THREE.Vector3, quat: THREE.Quaternion, time: number): DeliveryEvent | null {
    if (this.over) return null;
    this.timeLeft -= dt;
    this.legTime += dt;
    this.pad.rotation.z = time * 0.8;
    // El haz guía desde lejos; de cerca se oculta para no deslumbrar
    const hd = Math.hypot(pos.x - this.target.x, pos.z - this.target.z);
    this.beam.visible = hd > 180;
    this.beamMat.opacity = 0.16 + 0.08 * Math.sin(time * 4);
    if (this.pkg.visible) {
      this.pkg.position.copy(new THREE.Vector3(0, -2.6, 1).applyQuaternion(quat).add(pos));
      this.pkg.quaternion.copy(quat);
    }
    const agl = pos.y - this.gen.heightAt(pos.x, pos.z);
    if (agl < 40) this.lowTime += dt;
    if (this.timeLeft <= 0) {
      this.over = true;
      return { type: 'timeout' };
    }
    const dx = pos.x - this.target.x;
    const dz = pos.z - this.target.z;
    const reached = dx * dx + dz * dz < PAD_R * PAD_R && pos.y < this.target.y + 45 && pos.y > this.target.y - 4;
    if (!reached) return null;
    if (this.state === 'pickup') {
      this.state = 'deliver';
      this.pkg.visible = true;
      const dest = this.pickRoof(this.target, 900, 1700);
      this.legDist = dest.distanceTo(this.target);
      this.setTarget(dest);
      return { type: 'pickup' };
    }
    // Entrega: base + propina por rapidez y por volar bajo
    this.delivered++;
    const par = this.legDist / 220;
    const fast = Math.max(0, par - this.legTime);
    const tip = Math.round(fast * 12 + Math.min(this.lowTime, 20) * 6);
    const reward = 150 + tip;
    this.score += reward;
    this.timeLeft += TIME_PER_DELIVERY;
    this.state = 'pickup';
    this.pkg.visible = false;
    this.setTarget(this.pickRoof(this.target, 400, 900));
    return { type: 'deliver', reward, tip, label: fast > 3 ? '¡Entrega exprés!' : 'Entregado' };
  }

  get legDistance() {
    return this.legDist;
  }

  dispose() {
    this.scene.remove(this.group, this.pkg);
    this.pad.geometry.dispose();
    this.beam.geometry.dispose();
    this.padMat.dispose();
    this.beamMat.dispose();
    this.pkg.geometry.dispose();
    (this.pkg.material as THREE.Material).dispose();
  }
}
