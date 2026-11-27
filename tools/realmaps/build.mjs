// Genera los mapas del modo «Mundo real» a partir de datos abiertos:
//  - Relieve: teselas «Terrarium» de AWS (Mapzen / Tilezen, dominio público y licencias abiertas)
//  - Edificios, calles, agua, parques: OpenStreetMap vía Overpass (© colaboradores de OpenStreetMap, ODbL)
// Uso: node tools/realmaps/build.mjs [id ...]
// Salida: public/real/<id>.dat (binario comprimido con gzip, lo lee src/world/real.ts)
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { VectorTile, classifyRings } from '@mapbox/vector-tile';
import Pbf from 'pbf';
import { MAPS } from './maps.mjs';

const CACHE = 'tools/realmaps/cache';
const OUT = 'public/real';
mkdirSync(CACHE, { recursive: true });
mkdirSync(OUT, { recursive: true });

// Clases de suelo (deben coincidir con src/world/real.ts)
const C = {
  URBAN: 0, WATER: 1, PARK: 2, FOREST: 3, SAND: 4, ROAD: 5, ROAD_BIG: 6, PATH: 7, RAIL: 8, PITCH: 9,
  PLAZA: 10, PARKING: 11, FIELD: 12, ROCK: 13, GLACIER: 14, SCRUB: 15, INDUSTRIAL: 16, CEMETERY: 17, SEA: 18,
};
// Estilos de edificio (S_* de src/world/city.ts)
const S = { OFFICE: 0, GLASS: 1, RESID: 2, INDUST: 3, HOUSE: 5, DECO: 6 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchRetry(url, opts = {}, tries = 5) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, opts);
      if (r.ok) return r;
      console.warn(`  ${r.status} ${url.slice(0, 80)}`);
      if (r.status === 400) throw new Error(await r.text());
    } catch (e) {
      console.warn(`  error ${e.message?.slice(0, 120)}`);
    }
    await sleep(3000 * (i + 1));
  }
  throw new Error(`No se pudo descargar ${url}`);
}

// ------------------------------------------------------------ Proyección
function projector(m, rotRad) {
  const [lat0, lon0] = m.center;
  const kx = Math.cos((lat0 * Math.PI) / 180) * 111320;
  const ky = 110574;
  const c = Math.cos(rotRad), s = Math.sin(rotRad);
  // lat/lon -> mundo (x este girado, z sur girado), en metros del juego
  const toWorld = (lat, lon) => {
    const e = (lon - lon0) * kx;
    const n = (lat - lat0) * ky;
    const u = e * c - n * s;
    const v = e * s + n * c;
    return [u * m.scale, -v * m.scale];
  };
  const toLatLon = (x, z) => {
    const u = x / m.scale, v = -z / m.scale;
    const e = u * c + v * s;
    const n = -u * s + v * c;
    return [lat0 + n / ky, lon0 + e / kx];
  };
  return { toWorld, toLatLon };
}

function bboxLatLon(m, proj) {
  const W = (m.size[0] * m.scale) / 2, H = (m.size[1] * m.scale) / 2;
  let s = 90, n = -90, w = 180, e = -180;
  for (const [x, z] of [[-W, -H], [W, -H], [W, H], [-W, H]]) {
    const [la, lo] = proj.toLatLon(x, z);
    s = Math.min(s, la); n = Math.max(n, la); w = Math.min(w, lo); e = Math.max(e, lo);
  }
  return { s, n, w, e };
}

// ------------------------------------------------------------ Relieve (Terrarium)
function lon2tile(lon, z) { return ((lon + 180) / 360) * 2 ** z; }
function lat2tile(lat, z) {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
}

async function elevationSampler(bb, z) {
  const x0 = Math.floor(lon2tile(bb.w, z)), x1 = Math.floor(lon2tile(bb.e, z));
  const y0 = Math.floor(lat2tile(bb.n, z)), y1 = Math.floor(lat2tile(bb.s, z));
  const tiles = new Map();
  for (let tx = x0; tx <= x1; tx++) {
    for (let ty = y0; ty <= y1; ty++) {
      const f = join(CACHE, `t_${z}_${tx}_${ty}.png`);
      if (!existsSync(f)) {
        const r = await fetchRetry(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${tx}/${ty}.png`);
        writeFileSync(f, Buffer.from(await r.arrayBuffer()));
      }
      const png = PNG.sync.read(readFileSync(f));
      const el = new Float32Array(256 * 256);
      for (let i = 0; i < 256 * 256; i++) {
        const o = i * 4;
        el[i] = png.data[o] * 256 + png.data[o + 1] + png.data[o + 2] / 256 - 32768;
      }
      tiles.set(`${tx},${ty}`, el);
    }
  }
  console.log(`  relieve: ${tiles.size} teselas z${z}`);
  const px = (tx, ty) => {
    const ix = Math.floor(tx), iy = Math.floor(ty);
    const t = tiles.get(`${ix},${iy}`);
    if (!t) return 0;
    const u = Math.min(255, Math.max(0, Math.floor((tx - ix) * 256)));
    const v = Math.min(255, Math.max(0, Math.floor((ty - iy) * 256)));
    return t[v * 256 + u];
  };
  // Muestreo bilineal en píxeles de tesela
  return (lat, lon) => {
    const fx = lon2tile(lon, z) * 256 - 0.5, fy = lat2tile(lat, z) * 256 - 0.5;
    const ix = Math.floor(fx), iy = Math.floor(fy);
    const ax = fx - ix, ay = fy - iy;
    const g = (x, y) => px(x / 256, y / 256);
    return (g(ix, iy) * (1 - ax) + g(ix + 1, iy) * ax) * (1 - ay) + (g(ix, iy + 1) * (1 - ax) + g(ix + 1, iy + 1) * ax) * ay;
  };
}

// ------------------------------------------------------------ OpenStreetMap (Overpass)
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];

async function overpass(m, bb, everest) {
  const f = join(CACHE, `osm_${m.id}.json`);
  if (existsSync(f)) return JSON.parse(readFileSync(f, 'utf8'));
  if (process.env.NO_OSM) return [];
  // Teselas de ~0.035° para no saturar el servidor
  const step = 0.035;
  const all = new Map();
  const parts = [];
  for (let la = bb.s; la < bb.n; la += step) for (let lo = bb.w; lo < bb.e; lo += step) parts.push([la, lo, Math.min(bb.n, la + step), Math.min(bb.e, lo + step)]);
  let k = 0;
  for (const [s, w, n, e] of parts) {
    const b = `${s.toFixed(5)},${w.toFixed(5)},${n.toFixed(5)},${e.toFixed(5)}`;
    const q = everest
      ? `[out:json][timeout:180];(way["natural"~"glacier|water|bare_rock|scree"](${b});relation["natural"~"glacier|water"](${b});way["waterway"~"river|stream"](${b});way["highway"~"path|track"](${b});node["tourism"~"camp_site|alpine_hut"](${b});way["building"](${b}););out geom;`
      : `[out:json][timeout:180];(
          way["building"](${b});way["building:part"](${b});relation["building"](${b});
          way["landuse"](${b});relation["landuse"](${b});
          way["leisure"~"park|garden|pitch|stadium|track|playground|golf_course|nature_reserve"](${b});relation["leisure"~"park|garden|nature_reserve"](${b});
          way["natural"~"water|wood|scrub|beach|sand|grassland|bare_rock|heath"](${b});relation["natural"~"water|wood|beach|scrub"](${b});
          way["waterway"~"riverbank|river|canal|dock"](${b});relation["waterway"="riverbank"](${b});
          way["highway"](${b});way["railway"~"rail|light_rail|tram|subway|narrow_gauge"](${b});
          way["amenity"="parking"](${b});way["place"="square"](${b});way["man_made"~"pier|breakwater"](${b});
          node["natural"="tree"](${b});
        );out geom;`;
    let done = false;
    for (let t = 0; t < 6 && !done; t++) {
      const url = OVERPASS[t % OVERPASS.length];
      try {
        const r = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'falconsky-realmaps/1.0' } });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = await r.json();
        for (const el of j.elements) all.set(`${el.type}${el.id}`, el);
        done = true;
      } catch (e) {
        console.warn(`  overpass ${e.message}, reintento`);
        await sleep(8000 * (t + 1));
      }
    }
    if (!done) throw new Error('Overpass no responde');
    k++;
    process.stdout.write(`\r  OSM ${k}/${parts.length} (${all.size} elementos)`);
  }
  process.stdout.write('\n');
  const data = [...all.values()];
  writeFileSync(f, JSON.stringify(data));
  return data;
}

// ------------------------------------------------------------ OpenStreetMap (teselas vectoriales de OpenFreeMap)
// Esquema OpenMapTiles. Se traducen a elementos con etiquetas al estilo de OSM para el resto del proceso.
async function openFreeMap(m, bb) {
  const f = join(CACHE, `omt_${m.id}.json`);
  if (existsSync(f)) return JSON.parse(readFileSync(f, 'utf8'));
  const tj = await (await fetchRetry('https://tiles.openfreemap.org/planet')).json();
  const tpl = tj.tiles[0];
  const z = 14;
  const x0 = Math.floor(lon2tile(bb.w, z)), x1 = Math.floor(lon2tile(bb.e, z));
  const y0 = Math.floor(lat2tile(bb.n, z)), y1 = Math.floor(lat2tile(bb.s, z));
  const out = [];
  const n = (x1 - x0 + 1) * (y1 - y0 + 1);
  let k = 0;
  const ll = (tx, ty, p, ext) => {
    const X = (tx + p.x / ext) / 2 ** z, Y = (ty + p.y / ext) / 2 ** z;
    return { lat: (Math.atan(Math.sinh(Math.PI * (1 - 2 * Y))) * 180) / Math.PI, lon: X * 360 - 180 };
  };
  for (let tx = x0; tx <= x1; tx++) {
    for (let ty = y0; ty <= y1; ty++) {
      const r = await fetchRetry(tpl.replace('{z}', z).replace('{x}', tx).replace('{y}', ty));
      const t = new VectorTile(new Pbf(new Uint8Array(await r.arrayBuffer())));
      const add = (layer, tagsOf) => {
        const L = t.layers[layer];
        if (!L) return;
        for (let i = 0; i < L.length; i++) {
          const ft = L.feature(i);
          const tags = tagsOf(ft.properties);
          if (!tags) continue;
          const geom = ft.loadGeometry();
          if (ft.type === 3) {
            for (const poly of classifyRings(geom)) {
              const members = poly.map((ring, ri) => ({ type: 'way', role: ri === 0 ? 'outer' : 'inner', geometry: ring.map((p) => ll(tx, ty, p, L.extent)) }));
              const g0 = members[0].geometry[0];
              out.push({ type: 'relation', id: Math.round(g0.lat * 1e6) * 7 + Math.round(g0.lon * 1e6), tags, members });
            }
          } else if (ft.type === 2) {
            for (const line of geom) out.push({ type: 'way', id: 0, tags, geometry: line.map((p) => ll(tx, ty, p, L.extent)) });
          }
        }
      };
      add('building', (p) => (p.hide_3d || !(p.render_height >= 2) ? null : { building: 'yes', height: p.render_height, min_height: p.render_min_height || 0 }));
      add('landcover', (p) => {
        const c = p.class;
        if (c === 'grass') return { leisure: 'park' };
        if (c === 'wood') return { natural: 'wood' };
        if (c === 'farmland') return { landuse: 'farmland' };
        if (c === 'sand') return { natural: 'beach' };
        if (c === 'ice') return { natural: 'glacier' };
        if (c === 'rock') return { natural: p.subclass === 'scree' ? 'scree' : 'bare_rock' };
        if (c === 'wetland') return { landuse: 'meadow' };
        return null;
      });
      add('landuse', (p) => {
        const c = p.class;
        if (['residential', 'commercial', 'retail', 'neighbourhood', 'suburb', 'quarter'].includes(c)) return { landuse: 'residential' };
        if (['industrial', 'railway', 'garages', 'quarry', 'dam'].includes(c)) return { landuse: 'industrial' };
        if (c === 'cemetery') return { landuse: 'cemetery' };
        if (c === 'stadium' || c === 'pitch' || c === 'track') return { leisure: 'pitch' };
        if (c === 'playground' || c === 'theme_park' || c === 'zoo') return { leisure: 'park' };
        return null;
      });
      add('park', () => ({ leisure: 'park' }));
      add('water', (p) => (p.class === 'ocean' ? { natural: 'water', water: 'sea' } : p.class === 'swimming_pool' ? null : { natural: 'water' }));
      add('waterway', (p) => (p.brunnel === 'tunnel' ? null : { waterway: p.class === 'river' || p.class === 'canal' ? 'river' : 'stream' }));
      add('aeroway', (p) => (p.class === 'runway' || p.class === 'taxiway' ? { highway: p.class === 'runway' ? 'motorway' : 'service', area: 'no' } : null));
      add('transportation', (p) => {
        if (p.brunnel === 'tunnel' || String(p.class).endsWith('_construction')) return null;
        const c = p.class;
        const bridge = p.brunnel === 'bridge' ? 'yes' : undefined;
        if (c === 'rail') return { railway: 'rail', bridge };
        if (c === 'transit') return p.subclass === 'subway' ? null : { railway: 'tram', bridge };
        if (c === 'path' && t.layers.transportation) return { highway: p.subclass === 'pedestrian' ? 'pedestrian' : 'footway', bridge, area: undefined, _poly: true };
        const hw = { motorway: 'motorway', trunk: 'trunk', primary: 'primary', secondary: 'secondary', tertiary: 'tertiary', minor: 'residential', service: 'service', track: 'track', busway: 'service', raceway: 'service' }[c];
        return hw ? { highway: hw, bridge } : null;
      });
      k++;
      process.stdout.write(`\r  OpenFreeMap ${k}/${n} teselas (${out.length} elementos)`);
    }
  }
  process.stdout.write('\n');
  // Las áreas peatonales llegan como polígonos de la capa de transporte
  for (const el of out) {
    if (el.tags._poly && el.type === 'relation') {
      el.tags = { place: 'square' };
    }
    delete el.tags?._poly;
  }
  writeFileSync(f, JSON.stringify(out));
  return out;
}

// ------------------------------------------------------------ Geometría
/** Anillos (en coordenadas del mundo) de un elemento con geometría */
function rings(el, proj) {
  const conv = (g) => g.map((p) => proj.toWorld(p.lat, p.lon));
  if (el.type === 'way' && el.geometry) return { outer: [conv(el.geometry)], inner: [] };
  if (el.type === 'relation' && el.members) {
    const outer = [], inner = [];
    // Une los tramos de cada papel en anillos cerrados
    for (const role of ['outer', 'inner']) {
      const segs = el.members.filter((mm) => mm.type === 'way' && mm.geometry && (mm.role || 'outer') === role).map((mm) => conv(mm.geometry));
      const out = role === 'outer' ? outer : inner;
      const near = (a, b) => Math.abs(a[0] - b[0]) < 0.01 && Math.abs(a[1] - b[1]) < 0.01;
      while (segs.length) {
        let ring = segs.shift();
        let grown = true;
        while (!near(ring[0], ring[ring.length - 1]) && grown) {
          grown = false;
          for (let i = 0; i < segs.length; i++) {
            const sg = segs[i];
            const end = ring[ring.length - 1];
            if (near(end, sg[0])) ring = ring.concat(sg.slice(1));
            else if (near(end, sg[sg.length - 1])) ring = ring.concat(sg.slice(0, -1).reverse());
            else continue;
            segs.splice(i, 1);
            grown = true;
            break;
          }
        }
        out.push(ring);
      }
    }
    return { outer, inner };
  }
  return { outer: [], inner: [] };
}

/** Rellena un polígono (anillos exteriores e interiores, par-impar) en una cuadrícula */
function fillPoly(poly, grid, fn) {
  const { x0, z0, cell, nx, nz } = grid;
  const all = [...poly.outer, ...poly.inner];
  let minZ = Infinity, maxZ = -Infinity;
  for (const r of poly.outer) for (const p of r) { minZ = Math.min(minZ, p[1]); maxZ = Math.max(maxZ, p[1]); }
  const j0 = Math.max(0, Math.floor((minZ - z0) / cell)), j1 = Math.min(nz - 1, Math.ceil((maxZ - z0) / cell));
  const xs = [];
  for (let j = j0; j <= j1; j++) {
    const zc = z0 + (j + 0.5) * cell;
    xs.length = 0;
    for (const r of all) {
      for (let i = 0, n = r.length; i < n; i++) {
        const a = r[i], b = r[(i + 1) % n];
        if ((a[1] <= zc) !== (b[1] <= zc)) xs.push(a[0] + ((zc - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
      }
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const i0 = Math.max(0, Math.ceil((xs[k] - x0) / cell - 0.5)), i1 = Math.min(nx - 1, Math.floor((xs[k + 1] - x0) / cell - 0.5));
      for (let i = i0; i <= i1; i++) fn(j * nx + i);
    }
  }
}

/** Dibuja una línea gruesa (ancho w) en una cuadrícula */
function strokeLine(pts, w, grid, fn) {
  const { x0, z0, cell, nx, nz } = grid;
  const r = Math.max(cell * 0.5, w / 2);
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    const steps = Math.max(1, Math.ceil(len / (cell * 0.5)));
    for (let s = 0; s <= steps; s++) {
      const px = ax + ((bx - ax) * s) / steps, pz = az + ((bz - az) * s) / steps;
      const ia = Math.floor((px - r - x0) / cell), ib = Math.floor((px + r - x0) / cell);
      const ja = Math.floor((pz - r - z0) / cell), jb = Math.floor((pz + r - z0) / cell);
      for (let j = Math.max(0, ja); j <= Math.min(nz - 1, jb); j++) {
        for (let ii = Math.max(0, ia); ii <= Math.min(nx - 1, ib); ii++) {
          const cx = x0 + (ii + 0.5) * cell - px, cz = z0 + (j + 0.5) * cell - pz;
          if (cx * cx + cz * cz <= r * r) fn(j * nx + ii);
        }
      }
    }
  }
}

// ------------------------------------------------------------ Alturas de edificios
function num(v) {
  if (v == null) return NaN;
  const m = String(v).replace(',', '.').match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : NaN;
}

function buildingHeight(t) {
  let h = num(t.height);
  if (!(h > 0)) {
    const lv = num(t['building:levels']);
    const rl = num(t['roof:levels']);
    if (lv > 0) h = lv * 3.3 + (rl > 0 ? rl * 2.2 : 1.5);
  }
  if (!(h > 0)) {
    const b = t.building || t['building:part'] || 'yes';
    h = { house: 7, detached: 8, terrace: 9, garage: 3, garages: 3, shed: 3, roof: 5, hut: 3, kiosk: 3, church: 22, cathedral: 35, chapel: 10, industrial: 10, warehouse: 9, retail: 8, commercial: 16, office: 24, apartments: 19, residential: 17, hotel: 30, school: 12, university: 16, hospital: 22, train_station: 15, stadium: 30, construction: 10, ruins: 4, service: 4, transportation: 8 }[b] ?? 13;
  }
  return Math.min(h, 560);
}

function buildingStyle(t, h) {
  const b = t.building || t['building:part'] || 'yes';
  if (['church', 'cathedral', 'chapel', 'temple', 'mosque', 'synagogue', 'basilica', 'palace', 'castle', 'government', 'civic', 'museum', 'monument'].includes(b) || t.historic || t.amenity === 'place_of_worship') return S.DECO;
  if (['industrial', 'warehouse', 'hangar', 'factory', 'manufacture', 'storage_tank', 'service', 'garage', 'garages', 'parking'].includes(b)) return S.INDUST;
  if (['house', 'detached', 'terrace', 'semidetached_house', 'bungalow', 'hut', 'shed', 'farm', 'cabin'].includes(b)) return S.HOUSE;
  if (h > 70) return S.GLASS;
  if (['office', 'commercial', 'hotel', 'retail', 'hospital', 'university'].includes(b) || h > 40) return S.OFFICE;
  return S.RESID;
}

// ------------------------------------------------------------ Orientación de la cuadrícula
function dominantAngle(osm, m) {
  const proj0 = projector(m, 0);
  const hist = new Float64Array(90);
  for (const el of osm) {
    if (!el.tags?.building) continue;
    const geoms = el.geometry ? [el.geometry] : (el.members ?? []).map((mm) => mm.geometry).filter(Boolean);
    for (const geom of geoms) {
    const pts = geom.map((p) => proj0.toWorld(p.lat, p.lon));
    for (let i = 0; i + 1 < pts.length; i++) {
      const dx = pts[i + 1][0] - pts[i][0], dz = pts[i + 1][1] - pts[i][1];
      const len = Math.hypot(dx, dz);
      if (len < 3) continue;
      let a = (Math.atan2(dz, dx) * 180) / Math.PI;
      a = ((a % 90) + 90) % 90;
      hist[Math.floor(a)] += len;
    }
    }
  }
  let best = 0, bv = -1;
  for (let a = 0; a < 90; a++) {
    const v = hist[(a + 89) % 90] + hist[a] * 2 + hist[(a + 1) % 90];
    if (v > bv) { bv = v; best = a; }
  }
  // Ángulo en (−45, 45]
  return best > 45 ? best - 90 : best;
}

// ------------------------------------------------------------ Mapa
async function buildMap(m) {
  console.log(`== ${m.id}`);
  const everest = m.id === 'everest';
  const proj0 = projector(m, 0);
  // Margen para el giro: se pide la caja girada 45° como máximo
  const big = { ...m, size: [Math.hypot(...m.size), Math.hypot(...m.size)] };
  const bbBig = bboxLatLon(big, proj0);
  const osm = process.env.SOURCE === 'overpass' ? await overpass(m, bbBig, everest) : await openFreeMap(m, bbBig);
  console.log(`  OSM: ${osm.length} elementos`);
  let rotDeg = m.rot;
  if (rotDeg == null) rotDeg = dominantAngle(osm, m);
  console.log(`  giro: ${rotDeg}°`);
  // En pantalla el mapa se gira -rot para alinear las calles con los ejes
  const proj = projector(m, (-rotDeg * Math.PI) / 180);
  const W = m.size[0] * m.scale, H = m.size[1] * m.scale;
  const X0 = -W / 2, Z0 = -H / 2;
  const bb = bboxLatLon(m, proj);
  const elevAt = await elevationSampler(bb, m.zoom);

  // ---- Relieve
  const eg = { x0: X0, z0: Z0, cell: m.cellE, nx: Math.round(W / m.cellE) + 1, nz: Math.round(H / m.cellE) + 1 };
  const raw = new Float32Array(eg.nx * eg.nz);
  for (let j = 0; j < eg.nz; j++) for (let i = 0; i < eg.nx; i++) {
    const [la, lo] = proj.toLatLon(X0 + i * m.cellE, Z0 + j * m.cellE);
    raw[j * eg.nx + i] = elevAt(la, lo);
  }
  let base = Infinity;
  for (const v of raw) base = Math.min(base, v);
  if (m.coastal) base = 0;
  if (m.minBase != null) base = Math.max(base, m.minBase);
  base = Math.floor(base);
  // Suavizado 3×3 (quita ruido del modelo de elevación) y paso a metros del juego
  const elev = new Int16Array(eg.nx * eg.nz);
  let maxE = 0;
  for (let j = 0; j < eg.nz; j++) for (let i = 0; i < eg.nx; i++) {
    let s = 0, n = 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const ii = i + di, jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= eg.nx || jj >= eg.nz) continue;
      s += raw[jj * eg.nx + ii]; n++;
    }
    const v = Math.max(0, (s / n - base) * m.scale);
    maxE = Math.max(maxE, v);
    elev[j * eg.nx + i] = Math.round(v * 4);
  }
  console.log(`  base ${base} m, relieve máx ${maxE.toFixed(0)} m (juego)`);
  const groundAt = (x, z) => {
    const fx = Math.min(eg.nx - 1.001, Math.max(0, (x - X0) / m.cellE)), fz = Math.min(eg.nz - 1.001, Math.max(0, (z - Z0) / m.cellE));
    const i = Math.floor(fx), j = Math.floor(fz), ax = fx - i, az = fz - j;
    const g = (a, b) => elev[b * eg.nx + a] / 4;
    return (g(i, j) * (1 - ax) + g(i + 1, j) * ax) * (1 - az) + (g(i, j + 1) * (1 - ax) + g(i + 1, j + 1) * ax) * az;
  };
  const rawAt = (x, z) => {
    const [la, lo] = proj.toLatLon(x, z);
    return elevAt(la, lo);
  };

  // ---- Suelo
  const cg = { x0: X0, z0: Z0, cell: m.cellC, nx: Math.round(W / m.cellC), nz: Math.round(H / m.cellC) };
  const cls = new Uint8Array(cg.nx * cg.nz).fill(everest ? C.ROCK : C.URBAN);
  const polys = (pred) => osm.filter((el) => el.tags && el.type !== 'node' && pred(el.tags));
  const paint = (pred, c) => { for (const el of polys(pred)) fillPoly(rings(el, proj), cg, (k) => (cls[k] = c)); };
  if (everest) {
    // Hierba en el fondo de los valles, roca y nieve según la altura real
    for (let j = 0; j < cg.nz; j++) for (let i = 0; i < cg.nx; i++) {
      const e = rawAt(X0 + (i + 0.5) * m.cellC, Z0 + (j + 0.5) * m.cellC);
      cls[j * cg.nx + i] = e < 4300 ? C.SCRUB : e < 4950 ? C.FIELD : e < 5650 ? C.ROCK : C.GLACIER;
    }
    paint((t) => t.natural === 'scree' || t.natural === 'bare_rock', C.ROCK);
    paint((t) => t.natural === 'glacier', C.GLACIER);
    paint((t) => t.natural === 'water', C.WATER);
    for (const el of osm) if (el.type === 'way' && el.tags?.waterway && el.geometry) strokeLine(rings(el, proj).outer[0], el.tags.waterway === 'river' ? 10 * m.scale : 5 * m.scale, cg, (k) => (cls[k] = C.WATER));
    for (const el of osm) if (el.type === 'way' && el.tags?.highway && el.geometry) strokeLine(rings(el, proj).outer[0], 2.5, cg, (k) => (cls[k] = C.PATH));
  } else {
    paint((t) => ['residential', 'commercial', 'retail'].includes(t.landuse), C.URBAN);
    paint((t) => ['industrial', 'railway', 'port', 'construction', 'brownfield'].includes(t.landuse), C.INDUSTRIAL);
    paint((t) => ['farmland', 'meadow', 'orchard', 'vineyard', 'allotments', 'greenfield'].includes(t.landuse), C.FIELD);
    paint((t) => ['grass', 'recreation_ground', 'village_green', 'flowerbed'].includes(t.landuse) || ['grassland', 'heath'].includes(t.natural) || ['park', 'garden', 'playground', 'golf_course', 'nature_reserve'].includes(t.leisure), C.PARK);
    paint((t) => t.landuse === 'cemetery', C.CEMETERY);
    paint((t) => t.landuse === 'forest' || t.natural === 'wood', C.FOREST);
    paint((t) => t.natural === 'scrub', C.SCRUB);
    paint((t) => ['beach', 'sand'].includes(t.natural), C.SAND);
    paint((t) => ['pitch', 'stadium', 'track'].includes(t.leisure), C.PITCH);
    paint((t) => t.amenity === 'parking', C.PARKING);
    paint((t) => t.place === 'square' || (t.highway === 'pedestrian' && t.area === 'yes'), C.PLAZA);
    paint((t) => (t.natural === 'water' && t.water !== 'sea') || t.waterway === 'riverbank' || t.waterway === 'dock' || ['reservoir', 'basin'].includes(t.landuse), C.WATER);
    paint((t) => t.water === 'sea', C.SEA);
    // Mar: lo que está a nivel del mar según el relieve
    if (m.coastal) {
      for (let j = 0; j < cg.nz; j++) for (let i = 0; i < cg.nx; i++) {
        const k = j * cg.nx + i;
        if (cls[k] !== C.URBAN && cls[k] !== C.WATER && cls[k] !== C.PARK) continue;
        if (rawAt(X0 + (i + 0.5) * m.cellC, Z0 + (j + 0.5) * m.cellC) <= 0.2) cls[k] = C.SEA;
      }
    }
    // Vías
    const roadW = { motorway: 22, trunk: 20, primary: 18, secondary: 15, tertiary: 12, unclassified: 9, residential: 9, living_street: 7, service: 5, motorway_link: 9, trunk_link: 9, primary_link: 9, secondary_link: 8, pedestrian: 7, footway: 3, path: 2.5, cycleway: 3, steps: 3, track: 4 };
    const ways = osm.filter((el) => el.type === 'way' && el.geometry && el.tags);
    for (const el of ways) {
      const t = el.tags;
      if (t.railway && !t.tunnel && t.railway !== 'subway') strokeLine(rings(el, proj).outer[0], 4, cg, (k) => (cls[k] = C.RAIL));
    }
    for (const el of ways) {
      const t = el.tags;
      if (!t.highway || t.area === 'yes' || t.tunnel === 'yes' || t.indoor === 'yes') continue;
      const w = roadW[t.highway];
      if (!w) continue;
      const c = w >= 15 ? C.ROAD_BIG : w >= 5 ? C.ROAD : C.PATH;
      strokeLine(rings(el, proj).outer[0], w, cg, (k) => {
        if (c === C.PATH && (cls[k] === C.ROAD || cls[k] === C.ROAD_BIG)) return;
        if (cls[k] === C.SEA && t.bridge !== 'yes') return;
        cls[k] = c;
      });
    }
    for (const el of ways) if (el.tags.man_made) strokeLine(rings(el, proj).outer[0], 8, cg, (k) => (cls[k] = C.PLAZA));
  }

  // ---- Edificios
  const bg = { x0: X0, z0: Z0, cell: m.cellB, nx: Math.round(W / m.cellB), nz: Math.round(H / m.cellB) };
  const N = bg.nx * bg.nz;
  const cb = new Int32Array(N).fill(-1); // índice de edificio
  const ch = new Float32Array(N); // altura
  const cm = new Float32Array(N); // altura mínima
  const fromPart = new Uint8Array(N);
  const bInfo = []; // { style, seed, parts }
  const blds = osm.filter((el) => el.tags && el.type !== 'node' && (el.tags.building || el.tags['building:part']) && el.tags.building !== 'no' && el.tags['building:part'] !== 'no' && !['roof', 'carport'].includes(el.tags.building) && el.tags.location !== 'underground');
  const outlines = blds.filter((el) => el.tags.building);
  const partEls = blds.filter((el) => !el.tags.building && el.tags['building:part']);
  const outlineCells = [];
  const marks = (m.landmarks ?? []).map((l) => ({ ...l, p: proj.toWorld(l.lat, l.lon) }));
  for (const el of outlines) {
    const t = el.tags;
    const h = buildingHeight(t) * m.scale;
    const mh = Math.max(0, num(t.min_height) || 0) * m.scale;
    const id = bInfo.length;
    const poly = rings(el, proj);
    let style = buildingStyle(t, h / m.scale);
    const p0 = poly.outer[0]?.[0];
    if (p0) for (const l of marks) if (Math.hypot(p0[0] - l.p[0], p0[1] - l.p[1]) < l.r * m.scale) style = l.style;
    bInfo.push({ style, seed: (el.id * 2654435761) >>> 0 });
    const cells = [];
    fillPoly(poly, bg, (k) => {
      cells.push(k);
      if (cb[k] >= 0 && ch[k] >= h) return;
      cb[k] = id; ch[k] = h; cm[k] = mh;
    });
    outlineCells.push(cells);
  }
  for (const el of partEls) {
    const t = el.tags;
    const h = buildingHeight(t) * m.scale;
    const mh = Math.max(0, num(t.min_height) || (num(t['building:min_level']) || 0) * 3.3) * m.scale;
    const id = bInfo.length;
    bInfo.push({ style: buildingStyle(t, h / m.scale), seed: (el.id * 2654435761) >>> 0 });
    fillPoly(rings(el, proj), bg, (k) => {
      if (fromPart[k]) {
        // Varias partes en la misma celda: se queda la más alta, sólida desde la más baja
        if (h > ch[k]) { ch[k] = h; cb[k] = id; }
        cm[k] = Math.min(cm[k], mh);
        return;
      }
      fromPart[k] = 1;
      cb[k] = id; ch[k] = h; cm[k] = mh;
    });
  }
  // Contornos cubiertos por partes: la parte sin detallar se queda baja (patios, naves)
  for (const cells of outlineCells) {
    if (!cells.length) continue;
    let covered = 0;
    for (const k of cells) if (fromPart[k]) covered++;
    if (covered / cells.length < 0.3) continue;
    for (const k of cells) if (!fromPart[k]) { cb[k] = -1; }
  }
  // Mallado voraz por manzanas de 80 m: rectángulos de celdas con el mismo edificio y altura
  const per = Math.round(80 / m.cellB);
  const rects = [];
  const used = new Uint8Array(N);
  // Alturas redondeadas a 3 m: los edificios contiguos de altura parecida se unen en menos cajas
  for (let k = 0; k < N; k++) {
    if (cb[k] < 0) continue;
    ch[k] = Math.max(4, Math.round(ch[k] / 4) * 4);
    cm[k] = Math.round(cm[k] / 4) * 4;
  }
  const same = (a, b) => cb[b] >= 0 && ch[a] === ch[b] && cm[a] === cm[b] && bInfo[cb[a]].style === bInfo[cb[b]].style;
  // La cuadrícula arranca en X0, que no tiene por qué ser múltiplo de 80: se alinean los cortes con el mundo
  const offI = Math.round((((X0 % 80) + 80) % 80) / m.cellB), offJ = Math.round((((Z0 % 80) + 80) % 80) / m.cellB);
  for (let j = 0; j < bg.nz; j++) for (let i = 0; i < bg.nx; i++) {
    const k = j * bg.nx + i;
    if (used[k] || cb[k] < 0 || ch[k] - cm[k] < 0.5) continue;
    const bi = Math.floor((i + offI) / per), bj = Math.floor((j + offJ) / per);
    const iMax = Math.min(bg.nx, (bi + 1) * per - offI), jMax = Math.min(bg.nz, (bj + 1) * per - offJ);
    let w = 1;
    while (i + w < iMax && !used[k + w] && same(k, k + w)) w++;
    let d = 1;
    outer: while (j + d < jMax) {
      for (let a = 0; a < w; a++) {
        const kk = (j + d) * bg.nx + i + a;
        if (used[kk] || !same(k, kk)) break outer;
      }
      d++;
    }
    for (let b = 0; b < d; b++) for (let a = 0; a < w; a++) used[(j + b) * bg.nx + i + a] = 1;
    rects.push([i, j, w, d, ch[k], cm[k], cb[k]]);
  }
  console.log(`  edificios: ${outlines.length} + ${partEls.length} partes -> ${rects.length} cajas`);

  // ---- Árboles sueltos (OSM)
  let trees = osm.filter((el) => el.type === 'node' && el.tags?.natural === 'tree').map((el) => proj.toWorld(el.lat, el.lon)).filter(([x, z]) => x > X0 && x < X0 + W && z > Z0 && z < Z0 + H);
  const MAXT = 45000;
  if (trees.length > MAXT) {
    const keep = MAXT / trees.length;
    trees = trees.filter((_, i) => ((i * 2654435761) >>> 0) / 4294967296 < keep);
  }
  console.log(`  árboles: ${trees.length}`);

  // ---- Puntos de interés para el mapa (sitios con nombre, edificios altos)
  // ---- Escritura
  const nR = rects.length;
  const rI = new Uint16Array(nR * 4), rH = new Uint16Array(nR * 2), rS = new Uint8Array(nR), rSeed = new Uint16Array(nR);
  rects.forEach(([i, j, w, d, h, mh, id], n) => {
    rI.set([i, j, w, d], n * 4);
    rH[n * 2] = Math.min(65535, Math.round(h * 10));
    rH[n * 2 + 1] = Math.min(65535, Math.round(mh * 10));
    rS[n] = bInfo[id].style;
    rSeed[n] = bInfo[id].seed & 0xffff;
  });
  const tr = new Int16Array(trees.length * 2);
  trees.forEach(([x, z], n) => { tr[n * 2] = Math.round(x * 2); tr[n * 2 + 1] = Math.round(z * 2); });
  const header = {
    v: 1, id: m.id, center: m.center, x0: X0, z0: Z0, w: W, h: H, rot: rotDeg, scale: m.scale, base,
    elev: { cell: m.cellE, nx: eg.nx, nz: eg.nz },
    cls: { cell: m.cellC, nx: cg.nx, nz: cg.nz },
    bld: { cell: m.cellB, n: nR },
    trees: trees.length,
    attribution: '© colaboradores de OpenStreetMap (ODbL) · Relieve: Mapzen/Tilezen Terrarium',
  };
  const hb = Buffer.from(JSON.stringify(header));
  const pad = (b) => { const p = (4 - (b.length % 4)) % 4; return p ? Buffer.concat([b, Buffer.alloc(p)]) : b; };
  const len = Buffer.alloc(4);
  len.writeUInt32LE(hb.length + ((4 - (hb.length % 4)) % 4));
  const chunks = [len, pad(hb), pad(Buffer.from(elev.buffer)), pad(Buffer.from(cls.buffer)), pad(Buffer.from(rI.buffer)), pad(Buffer.from(rH.buffer)), pad(Buffer.from(rS.buffer)), pad(Buffer.from(rSeed.buffer)), pad(Buffer.from(tr.buffer))];
  const bin = gzipSync(Buffer.concat(chunks), { level: 9 });
  writeFileSync(join(OUT, `${m.id}.dat`), bin);
  console.log(`  -> ${OUT}/${m.id}.dat ${(bin.length / 1024).toFixed(0)} KB`);
}

const want = process.argv.slice(2);
for (const m of MAPS) if (!want.length || want.includes(m.id)) await buildMap(m);
