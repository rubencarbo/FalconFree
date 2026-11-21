/** Instalación como app (PWA), actualizaciones y pantalla siempre encendida */

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const isArtifact = import.meta.env.VITE_ARTIFACT === '1';

export function isStandalone() {
  return (
    matchMedia('(display-mode: standalone)').matches ||
    matchMedia('(display-mode: fullscreen)').matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

function isIos() {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);
}

export class Pwa {
  private deferred: BeforeInstallPromptEvent | null = null;
  private waiting: ServiceWorker | null = null;
  private wakeLock: { release(): Promise<void> } | null = null;
  /** Cambia la visibilidad del botón «Instalar app» */
  onInstallAvailable?: (available: boolean) => void;
  /** Hay una versión nueva lista para aplicar */
  onUpdateReady?: () => void;
  onInstalled?: () => void;

  constructor() {
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.deferred = e as BeforeInstallPromptEvent;
      this.onInstallAvailable?.(true);
    });
    window.addEventListener('appinstalled', () => {
      this.deferred = null;
      this.onInstallAvailable?.(false);
      this.onInstalled?.();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.wantWake) void this.keepAwake(true);
    });
  }

  /** ¿Mostrar el botón de instalar? (Android/escritorio con aviso, o iPhone sin instalar) */
  get canInstall() {
    if (isArtifact || isStandalone()) return false;
    return !!this.deferred || isIos();
  }

  get iosManual() {
    return !this.deferred && isIos() && !isStandalone();
  }

  /** Devuelve 'prompted' | 'ios' | 'unavailable' */
  async install(): Promise<'prompted' | 'ios' | 'unavailable'> {
    if (this.deferred) {
      const d = this.deferred;
      this.deferred = null;
      await d.prompt();
      const choice = await d.userChoice.catch(() => ({ outcome: 'dismissed' as const }));
      if (choice.outcome !== 'accepted') this.deferred = null;
      this.onInstallAvailable?.(this.canInstall);
      return 'prompted';
    }
    if (isIos()) return 'ios';
    return 'unavailable';
  }

  register() {
    if (isArtifact || !import.meta.env.PROD || !('serviceWorker' in navigator)) return;
    window.addEventListener('load', async () => {
      try {
        const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
        const track = (w: ServiceWorker | null) => {
          if (!w) return;
          w.addEventListener('statechange', () => {
            if (w.state === 'installed' && navigator.serviceWorker.controller) {
              this.waiting = w;
              this.onUpdateReady?.();
            }
          });
        };
        if (reg.waiting && navigator.serviceWorker.controller) {
          this.waiting = reg.waiting;
          this.onUpdateReady?.();
        }
        reg.addEventListener('updatefound', () => track(reg.installing));
        // Buscar actualizaciones cada hora
        setInterval(() => reg.update().catch(() => undefined), 60 * 60 * 1000);
        let reloaded = false;
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          if (reloaded) return;
          reloaded = true;
          location.reload();
        });
      } catch (e) {
        console.warn('[pwa] no se pudo registrar el service worker', e);
      }
    });
  }

  /** Aplica la versión nueva (recarga la página) */
  applyUpdate() {
    this.waiting?.postMessage({ type: 'SKIP_WAITING' });
  }

  private wantWake = false;

  /** Mantiene la pantalla encendida mientras se juega */
  async keepAwake(on: boolean) {
    this.wantWake = on;
    try {
      if (on && !this.wakeLock && document.visibilityState === 'visible') {
        const wl = (navigator as unknown as { wakeLock?: { request(t: 'screen'): Promise<{ release(): Promise<void>; addEventListener(t: string, f: () => void): void }> } }).wakeLock;
        if (!wl) return;
        const lock = await wl.request('screen');
        this.wakeLock = lock;
        lock.addEventListener('release', () => {
          this.wakeLock = null;
        });
      } else if (!on && this.wakeLock) {
        await this.wakeLock.release();
        this.wakeLock = null;
      }
    } catch {
      /* no disponible */
    }
  }
}
