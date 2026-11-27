// Lugares reales del modo «Mundo real».
// center: [lat, lon] del centro del mapa · size: [ancho, largo] en metros reales
// scale: metros del juego por metro real (1 = tamaño real)
// rot: giro del mapa en grados (null = alinear con la cuadrícula de calles dominante)
// zoom: nivel de las teselas de elevación · cellB/cellC/cellE: celdas (m del juego) de edificios, suelo y relieve
export const MAPS = [
  {
    id: 'barcelona',
    center: [41.3955, 2.158],
    size: [9000, 9000],
    scale: 1,
    rot: null,
    zoom: 13,
    cellB: 4,
    cellC: 4,
    cellE: 16,
    coastal: true,
    // Edificios singulares: estilo de piedra (en las teselas no viene el tipo de edificio)
    landmarks: [{ lat: 41.4036, lon: 2.1744, r: 75, style: 6 }],
  },
  {
    id: 'madrid',
    center: [40.4385, -3.6935],
    size: [8000, 10000],
    scale: 1,
    rot: 0,
    zoom: 13,
    cellB: 4,
    cellC: 4,
    cellE: 16,
    coastal: false,
    landmarks: [
      { lat: 40.418, lon: -3.7143, r: 110, style: 6 },
      { lat: 40.4153, lon: -3.7074, r: 70, style: 6 },
      { lat: 40.4155, lon: -3.7152, r: 70, style: 6 },
    ],
  },
  {
    id: 'nuevayork',
    center: [40.7365, -73.9905],
    size: [7000, 13000],
    scale: 1,
    rot: null,
    zoom: 13,
    cellB: 4,
    cellC: 4,
    cellE: 16,
    coastal: true,
  },
  {
    id: 'everest',
    center: [27.9881, 86.925],
    size: [26000, 26000],
    scale: 0.4,
    rot: 0,
    zoom: 12,
    cellB: 4,
    cellC: 8,
    cellE: 12,
    coastal: false,
    // El Everest se ve desde el sur (Khumbu): base del mapa un poco por debajo del valle
    minBase: 3600,
  },
];
