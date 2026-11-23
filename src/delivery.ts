import * as THREE from 'three';
import { PERIOD, S_DETAIL, S_ROOF, type CityGen } from './world/city';

export interface DeliveryEvent {
  type: 'pickup' | 'deliver' | 'timeout';
  reward?: number;
  tip?: number;
  label?: string;
}

const START_TIME = 120;
const TIME_PER_DELIVERY = 40;
/** Radio de la esfera de recogida/entrega (se atraviesa en el aire) */
const ZONE_R = 42;
/** Altura de la esfera sobre la azotea */
const HOVER = 110;

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

  private ringA: THREE.Mesh;
  private ringB: THREE.Mesh;
  private shell: THREE.Mesh;
  private shellMat: THREE.MeshBasicMaterial;
  private ringMat: THREE.MeshBasicMaterial;
  private tether: THREE.Mesh;
  private crate: THREE.Group;
  private arrow: THREE.Mesh;
  /** posición de la azotea bajo la esfera */
  roof = new THREE.Vector3();

  constructor(
    private scene: THREE.Scene,
    private gen: CityGen,
  ) {
    // Marca en la azotea (ancla visual)
    this.padMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.35, 0.95, 0.5), transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false });
    this.pad = new THREE.Mesh(new THREE.RingGeometry(16, 20, 40), this.padMat);
    this.pad.rotation.x = -Math.PI / 2;
    // Haz que se ve desde lejos
    this.beamMat = new THREE.MeshBasicMaterial({ color: 0x5cff8a, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
    this.beam = new THREE.Mesh(new THREE.CylinderGeometry(5, 5, 1200, 8, 1, true), this.beamMat);
    this.beam.position.y = 600;
    // Esfera flotante: cáscara translúcida + dos aros que giran (giroscopio)
    this.shellMat = new THREE.MeshBasicMaterial({ color: 0x5cff8a, transparent: true, opacity: 0.14, depthWrite: false, side: THREE.DoubleSide });
    this.shell = new THREE.Mesh(new THREE.IcosahedronGeometry(ZONE_R, 2), this.shellMat);
    this.ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 1.4, 0.7) });
    this.ringA = new THREE.Mesh(new THREE.TorusGeometry(ZONE_R, 1.6, 6, 48), this.ringMat);
    this.ringB = new THREE.Mesh(new THREE.TorusGeometry(ZONE_R * 0.86, 1.3, 6, 48), this.ringMat);
    // Cuerda de luz entre azotea y esfera
    this.tether = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 1, 6), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45 }));
    // Paquete flotando dentro (recogida)
    this.crate = new THREE.Group();
    const box = new THREE.Mesh(new THREE.BoxGeometry(12, 12, 12), new THREE.MeshLambertMaterial({ color: 0xc8904a, emissive: 0x3a2200 }));
    const tape = new THREE.Mesh(new THREE.BoxGeometry(12.4, 2, 12.4), new THREE.MeshBasicMaterial({ color: 0xffe08a }));
    const tape2 = new THREE.Mesh(new THREE.BoxGeometry(2, 12.4, 12.4), new THREE.MeshBasicMaterial({ color: 0xffe08a }));
    this.crate.add(box, tape, tape2);
    // Flecha hacia abajo (entrega)
    this.arrow = new THREE.Mesh(new THREE.ConeGeometry(10, 18, 4), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 0.8, 0.2) }));
    this.arrow.rotation.x = Math.PI;
    this.group.add(this.pad, this.beam);
    scene.add(this.group);
    this.zone.add(this.shell, this.ringA, this.ringB, this.crate, this.arrow);
    scene.add(this.zone, this.tether);
    this.pkg = new THREE.Mesh(new THREE.BoxGeometry(2.4, 2.4, 2.4), new THREE.MeshLambertMaterial({ color: 0xc8904a, emissive: 0x2a1600 }));
    this.pkg.visible = false;
    scene.add(this.pkg);
  }

  private zone = new THREE.Group();

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
    this.setTarget(this.pickRoof(from, 900, 1600));
  }

  private setTarget(p: THREE.Vector3) {
    // La esfera flota sobre la azotea: se recoge y se entrega en el aire
    this.roof.copy(p);
    const air = Math.max(p.y + HOVER, this.gen.maxHeightNear(p.x, p.z, ZONE_R + 30) + ZONE_R + 25, 160);
    this.target.set(p.x, air, p.z);
    this.group.position.copy(p).setY(p.y + 0.6);
    this.zone.position.copy(this.target);
    const len = Math.max(1, air - ZONE_R - p.y);
    this.tether.scale.set(1, len, 1);
    this.tether.position.set(p.x, p.y + len / 2, p.z);
    const deliver = this.state === 'deliver';
    const col = deliver ? 0xffa040 : 0x5cff8a;
    this.padMat.color.setRGB(deliver ? 1 : 0.35, deliver ? 0.6 : 0.95, deliver ? 0.2 : 0.5);
    this.beamMat.color.setHex(col);
    this.shellMat.color.setHex(col);
    if (deliver) this.ringMat.color.setRGB(1.6, 0.85, 0.3);
    else this.ringMat.color.setRGB(0.5, 1.4, 0.7);
    this.crate.visible = !deliver;
    this.arrow.visible = deliver;
    this.legTime = 0;
    this.lowTime = 0;
  }

  update(dt: number, pos: THREE.Vector3, quat: THREE.Quaternion, time: number): DeliveryEvent | null {
    if (this.over) return null;
    this.timeLeft -= dt;
    this.legTime += dt;
    this.pad.rotation.z = time * 0.8;
    this.ringA.rotation.set(time * 0.9, time * 0.6, 0);
    this.ringB.rotation.set(Math.PI / 2 + time * 0.5, 0, time * 1.1);
    this.crate.rotation.set(time * 0.4, time * 0.9, 0);
    this.crate.position.y = Math.sin(time * 2) * 3;
    this.arrow.position.y = Math.sin(time * 4) * 4;
    this.shellMat.opacity = 0.1 + 0.06 * Math.sin(time * 3);
    // Se agranda un poco al acercarse para que se vea bien el objetivo
    const near = THREE.MathUtils.clamp(1 - pos.distanceTo(this.target) / 600, 0, 1);
    this.zone.scale.setScalar(1 + near * 0.15);
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
    const dy = pos.y - this.target.y;
    const reached = dx * dx + dz * dz + dy * dy < ZONE_R * ZONE_R * 1.15;
    if (!reached) return null;
    if (this.state === 'pickup') {
      this.state = 'deliver';
      this.pkg.visible = true;
      const dest = this.pickRoof(this.target, 1800, 3000);
      this.legDist = dest.distanceTo(this.target);
      this.setTarget(dest);
      return { type: 'pickup' };
    }
    // Entrega: base + propina por rapidez y por volar bajo
    this.delivered++;
    const par = this.legDist / 220;
    const fast = Math.max(0, par - this.legTime);
    const tip = Math.round(fast * 14);
    const reward = 150 + tip;
    this.score += reward;
    this.timeLeft += TIME_PER_DELIVERY;
    this.state = 'pickup';
    this.pkg.visible = false;
    this.setTarget(this.pickRoof(this.target, 900, 1600));
    return { type: 'deliver', reward, tip, label: fast > 3 ? '¡Entrega exprés!' : 'Entregado' };
  }

  get legDistance() {
    return this.legDist;
  }

  dispose() {
    this.scene.remove(this.group, this.pkg, this.zone, this.tether);
    this.zone.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }
    });
    this.tether.geometry.dispose();
    (this.tether.material as THREE.Material).dispose();
    this.pad.geometry.dispose();
    this.beam.geometry.dispose();
    this.padMat.dispose();
    this.beamMat.dispose();
    this.pkg.geometry.dispose();
    (this.pkg.material as THREE.Material).dispose();
  }
}
