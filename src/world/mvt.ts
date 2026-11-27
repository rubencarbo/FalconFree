/**
 * Lector mínimo de teselas vectoriales (Mapbox Vector Tile, protobuf), sin dependencias.
 * Solo lo que usa el mundo abierto: capas, propiedades, tipo y geometría.
 */
export interface Point {
  x: number;
  y: number;
}

export interface MvtFeature {
  /** 1 punto · 2 línea · 3 polígono */
  type: number;
  properties: Record<string, unknown>;
  loadGeometry(): Point[][];
}

export interface MvtLayer {
  name: string;
  extent: number;
  length: number;
  feature(i: number): MvtFeature;
}

class Reader {
  pos = 0;
  constructor(
    readonly buf: Uint8Array,
    readonly end = buf.length,
  ) {}

  varint(): number {
    let r = 0;
    let mul = 1;
    let b: number;
    do {
      b = this.buf[this.pos++];
      r += (b & 0x7f) * mul;
      mul *= 128;
    } while (b & 0x80);
    return r;
  }

  svarint() {
    const n = this.varint();
    return n % 2 === 1 ? (n + 1) / -2 : n / 2;
  }

  bytes(): Uint8Array {
    const len = this.varint();
    const s = this.buf.subarray(this.pos, this.pos + len);
    this.pos += len;
    return s;
  }

  skip(wire: number) {
    if (wire === 0) this.varint();
    else if (wire === 1) this.pos += 8;
    else if (wire === 2) this.pos += this.varint();
    else if (wire === 5) this.pos += 4;
    else throw new Error(`protobuf: tipo ${wire}`);
  }
}

const dec = new TextDecoder();

function readValue(b: Uint8Array): unknown {
  const r = new Reader(b);
  let v: unknown = null;
  while (r.pos < r.end) {
    const tag = r.varint();
    const f = tag >> 3;
    const w = tag & 7;
    if (f === 1) v = dec.decode(r.bytes());
    else if (f === 2) {
      v = new DataView(b.buffer, b.byteOffset + r.pos, 4).getFloat32(0, true);
      r.pos += 4;
    } else if (f === 3) {
      v = new DataView(b.buffer, b.byteOffset + r.pos, 8).getFloat64(0, true);
      r.pos += 8;
    } else if (f === 4 || f === 5) v = r.varint();
    else if (f === 6) v = r.svarint();
    else if (f === 7) v = r.varint() === 1;
    else r.skip(w);
  }
  return v;
}

function packed(b: Uint8Array): number[] {
  const r = new Reader(b);
  const out: number[] = [];
  while (r.pos < r.end) out.push(r.varint());
  return out;
}

function parseLayer(b: Uint8Array): MvtLayer {
  const r = new Reader(b);
  let name = '';
  let extent = 4096;
  const feats: Uint8Array[] = [];
  const keys: string[] = [];
  const values: unknown[] = [];
  while (r.pos < r.end) {
    const tag = r.varint();
    const f = tag >> 3;
    const w = tag & 7;
    if (f === 1) name = dec.decode(r.bytes());
    else if (f === 2) feats.push(r.bytes());
    else if (f === 3) keys.push(dec.decode(r.bytes()));
    else if (f === 4) values.push(readValue(r.bytes()));
    else if (f === 5) extent = r.varint();
    else r.skip(w);
  }
  return {
    name,
    extent,
    length: feats.length,
    feature(i: number): MvtFeature {
      const fr = new Reader(feats[i]);
      let type = 0;
      let tags: number[] = [];
      let geom: number[] = [];
      while (fr.pos < fr.end) {
        const tag = fr.varint();
        const f2 = tag >> 3;
        const w2 = tag & 7;
        if (f2 === 2) tags = packed(fr.bytes());
        else if (f2 === 3) type = fr.varint();
        else if (f2 === 4) geom = packed(fr.bytes());
        else fr.skip(w2);
      }
      const properties: Record<string, unknown> = {};
      for (let k = 0; k + 1 < tags.length; k += 2) properties[keys[tags[k]]] = values[tags[k + 1]];
      return {
        type,
        properties,
        loadGeometry() {
          const rings: Point[][] = [];
          let ring: Point[] | null = null;
          let x = 0;
          let y = 0;
          let n = 0;
          while (n < geom.length) {
            const c = geom[n++];
            const cmd = c & 7;
            const count = c >> 3;
            if (cmd === 7) {
              if (ring && ring.length) ring.push({ x: ring[0].x, y: ring[0].y });
              continue;
            }
            for (let k = 0; k < count; k++) {
              const v1 = geom[n++];
              const v2 = geom[n++];
              x += v1 % 2 === 1 ? (v1 + 1) / -2 : v1 / 2;
              y += v2 % 2 === 1 ? (v2 + 1) / -2 : v2 / 2;
              if (cmd === 1) {
                if (ring) rings.push(ring);
                ring = [];
              }
              ring!.push({ x, y });
            }
          }
          if (ring) rings.push(ring);
          return rings;
        },
      };
    },
  };
}

/** Tesela vectorial: capas por nombre */
export class VectorTile {
  layers: Record<string, MvtLayer> = {};
  constructor(buf: Uint8Array) {
    const r = new Reader(buf);
    while (r.pos < r.end) {
      const tag = r.varint();
      if (tag >> 3 === 3) {
        const l = parseLayer(r.bytes());
        this.layers[l.name] = l;
      } else r.skip(tag & 7);
    }
  }
}

function signedArea(ring: Point[]) {
  let s = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) s += (ring[i].x - ring[j].x) * (ring[j].y + ring[i].y);
  return s;
}

/** Agrupa los anillos de un polígono: exterior seguido de sus huecos */
export function classifyRings(rings: Point[][]): Point[][][] {
  if (rings.length <= 1) return [rings];
  const polys: Point[][][] = [];
  let poly: Point[][] | null = null;
  let ccw: boolean | undefined;
  for (const r of rings) {
    const a = signedArea(r);
    if (a === 0) continue;
    if (ccw === undefined) ccw = a < 0;
    if (ccw === a < 0) {
      if (poly) polys.push(poly);
      poly = [r];
    } else poly?.push(r);
  }
  if (poly) polys.push(poly);
  return polys;
}
