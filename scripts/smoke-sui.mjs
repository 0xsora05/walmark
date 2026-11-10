// npm run smoke:sui
// Real end-to-end check of the direct Sui + Walrus backend: writes ONE tiny blob through the running app
// (so it spends a little SUI gas and WAL), reads it back from the Walrus aggregator, and verifies the
// blob object on Sui through the Tatum RPC. Start the app first (npm run dev), then run this.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadProjectEnv } from './lib/envfile.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { env } = loadProjectEnv(root);
const base = (process.argv[2] || process.env.BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
const token = env.get('WALMARK_ACCESS_TOKEN');
if (!token) {
  console.error('WALMARK_ACCESS_TOKEN is not set. Run npm run setup:mainnet first.');
  process.exit(1);
}
const h = { 'x-walmark-token': token };
const step = (m) => console.log(`  ${m}`);
const die = (m) => {
  console.error(`\n[FAIL] ${m}`);
  process.exit(1);
};
async function json(res) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) die(`${res.url.replace(base, '')} -> HTTP ${res.status}: ${body.error ?? 'no message'}`);
  return body;
}

console.log(`\nWalMark smoke test against ${base}\n`);
const cfg = await json(await fetch(`${base}/api/config`).catch(() => die(`Cannot reach ${base}. Is the app running (npm run dev)?`)));
if (!cfg.sui?.enabled) die(`The direct backend is off on the server. Missing: ${(cfg.sui?.missing ?? []).join(', ') || 'unknown'}. Restart the app after editing .env.local.`);
step(`server: ${cfg.sui.network}, Sui RPC ${cfg.sui.rpcHost}${cfg.sui.tatum ? ' (Tatum)' : ''}`);

const st = await json(await fetch(`${base}/api/sui/status`, { headers: h }));
if (st.error) die(st.error);
step(`wallet ${st.address.slice(0, 10)}…  SUI ${st.sui}  WAL ${st.wal}  epoch ${st.epoch}${st.estCostWal ? `  ≈${st.estCostWal} WAL/mark` : ''}`);
if (Number(st.wal) <= 0) die('The wallet has no WAL. Swap some SUI for WAL first.');
if (Number(st.sui) <= 0) die('The wallet has no SUI for gas.');

const payload = new TextEncoder().encode(JSON.stringify({ app: 'walmark-smoke', at: new Date().toISOString() }));
step('writing a tiny blob (this can take 10-60 s)…');
const t0 = Date.now();
const w = await json(await fetch(`${base}/api/sui/store?epochs=1`, { method: 'POST', headers: { ...h, 'content-type': 'application/octet-stream' }, body: payload }));
step(`stored in ${((Date.now() - t0) / 1000).toFixed(1)} s  blobId=${w.blobId}  object=${w.blobObjectId}`);

const v = await json(await fetch(`${base}/api/sui/verify?id=${w.blobObjectId}&blobId=${w.blobId}`, { headers: h }));
step(`on chain: certified=${v.certified}  blobId match=${v.matchesBlobId}  epochs left=${v.epochsLeft}  verified=${v.verified}`);
if (!v.verified) die('The blob object is not verified on Sui.');

let back;
for (let i = 0; i < 6 && !back; i++) {
  const r = await fetch(`${base}/api/walrus/blob/${w.blobId}`);
  if (r.ok) back = new Uint8Array(await r.arrayBuffer());
  else await new Promise((r) => setTimeout(r, 2000));
}
if (!back) die('Stored, but the aggregator did not return the blob yet. Try again in a minute.');
if (new TextDecoder().decode(back) !== new TextDecoder().decode(payload)) die('The blob read back does not match what was written.');
step('read back from the Walrus aggregator: identical');
console.log(`\nAll good. Explorer: https://suiscan.xyz/${w.network === 'mainnet' ? 'mainnet' : 'testnet'}/object/${w.blobObjectId}\n`);
