import * as THREE from 'three';
import type { Target } from './combat';

/**
 * Cielo de aurora: cintas de luz ondulantes y un manto de estrellas que siguen a la cámara.
 * (El oscurecimiento del cielo lo hace el juego; esto pone la aurora y las estrellas.)
 */
export class AuroraSky {
  group = new THREE.Group();
  private mats: THREE.ShaderMaterial[] = [];
  private stars: THREE.Points;

  constructor(private scene: THREE.Scene) {
    const vert = /* glsl */ `
      uniform float uTime;
      uniform float uPhase;
      varying vec2 vUv;
      void main() {
        vUv = uv;
        vec3 p = position;
        p.z += sin(p.x * 0.004 + uTime * 0.35 + uPhase) * 160.0 + sin(p.x * 0.011 - uTime * 0.6) * 40.0;
        p.y += sin(p.x * 0.006 + uTime * 0.2 + uPhase) * 60.0;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
      }`;
    const frag = /* glsl */ `
      uniform float uTime;
      uniform float uPhase;
      uniform vec3 uColA;
      uniform vec3 uColB;
      varying vec2 vUv;
      void main() {
        float bands = 0.55 + 0.45 * sin(vUv.x * 60.0 + uTime * 1.3 + uPhase * 3.0);
        float fade = smoothstep(0.0, 0.25, vUv.y) * (1.0 - smoothstep(0.55, 1.0, vUv.y));
        float edge = smoothstep(0.0, 0.08, vUv.x) * (1.0 - smoothstep(0.92, 1.0, vUv.x));
        vec3 col = mix(uColA, uColB, vUv.y);
        gl_FragColor = vec4(col * bands, fade * edge * 0.75);
      }`;
    const palettes: [number, number][] = [
      [0x40ff9a, 0x9a50ff],
      [0x30e0c0, 0x50a0ff],
      [0x70ff60, 0xff50c0],
    ];
    for (let i = 0; i < 3; i++) {
      const mat = new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 }, uPhase: { value: i * 2.1 }, uColA: { value: new THREE.Color(palettes[i][0]) }, uColB: { value: new THREE.Color(palettes[i][1]) } },
        vertexShader: vert,
        fragmentShader: frag,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        fog: false,
      });
      this.mats.push(mat);
      const ribbon = new THREE.Mesh(new THREE.PlaneGeometry(5200, 700, 120, 1), mat);
      ribbon.position.set((i - 1) * 600, 1500 + i * 220, -2400 + i * 700);
      ribbon.rotation.y = (i - 1) * 0.35;
      this.group.add(ribbon);
    }
    // Estrellas
    const N = 1600;
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const u = Math.random() * Math.PI * 2;
      const v = Math.acos(Math.random() * 0.95);
      const r = 6500;
      pos[i * 3] = Math.cos(u) * Math.sin(v) * r;
      pos[i * 3 + 1] = Math.cos(v) * r * 0.6 + 400;
      pos[i * 3 + 2] = Math.sin(u) * Math.sin(v) * r;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.stars = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, fog: false, transparent: true, opacity: 0.85 }));
    this.group.add(this.stars);
    this.group.renderOrder = -1;
    scene.add(this.group);
  }

  update(time: number, camera: THREE.Camera, fade: number) {
    this.group.position.set(camera.position.x, 0, camera.position.z);
    for (const m of this.mats) m.uniforms.uTime.value = time;
    (this.stars.material as THREE.PointsMaterial).opacity = 0.85 * fade;
    this.group.visible = fade > 0.01;
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | undefined;
      mat?.dispose();
    });
  }
}

/** Aves de luz: tres aves luminosas que escoltan al avión y disparan rayos de luz */
export class LightBirds {
  group = new THREE.Group();
  private birds: { g: THREE.Group; wl: THREE.Mesh; wr: THREE.Mesh; pos: THREE.Vector3; cool: number }[] = [];
  private beams: { line: THREE.Line; life: number }[] = [];
  private beamMat = new THREE.LineBasicMaterial({ color: new THREE.Color(1, 0.95, 0.6), transparent: true });

  constructor(private scene: THREE.Scene, start: THREE.Vector3) {
    const body = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.75, 0.98, 1) });
    const wing = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.55, 0.85, 1), transparent: true, opacity: 0.85, side: THREE.DoubleSide });
    const tail = new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.85, 0.5) });
    for (let i = 0; i < 3; i++) {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(new THREE.BoxGeometry(1.4, 1, 5), body));
      const head = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1.4), tail);
      head.position.set(0, 0.3, -3);
      g.add(head);
      const wl = new THREE.Mesh(new THREE.PlaneGeometry(7, 2.6), wing);
      wl.geometry.rotateX(-Math.PI / 2);
      wl.geometry.translate(-3.5, 0, 0);
      const wr = new THREE.Mesh(new THREE.PlaneGeometry(7, 2.6), wing);
      wr.geometry.rotateX(-Math.PI / 2);
      wr.geometry.translate(3.5, 0, 0);
      const t = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.2, 3), tail);
      t.position.z = 3.6;
      g.add(wl, wr, t);
      g.scale.setScalar(1.6);
      this.group.add(g);
      this.birds.push({ g, wl, wr, pos: start.clone(), cool: i * 0.4 });
    }
    scene.add(this.group);
  }

  /**
   * me: posición y orientación del avión; targets: objetivos enemigos;
   * hit: aplica el daño del rayo
   */
  update(dt: number, time: number, me: THREE.Vector3, quat: THREE.Quaternion, targets: Target[], hit: (t: Target) => void) {
    const offsets = [new THREE.Vector3(-22, 6, 18), new THREE.Vector3(22, 6, 18), new THREE.Vector3(0, 14, 30)];
    for (const [i, b] of this.birds.entries()) {
      const goal = offsets[i].clone().add(new THREE.Vector3(Math.sin(time * 1.3 + i) * 4, Math.sin(time * 2 + i) * 3, 0)).applyQuaternion(quat).add(me);
      b.pos.lerp(goal, Math.min(1, dt * 4));
      b.g.position.copy(b.pos);
      b.g.quaternion.copy(quat);
      const flap = Math.sin(time * 9 + i * 1.7) * 0.6;
      b.wl.rotation.z = flap;
      b.wr.rotation.z = -flap;
      b.cool -= dt;
      if (b.cool <= 0) {
        let best: Target | null = null;
        let bd = 750;
        for (const t of targets) {
          if (!t.alive) continue;
          const d = t.pos.distanceTo(b.pos);
          if (d < bd) {
            bd = d;
            best = t;
          }
        }
        if (best) {
          b.cool = 1.1;
          const geo = new THREE.BufferGeometry().setFromPoints([b.pos.clone(), best.pos.clone()]);
          const line = new THREE.Line(geo, this.beamMat);
          this.scene.add(line);
          this.beams.push({ line, life: 0.18 });
          hit(best);
        } else b.cool = 0.3;
      }
    }
    for (const bm of [...this.beams]) {
      bm.life -= dt;
      if (bm.life <= 0) {
        this.scene.remove(bm.line);
        bm.line.geometry.dispose();
        this.beams.splice(this.beams.indexOf(bm), 1);
      }
    }
  }

  dispose() {
    this.scene.remove(this.group);
    for (const bm of this.beams) {
      this.scene.remove(bm.line);
      bm.line.geometry.dispose();
    }
    this.beams = [];
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.geometry.dispose();
        (m.material as THREE.Material).dispose();
      }
    });
    this.beamMat.dispose();
  }
}
