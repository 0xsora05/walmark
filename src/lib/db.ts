import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { DocRecord, MemoryRecord } from './types';

interface WalmarkDB extends DBSchema {
  docs: { key: string; value: DocRecord };
  files: { key: string; value: ArrayBuffer };
  memories: {
    key: string;
    value: MemoryRecord;
    indexes: { 'by-doc': string; 'by-created': number };
  };
  kv: { key: string; value: string };
}

let dbPromise: Promise<IDBPDatabase<WalmarkDB>> | null = null;

function db(): Promise<IDBPDatabase<WalmarkDB>> {
  if (!dbPromise) {
    dbPromise = openDB<WalmarkDB>('walmark', 1, {
      upgrade(d) {
        d.createObjectStore('docs', { keyPath: 'id' });
        d.createObjectStore('files');
        const mem = d.createObjectStore('memories', { keyPath: 'id' });
        mem.createIndex('by-doc', 'docId');
        mem.createIndex('by-created', 'createdAt');
        d.createObjectStore('kv');
      },
    });
  }
  return dbPromise;
}

export function uid(): string {
  const b = crypto.getRandomValues(new Uint8Array(9));
  return Array.from(b, (x) => x.toString(36).padStart(2, '0')).join('').slice(0, 12);
}

export async function listDocs(): Promise<DocRecord[]> {
  const all = await (await db()).getAll('docs');
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

export async function getDoc(id: string): Promise<DocRecord | undefined> {
  return (await db()).get('docs', id);
}

export async function putDoc(doc: DocRecord, file?: ArrayBuffer): Promise<void> {
  const d = await db();
  const tx = d.transaction(['docs', 'files'], 'readwrite');
  await tx.objectStore('docs').put(doc);
  if (file) await tx.objectStore('files').put(file, doc.id);
  await tx.done;
}

export async function getFile(docId: string): Promise<ArrayBuffer | undefined> {
  return (await db()).get('files', docId);
}

export async function deleteDoc(id: string): Promise<void> {
  const d = await db();
  const tx = d.transaction(['docs', 'files'], 'readwrite');
  await tx.objectStore('docs').delete(id);
  await tx.objectStore('files').delete(id);
  await tx.done;
}

export async function listMemories(): Promise<MemoryRecord[]> {
  const all = await (await db()).getAll('memories');
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

export async function putMemory(m: MemoryRecord): Promise<void> {
  await (await db()).put('memories', m);
}

export async function deleteMemory(id: string): Promise<void> {
  await (await db()).delete('memories', id);
}

export async function getKV(key: string): Promise<string | undefined> {
  return (await db()).get('kv', key);
}

export async function setKV(key: string, value: string): Promise<void> {
  await (await db()).put('kv', value, key);
}

export async function wipeAll(): Promise<void> {
  const d = await db();
  const tx = d.transaction(['docs', 'files', 'memories', 'kv'], 'readwrite');
  await Promise.all([
    tx.objectStore('docs').clear(),
    tx.objectStore('files').clear(),
    tx.objectStore('memories').clear(),
    tx.objectStore('kv').clear(),
  ]);
  await tx.done;
}
