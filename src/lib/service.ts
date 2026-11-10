import { b64ToBytes, decodeBlob, encryptJson, exportKey, importKey, plainJsonBytes } from './crypto';
import { getKV, listMemories, putMemory, setKV, uid } from './db';
import { formatLearnText, formatMemwalText, parseLearnText, parseMemwalText } from './memwalFormat';
import { learnableTerms, tokenize } from './search';
import type { LearnPayload, MemoryPayload, MemoryRecord, Settings } from './types';

/* ------------------------------------------------------------------ */
/* Thin clients for our own API routes                                 */
/* ------------------------------------------------------------------ */

async function errorFrom(res: Response): Promise<Error> {
  let msg = `${res.status} ${res.statusText}`;
  try {
    const j = (await res.json()) as { error?: string; detail?: string };
    if (j.error) msg = j.detail ? `${j.error} (${j.detail})` : j.error;
  } catch {
    /* not JSON */
  }
  return new Error(msg);
}

export async function storeBlob(bytes: Uint8Array<ArrayBuffer>, epochs: number): Promise<{ blobId: string; endEpoch?: number }> {
  const res = await fetch(`/api/walrus/store?epochs=${epochs}`, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream' },
    body: bytes,
  });
  if (!res.ok) throw await errorFrom(res);
  return (await res.json()) as { blobId: string; endEpoch?: number };
}

export async function readBlob(blobId: string): Promise<Uint8Array<ArrayBuffer>> {
  const res = await fetch(`/api/walrus/blob/${encodeURIComponent(blobId)}`);
  if (!res.ok) throw await errorFrom(res);
  return new Uint8Array(await res.arrayBuffer());
}

export interface WalrusHealth {
  ok: boolean;
  mode: 'walrus' | 'mock';
  network?: 'mainnet' | 'testnet';
  latencyMs: number;
  aggregator?: { host: string; ok: boolean };
  publisher?: { host: string; ok: boolean; configured?: boolean };
  memwal?: { ok: boolean; network: 'mainnet' | 'testnet' | 'custom'; writeReady?: boolean };
}

export async function checkWalrus(): Promise<WalrusHealth> {
  const res = await fetch('/api/walrus/health');
  if (!res.ok) throw await errorFrom(res);
  return (await res.json()) as WalrusHealth;
}

export interface SuiVerify {
  mock?: boolean;
  exists: boolean;
  isWalrusBlob: boolean;
  certified?: boolean;
  matchesBlobId?: boolean;
  size?: number;
  endEpoch?: number;
  currentEpoch?: number;
  epochsLeft?: number;
  verified: boolean;
}

export async function verifyOnSui(m: MemoryRecord, s: Settings): Promise<SuiVerify> {
  const q = new URLSearchParams({ id: m.suiObjectId ?? '', blobId: m.blobId ?? '' });
  const res = await fetch(`/api/sui/verify?${q}`, { headers: { 'x-walmark-token': s.accessToken } });
  if (!res.ok) throw await errorFrom(res);
  return (await res.json()) as SuiVerify;
}

export interface SuiWalletStatus {
  mock?: boolean;
  network: 'mainnet' | 'testnet';
  rpcHost: string;
  rpcOk: boolean;
  latencyMs: number;
  chainMatches?: boolean;
  epoch?: number;
  address?: string;
  sui?: string;
  wal?: string;
  uploadRelay: string | null;
  estCostWal?: string;
  error?: string;
}

export async function suiStatus(s: Settings): Promise<SuiWalletStatus> {
  const res = await fetch(`/api/sui/status?epochs=${s.epochs}`, { headers: { 'x-walmark-token': s.accessToken } });
  if (!res.ok) throw await errorFrom(res);
  return (await res.json()) as SuiWalletStatus;
}

const authHeaders = (s: Settings): Record<string, string> => ({
  'content-type': 'application/json',
  'x-walmark-token': s.accessToken,
});

/* ------------------------------------------------------------------ */
/* Saving                                                              */
/* ------------------------------------------------------------------ */

export interface SaveRequest {
  word: string;
  context: string;
  note?: string;
  docId: string;
  docTitle: string;
  page: number;
}

function toPayload(m: MemoryRecord): MemoryPayload {
  return {
    v: 1,
    app: 'walmark',
    id: m.id,
    word: m.word,
    context: m.context,
    note: m.note,
    docId: m.docId,
    docTitle: m.docTitle,
    page: m.page,
    createdAt: m.createdAt,
  };
}

async function syncMemory(m: MemoryRecord, s: Settings): Promise<void> {
  if (s.backend === 'memwal') {
    const res = await fetch('/api/memwal/remember', {
      method: 'POST',
      headers: authHeaders(s),
      body: JSON.stringify({ text: formatMemwalText(m) }),
    });
    if (!res.ok) throw await errorFrom(res);
    const r = (await res.json()) as { blobId?: string };
    m.backend = 'memwal';
    m.blobId = r.blobId;
    m.encrypted = true; // MemWal encrypts with SEAL
  } else if (s.backend === 'sui') {
    const payload = toPayload(m);
    const bytes = s.encrypt ? await encryptJson(payload) : plainJsonBytes(payload);
    const res = await fetch(`/api/sui/store?epochs=${s.epochs}`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream', 'x-walmark-token': s.accessToken },
      body: bytes,
    });
    if (!res.ok) throw await errorFrom(res);
    const r = (await res.json()) as { blobId: string; blobObjectId?: string };
    m.backend = 'sui';
    m.blobId = r.blobId;
    m.suiObjectId = r.blobObjectId || undefined;
    m.encrypted = s.encrypt;
  } else {
    const payload = toPayload(m);
    const bytes = s.encrypt ? await encryptJson(payload) : plainJsonBytes(payload);
    const r = await storeBlob(bytes, s.epochs);
    m.backend = 'walrus';
    m.blobId = r.blobId;
    m.encrypted = s.encrypt;
  }
  m.status = 'synced';
  m.error = undefined;
}

/** The mark is written locally first, so nothing is lost if Walrus is slow or down. */
export async function saveMemory(req: SaveRequest, s: Settings): Promise<MemoryRecord> {
  const m: MemoryRecord = {
    id: uid(),
    word: req.word,
    context: req.context,
    note: req.note?.trim() || undefined,
    docId: req.docId,
    docTitle: req.docTitle,
    page: req.page,
    createdAt: Date.now(),
    backend: s.backend,
    status: 'local',
  };
  await putMemory(m);
  try {
    await syncMemory(m, s);
  } catch (e) {
    m.status = 'failed';
    m.error = e instanceof Error ? e.message : String(e);
  }
  await putMemory(m);
  return m;
}

export async function retrySync(m: MemoryRecord, s: Settings): Promise<MemoryRecord> {
  const next = { ...m };
  try {
    await syncMemory(next, s);
  } catch (e) {
    next.status = 'failed';
    next.error = e instanceof Error ? e.message : String(e);
  }
  await putMemory(next);
  return next;
}

/* ------------------------------------------------------------------ */
/* Semantic recall (MemWal)                                            */
/* ------------------------------------------------------------------ */

export interface SemanticHit {
  memory: MemoryRecord;
  distance: number;
  /** Set when this hit came from a lesson you taught it earlier, not from the mark itself. */
  learned?: boolean;
}

export async function memwalRecall(query: string, s: Settings, limit = 6): Promise<SemanticHit[]> {
  const res = await fetch('/api/memwal/recall', {
    method: 'POST',
    headers: authHeaders(s),
    body: JSON.stringify({ query, limit }),
  });
  if (!res.ok) throw await errorFrom(res);
  const data = (await res.json()) as { results: { text: string; distance: number; blobId?: string }[] };
  const out: SemanticHit[] = [];
  const local = new Map((await listMemories()).map((m) => [m.id, m]));
  for (const r of data.results) {
    const lesson = parseLearnText(r.text);
    if (lesson) {
      const m = local.get(lesson.memoryId);
      if (m && lesson.kind === 'alias') out.push({ distance: r.distance, memory: m, learned: true });
      continue;
    }
    const p = parseMemwalText(r.text);
    if (!p) continue;
    out.push({
      distance: r.distance,
      memory: {
        id: p.id,
        word: p.word,
        context: p.context,
        note: p.note,
        docId: p.docId,
        docTitle: p.docTitle,
        page: p.page,
        createdAt: p.createdAt,
        backend: 'memwal',
        blobId: r.blobId,
        status: 'synced',
        encrypted: true,
      },
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Learning loop: the app gets sharper from what you confirm           */
/* ------------------------------------------------------------------ */

const LEARN_WRITES_KEY = 'learnWrites';

export async function learnWrites(): Promise<number> {
  return parseInt((await getKV(LEARN_WRITES_KEY)) ?? '0', 10) || 0;
}

async function writeLesson(p: LearnPayload, s: Settings): Promise<void> {
  const res = await fetch('/api/memwal/remember', {
    method: 'POST',
    headers: authHeaders(s),
    body: JSON.stringify({ text: formatLearnText(p) }),
  });
  if (!res.ok) throw await errorFrom(res);
  await setKV(LEARN_WRITES_KEY, String((await learnWrites()) + 1));
}

export interface FeedbackResult {
  memory: MemoryRecord;
  /** Terms WalMark just learned (or will now avoid) for this mark. */
  learned: string[];
  /** True when the lesson was also written to Walrus Memory. */
  stored: boolean;
  error?: string;
}

/**
 * "Right one" teaches WalMark that the way you asked is a nickname for this mark, and ranks the mark higher next time.
 * "Not it" teaches it to demote the mark for those words. When MemWal is on, every lesson is also written to
 * Walrus Memory, so the learning follows you to another device and shows up in semantic recall.
 */
export async function giveFeedback(memory: MemoryRecord, query: string, verdict: 'right' | 'wrong', s: Settings): Promise<FeedbackResult> {
  const known = new Set([...tokenize(memory.word), ...(memory.aliases ?? []).flatMap(tokenize)]);
  const terms = learnableTerms(query);
  const fresh = verdict === 'right' ? terms.filter((t) => !known.has(t)) : terms.filter((t) => !(memory.avoid ?? []).includes(t));
  const next: MemoryRecord = { ...memory, lastRecalledAt: Date.now() };
  if (verdict === 'right') {
    next.confirmed = (memory.confirmed ?? 0) + 1;
    next.aliases = [...new Set([...(memory.aliases ?? []), ...fresh])];
    next.avoid = (memory.avoid ?? []).filter((t) => !terms.includes(t));
  } else {
    next.avoid = [...new Set([...(memory.avoid ?? []), ...fresh])];
  }
  await putMemory(next);

  let stored = false;
  let error: string | undefined;
  if (fresh.length > 0 && s.backend === 'memwal') {
    try {
      await writeLesson(
        { v: 1, app: 'walmark', kind: verdict === 'right' ? 'alias' : 'avoid', memoryId: memory.id, word: memory.word, docTitle: memory.docTitle, page: memory.page, terms: fresh, at: Date.now() },
        s,
      );
      stored = true;
    } catch (e) {
      error = e instanceof Error ? e.message : 'Could not write the lesson to Walrus Memory';
    }
  }
  return { memory: next, learned: fresh, stored, error };
}

/** Pulls lessons back out of Walrus Memory and applies them to the marks on this device. */
export async function syncLearning(s: Settings): Promise<{ lessons: number; applied: number }> {
  const res = await fetch('/api/memwal/recall', {
    method: 'POST',
    headers: authHeaders(s),
    body: JSON.stringify({ query: 'Learned: when I ask, I mean', limit: 20 }),
  });
  if (!res.ok) throw await errorFrom(res);
  const data = (await res.json()) as { results: { text: string }[] };
  const lessons = data.results.map((r) => parseLearnText(r.text)).filter((p): p is LearnPayload => p !== null);
  const byId = new Map((await listMemories()).map((m) => [m.id, m]));
  let applied = 0;
  for (const l of lessons) {
    const m = byId.get(l.memoryId);
    if (!m) continue;
    const list = (l.kind === 'alias' ? m.aliases : m.avoid) ?? [];
    const add = l.terms.filter((t) => !list.includes(t));
    if (add.length === 0) continue;
    const next = { ...m };
    if (l.kind === 'alias') {
      next.aliases = [...list, ...add];
      next.confirmed = Math.max(next.confirmed ?? 0, 1);
    } else next.avoid = [...list, ...add];
    await putMemory(next);
    byId.set(m.id, next);
    applied++;
  }
  return { lessons: lessons.length, applied };
}

/* ------------------------------------------------------------------ */
/* MemWal account on Sui (read through Tatum)                          */
/* ------------------------------------------------------------------ */

export interface MemwalAccountStatus {
  mock?: boolean;
  accountId: string;
  network: 'mainnet' | 'testnet';
  rpcHost: string;
  tatum: boolean;
  configured?: boolean;
  rpcOk?: boolean;
  latencyMs?: number;
  chainMatches?: boolean;
  exists?: boolean;
  type?: string;
  version?: string;
  owner?: string;
  delegateKeys?: number;
  error?: string;
}

export async function memwalAccount(s: Settings): Promise<MemwalAccountStatus> {
  const res = await fetch('/api/memwal/account', { headers: { 'x-walmark-token': s.accessToken } });
  if (!res.ok) throw await errorFrom(res);
  return (await res.json()) as MemwalAccountStatus;
}

/** Hackathon progress: how many memories this device has written to Walrus Memory. */
export async function memwalWriteCount(): Promise<{ marks: number; lessons: number; total: number }> {
  const marks = (await listMemories()).filter((m) => m.backend === 'memwal' && m.status === 'synced').length;
  const lessons = await learnWrites();
  return { marks, lessons, total: marks + lessons };
}

/* ------------------------------------------------------------------ */
/* Backup / restore (portable memory)                                  */
/* ------------------------------------------------------------------ */

interface Backup {
  app: 'walmark';
  v: 1;
  exportedAt: number;
  /** AES key (base64). Whoever holds this file can decrypt your Walrus blobs. */
  key: string;
  refs: { id: string; blobId: string; objectId?: string; backend?: 'walrus' | 'sui' }[];
  inline: MemoryRecord[];
}

/** Marks whose content lives in a Walrus blob (plain publisher or direct Sui writes) and can be restored from it. */
function isBlobBacked(m: MemoryRecord): boolean {
  return (m.backend === 'walrus' || m.backend === 'sui') && m.status === 'synced' && Boolean(m.blobId);
}

export async function exportBackup(): Promise<string> {
  const all = await listMemories();
  const backup: Backup = {
    app: 'walmark',
    v: 1,
    exportedAt: Date.now(),
    key: await exportKey(),
    refs: all
      .filter((m) => isBlobBacked(m))
      .map((m) => ({ id: m.id, blobId: m.blobId!, objectId: m.suiObjectId, backend: m.backend as 'walrus' | 'sui' })),
    inline: all.filter((m) => !isBlobBacked(m)),
  };
  return JSON.stringify(backup, null, 2);
}

export interface RestoreResult {
  restored: number;
  skipped: number;
  failed: number;
}

export async function restoreBackup(text: string): Promise<RestoreResult> {
  const b = JSON.parse(text) as Partial<Backup>;
  if (b.app !== 'walmark' || b.v !== 1 || !Array.isArray(b.refs)) throw new Error('This is not a WalMark backup file.');
  if (b.key) {
    b64ToBytes(b.key); // validates base64
    await importKey(b.key);
  }
  const have = new Set((await listMemories()).map((m) => m.id));
  const result: RestoreResult = { restored: 0, skipped: 0, failed: 0 };

  for (const r of b.refs) {
    if (have.has(r.id)) {
      result.skipped++;
      continue;
    }
    try {
      const p = await decodeBlob<MemoryPayload>(await readBlob(r.blobId));
      await putMemory({
        id: p.id,
        word: p.word,
        context: p.context,
        note: p.note,
        docId: p.docId,
        docTitle: p.docTitle,
        page: p.page,
        createdAt: p.createdAt,
        backend: r.backend ?? 'walrus',
        blobId: r.blobId,
        suiObjectId: r.objectId,
        status: 'synced',
        encrypted: true,
      });
      result.restored++;
    } catch {
      result.failed++;
    }
  }
  for (const m of b.inline ?? []) {
    if (have.has(m.id)) {
      result.skipped++;
      continue;
    }
    await putMemory(m);
    result.restored++;
  }
  return result;
}
