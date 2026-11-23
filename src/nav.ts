import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { drawIcon, type IconId } from './identity';

/** Flecha 3D que flota delante del avión y apunta al siguiente objetivo */
/**
 * Flecha guía: una flecha plana y grande en el HUD, alrededor del avión.
 * Solo aparece cuando el objetivo no está a la vista y señala hacia dónde girar.
 */
export class GuideArrow {
  camera: THREE.Camera | null = null;
  private el: HTMLElement;
  private v = new THREE.Vector3();
  private shown = false;

  constructor(_scene?: THREE.Scene) {
    this.el = document.getElementById('guide-arrow')!;
  }

  private hide() {
    if (!this.shown) return;
    this.shown = false;
    this.el.classList.remove('show');
  }

  update(planePos: THREE.Vector3, yaw: number, target: THREE.Vector3 | null, visible: boolean, color?: number) {
    const cam = this.camera;
    if (!target || !visible || !cam) {
      this.hide();
      return;
    }
    const W = window.innerWidth;
    const H = window.innerHeight;
    const p = this.v.copy(target).project(cam);
    const behind = p.z > 1;
    // Objetivo delante y dentro de la pantalla: basta con el rombo, sin flecha
    if (!behind && Math.abs(p.x) < 0.75 && Math.abs(p.y) < 0.7) {
      this.hide();
      return;
    }
    let ang: number;
    if (!behind) {
      // Dirección en pantalla hacia el objetivo (0 = arriba)
      ang = Math.atan2(p.x * W, p.y * H);
    } else {
      // Detrás: girar hacia el lado más corto (izquierda o derecha)
      const dx = target.x - planePos.x;
      const dz = target.z - planePos.z;
      const fwd = -Math.sin(yaw) * dx - Math.cos(yaw) * dz;
      const side = Math.cos(yaw) * dx - Math.sin(yaw) * dz;
      const bearing = Math.atan2(side, fwd);
      ang = Math.sign(bearing || 1) * Math.min(Math.abs(bearing), Math.PI * 0.62);
    }
    const R = Math.min(W, H) * 0.2;
    const cx = W / 2 + Math.sin(ang) * R;
    const cy = H * 0.52 - Math.cos(ang) * R;
    this.el.style.transform = `translate(${cx.toFixed(1)}px, ${cy.toFixed(1)}px) rotate(${ang.toFixed(3)}rad)`;
    this.el.style.color = color !== undefined ? `#${color.toString(16).padStart(6, '0')}` : '#40e0ff';
    if (!this.shown) {
      this.shown = true;
      this.el.classList.add('show');
    }
  }

  dispose(_scene?: THREE.Scene) {
    this.hide();
  }
}

const TRAIL_MAX = 110;
const TRAIL_GAP = 34;

/**
 * Estela en el cielo: chevrones luminosos que fluyen por el camino a seguir
 * (del avión al siguiente hito y al posterior), entrando de frente por cada hito.
 */
export class RouteTrail {
  private mesh: THREE.InstancedMesh;
  private curve: THREE.CatmullRomCurve3 | null = null;
  private len = 0;
  private phase = 0;
  private refreshT = 0;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3(1, 1, 1);
  private c = new THREE.Color();
  private base = new THREE.Color();
  private look = new THREE.Matrix4();
  private up = new THREE.Vector3(0, 1, 0);
  private p = new THREE.Vector3();
  private t = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    const arm = (side: number) => {
      const g = new THREE.BoxGeometry(1.8, 0.9, 10);
      g.rotateY(side * 0.62);
      g.translate(side * 2.9, 0, 2.2);
      return g.toNonIndexed();
    };
    const geo = mergeGeometries([arm(1), arm(-1)]);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    this.mesh = new THREE.InstancedMesh(geo, mat, TRAIL_MAX);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(TRAIL_MAX * 3), 3);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.renderOrder = 4;
    scene.add(this.mesh);
  }

  /** points: camino a seguir (null para ocultar). color: hex del camino. */
  update(dt: number, points: THREE.Vector3[] | null, color = 0x40e0ff) {
    if (!points || points.length < 2) {
      this.mesh.count = 0;
      this.curve = null;
      return;
    }
    this.refreshT -= dt;
    if (!this.curve || this.refreshT <= 0) {
      this.refreshT = 0.15;
      this.curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
      this.len = this.curve.getLength();
    }
    const curve = this.curve;
    const L = this.len;
    if (L < 20) {
      this.mesh.count = 0;
      return;
    }
    this.phase = (this.phase + dt * 70) % TRAIL_GAP;
    this.base.setHex(color).multiplyScalar(1.6);
    const n = Math.min(TRAIL_MAX, Math.floor(L / TRAIL_GAP));
    let k = 0;
    for (let i = 0; i < n; i++) {
      const d = i * TRAIL_GAP + this.phase;
      if (d > L) break;
      const u = d / L;
      curve.getPointAt(u, this.p);
      curve.getTangentAt(u, this.t);
      this.look.lookAt(this.p, this.t.add(this.p), this.up);
      this.q.setFromRotationMatrix(this.look);
      const scale = 1.1 + Math.min(3.2, d / 260);
      this.s.setScalar(scale);
      this.m.compose(this.p, this.q, this.s);
      this.mesh.setMatrixAt(k, this.m);
      // Aparece suave cerca del avión y se apaga al final
      const fadeIn = Math.min(1, d / 120);
      const fadeOut = Math.min(1, (L - d) / 80);
      const pulse = 0.75 + 0.25 * Math.sin(i * 0.9 - this.phase * 0.18);
      this.c.copy(this.base).multiplyScalar(fadeIn * fadeOut * pulse);
      this.mesh.setColorAt(k, this.c);
      k++;
    }
    this.mesh.count = k;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

export type RadarKind = 'gate' | 'gate2' | 'ring' | 'power' | 'enemy' | 'ally' | 'drone' | 'ghost';

export interface RadarItem {
  pos: THREE.Vector3;
  kind: RadarKind;
  color?: string;
  label?: string;
  /** Icono del piloto (aliados y enemigos) */
  icon?: IconId;
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

  draw(me: THREE.Vector3, yaw: number, items: RadarItem[], route: THREE.Vector3[] = [], circles: { pos: THREE.Vector3; r: number; color: string }[] = []) {
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

    // Zonas (tormenta de Supervivencia)
    if (circles.length) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(R, R, R - 2, 0, Math.PI * 2);
      ctx.clip();
      for (const c of circles) {
        const q = toRadar(c.pos);
        ctx.strokeStyle = c.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(R + q.x, R + q.y, Math.max(2, c.r * scale), 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }

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
      if (it.icon) {
        drawIcon(ctx, it.icon, R + x, R + y, outside ? 4.5 : 6.5, color);
        if (it.kind === 'enemy') {
          ctx.strokeStyle = '#ff3030';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(R + x, R + y, outside ? 7 : 9.5, 0, Math.PI * 2);
          ctx.stroke();
        }
        continue;
      }
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
