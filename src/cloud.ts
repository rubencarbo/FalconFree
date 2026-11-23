import { firebase } from './firebase';
import { randomCode } from './circuits';
import { store } from './settings';

/** Claves del almacén local que se copian a la nube (prefijo «ff.») */
function cloudKey(k: string) {
  if (!k.startsWith('ff.')) return false;
  const name = k.slice(3);
  // Fuera: fantasmas (pesan mucho), la propia configuración de la nube, ajustes del dispositivo
  return !name.startsWith('ghost.') && !name.startsWith('cloud.') && name !== 'gfx.auto' && name !== 'settings';
}

export function formatRecovery(code: string) {
  return code.replace(/(.{4})(?=.)/g, '$1-');
}

/**
 * Perfil en la nube con código de recuperación.
 * El código (12 caracteres) es la «llave»: con él se recupera el progreso en otro móvil.
 */
export class CloudSave {
  lastSync = Number(store.get('cloud.last') ?? 0);
  busy = false;
  private lastHash = store.get('cloud.hash') ?? '';
  private timer = 0;

  get available() {
    return firebase.enabled;
  }

  get enabled() {
    return store.get('cloud.on') === '1';
  }

  set enabled(v: boolean) {
    store.set('cloud.on', v ? '1' : '0');
    if (v && !this.code) store.set('cloud.code', randomCode(12));
  }

  get code() {
    return store.get('cloud.code') ?? '';
  }

  /** Copia de todo lo que forma el progreso */
  snapshot(name: string) {
    const data: Record<string, string> = {};
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && cloudKey(k)) data[k] = localStorage.getItem(k) ?? '';
      }
    } catch {
      /* sin almacenamiento */
    }
    return JSON.stringify({ v: 1, name, data });
  }

  /** Programa copias automáticas cada pocos minutos */
  startAuto(getName: () => string, beforeSave: () => void) {
    clearInterval(this.timer);
    this.timer = window.setInterval(() => {
      if (this.enabled && this.available && !document.hidden) void this.save(getName(), beforeSave, false);
    }, 120000);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.enabled && this.available) void this.save(getName(), beforeSave, false);
    });
  }

  /** Sube la copia si ha cambiado (o siempre si force) */
  async save(name: string, beforeSave: () => void, force: boolean): Promise<'saved' | 'same' | 'error'> {
    if (!this.available || !this.code || this.busy) return 'error';
    beforeSave();
    const snap = this.snapshot(name);
    const hash = String(hashStr(snap));
    if (!force && hash === this.lastHash) return 'same';
    this.busy = true;
    try {
      await firebase.saveCloud(this.code, snap, name);
      this.lastHash = hash;
      this.lastSync = Date.now();
      store.set('cloud.hash', hash);
      store.set('cloud.last', String(this.lastSync));
      return 'saved';
    } catch (e) {
      console.warn('[nube] no se pudo guardar', e);
      return 'error';
    } finally {
      this.busy = false;
    }
  }

  /** Descarga el perfil de otro dispositivo y lo instala aquí. Devuelve el nombre del piloto. */
  async restore(rawCode: string): Promise<string> {
    const code = rawCode.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (code.length !== 12) throw new Error('El código de recuperación tiene 12 caracteres.');
    const res = await firebase.loadCloud(code);
    if (!res) throw new Error('No hay ningún perfil guardado con ese código.');
    const parsed = JSON.parse(res.data) as { v: number; name?: string; data: Record<string, string> };
    if (!parsed || typeof parsed.data !== 'object') throw new Error('La copia está dañada.');
    // Sustituir el progreso local por el de la nube
    const remove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && cloudKey(k)) remove.push(k);
    }
    for (const k of remove) localStorage.removeItem(k);
    for (const [k, v] of Object.entries(parsed.data)) if (cloudKey(k)) localStorage.setItem(k, v);
    store.set('cloud.code', code);
    store.set('cloud.on', '1');
    store.set('cloud.hash', '');
    return parsed.name ?? res.name ?? '';
  }
}

function hashStr(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
