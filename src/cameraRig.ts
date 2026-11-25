import * as THREE from 'three';
import type { Flight } from './jet';

export type CameraMode = 'chase' | 'far' | 'top' | 'cockpit';
export const CAMERA_MODES: CameraMode[] = ['chase', 'far', 'top', 'cockpit'];
export const CAMERA_LABELS: Record<CameraMode, string> = {
  chase: 'Básica',
  far: 'Lejana',
  top: 'Cenital',
  cockpit: 'Cabina',
};

export class CameraRig {
  mode: CameraMode = 'chase';
  private pos = new THREE.Vector3();
  private look = new THREE.Vector3();
  private initialized = false;
  private shake = 0;
  /** fracción del alabeo que copia la cámara (ajuste «Inclinación de la cámara») */
  tilt = 0.25;

  constructor(public camera: THREE.PerspectiveCamera) {}

  snap() {
    this.initialized = false;
  }

  addShake(v: number) {
    this.shake = Math.max(this.shake, v);
  }

  update(dt: number, f: Flight, speedFactor: number) {
    const cam = this.camera;
    const fwd = f.forward(new THREE.Vector3());
    const flat = new THREE.Vector3(-Math.sin(f.yaw), 0, -Math.cos(f.yaw));
    const baseFov = this.mode === 'cockpit' ? 70 : 62;
    const fov = baseFov + speedFactor * 14;
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov += (fov - cam.fov) * Math.min(1, dt * 3);
      cam.updateProjectionMatrix();
    }

    if (this.mode === 'cockpit') {
      const q = f.quaternion();
      const offset = new THREE.Vector3(0, 1.6, -5).applyQuaternion(q);
      cam.position.copy(f.pos).add(offset);
      cam.quaternion.copy(q);
      this.applyShake(dt);
      this.initialized = false;
      return;
    }

    let targetPos: THREE.Vector3;
    let targetLook: THREE.Vector3;
    const up = new THREE.Vector3(0, 1, 0);
    if (this.mode === 'top') {
      targetPos = f.pos.clone().add(new THREE.Vector3(0, 260, 0)).addScaledVector(flat, -30);
      targetLook = f.pos.clone().addScaledVector(flat, 40);
      up.copy(flat);
    } else {
      const back = this.mode === 'far' ? 130 : 42;
      const height = this.mode === 'far' ? 48 : 12;
      targetPos = f.pos.clone().addScaledVector(fwd, -back).add(new THREE.Vector3(0, height, 0));
      targetLook = f.pos.clone().addScaledVector(fwd, 40).add(new THREE.Vector3(0, height * 0.25, 0));
    }

    if (!this.initialized) {
      this.pos.copy(targetPos);
      this.look.copy(targetLook);
      this.initialized = true;
    } else {
      const k = 1 - Math.exp(-dt * (this.mode === 'top' ? 6 : 8));
      this.pos.lerp(targetPos, k);
      this.look.lerp(targetLook, 1 - Math.exp(-dt * 12));
    }
    cam.position.copy(this.pos);
    cam.up.copy(up);
    cam.lookAt(this.look);
    if (this.mode !== 'top') {
      // Inclinar un poco la cámara con el alabeo
      cam.rotateZ(f.roll * this.tilt);
    }
    this.applyShake(dt);
  }

  private applyShake(dt: number) {
    if (this.shake <= 0) return;
    const s = this.shake;
    this.camera.position.x += (Math.random() - 0.5) * s;
    this.camera.position.y += (Math.random() - 0.5) * s;
    this.camera.position.z += (Math.random() - 0.5) * s;
    this.shake = Math.max(0, this.shake - dt * 4);
  }
}
