import * as THREE from 'three';
import TileWorker from './tilework?worker&inline';
import { Geo, lat2tile, lon2tile, tile2lat, tile2lon } from './geo';
import { RC, type RealRect, type RealSource } from './real';
import { CELL_C, CELL_E, COARSE_N, COARSE_TEX, COARSE_Z, NC, NE, REGION, type Diag, type WorkOut } from './streamconst';

const PERIOD = 80;
const bkey = (bx: number, bz: number) => (bx + 32768) * 65536 + (bz + 32768);

interface Region {
  rx: number;
  rz: number;
  elev: Float32Array;
  cls: Uint8Array;
  byBlock: Map<number, RealRect[]>;
}

interface CoarseTile {
  x: number;
  y: number;
  mesh: THREE.Mesh;
  raw: Float32Array;
}

/**
 * Mundo abierto: datos reales de todo el planeta que se descargan mientras se vuela.
 * Cerca del avión, «regiones» de 1920 m con detalle (calles, edificios); a lo lejos, teselas
 * z10 (~30 km) con relieve y colores. Todo se prepara en un worker.
 */
export class StreamWorld implements RealSource {
  readonly geo: Geo;
  readonly bounded = null;
  readonly seaOutside = false;
  private regions = new Map<string, Region>();
  private loadingR = new Set<string>();
  private retryR = new Map<string, number>();
  private coarse = new Map<string, CoarseTile>();
  private loadingC = new Set<string>();
  private retryC = new Map<string, number>();
  private worker: Worker;
  private group = new THREE.Group();
  /** se llama cuando llegan los datos de una zona (x0, z0, x1, z1) */
  onRegion?: (x0: number, z0: number, x1: number, z1: number) => void;
  /** cargar detalle alrededor del avión (se apaga en crucero) */
  detail = true;
  /** radio (m) de las regiones con detalle */
  detailRadius = 2600;
  lastError = '';
  /** descargas correctas y fallidas (OpenFreeMap y relieve) */
  diag: Diag = { osmOk: 0, osmFail: 0, demOk: 0, demFail: 0, err: '', regionMs: 0 };
  /** regiones y teselas lejanas cargadas (para el marcador) */
  get stats() {
    return { regions: this.regions.size, coarse: this.coarse.size, loading: this.loadingR.size + this.loadingC.size };
  }

  constructor(
    private scene: THREE.Scene,
    lat0: number,
    lon0: number,
  ) {
    this.geo = new Geo(lat0, lon0);
    this.worker = new TileWorker();
    this.worker.onmessage = (ev: MessageEvent<WorkOut>) => this.receive(ev.data);
    this.worker.postMessage({ type: 'init', lat0, lon0 });
    this.scene.add(this.group);
  }

  // ------------------------------------------------------------ RealSource
  private regionAt(x: number, z: number) {
    return this.regions.get(`${Math.floor(x / REGION)},${Math.floor(z / REGION)}`);
  }

  ready(x: number, z: number) {
    return !!this.regionAt(x, z);
  }

  ground(x: number, z: number): number {
    const r = this.regionAt(x, z);
    if (!r) return this.coarseGround(x, z);
    const fx = Math.min(NE - 1.0001, (x - r.rx * REGION) / CELL_E);
    const fz = Math.min(NE - 1.0001, (z - r.rz * REGION) / CELL_E);
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const ax = fx - i;
    const az = fz - j;
    const e = r.elev;
    return (e[j * NE + i] * (1 - ax) + e[j * NE + i + 1] * ax) * (1 - az) + (e[(j + 1) * NE + i] * (1 - ax) + e[(j + 1) * NE + i + 1] * ax) * az;
  }

  /** Altura aproximada con las teselas lejanas (mientras no hay detalle) */
  coarseGround(x: number, z: number): number {
    const [lat, lon] = this.geo.toLatLon(x, z);
    const tx = lon2tile(lon, COARSE_Z);
    const ty = lat2tile(lat, COARSE_Z);
    const t = this.coarse.get(`${Math.floor(tx)},${Math.floor(ty)}`);
    if (!t) return 0;
    const N = COARSE_N;
    const fx = (tx - t.x) * (N - 1);
    const fy = (ty - t.y) * (N - 1);
    const i = Math.min(N - 2, Math.floor(fx));
    const j = Math.min(N - 2, Math.floor(fy));
    const ax = fx - i;
    const ay = fy - j;
    const a = t.raw;
    return (a[j * N + i] * (1 - ax) + a[j * N + i + 1] * ax) * (1 - ay) + (a[(j + 1) * N + i] * (1 - ax) + a[(j + 1) * N + i + 1] * ax) * ay;
  }

  clsAt(x: number, z: number): number {
    const r = this.regionAt(x, z);
    if (!r) return RC.OUT;
    const i = Math.min(NC - 1, Math.floor((x - r.rx * REGION) / CELL_C));
    const j = Math.min(NC - 1, Math.floor((z - r.rz * REGION) / CELL_C));
    return r.cls[j * NC + i];
  }

  rectsIn(bx: number, bz: number): RealRect[] {
    const r = this.regionAt((bx + 0.5) * PERIOD, (bz + 0.5) * PERIOD);
    return r?.byBlock.get(bkey(bx, bz)) ?? [];
  }

  treesIn(): [number, number][] {
    return [];
  }

  toWorld(lat: number, lon: number) {
    return this.geo.toWorld(lat, lon);
  }

  outside() {
    return 0;
  }

  // ------------------------------------------------------------ Carga
  /** Pide los datos que faltan alrededor de (x, z) y suelta los lejanos */
  update(x: number, z: number, now: number) {
    // Regiones con detalle
    if (this.detail) {
      const R = this.detailRadius;
      const want: { k: string; rx: number; rz: number; d: number }[] = [];
      for (let rx = Math.floor((x - R) / REGION); rx <= Math.floor((x + R) / REGION); rx++)
        for (let rz = Math.floor((z - R) / REGION); rz <= Math.floor((z + R) / REGION); rz++) {
          const k = `${rx},${rz}`;
          if (this.regions.has(k) || this.loadingR.has(k) || (this.retryR.get(k) ?? 0) > now) continue;
          const d = Math.hypot((rx + 0.5) * REGION - x, (rz + 0.5) * REGION - z);
          if (d < R + REGION * 0.71) want.push({ k, rx, rz, d });
        }
      want.sort((a, b) => a.d - b.d);
      for (const w of want) {
        if (this.loadingR.size >= 2) break;
        this.loadingR.add(w.k);
        this.worker.postMessage({ type: 'region', rx: w.rx, rz: w.rz });
      }
    }
    for (const [k, r] of this.regions) {
      if (Math.hypot((r.rx + 0.5) * REGION - x, (r.rz + 0.5) * REGION - z) > 9000) this.regions.delete(k);
    }
    // Teselas lejanas
    const [lat, lon] = this.geo.toLatLon(x, z);
    const cx = Math.floor(lon2tile(lon, COARSE_Z));
    const cy = Math.floor(lat2tile(lat, COARSE_Z));
    const wantC: { k: string; tx: number; ty: number; d: number }[] = [];
    for (let i = -2; i <= 2; i++)
      for (let j = -2; j <= 2; j++) {
        const tx = cx + i;
        const ty = cy + j;
        const k = `${tx},${ty}`;
        if (this.coarse.has(k) || this.loadingC.has(k) || (this.retryC.get(k) ?? 0) > now) continue;
        wantC.push({ k, tx, ty, d: Math.hypot(i, j) });
      }
    wantC.sort((a, b) => a.d - b.d);
    for (const w of wantC) {
      if (this.loadingC.size >= 3) break;
      this.loadingC.add(w.k);
      this.worker.postMessage({ type: 'coarse', x: w.tx, y: w.ty });
    }
    for (const [k, t] of this.coarse) {
      if (Math.abs(t.x - cx) > 3 || Math.abs(t.y - cy) > 3) {
        this.group.remove(t.mesh);
        t.mesh.geometry.dispose();
        const m = t.mesh.material as THREE.MeshLambertMaterial;
        m.map?.dispose();
        m.dispose();
        this.coarse.delete(k);
      }
    }
  }

  private receive(msg: WorkOut) {
    const now = performance.now();
    if (msg.diag) this.diag = msg.diag;
    if (msg.type === 'region') {
      const k = `${msg.rx},${msg.rz}`;
      this.loadingR.delete(k);
      if (msg.error) {
        this.lastError = msg.error;
        this.retryR.set(k, now + 8000);
        return;
      }
      const byBlock = new Map<number, RealRect[]>();
      const a = msg.rects;
      for (let n = 0; n < a.length; n += 8) {
        const r: RealRect = { x0: a[n], z0: a[n + 1], x1: a[n + 2], z1: a[n + 3], h: a[n + 4], minH: a[n + 5], style: a[n + 6], seed: a[n + 7] };
        const bk = bkey(Math.floor((r.x0 + 0.01) / PERIOD), Math.floor((r.z0 + 0.01) / PERIOD));
        let l = byBlock.get(bk);
        if (!l) byBlock.set(bk, (l = []));
        l.push(r);
      }
      this.regions.set(k, { rx: msg.rx, rz: msg.rz, elev: msg.elev, cls: msg.cls, byBlock });
      this.onRegion?.(msg.rx * REGION, msg.rz * REGION, (msg.rx + 1) * REGION, (msg.rz + 1) * REGION);
    } else {
      const k = `${msg.x},${msg.y}`;
      this.loadingC.delete(k);
      if (msg.error) {
        this.lastError = msg.error;
        this.retryC.set(k, now + 8000);
        return;
      }
      const mesh = this.coarseMesh(msg.x, msg.y, msg.low, msg.rgba);
      this.group.add(mesh);
      this.coarse.set(k, { x: msg.x, y: msg.y, mesh, raw: msg.raw });
    }
  }

  /** Malla de una tesela lejana: 65×65 vértices con faldón para tapar las juntas */
  private coarseMesh(tx: number, ty: number, low: Float32Array, rgba: Uint8ClampedArray) {
    const N = COARSE_N;
    const [ccx, ccz] = this.geo.toWorld(tile2lat(ty + 0.5, COARSE_Z), tile2lon(tx + 0.5, COARSE_Z));
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    const vert = (i: number, j: number, dy: number) => {
      const lon = tile2lon(tx + i / (N - 1), COARSE_Z);
      const lat = tile2lat(ty + j / (N - 1), COARSE_Z);
      const [wx, wz] = this.geo.toWorld(lat, lon);
      pos.push(wx - ccx, low[j * N + i] + dy, wz - ccz);
      uv.push(i / (N - 1), j / (N - 1));
      return pos.length / 3 - 1;
    };
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) vert(i, j, 0);
    for (let j = 0; j < N - 1; j++)
      for (let i = 0; i < N - 1; i++) {
        const a = j * N + i;
        idx.push(a, a + N, a + 1, a + 1, a + N, a + N + 1);
      }
    // Faldón: cada borde baja 500 m
    const edge = (list: [number, number][]) => {
      for (let n = 0; n + 1 < list.length; n++) {
        const [i0, j0] = list[n];
        const [i1, j1] = list[n + 1];
        const a = j0 * N + i0;
        const b = j1 * N + i1;
        const a2 = vert(i0, j0, -500);
        const b2 = vert(i1, j1, -500);
        idx.push(a, a2, b, b, a2, b2, a, b, a2, b, b2, a2);
      }
    };
    const top: [number, number][] = [];
    const bottom: [number, number][] = [];
    const left: [number, number][] = [];
    const right: [number, number][] = [];
    for (let n = 0; n < N; n++) {
      top.push([n, 0]);
      bottom.push([n, N - 1]);
      left.push([0, n]);
      right.push([N - 1, n]);
    }
    edge(top);
    edge(bottom);
    edge(left);
    edge(right);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    // Normales solo con la malla principal (los faldones darían normales nulas → NaN en la luz)
    geo.setIndex(idx.slice(0, (N - 1) * (N - 1) * 6));
    geo.computeVertexNormals();
    const nrm = geo.attributes.normal as THREE.BufferAttribute;
    for (let k = N * N; k < nrm.count; k++) nrm.setXYZ(k, 0, 1, 0);
    geo.setIndex(idx);
    const tex = new THREE.DataTexture(new Uint8Array(rgba.buffer, rgba.byteOffset, rgba.byteLength), COARSE_TEX, COARSE_TEX, THREE.RGBAFormat);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.needsUpdate = true;
    const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: tex }));
    mesh.position.set(ccx, 0, ccz);
    return mesh;
  }

  dispose() {
    this.worker.terminate();
    for (const t of this.coarse.values()) {
      t.mesh.geometry.dispose();
      const m = t.mesh.material as THREE.MeshLambertMaterial;
      m.map?.dispose();
      m.dispose();
    }
    this.coarse.clear();
    this.regions.clear();
    this.scene.remove(this.group);
  }
}
