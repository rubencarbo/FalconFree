import * as THREE from 'three';

/**
 * Aviones clásicos de la Segunda Guerra Mundial (y posguerra), con su librea y sus
 * escarapelas. Miran hacia -Z (morro) como el resto de aviones del juego.
 * Devuelven las hélices (para girarlas) y las puntas de las alas (estelas).
 */
export type WarbirdId = 'spitfire' | 'mustang' | 'warhawk' | 'zero' | 'bf109' | 'sturmovik' | 'dauntless' | 'lancaster' | 'skytrain' | 'mosquito' | 'he111' | 'b17';

export const WARBIRDS: WarbirdId[] = ['spitfire', 'mustang', 'warhawk', 'zero', 'bf109', 'sturmovik', 'dauntless', 'lancaster', 'skytrain', 'mosquito', 'he111', 'b17'];

export function isWarbird(v: string): v is WarbirdId {
  return (WARBIRDS as string[]).includes(v);
}

export interface WarbirdParts {
  props: THREE.Object3D[];
  tips: [THREE.Vector3, THREE.Vector3];
}

const M = (c: number) => new THREE.MeshLambertMaterial({ color: c });
const B = (c: number) => new THREE.MeshBasicMaterial({ color: c });

function box(g: THREE.Group, w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  mesh.position.set(x, y, z);
  g.add(mesh);
  return mesh;
}

/** Tubo a lo largo de Z */
function tube(g: THREE.Group, rF: number, rB: number, len: number, x: number, y: number, z: number, m: THREE.Material, seg = 10) {
  const geo = new THREE.CylinderGeometry(rB, rF, len, seg);
  geo.rotateX(Math.PI / 2);
  const mesh = new THREE.Mesh(geo, m);
  mesh.position.set(x, y, z);
  g.add(mesh);
  return mesh;
}

/** Plancha en planta: contorno del lado derecho [x, z], reflejado al izquierdo */
function plate(g: THREE.Group, pts: [number, number][], t: number, y: number, m: THREE.Material, mirror = true) {
  const make = (sx: number) => {
    const shape = new THREE.Shape();
    shape.moveTo(pts[0][0] * sx, pts[0][1]);
    for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i][0] * sx, pts[i][1]);
    shape.closePath();
    const geo = new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: false });
    geo.rotateX(Math.PI / 2);
    geo.translate(0, y + t / 2, 0);
    g.add(new THREE.Mesh(geo, m));
  };
  make(1);
  if (mirror) make(-1);
}

/** Deriva: contorno [z, y] */
function fin(g: THREE.Group, pts: [number, number][], t: number, x: number, y: number, m: THREE.Material) {
  const shape = new THREE.Shape();
  shape.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i][0], pts[i][1]);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: false });
  geo.rotateY(-Math.PI / 2);
  geo.translate(t / 2, 0, 0);
  const mesh = new THREE.Mesh(geo, m);
  mesh.position.set(x, y, 0);
  g.add(mesh);
  return mesh;
}

/** Ala elíptica (Spitfire) o redondeada: semienvergadura s, cuerda en la raíz c */
function ellipticWing(s: number, c: number, z0: number, sweep = 0.15): [number, number][] {
  const lead: [number, number][] = [];
  const trail: [number, number][] = [];
  for (let i = 0; i <= 12; i++) {
    const x = s * Math.sin((i / 12) * (Math.PI / 2));
    const k = Math.sqrt(Math.max(0, 1 - (x / s) ** 2));
    lead.push([x, z0 - c * 0.42 * k + sweep * (x / s)]);
    trail.push([x, z0 + c * 0.58 * k + sweep * (x / s)]);
  }
  return [[0, lead[0][1]], ...lead.slice(1), ...trail.reverse()];
}

/** Ala trapezoidal (cuerda raíz → punta) con punta redondeada */
function taperWing(s: number, cRoot: number, cTip: number, z0: number, sweep = 0.3): [number, number][] {
  const tipZ = z0 + sweep;
  return [
    [0, z0 - cRoot * 0.4],
    [s * 0.97, tipZ - cTip * 0.45],
    [s, tipZ - cTip * 0.2],
    [s, tipZ + cTip * 0.3],
    [s * 0.97, tipZ + cTip * 0.55],
    [0, z0 + cRoot * 0.6],
  ];
}

/** Disco (escarapela) concéntrico. axis 'y' = sobre el ala; 'x' = en el costado */
function roundel(g: THREE.Group, colors: number[], r: number, x: number, y: number, z: number, axis: 'y' | 'x', side = 1) {
  colors.forEach((c, i) => {
    const rr = r * (1 - i / colors.length);
    const geo = new THREE.CylinderGeometry(rr, rr, 0.06, 20);
    const mesh = new THREE.Mesh(geo, B(c));
    if (axis === 'x') mesh.rotation.z = Math.PI / 2;
    mesh.position.set(x + (axis === 'x' ? side * i * 0.012 : 0), y + (axis === 'y' ? i * 0.012 : 0), z);
    g.add(mesh);
  });
}

/** Estrella blanca de cinco puntas sobre disco azul (EE. UU.) */
function usStar(g: THREE.Group, r: number, x: number, y: number, z: number, axis: 'y' | 'x', side = 1, bars = true) {
  roundel(g, [0x1a2a6a], r, x, y, z, axis, side);
  const shape = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 === 0 ? r * 0.92 : r * 0.38;
    if (i === 0) shape.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
    else shape.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.05, bevelEnabled: false });
  const mesh = new THREE.Mesh(geo, B(0xf4f4f4));
  if (axis === 'y') {
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, y + 0.05, z);
  } else {
    mesh.rotation.y = side * Math.PI / 2;
    mesh.position.set(x + side * 0.05, y, z);
  }
  g.add(mesh);
  if (bars) {
    for (const s of [-1, 1]) {
      if (axis === 'y') box(g, r * 0.9, 0.06, r * 0.5, x + s * r * 1.3, y + 0.03, z, B(0xf4f4f4));
      else box(g, 0.06, r * 0.5, r * 0.9, x + side * 0.03, y, z + s * r * 1.3, B(0xf4f4f4));
    }
  }
}

/** Cruz negra con borde blanco */
function cross(g: THREE.Group, s: number, x: number, y: number, z: number, axis: 'y' | 'x', side = 1) {
  const W = B(0xf4f4f4);
  const K = B(0x141414);
  for (const [m, k, d] of [
    [W, 1, 0],
    [K, 0.6, 0.02],
  ] as [THREE.Material, number, number][]) {
    if (axis === 'y') {
      box(g, s * 2 * k + (k < 1 ? 0 : 0.1), 0.05, s * 0.55 * k, x, y + d, z, m);
      box(g, s * 0.55 * k, 0.05, s * 2 * k + (k < 1 ? 0 : 0.1), x, y + d, z, m);
    } else {
      box(g, 0.05, s * 2 * k, s * 0.55 * k, x + side * d, y, z, m);
      box(g, 0.05, s * 0.55 * k, s * 2 * k, x + side * d, y, z, m);
    }
  }
}

/** Estrella roja (URSS) con borde */
function redStar(g: THREE.Group, r: number, x: number, y: number, z: number, side: number) {
  const shape = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 === 0 ? r : r * 0.4;
    if (i === 0) shape.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
    else shape.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.05, bevelEnabled: false });
  const mesh = new THREE.Mesh(geo, B(0xd02020));
  mesh.rotation.y = side * Math.PI / 2;
  mesh.position.set(x + side * 0.05, y, z);
  g.add(mesh);
}

/** Hélice: buje + palas. Devuelve el grupo que gira alrededor de Z */
function prop(g: THREE.Group, blades: number, r: number, x: number, y: number, z: number, hub: number) {
  const p = new THREE.Group();
  const bm = M(0x1c1c1c);
  for (let i = 0; i < blades; i++) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.28, r, 0.08), bm);
    b.geometry.translate(0, r / 2, 0);
    b.rotation.z = (i / blades) * Math.PI * 2;
    p.add(b);
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.1), B(0xf0d020));
    tip.position.set(Math.sin(-b.rotation.z) * r * 0.95, Math.cos(b.rotation.z) * r * 0.95, 0);
    p.add(tip);
  }
  // disco borroso al girar
  const disc = new THREE.Mesh(new THREE.CircleGeometry(r, 24), new THREE.MeshBasicMaterial({ color: 0x404040, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false }));
  p.add(disc);
  p.position.set(x, y, z);
  g.add(p);
  const sp = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.1, 10), M(hub));
  sp.rotation.x = -Math.PI / 2;
  sp.position.set(x, y, z - 0.5);
  g.add(sp);
  return p;
}

// ======================================================================= Modelos
const RAF_OUTER = [0xf0d020, 0x1a2a6a, 0xf4f4f4, 0xc02020];
const RAF_TOP = [0x1a2a6a, 0xc02020];

export function buildWarbird(id: WarbirdId, g: THREE.Group): WarbirdParts {
  switch (id) {
    case 'spitfire':
      return spitfire(g);
    case 'mustang':
      return mustang(g);
    case 'warhawk':
      return warhawk(g);
    case 'zero':
      return zero(g);
    case 'bf109':
      return bf109(g);
    case 'sturmovik':
      return sturmovik(g);
    case 'dauntless':
      return dauntless(g);
    case 'lancaster':
      return lancaster(g);
    case 'skytrain':
      return skytrain(g);
    case 'mosquito':
      return mosquito(g);
    case 'he111':
      return he111(g);
    case 'b17':
      return b17(g);
  }
}

/** Supermarine Spitfire (Reino Unido): ala elíptica, camuflaje verde y gris */
function spitfire(g: THREE.Group): WarbirdParts {
  const green = M(0x4a5a34);
  const grey = M(0x7a7a6a);
  const sky = M(0xc8d4b0);
  tube(g, 0.75, 0.45, 9.5, 0, 0, 0.4, green);
  tube(g, 0.55, 0.75, 1.6, 0, 0, -4.9, green);
  box(g, 0.9, 0.7, 2.2, 0, 0.75, -0.9, M(0x8ab8d0));
  box(g, 1.15, 0.5, 0.5, 0, -0.65, 0.2, grey);
  plate(g, ellipticWing(5.6, 2.6, -0.6), 0.22, -0.35, green);
  plate(g, [[0.2, 3.6], [2.0, 4.0], [2.1, 4.6], [0.2, 5.0]], 0.15, 0.1, grey);
  fin(g, [[3.6, 0.4], [4.4, 2.0], [5.1, 2.1], [5.3, 0.4]], 0.15, 0, 0.2, green);
  box(g, 1.55, 1.55, 0.5, 0, 0, 3.4, sky);
  roundel(g, RAF_TOP, 0.7, 3.4, -0.2, -0.3, 'y');
  roundel(g, RAF_TOP, 0.7, -3.4, -0.2, -0.3, 'y');
  roundel(g, RAF_OUTER, 0.62, 0.72, 0, 1.9, 'x', 1);
  roundel(g, RAF_OUTER, 0.62, -0.72, 0, 1.9, 'x', -1);
  const p = prop(g, 3, 1.7, 0, 0, -5.8, 0x3a3a3a);
  return { props: [p], tips: [new THREE.Vector3(-5.6, -0.3, -0.4), new THREE.Vector3(5.6, -0.3, -0.4)] };
}

/** North American P-51 Mustang (EE. UU.): aluminio, morro amarillo, cabina de burbuja, toma ventral */
function mustang(g: THREE.Group): WarbirdParts {
  const metal = M(0xb8bcc4);
  const olive = M(0x5a5e3a);
  tube(g, 0.7, 0.45, 9.8, 0, 0, 0.4, metal);
  tube(g, 0.55, 0.7, 1.6, 0, 0, -5, M(0xf0c020));
  box(g, 1.4, 0.35, 9, 0, 0.55, 0.2, olive); // franja antirreflejos
  tube(g, 0.5, 0.5, 1.4, 0, 0.75, -0.6, M(0x8ab8d0), 10).scale.set(0.9, 1, 1);
  box(g, 0.9, 0.9, 3, 0, -0.95, 0.6, metal); // toma ventral
  plate(g, taperWing(5.7, 2.6, 1.2, -0.5, 0.2), 0.22, -0.4, metal);
  // franjas de invasión
  for (const [x, c] of [[2.2, 0xf4f4f4], [2.6, 0x141414], [3.0, 0xf4f4f4], [3.4, 0x141414]] as [number, number][]) {
    box(g, 0.4, 0.26, 2.1, x, -0.4, -0.25, B(c));
    box(g, 0.4, 0.26, 2.1, -x, -0.4, -0.25, B(c));
  }
  plate(g, [[0.2, 3.8], [2.2, 4.2], [2.2, 4.8], [0.2, 5.1]], 0.15, 0.1, metal);
  fin(g, [[3.7, 0.4], [4.6, 2.0], [5.3, 2.1], [5.3, 0.4]], 0.15, 0, 0.2, metal);
  usStar(g, 0.55, 4.2, -0.15, 0.2, 'y');
  usStar(g, 0.5, 0.7, 0, 2.2, 'x', 1);
  usStar(g, 0.5, -0.7, 0, 2.2, 'x', -1);
  const p = prop(g, 4, 1.75, 0, 0, -5.9, 0xf0c020);
  return { props: [p], tips: [new THREE.Vector3(-5.7, -0.4, -0.3), new THREE.Vector3(5.7, -0.4, -0.3)] };
}

/** Curtiss P-40 Warhawk (EE. UU., «Tigres Voladores»): boca de tiburón y radiador bajo el morro */
function warhawk(g: THREE.Group): WarbirdParts {
  const olive = M(0x5e5a36);
  const belly = M(0xa8aaa0);
  tube(g, 0.72, 0.45, 9.2, 0, 0, 0.5, olive);
  tube(g, 0.62, 0.72, 1.4, 0, -0.05, -4.7, olive);
  box(g, 1.3, 1.1, 2.0, 0, -0.75, -4.0, olive); // radiador
  // boca de tiburón
  for (const s of [-1, 1]) {
    box(g, 0.05, 0.55, 2.0, s * 0.68, -0.75, -4.1, B(0xc02020));
    for (let i = 0; i < 5; i++) {
      const tooth = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.22, 3), B(0xf4f4f4));
      tooth.position.set(s * 0.7, -0.52, -4.9 + i * 0.4);
      tooth.rotation.x = Math.PI;
      g.add(tooth);
    }
    box(g, 0.05, 0.22, 0.32, s * 0.72, -0.05, -4.5, B(0xf4f4f4));
    box(g, 0.06, 0.12, 0.14, s * 0.74, -0.05, -4.5, B(0x141414));
  }
  box(g, 0.9, 0.65, 2.0, 0, 0.72, -0.8, M(0x8ab8d0));
  box(g, 1.2, 0.45, 8, 0, -0.55, 0.6, belly);
  plate(g, taperWing(5.6, 2.5, 1.3, -0.4, 0.2), 0.22, -0.4, olive);
  plate(g, [[0.2, 3.6], [2.0, 4.0], [2.0, 4.6], [0.2, 4.9]], 0.15, 0.1, olive);
  fin(g, [[3.5, 0.4], [4.3, 1.9], [5.0, 2.0], [5.1, 0.4]], 0.15, 0, 0.2, olive);
  usStar(g, 0.55, 4.0, -0.15, 0.2, 'y', 1, false);
  usStar(g, 0.5, 0.7, 0, 2.0, 'x', 1, false);
  usStar(g, 0.5, -0.7, 0, 2.0, 'x', -1, false);
  const p = prop(g, 3, 1.7, 0, 0, -5.6, 0x2a2a2a);
  return { props: [p], tips: [new THREE.Vector3(-5.6, -0.4, -0.2), new THREE.Vector3(5.6, -0.4, -0.2)] };
}

/** Mitsubishi A6M Zero (Japón): gris claro, capota negra y discos rojos (hinomaru) */
function zero(g: THREE.Group): WarbirdParts {
  const light = M(0xc4c2a8);
  tube(g, 0.75, 0.42, 9, 0, 0, 0.5, light);
  tube(g, 0.78, 0.78, 1.3, 0, 0, -4.6, M(0x1a1a1a));
  box(g, 0.9, 0.7, 3.2, 0, 0.72, -0.6, M(0x8ab8d0));
  plate(g, ellipticWing(5.9, 2.4, -0.4, 0.3), 0.2, -0.35, light);
  plate(g, [[0.2, 3.6], [2.0, 4.0], [1.9, 4.6], [0.2, 4.9]], 0.15, 0.1, light);
  fin(g, [[3.6, 0.4], [4.5, 1.9], [5.1, 1.9], [5.2, 0.4]], 0.15, 0, 0.2, light);
  roundel(g, [0xc01818], 0.75, 3.6, -0.15, -0.3, 'y');
  roundel(g, [0xc01818], 0.75, -3.6, -0.15, -0.3, 'y');
  roundel(g, [0xc01818], 0.5, 0.66, 0, 2.2, 'x', 1);
  roundel(g, [0xc01818], 0.5, -0.66, 0, 2.2, 'x', -1);
  const p = prop(g, 3, 1.6, 0, 0, -5.5, 0x9a8a70);
  return { props: [p], tips: [new THREE.Vector3(-5.9, -0.3, -0.1), new THREE.Vector3(5.9, -0.3, -0.1)] };
}

/** Messerschmitt Bf 109 (Alemania): gris moteado, morro y timón amarillos */
function bf109(g: THREE.Group): WarbirdParts {
  const grey = M(0x7a828a);
  const yellow = M(0xe0b020);
  tube(g, 0.62, 0.38, 9, 0, 0, 0.6, grey);
  tube(g, 0.5, 0.62, 1.5, 0, 0, -4.6, yellow);
  box(g, 0.8, 0.6, 1.8, 0, 0.62, -1.2, M(0x8ab8d0));
  box(g, 0.85, 0.12, 1.9, 0, 0.98, -1.2, M(0x2a2a2a));
  plate(g, taperWing(5.0, 2.2, 1.1, -0.6, 0.15), 0.2, -0.35, grey);
  plate(g, [[0.2, 3.7], [1.8, 4.0], [1.8, 4.6], [0.2, 4.9]], 0.15, 0.25, grey);
  fin(g, [[3.8, 0.35], [4.4, 1.6], [5.2, 1.7], [5.2, 0.35]], 0.15, 0, 0.25, yellow);
  for (let i = 0; i < 6; i++) box(g, 0.3, 0.05, 0.3, ((i * 1.7) % 4) - 2, -0.2, ((i * 2.3) % 3) - 1, M(0x5a626a));
  cross(g, 0.45, 3.2, -0.2, -0.2, 'y');
  cross(g, 0.45, -3.2, -0.2, -0.2, 'y');
  cross(g, 0.4, 0.62, 0, 2.0, 'x', 1);
  cross(g, 0.4, -0.62, 0, 2.0, 'x', -1);
  const p = prop(g, 3, 1.6, 0, 0, -5.5, 0xe0b020);
  return { props: [p], tips: [new THREE.Vector3(-5.0, -0.3, -0.4), new THREE.Vector3(5.0, -0.3, -0.4)] };
}

/** Ilyushin Il-2 Sturmovik (URSS): avión de ataque blindado con joroba y estrellas rojas */
function sturmovik(g: THREE.Group): WarbirdParts {
  const green = M(0x4e5e34);
  const black = M(0x2a2e24);
  tube(g, 0.85, 0.45, 10.5, 0, 0, 0.6, green);
  tube(g, 0.7, 0.85, 1.6, 0, -0.1, -5.4, green);
  box(g, 1.0, 1.0, 3.2, 0, 0.85, -1.0, M(0x8ab8d0)); // joroba de la cabina
  box(g, 1.0, 0.4, 2.0, 0, 0.6, 1.4, green);
  plate(g, [[0, -1.6], [2.4, -1.3], [7.0, -0.2], [7.2, 0.6], [6.9, 1.0], [2.4, 1.5], [0, 1.6]], 0.26, -0.5, green);
  plate(g, [[3, -0.9], [5, -0.6], [5, 1.2], [3, 1.4]], 0.27, -0.5, black);
  plate(g, [[0.2, 4.2], [2.3, 4.6], [2.3, 5.2], [0.2, 5.6]], 0.15, 0.1, green);
  fin(g, [[4.3, 0.45], [5.0, 2.1], [5.8, 2.2], [5.9, 0.45]], 0.15, 0, 0.2, green);
  redStar(g, 0.7, 0.86, 0, 2.3, 1);
  redStar(g, 0.7, -0.86, 0, 2.3, -1);
  redStar(g, 0.6, 0.09, 1.4, 5.1, 1);
  const p = prop(g, 3, 1.85, 0, -0.1, -6.3, 0x4e5e34);
  return { props: [p], tips: [new THREE.Vector3(-7.2, -0.5, 0.2), new THREE.Vector3(7.2, -0.5, 0.2)] };
}

/** Douglas SBD Dauntless (Armada de EE. UU.): bombardero en picado azul-gris con frenos perforados */
function dauntless(g: THREE.Group): WarbirdParts {
  const blue = M(0x5a6a82);
  const light = M(0xc8ccd0);
  tube(g, 0.78, 0.45, 10, 0, 0, 0.5, blue);
  tube(g, 0.82, 0.78, 1.3, 0, 0, -5.0, blue);
  box(g, 0.95, 0.7, 4.4, 0, 0.8, -0.2, M(0x8ab8d0));
  box(g, 1.3, 0.4, 8.5, 0, -0.6, 0.5, light);
  plate(g, taperWing(6.3, 2.7, 1.2, -0.3, 0.5), 0.22, -0.4, blue);
  // frenos de picado perforados en el borde de salida
  for (let i = 0; i < 6; i++) {
    box(g, 0.5, 0.06, 0.35, 1.2 + i * 0.75, -0.52, 1.25, M(0x2a2e38));
    box(g, 0.5, 0.06, 0.35, -(1.2 + i * 0.75), -0.52, 1.25, M(0x2a2e38));
  }
  box(g, 0.6, 0.6, 2.4, 0, -1.0, -0.6, M(0x3a3a3a)); // bomba
  plate(g, [[0.2, 4.0], [2.3, 4.3], [2.3, 4.9], [0.2, 5.2]], 0.15, 0.1, blue);
  fin(g, [[3.8, 0.45], [4.7, 2.2], [5.4, 2.3], [5.5, 0.45]], 0.15, 0, 0.2, blue);
  usStar(g, 0.6, 4.4, -0.15, 0.4, 'y', 1, false);
  usStar(g, 0.55, 0.76, 0, 2.3, 'x', 1, false);
  usStar(g, 0.55, -0.76, 0, 2.3, 'x', -1, false);
  const p = prop(g, 3, 1.8, 0, 0, -5.9, 0x2a2a2a);
  return { props: [p], tips: [new THREE.Vector3(-6.3, -0.4, 0.2), new THREE.Vector3(6.3, -0.4, 0.2)] };
}

/** Avro Lancaster (Reino Unido): bombardero de 4 motores, doble deriva oval y panza negra */
function lancaster(g: THREE.Group): WarbirdParts {
  const top = M(0x4a4a30);
  const black = M(0x1a1a1a);
  tube(g, 0.95, 0.55, 15, 0, 0, 0.5, top);
  box(g, 1.7, 0.9, 14, 0, -0.55, 0.5, black);
  box(g, 1.1, 0.8, 2.2, 0, 1.0, -4.6, M(0x8ab8d0));
  tube(g, 0.75, 0.95, 1.6, 0, 0, -7.6, M(0x8ab8d0));
  plate(g, taperWing(10.5, 3.6, 1.6, -2.0, 0.4), 0.3, 0.1, top);
  plate(g, [[0.2, 6.6], [3.6, 6.9], [3.6, 7.7], [0.2, 8.0]], 0.2, 0.3, top);
  for (const s of [-1, 1]) {
    fin(g, [[6.4, -1.5], [6.0, 1.6], [7.6, 1.8], [8.0, -1.5]], 0.18, s * 3.6, 0.4, black);
  }
  const props: THREE.Object3D[] = [];
  for (const x of [-6.4, -3.2, 3.2, 6.4]) {
    tube(g, 0.55, 0.45, 3.4, x, 0.05, -2.6, black);
    props.push(prop(g, 3, 1.6, x, 0.05, -4.5, 0x1a1a1a));
  }
  roundel(g, RAF_TOP, 1.0, 6.0, 0.45, -1.0, 'y');
  roundel(g, RAF_TOP, 1.0, -6.0, 0.45, -1.0, 'y');
  roundel(g, RAF_OUTER, 0.75, 0.96, 0.2, 3.2, 'x', 1);
  roundel(g, RAF_OUTER, 0.75, -0.96, 0.2, 3.2, 'x', -1);
  return { props, tips: [new THREE.Vector3(-10.5, 0.1, -1.4), new THREE.Vector3(10.5, 0.1, -1.4)] };
}

/** Douglas C-47 Skytrain (EE. UU.): transporte bimotor, fuselaje redondo y franjas de invasión */
function skytrain(g: THREE.Group): WarbirdParts {
  const olive = M(0x5a5c3a);
  const grey = M(0x9a9c94);
  tube(g, 1.1, 0.5, 14, 0, 0, 0.6, olive);
  tube(g, 0.6, 1.1, 2.2, 0, -0.1, -7.6, olive);
  box(g, 1.6, 0.5, 1.2, 0, 0.6, -6.7, M(0x8ab8d0));
  for (let i = 0; i < 5; i++) {
    box(g, 0.06, 0.4, 0.5, 1.1, 0.3, -3.5 + i * 1.6, M(0x8ab8d0));
    box(g, 0.06, 0.4, 0.5, -1.1, 0.3, -3.5 + i * 1.6, M(0x8ab8d0));
  }
  plate(g, taperWing(9.6, 3.6, 1.3, -2.2, 1.0), 0.28, -0.55, olive);
  box(g, 3.2, 0.3, 14, 0, -0.95, 0.6, grey);
  // franjas de invasión en las alas y la cola
  for (const [x, c] of [[4.4, 0xf4f4f4], [4.9, 0x141414], [5.4, 0xf4f4f4], [5.9, 0x141414], [6.4, 0xf4f4f4]] as [number, number][]) {
    box(g, 0.5, 0.32, 3.0, x, -0.55, -1.4, B(c));
    box(g, 0.5, 0.32, 3.0, -x, -0.55, -1.4, B(c));
  }
  plate(g, [[0.2, 6.2], [3.6, 6.5], [3.6, 7.3], [0.2, 7.6]], 0.2, 0.2, olive);
  fin(g, [[5.8, 0.6], [6.8, 3.2], [7.8, 3.3], [7.9, 0.6]], 0.18, 0, 0.3, olive);
  const props: THREE.Object3D[] = [];
  for (const x of [-3.0, 3.0]) {
    tube(g, 0.85, 0.7, 3.4, x, -0.45, -3.0, olive);
    props.push(prop(g, 3, 1.9, x, -0.45, -4.9, 0x2a2a2a));
  }
  usStar(g, 0.9, 6.5, -0.38, -1.6, 'y');
  usStar(g, 0.8, 1.12, 0, 3.2, 'x', 1);
  usStar(g, 0.8, -1.12, 0, 3.2, 'x', -1);
  return { props, tips: [new THREE.Vector3(-9.6, -0.5, -1.4), new THREE.Vector3(9.6, -0.5, -1.4)] };
}

/** de Havilland Mosquito (Reino Unido): bimotor rápido «de madera» */
function mosquito(g: THREE.Group): WarbirdParts {
  const green = M(0x4a5a3a);
  const grey = M(0x8a8a80);
  tube(g, 0.75, 0.35, 11, 0, 0, 0.8, green);
  tube(g, 0.35, 0.75, 1.6, 0, 0, -5.4, green);
  box(g, 1.1, 0.7, 2.0, 0, 0.75, -3.4, M(0x8ab8d0));
  plate(g, taperWing(7.8, 3.0, 1.2, -1.2, 0.6), 0.24, -0.1, green);
  plate(g, [[0.2, 5.0], [2.6, 5.3], [2.6, 5.9], [0.2, 6.2]], 0.16, 0.2, green);
  fin(g, [[4.8, 0.45], [5.6, 2.3], [6.4, 2.4], [6.5, 0.45]], 0.16, 0, 0.2, green);
  box(g, 1.3, 0.3, 9, 0, -0.55, 0.8, grey);
  const props: THREE.Object3D[] = [];
  for (const x of [-2.4, 2.4]) {
    tube(g, 0.55, 0.45, 4.6, x, -0.1, -1.6, green);
    props.push(prop(g, 3, 1.6, x, -0.1, -4.1, 0x2a2a2a));
  }
  roundel(g, RAF_TOP, 0.8, 5.2, 0.15, -0.6, 'y');
  roundel(g, RAF_TOP, 0.8, -5.2, 0.15, -0.6, 'y');
  roundel(g, RAF_OUTER, 0.6, 0.76, 0, 2.6, 'x', 1);
  roundel(g, RAF_OUTER, 0.6, -0.76, 0, 2.6, 'x', -1);
  return { props, tips: [new THREE.Vector3(-7.8, -0.1, -0.6), new THREE.Vector3(7.8, -0.1, -0.6)] };
}

/** Heinkel He 111 (Alemania): bombardero bimotor con morro acristalado */
function he111(g: THREE.Group): WarbirdParts {
  const grey = M(0x5a6258);
  tube(g, 1.0, 0.5, 14, 0, 0, 0.6, grey);
  tube(g, 0.3, 1.0, 2.2, 0, 0, -7.4, M(0x9ac0d4));
  plate(g, taperWing(10, 3.8, 1.4, -1.6, 0.8), 0.3, -0.3, grey);
  plate(g, [[0.2, 6.2], [3.4, 6.5], [3.2, 7.4], [0.2, 7.6]], 0.2, 0.2, grey);
  fin(g, [[6.0, 0.6], [6.8, 2.8], [7.7, 2.9], [7.8, 0.6]], 0.18, 0, 0.3, grey);
  const props: THREE.Object3D[] = [];
  for (const x of [-3.2, 3.2]) {
    tube(g, 0.75, 0.6, 3.6, x, -0.2, -2.6, grey);
    props.push(prop(g, 3, 1.8, x, -0.2, -4.6, 0xe0b020));
  }
  cross(g, 0.7, 6.4, 0.0, -1.2, 'y');
  cross(g, 0.7, -6.4, 0.0, -1.2, 'y');
  cross(g, 0.6, 1.0, 0, 3.4, 'x', 1);
  cross(g, 0.6, -1.0, 0, 3.4, 'x', -1);
  return { props, tips: [new THREE.Vector3(-10, -0.3, -0.8), new THREE.Vector3(10, -0.3, -0.8)] };
}

/** Boeing B-17 Flying Fortress (EE. UU.): cuatro motores, deriva grande, aluminio */
function b17(g: THREE.Group): WarbirdParts {
  const metal = M(0xb4b8bc);
  const olive = M(0x5a5e3a);
  tube(g, 1.0, 0.5, 15, 0, 0, 0.5, olive);
  tube(g, 0.45, 1.0, 2, 0, 0, -7.9, M(0x9ac0d4));
  box(g, 1.1, 0.7, 1.6, 0, 1.05, -4.6, M(0x8ab8d0));
  plate(g, taperWing(10.8, 4.0, 1.5, -1.8, 0.9), 0.3, -0.2, olive);
  plate(g, [[0.2, 5.8], [3.8, 6.4], [3.8, 7.3], [0.2, 7.8]], 0.2, 0.2, olive);
  fin(g, [[3.8, 0.8], [6.6, 4.2], [7.8, 4.3], [8.0, 0.8]], 0.2, 0, 0.3, olive);
  box(g, 2.2, 0.3, 14, 0, -0.9, 0.5, metal);
  const props: THREE.Object3D[] = [];
  for (const x of [-6.6, -3.3, 3.3, 6.6]) {
    tube(g, 0.62, 0.5, 3.2, x, -0.1, -2.6, olive);
    props.push(prop(g, 3, 1.6, x, -0.1, -4.4, 0x2a2a2a));
  }
  usStar(g, 0.95, 6.5, 0.15, -0.6, 'y');
  usStar(g, 0.85, 1.02, 0, 3.4, 'x', 1);
  usStar(g, 0.85, -1.02, 0, 3.4, 'x', -1);
  return { props, tips: [new THREE.Vector3(-10.8, -0.2, -0.6), new THREE.Vector3(10.8, -0.2, -0.6)] };
}
