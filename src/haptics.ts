/** Vibración del dispositivo (con límite de frecuencia) */
let enabled = true;
let last = 0;

export function setHaptics(on: boolean) {
  enabled = on;
}

export function hapticsSupported() {
  return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
}

/**
 * @param pattern duración en ms o patrón
 * @param minGap ms mínimos desde la última vibración (evita saturar)
 */
export function vibrate(pattern: number | number[], minGap = 0) {
  if (!enabled || !hapticsSupported()) return;
  const now = performance.now();
  if (now - last < minGap) return;
  last = now;
  try {
    navigator.vibrate(pattern);
  } catch {
    /* bloqueado */
  }
}

export const Haptic = {
  shot: () => vibrate(8, 90),
  hitTaken: () => vibrate(45, 60),
  scrape: () => vibrate([70, 40, 90]),
  bump: () => vibrate([50, 30, 50]),
  explosion: () => vibrate([180, 60, 260]),
  missileWarning: () => vibrate([30, 60, 30, 60, 30], 400),
  pickup: () => vibrate(20),
  gate: () => vibrate(25),
};
