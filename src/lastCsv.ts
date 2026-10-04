import { readStoredExtended } from "./coreExtend";
import type { Mon } from "./types";

/**
 * Last inventory CSV, kept in IndexedDB.
 * localStorage is a 5 MiB UTF-16 quota (~2.5M characters) shared with the
 * meta caches, and a full box export sits on that ceiling.
 */

export interface StoredCsv {
  name: string;
  text: string;
  size: number;
  lastModified: number;
}

const DB_NAME = "pogo-grader";
const DB_VERSION = 1;
const STORE = "lastCsv";
const KEY = "current";
const CORE_KEY = "core";
export const CORE_EXTENDED_KEY = "coreExtended";

let dbPromise: Promise<IDBDatabase> | null = null;
let queue: Promise<unknown> = Promise.resolve();

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("This browser has no local database."));
  }
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) {
          req.result.createObjectStore(STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error("Could not open local database"));
    });
    dbPromise.catch(() => {
      dbPromise = null;
    });
  }
  return dbPromise;
}

function requestToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Storage request failed"));
  });
}

function isStoredCsv(value: unknown): value is StoredCsv {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<StoredCsv>;
  return (
    typeof row.name === "string" &&
    row.name.length > 0 &&
    typeof row.text === "string" &&
    typeof row.size === "number" &&
    Number.isFinite(row.size) &&
    typeof row.lastModified === "number" &&
    Number.isFinite(row.lastModified)
  );
}

export function saveLastCsv(row: StoredCsv): Promise<void> {
  return enqueue(async () => {
    const db = await openDb();
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(row, KEY);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("Could not keep the CSV"));
      tx.onabort = () => reject(tx.error ?? new Error("Could not keep the CSV"));
    });
  });
}

async function deleteStored(): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE, "readwrite");
  tx.objectStore(STORE).delete(KEY);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Could not remove the stored CSV"));
    tx.onabort = () => reject(tx.error ?? new Error("Could not remove the stored CSV"));
  });
}

export function loadLastCsv(): Promise<StoredCsv | null> {
  return enqueue(async () => {
    const db = await openDb();
    const tx = db.transaction(STORE, "readonly");
    const value = await requestToPromise(tx.objectStore(STORE).get(KEY));
    if (value == null) return null;
    if (!isStoredCsv(value)) {
      await deleteStored();
      return null;
    }
    return value;
  });
}

export function clearLastCsv(): Promise<void> {
  return enqueue(() => deleteStored());
}

function putStored(key: string, row: StoredCsv): Promise<void> {
  return enqueue(async () => {
    const db = await openDb();
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(row, key);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("Could not keep the CSV"));
      tx.onabort = () => reject(tx.error ?? new Error("Could not keep the CSV"));
    });
  });
}

function loadStored(key: string): Promise<StoredCsv | null> {
  return enqueue(async () => {
    const db = await openDb();
    const tx = db.transaction(STORE, "readonly");
    const value = await requestToPromise(tx.objectStore(STORE).get(key));
    if (value == null) return null;
    if (!isStoredCsv(value)) {
      const drop = db.transaction(STORE, "readwrite");
      drop.objectStore(STORE).delete(key);
      await new Promise<void>((resolve, reject) => {
        drop.oncomplete = () => resolve();
        drop.onerror = () => reject(drop.error ?? new Error("Could not remove the stored CSV"));
        drop.onabort = () => reject(drop.error ?? new Error("Could not remove the stored CSV"));
      });
      return null;
    }
    return value;
  });
}

export function saveCoreCsv(row: StoredCsv): Promise<void> {
  return putStored(CORE_KEY, row);
}

export function loadCoreCsv(): Promise<StoredCsv | null> {
  return loadStored(CORE_KEY);
}

export function clearCoreCsv(): Promise<void> {
  return enqueue(() => deleteKey(CORE_KEY, "Could not remove the stored core CSV"));
}

async function writeKey(key: string, value: unknown, failure: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE, "readwrite");
  tx.objectStore(STORE).put(value, key);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error(failure));
    tx.onabort = () => reject(tx.error ?? new Error(failure));
  });
}

async function deleteKey(key: string, failure: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(STORE, "readwrite");
  tx.objectStore(STORE).delete(key);
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error(failure));
    tx.onabort = () => reject(tx.error ?? new Error(failure));
  });
}

export function saveCoreExtended(mons: Mon[]): Promise<void> {
  return enqueue(() => writeKey(CORE_EXTENDED_KEY, { mons }, "Could not keep the extended core"));
}

export function loadCoreExtended(): Promise<Mon[]> {
  return enqueue(async () => {
    const db = await openDb();
    const tx = db.transaction(STORE, "readonly");
    const value = await requestToPromise(tx.objectStore(STORE).get(CORE_EXTENDED_KEY));
    if (value == null) return [];
    const read = readStoredExtended(value);
    if (!read.ok) {
      await deleteKey(CORE_EXTENDED_KEY, "Could not remove the extended core");
      return [];
    }
    if (read.dirty) await writeKey(CORE_EXTENDED_KEY, { mons: read.mons }, "Could not keep the extended core");
    return read.mons;
  });
}

export function clearCoreExtended(): Promise<void> {
  return enqueue(() => deleteKey(CORE_EXTENDED_KEY, "Could not remove the extended core"));
}
