import { openDB, type IDBPDatabase } from 'idb';
import type { PersistedState } from '../engine/core/types';

const DB_NAME = 'zhiyu-db';
const STORE = 'saves';
const KEY = 'current';

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, 1, {
      upgrade(db) {
        db.createObjectStore(STORE);
      },
    });
  }
  return dbPromise;
}

export async function saveGame(state: PersistedState): Promise<void> {
  const db = await getDB();
  await db.put(STORE, state, KEY);
}

export async function loadGame(): Promise<PersistedState | undefined> {
  const db = await getDB();
  return db.get(STORE, KEY);
}

export async function clearSave(): Promise<void> {
  const db = await getDB();
  await db.delete(STORE, KEY);
}
