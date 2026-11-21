import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Flecha 3D que flota delante del avión y apunta al siguiente objetivo */
export class GuideArrow {
  mesh: THREE.Mesh;
  private mat: THREE.MeshBasicMaterial;
  private tmp = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    // Flecha volumétrica (cabeza piramidal + cuerpo) que apunta a -Z
    const head = new THREE.ConeGeometry(2.6, 4.5, 4);
    head.rotateY(Math.PI / 4);
    head.rotateX(-Math.PI / 2);
    head.translate(0, 0, -2.2);
    const shaft = new THREE.BoxGeometry(1.4, 1.4, 4);
    shaft.translate(0, 0, 1.6);
    const geo = mergeGeometries([head.toNonIndexed(), shaft.toNonIndexed()]);
    this.mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(0.35, 1.25, 1.5),
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      fog: false,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.visible = false;
    this.mesh.renderOrder = 5;
    scene.add(this.mesh);
  }

  update(planePos: THREE.Vector3, yaw: number, target: THREE.Vector3 | null, visible: boolean, color?: number) {
    if (!target || !visible) {
      this.mesh.visible = false;
      return;
    }
    const fwd = this.tmp.set(-Math.sin(yaw), 0, -Math.cos(yaw));
    this.mesh.position.copy(planePos).addScaledVector(fwd, 22).add(new THREE.Vector3(0, 9, 0));
    this.mesh.lookAt(target);
    // Más tenue cuando ya vas en la buena dirección
    const to = new THREE.Vector3().subVectors(target, planePos).normalize();
    const facing = to.dot(new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw)));
    this.mat.opacity = facing > 0.95 ? 0.25 : 0.9;
    if (color !== undefined) this.mat.color.setHex(color).multiplyScalar(1.3);
    else this.mat.color.setRGB(0.35, 1.25, 1.5);
    this.mesh.visible = true;
  }

  dispose(scene: THREE.Scene) {
    scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}

export type RadarKind = 'gate' | 'gate2' | 'ring' | 'power' | 'enemy' | 'ally' | 'drone' | 'ghost';

export interface RadarItem {
  pos: THREE.Vector3;
  kind: RadarKind;
  color?: string;
  label?: string;
}

const RADAR_COLORS: Record<RadarKind, string> = {
  gate: '#40e0ff',
  gate2: 'rgba(255,255,255,0.55)',
  ring: '#ff9a2a',
  power: '#5cff8a',
  enemy: '#ff4040',
  ally: '#5cc8ff',
  drone: '#ff6a6a',
  ghost: 'rgba(150,200,255,0.8)',
};

/** Radar circular orientado al rumbo del avión */
export class Radar {
  private ctx: CanvasRenderingContext2D;
  range = 2000;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d')!;
  }

  draw(me: THREE.Vector3, yaw: number, items: RadarItem[], route: THREE.Vector3[] = []) {
    const c = this.canvas;
    const css = c.clientWidth || 120;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (c.width !== Math.round(css * dpr)) {
      c.width = c.height = Math.round(css * dpr);
    }
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const R = css / 2;
    ctx.clearRect(0, 0, css, css);

    // Fondo
    ctx.fillStyle = 'rgba(8,14,26,0.62)';
    ctx.beginPath();
    ctx.arc(R, R, R - 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(120,220,255,0.35)';
    ctx.lineWidth = 1;
    for (const k of [0.5, 1]) {
      ctx.beginPath();
      ctx.arc(R, R, (R - 2) * k, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(R, 4);
    ctx.lineTo(R, css - 4);
    ctx.moveTo(4, R);
    ctx.lineTo(css - 4, R);
    ctx.strokeStyle = 'rgba(120,220,255,0.15)';
    ctx.stroke();

    const scale = (R - 8) / this.range;
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    // mundo -> radar (arriba = hacia donde apunta el morro)
    const toRadar = (p: THREE.Vector3) => {
      const dx = p.x - me.x;
      const dz = p.z - me.z;
      // rotar por el rumbo: el morro mira a (-sin, -cos)
      const rx = dx * cos - dz * sin;
      const rz = dx * sin + dz * cos;
      return { x: rx * scale, y: rz * scale, dist: Math.hypot(dx, dz) };
    };

    // Ruta
    if (route.length > 1) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(R, R, R - 3, 0, Math.PI * 2);
      ctx.clip();
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = 'rgba(64,224,255,0.5)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      route.forEach((p, i) => {
        const q = toRadar(p);
        if (i === 0) ctx.moveTo(R + q.x, R + q.y);
        else ctx.lineTo(R + q.x, R + q.y);
      });
      ctx.stroke();
      ctx.restore();
    }

    for (const it of items) {
      const q = toRadar(it.pos);
      let x = q.x;
      let y = q.y;
      const len = Math.hypot(x, y);
      const max = R - 7;
      const outside = len > max;
      if (outside) {
        x = (x / len) * max;
        y = (y / len) * max;
      }
      const color = it.color ?? RADAR_COLORS[it.kind];
      ctx.fillStyle = color;
      ctx.strokeStyle = color;
      ctx.save();
      ctx.translate(R + x, R + y);
      if (outside && (it.kind === 'gate' || it.kind === 'enemy' || it.kind === 'ally')) {
        // flecha en el borde
        ctx.rotate(Math.atan2(y, x) + Math.PI / 2);
        ctx.beginPath();
        ctx.moveTo(0, -6);
        ctx.lineTo(5, 3);
        ctx.lineTo(-5, 3);
        ctx.closePath();
        ctx.fill();
      } else if (it.kind === 'gate' || it.kind === 'gate2') {
        ctx.rotate(Math.PI / 4);
        ctx.lineWidth = 2;
        const s = it.kind === 'gate' ? 6 : 4;
        ctx.strokeRect(-s / 2, -s / 2, s, s);
      } else if (it.kind === 'enemy' || it.kind === 'ally') {
        ctx.beginPath();
        ctx.arc(0, 0, 3.5, 0, Math.PI * 2);
        ctx.fill();
      } else {
        const s = it.kind === 'ring' ? 2.5 : 3;
        ctx.fillRect(-s / 2, -s / 2, s, s);
      }
      ctx.restore();
      if (it.label && !outside) {
        ctx.font = '700 9px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(it.label, R + x, R + y - 7);
      }
    }

    // Yo
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(R, R - 6);
    ctx.lineTo(R + 4.5, R + 5);
    ctx.lineTo(R, R + 2.5);
    ctx.lineTo(R - 4.5, R + 5);
    ctx.closePath();
    ctx.fill();
    // N
    const n = toRadar(new THREE.Vector3(me.x, 0, me.z - this.range * 2));
    const nl = Math.hypot(n.x, n.y) || 1;
    ctx.fillStyle = '#ff7a5a';
    ctx.font = '800 10px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('N', R + (n.x / nl) * (R - 9), R + (n.y / nl) * (R - 9));
    ctx.textBaseline = 'alphabetic';
  }
}
