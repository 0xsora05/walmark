import { getKV, setKV } from './db';

/**
 * Walrus blobs are public by default, so anything private is encrypted here first.
 * Blob layout: [0x01 version][12-byte IV][AES-256-GCM ciphertext+tag].
 * The key never leaves the browser except through the explicit "Export backup" action.
 */

const VERSION = 1;
const KEY_NAME = 'aes-key';

export function bytesToB64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function b64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function importRaw(raw: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

async function getKeyB64(): Promise<string> {
  let b64 = await getKV(KEY_NAME);
  if (!b64) {
    b64 = bytesToB64(crypto.getRandomValues(new Uint8Array(32)));
    await setKV(KEY_NAME, b64);
  }
  return b64;
}

export async function exportKey(): Promise<string> {
  return getKeyB64();
}

export async function importKey(b64: string): Promise<void> {
  const raw = b64ToBytes(b64.trim());
  if (raw.length !== 32) throw new Error('Encryption key must be 32 bytes (base64).');
  await setKV(KEY_NAME, b64.trim());
}

export async function encryptJson(value: unknown): Promise<Uint8Array<ArrayBuffer>> {
  const key = await importRaw(b64ToBytes(await getKeyB64()));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = new TextEncoder().encode(JSON.stringify(value));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain));
  const out = new Uint8Array(1 + iv.length + cipher.length);
  out[0] = VERSION;
  out.set(iv, 1);
  out.set(cipher, 1 + iv.length);
  return out;
}

export function plainJsonBytes(value: unknown): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(JSON.stringify(value));
}

/** Accepts both encrypted blobs and plain JSON blobs (when encryption was switched off). */
export async function decodeBlob<T>(bytes: Uint8Array<ArrayBuffer>): Promise<T> {
  if (bytes[0] === VERSION) {
    const key = await importRaw(b64ToBytes(await getKeyB64()));
    const iv = bytes.slice(1, 13);
    const body = bytes.slice(13);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, body);
    return JSON.parse(new TextDecoder().decode(plain)) as T;
  }
  return JSON.parse(new TextDecoder().decode(bytes)) as T;
}
