import { timingSafeEqual } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

const trimSlash = (s: string) => s.replace(/\/+$/, '');

export type WalrusNetwork = 'mainnet' | 'testnet';

const TESTNET = {
  publisher: 'https://publisher.walrus-testnet.walrus.space',
  aggregator: 'https://aggregator.walrus-testnet.walrus.space',
};
/** Mainnet has public aggregators but no public publisher: writing needs your own (authenticated) one. */
const MAINNET = {
  publisher: '',
  aggregator: 'https://aggregator.walrus-mainnet.walrus.space',
};

/** WALRUS_NETWORK wins; otherwise guess from the URLs so an old .env keeps behaving the same. */
export function detectNetwork(env: Record<string, string | undefined> = process.env): WalrusNetwork {
  const explicit = (env.WALRUS_NETWORK || '').toLowerCase();
  if (explicit === 'mainnet' || explicit === 'testnet') return explicit;
  const urls = `${env.WALRUS_PUBLISHER_URL ?? ''} ${env.WALRUS_AGGREGATOR_URL ?? ''}`;
  return /mainnet/i.test(urls) && !/testnet/i.test(urls) ? 'mainnet' : 'testnet';
}

export function walrusEnv() {
  const network = detectNetwork();
  const d = network === 'mainnet' ? MAINNET : TESTNET;
  const mode = process.env.WALRUS_MODE === 'mock' ? 'mock' : 'walrus';
  const publisher = trimSlash(process.env.WALRUS_PUBLISHER_URL || d.publisher);
  return {
    mode: mode as 'walrus' | 'mock',
    network,
    publisher,
    aggregator: trimSlash(process.env.WALRUS_AGGREGATOR_URL || d.aggregator),
    /** Sent as `Authorization: Bearer` when your publisher is JWT-protected. */
    publisherToken: process.env.WALRUS_PUBLISHER_TOKEN || '',
    /** True when blobs can actually be written (mock mode, or a publisher is configured). */
    canWrite: mode === 'mock' || publisher.length > 0,
    /** Records are tiny; refuse anything big so the proxy can't be used as free file hosting. */
    maxBytes: 64 * 1024,
    maxEpochs: 53,
    mockDir: process.env.WALMARK_MOCK_DIR || path.join(os.tmpdir(), 'walmark-mock'),
  };
}

/** The Walrus docs call the key MEMWAL_PRIVATE_KEY, so accept both names. */
export function memwalEnv() {
  return {
    key: process.env.MEMWAL_KEY || process.env.MEMWAL_PRIVATE_KEY || '',
    accountId: process.env.MEMWAL_ACCOUNT_ID || '',
    serverUrl: process.env.MEMWAL_SERVER_URL || '',
    namespace: process.env.MEMWAL_NAMESPACE || 'walmark',
    token: process.env.WALMARK_ACCESS_TOKEN || '',
  };
}

/** Names (never values) of the settings the MemWal backend still needs. */
export function memwalMissing(): string[] {
  const e = memwalEnv();
  const out: string[] = [];
  if (walrusEnv().mode !== 'mock') {
    if (!e.key) out.push('MEMWAL_KEY');
    if (!e.accountId) out.push('MEMWAL_ACCOUNT_ID');
  }
  if (!e.token) out.push('WALMARK_ACCESS_TOKEN');
  return out;
}

/** Chain IDs the Tatum gateway reports, used to catch a testnet URL on a mainnet setup. */
export const CHAIN_IDS: Record<WalrusNetwork, string> = { mainnet: '35834a8a', testnet: '4c78adac' };

/**
 * Direct Sui + Walrus backend: the server signs Walrus transactions with its own Sui wallet and talks to
 * Sui through the Tatum RPC gateway (x-api-key header). Never exposed to the browser.
 */
export function suiEnv() {
  const network = detectNetwork();
  const rpcUrl = trimSlash(process.env.SUI_RPC_URL || `https://sui-${network}.gateway.tatum.io`);
  const relay = process.env.WALRUS_UPLOAD_RELAY_URL;
  return {
    network,
    rpcUrl,
    usesTatum: /tatum\.io/i.test(rpcUrl),
    tatumKey: process.env.TATUM_API_KEY || '',
    privateKey: process.env.SUI_PRIVATE_KEY || '',
    /** The public relay does the ~2000 storage-node writes for a small SUI tip. "none" talks to the nodes directly. */
    uploadRelay: relay === 'none' ? '' : trimSlash(relay || `https://upload-relay.${network}.walrus.space`),
    token: process.env.WALMARK_ACCESS_TOKEN || '',
    /** Hard stop so a leaked token cannot drain the wallet. */
    maxWritesPerDay: Math.max(1, parseInt(process.env.WALMARK_MAX_WRITES_PER_DAY ?? '300', 10) || 300),
  };
}

/** Names (never values) still missing for the direct backend. Mock mode only needs the access token. */
export function suiMissing(): string[] {
  const e = suiEnv();
  const out: string[] = [];
  if (walrusEnv().mode !== 'mock') {
    if (e.usesTatum && !e.tatumKey) out.push('TATUM_API_KEY');
    if (!e.privateKey) out.push('SUI_PRIVATE_KEY');
  }
  if (!e.token) out.push('WALMARK_ACCESS_TOKEN');
  return out;
}

export function suiEnabled(): boolean {
  return suiMissing().length === 0;
}

/** MemWal writes with a server-held key, so it stays off unless an access token protects it. */
export function memwalEnabled(): boolean {
  return memwalMissing().length === 0;
}

/** Which network the MemWal relayer is on. An empty URL means the SDK default, which is mainnet. */
export function memwalNetwork(): 'mainnet' | 'testnet' | 'custom' {
  const url = memwalEnv().serverUrl;
  if (!url || /relayer\.memory\.walrus\.xyz/i.test(url)) return 'mainnet';
  if (/dev\.memwal\.ai/i.test(url)) return 'testnet';
  return 'custom';
}

export function checkToken(req: Request): boolean {
  const expected = Buffer.from(memwalEnv().token);
  const given = Buffer.from(req.headers.get('x-walmark-token') ?? '');
  return expected.length > 0 && expected.length === given.length && timingSafeEqual(expected, given);
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { 'cache-control': 'no-store' } });
}

const hits = new Map<string, number[]>();

/** Tiny in-memory sliding-window limiter (per server instance) - enough to stop casual abuse. */
export function limited(req: Request, bucket: string, max: number, windowMs = 60_000): boolean {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';
  const key = `${bucket}:${ip}`;
  const now = Date.now();
  const arr = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  arr.push(now);
  hits.set(key, arr);
  if (hits.size > 5000) hits.clear();
  return arr.length > max;
}

export async function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}
