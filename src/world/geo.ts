/**
 * Geografía del mundo abierto.
 * Proyección azimutal equidistante centrada en un origen: las distancias desde el origen son
 * exactas y la deformación es pequeña (≈1 % a 1.000 km, ≈3 % a 2.500 km). Mundo del juego:
 * x = este, z = sur, en metros reales.
 */
export const EARTH_R = 6371008.8;
const D2R = Math.PI / 180;

export class Geo {
  private sinP0: number;
  private cosP0: number;

  constructor(
    readonly lat0: number,
    readonly lon0: number,
  ) {
    this.sinP0 = Math.sin(lat0 * D2R);
    this.cosP0 = Math.cos(lat0 * D2R);
  }

  /** Latitud/longitud -> (x, z) del mundo */
  toWorld(lat: number, lon: number): [number, number] {
    const p = lat * D2R;
    const dl = (lon - this.lon0) * D2R;
    const sp = Math.sin(p);
    const cp = Math.cos(p);
    const cdl = Math.cos(dl);
    const cc = Math.max(-1, Math.min(1, this.sinP0 * sp + this.cosP0 * cp * cdl));
    const c = Math.acos(cc);
    const k = c < 1e-9 ? 1 : c / Math.sin(c);
    const x = EARTH_R * k * cp * Math.sin(dl);
    const y = EARTH_R * k * (this.cosP0 * sp - this.sinP0 * cp * cdl);
    return [x, -y];
  }

  /** (x, z) del mundo -> latitud/longitud */
  toLatLon(x: number, z: number): [number, number] {
    const y = -z;
    const rho = Math.hypot(x, y);
    if (rho < 1e-6) return [this.lat0, this.lon0];
    const c = rho / EARTH_R;
    const sc = Math.sin(c);
    const cc = Math.cos(c);
    const lat = Math.asin(cc * this.sinP0 + (y * sc * this.cosP0) / rho);
    const lon = this.lon0 * D2R + Math.atan2(x * sc, rho * this.cosP0 * cc - y * this.sinP0 * sc);
    return [lat / D2R, lon / D2R];
  }
}

/** Distancia (m) entre dos puntos del globo */
export function greatCircle(lat1: number, lon1: number, lat2: number, lon2: number) {
  const a = Math.sin(((lat2 - lat1) * D2R) / 2) ** 2 + Math.cos(lat1 * D2R) * Math.cos(lat2 * D2R) * Math.sin(((lon2 - lon1) * D2R) / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(a)));
}

// ---------------------------------------------------------------- Teselas (Web Mercator)
export function lon2tile(lon: number, z: number) {
  return ((lon + 180) / 360) * 2 ** z;
}
export function lat2tile(lat: number, z: number) {
  const r = lat * D2R;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
}
export function tile2lon(x: number, z: number) {
  return (x / 2 ** z) * 360 - 180;
}
export function tile2lat(y: number, z: number) {
  const n = Math.PI * (1 - (2 * y) / 2 ** z);
  return Math.atan(Math.sinh(n)) / D2R;
}
