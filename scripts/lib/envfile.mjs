// Tiny .env reader/writer shared by `npm run setup:mainnet` and `npm run doctor`.
// It never prints values; callers decide what is safe to show.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export function parseEnv(text) {
  const out = new Map();
  for (const raw of text.split(/\r?\n/)) {
    const m = raw.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, '');
    out.set(m[1], v);
  }
  return out;
}

const eolOf = (text) => (text.includes('\r\n') ? '\r\n' : '\n');
const keyLine = (key) => new RegExp(`^\\s*(?:export\\s+)?${key}\\s*=`);

/** Replace every active `KEY=` line with one `KEY=value` (or append it). Comments and other keys stay. */
export function setEnv(text, key, value) {
  const eol = eolOf(text);
  const lines = text.length ? text.split(/\r?\n/) : [];
  let done = false;
  const next = [];
  for (const line of lines) {
    if (keyLine(key).test(line)) {
      if (!done) next.push(`${key}=${value}`);
      done = true;
    } else next.push(line);
  }
  if (!done) {
    while (next.length && next[next.length - 1] === '') next.pop();
    next.push(`${key}=${value}`);
  }
  return next.join(eol).replace(/(\r?\n)*$/, eol);
}

export function removeEnv(text, key) {
  const eol = eolOf(text);
  return text
    .split(/\r?\n/)
    .filter((l) => !keyLine(key).test(l))
    .join(eol);
}

/** Same precedence Next.js uses: real environment > .env.local > .env. */
export function loadProjectEnv(dir) {
  const merged = new Map();
  const files = [];
  for (const name of ['.env', '.env.local']) {
    const p = path.join(dir, name);
    if (!existsSync(p)) continue;
    files.push(name);
    for (const [k, v] of parseEnv(readFileSync(p, 'utf8'))) merged.set(k, v);
  }
  for (const k of [
    'WALRUS_MODE',
    'WALRUS_NETWORK',
    'WALRUS_PUBLISHER_URL',
    'WALRUS_AGGREGATOR_URL',
    'WALRUS_PUBLISHER_TOKEN',
    'WALRUS_UPLOAD_RELAY_URL',
    'TATUM_API_KEY',
    'SUI_PRIVATE_KEY',
    'SUI_RPC_URL',
    'WALMARK_MAX_WRITES_PER_DAY',
    'MEMWAL_KEY',
    'MEMWAL_PRIVATE_KEY',
    'MEMWAL_ACCOUNT_ID',
    'MEMWAL_SERVER_URL',
    'MEMWAL_NAMESPACE',
    'WALMARK_ACCESS_TOKEN',
  ]) {
    if (process.env[k]) merged.set(k, process.env[k]);
  }
  return { env: merged, files };
}

export const looksLikeSuiId = (v) => /^0x[0-9a-fA-F]{64}$/.test(v);
export const looksLikeKey = (v) => /^(0x)?[0-9a-fA-F]{64}$/.test(v) || /^suiprivkey1[0-9a-z]+$/.test(v);

export const looksLikeSuiKey = (v) => /^(0x)?[0-9a-fA-F]{64}$/.test(v) || /^suiprivkey1[0-9a-z]+$/.test(v);
