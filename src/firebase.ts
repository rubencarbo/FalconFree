import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged, connectAuthEmulator, type Auth, type User } from 'firebase/auth';
import {
  getFirestore,
  connectFirestoreEmulator,
  doc,
  getDoc,
  setDoc,
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  serverTimestamp,
  type Firestore,
} from 'firebase/firestore';
import { getDatabase, connectDatabaseEmulator, type Database } from 'firebase/database';
import type { StageId } from './stages';

export interface ScoreEntry {
  uid: string;
  name: string;
  stage: StageId;
  rings: number;
  maxSpeed: number;
}

export interface TimeEntry {
  uid: string;
  name: string;
  course: string;
  timeMs: number;
}

const env = import.meta.env;
const useEmulators = env.VITE_USE_EMULATORS === '1';
const config = {
  apiKey: env.VITE_FIREBASE_API_KEY || (useEmulators ? 'demo-key' : undefined),
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID || (useEmulators ? 'demo-falconsky' : undefined),
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: env.VITE_FIREBASE_APP_ID || (useEmulators ? 'demo-app' : undefined),
  databaseURL:
    env.VITE_FIREBASE_DATABASE_URL || (useEmulators ? `http://127.0.0.1:9000?ns=${env.VITE_FIREBASE_PROJECT_ID || 'demo-falconsky'}` : undefined),
};

class FirebaseService {
  enabled = Boolean(config.apiKey && config.projectId && config.appId);
  /** El multijugador necesita además la URL de Realtime Database */
  get multiplayer() {
    return this.enabled && Boolean(config.databaseURL);
  }
  private app?: FirebaseApp;
  private auth?: Auth;
  private db?: Firestore;
  private rtdb?: Database;
  private userPromise?: Promise<User | null>;

  private init() {
    if (!this.enabled || this.app) return;
    try {
      this.app = initializeApp(config);
      this.auth = getAuth(this.app);
      this.db = getFirestore(this.app);
      if (useEmulators) {
        const host = env.VITE_EMULATOR_HOST || '127.0.0.1';
        connectAuthEmulator(this.auth, `http://${host}:9099`, { disableWarnings: true });
        connectFirestoreEmulator(this.db, host, 8080);
      }
    } catch (e) {
      console.warn('[firebase] no se pudo inicializar', e);
      this.enabled = false;
    }
  }

  database(): Database | null {
    this.init();
    if (!this.app || !config.databaseURL) return null;
    if (!this.rtdb) {
      this.rtdb = getDatabase(this.app);
      if (useEmulators) connectDatabaseEmulator(this.rtdb, env.VITE_EMULATOR_HOST || '127.0.0.1', 9000);
    }
    return this.rtdb;
  }

  /** Inicia sesión anónima (una sola vez) */
  user(): Promise<User | null> {
    this.init();
    if (!this.auth) return Promise.resolve(null);
    if (!this.userPromise) {
      const auth = this.auth;
      this.userPromise = new Promise<User | null>((resolve) => {
        const unsub = onAuthStateChanged(auth, (u) => {
          if (u) {
            unsub();
            resolve(u);
          }
        });
        signInAnonymously(auth).catch((e) => {
          console.warn('[firebase] auth anónima falló', e);
          unsub();
          resolve(null);
        });
      });
    }
    return this.userPromise;
  }

  async uid(): Promise<string | null> {
    return (await this.user())?.uid ?? null;
  }

  /** Guarda anillos si mejora la marca. Devuelve true si se guardó. */
  async submit(stage: StageId, name: string, rings: number, maxSpeed: number): Promise<boolean> {
    if (!this.enabled || rings <= 0) return false;
    const u = await this.user();
    if (!u || !this.db) return false;
    const ref = doc(this.db, 'scores', `${stage}_${u.uid}`);
    try {
      const snap = await getDoc(ref);
      if (snap.exists() && (snap.data().rings ?? 0) >= rings) return false;
      await setDoc(ref, {
        uid: u.uid,
        name: name.slice(0, 16) || 'Piloto',
        stage,
        rings: Math.floor(rings),
        maxSpeed: Math.round(maxSpeed),
        updatedAt: serverTimestamp(),
      });
      return true;
    } catch (e) {
      console.warn('[firebase] error guardando puntuación', e);
      return false;
    }
  }

  async top(stage: StageId, n = 10): Promise<ScoreEntry[]> {
    if (!this.enabled) return [];
    this.init();
    if (!this.db) return [];
    await this.user();
    const q = query(collection(this.db, 'scores'), where('stage', '==', stage), orderBy('rings', 'desc'), limit(n));
    const res = await getDocs(q);
    return res.docs.map((d) => d.data() as ScoreEntry);
  }

  /** Guarda un tiempo de carrera si mejora la marca */
  async submitTime(course: string, name: string, timeSec: number): Promise<boolean> {
    if (!this.enabled) return false;
    const u = await this.user();
    if (!u || !this.db) return false;
    const timeMs = Math.round(timeSec * 1000);
    const ref = doc(this.db, 'times', `${course}_${u.uid}`);
    try {
      const snap = await getDoc(ref);
      if (snap.exists() && (snap.data().timeMs ?? Infinity) <= timeMs) return false;
      await setDoc(ref, { uid: u.uid, name: name.slice(0, 16) || 'Piloto', course, timeMs, updatedAt: serverTimestamp() });
      return true;
    } catch (e) {
      console.warn('[firebase] error guardando tiempo', e);
      return false;
    }
  }

  async topTimes(course: string, n = 10): Promise<TimeEntry[]> {
    if (!this.enabled) return [];
    this.init();
    if (!this.db) return [];
    await this.user();
    const q = query(collection(this.db, 'times'), where('course', '==', course), orderBy('timeMs', 'asc'), limit(n));
    const res = await getDocs(q);
    return res.docs.map((d) => d.data() as TimeEntry);
  }
}

export const firebase = new FirebaseService();
