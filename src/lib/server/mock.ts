import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** Offline stand-in for a Walrus publisher/aggregator (WALRUS_MODE=mock). Content-addressed like the real thing. */

export const BLOB_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

export async function mockStore(dir: string, bytes: Uint8Array): Promise<string> {
  const id = 'mock' + createHash('sha256').update(bytes).digest('base64url').slice(0, 39);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, id), bytes);
  return id;
}

export async function mockRead(dir: string, id: string): Promise<Buffer | null> {
  if (!BLOB_ID_RE.test(id)) return null;
  try {
    return await readFile(path.join(dir, id));
  } catch {
    return null;
  }
}

/**
 * Offline stand-in for the MemWal relayer (WALRUS_MODE=mock): remembers text in a JSON file and recalls by word overlap.
 * Good enough to exercise the whole app, including the learning loop, without a network.
 */
interface MockMemory {
  id: string;
  blobId: string;
  text: string;
  createdAt: number;
}

const words = (t: string) => new Set((t.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => w.length > 1));

async function loadMemwal(dir: string): Promise<MockMemory[]> {
  try {
    return JSON.parse(await readFile(path.join(dir, 'memwal.json'), 'utf8')) as MockMemory[];
  } catch {
    return [];
  }
}

export async function mockMemwalRemember(dir: string, text: string): Promise<{ id: string; blobId: string }> {
  const all = await loadMemwal(dir);
  const id = 'mm' + createHash('sha256').update(text + all.length).digest('hex').slice(0, 20);
  const blobId = 'mockmw' + createHash('sha256').update(text).digest('base64url').slice(0, 36);
  all.push({ id, blobId, text, createdAt: Date.now() });
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, 'memwal.json'), JSON.stringify(all));
  return { id, blobId };
}

export async function mockMemwalRecall(dir: string, query: string, limit: number) {
  const q = words(query);
  const scored = (await loadMemwal(dir))
    .map((m) => {
      const w = words(m.text);
      let hit = 0;
      for (const t of q) if (w.has(t)) hit++;
      return { m, score: q.size ? hit / q.size : 0 };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || b.m.createdAt - a.m.createdAt)
    .slice(0, limit);
  return scored.map((x) => ({ text: x.m.text, distance: 1 - x.score, blobId: x.m.blobId, createdAt: String(x.m.createdAt) }));
}
