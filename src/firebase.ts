import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged, type Auth, type User } from 'firebase/auth';
import {
  getFirestore,
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
import type { StageId } from './stages';

export interface ScoreEntry {
  uid: string;
  name: string;
  stage: StageId;
  rings: number;
  maxSpeed: number;
}

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

class FirebaseService {
  enabled = Boolean(config.apiKey && config.projectId && config.appId);
  private app?: FirebaseApp;
  private auth?: Auth;
  private db?: Firestore;
  private userPromise?: Promise<User | null>;

  private init() {
    if (!this.enabled || this.app) return;
    try {
      this.app = initializeApp(config);
      this.auth = getAuth(this.app);
      this.db = getFirestore(this.app);
    } catch (e) {
      console.warn('[firebase] no se pudo inicializar', e);
      this.enabled = false;
    }
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

  /** Guarda la puntuación si mejora la marca del jugador. Devuelve true si se guardó. */
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

  async uid(): Promise<string | null> {
    return (await this.user())?.uid ?? null;
  }
}

export const firebase = new FirebaseService();
