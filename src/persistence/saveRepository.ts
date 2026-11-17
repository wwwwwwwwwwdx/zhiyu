import { openDB, deleteDB, type IDBPDatabase } from 'idb';
import type { PersistedState } from '../engine/core/types';
import { isPersistedState } from './migrate';

const DB_NAME = 'zhiyu-db';
const STORE = 'saves';
const KEY = 'current';
const BACKUP_KEY = 'zhiyu-save-backup';

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

// 结构损坏时携带原始数据抛错，交由上层备份，避免静默丢档
export class CorruptedSaveError extends Error {
  constructor(message: string, readonly raw: unknown) {
    super(message);
    this.name = 'CorruptedSaveError';
  }
}

export async function saveGame(state: PersistedState): Promise<void> {
  const db = await getDB();
  await db.put(STORE, state, KEY);
}

export async function loadGame(): Promise<PersistedState | undefined> {
  const db = await getDB();
  const raw: unknown = await db.get(STORE, KEY);
  if (raw === undefined) return undefined;
  if (!isPersistedState(raw)) throw new CorruptedSaveError('存档结构损坏', raw);
  return raw;
}

export async function clearSave(): Promise<void> {
  const db = await getDB();
  await db.delete(STORE, KEY);
}

// 把损坏的原始数据留在 localStorage，保证不静默丢档；返回是否备份成功
export function backupCorruptedSave(raw: unknown): boolean {
  try {
    if (typeof localStorage === 'undefined') return false;
    localStorage.setItem(BACKUP_KEY, JSON.stringify({ at: Date.now(), raw }));
    return true;
  } catch {
    return false;
  }
}

// 库结构损坏（如 object store 缺失）时重建，保证后续自动保存仍可写入
export async function resetSaveDatabase(): Promise<void> {
  try {
    const db = await getDB();
    db.close();
  } catch {
    // 打开失败也要继续删库重建
  }
  dbPromise = null;
  await deleteDB(DB_NAME);
  await getDB();
}
