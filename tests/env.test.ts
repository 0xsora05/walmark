import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { parseEnv, removeEnv, setEnv } from '../scripts/lib/envfile.mjs';
import { detectNetwork, memwalEnabled, memwalEnv, memwalMissing, memwalNetwork, walrusEnv } from '../src/lib/server/env.ts';

const KEYS = [
  'WALRUS_MODE', 'WALRUS_NETWORK', 'WALRUS_PUBLISHER_URL', 'WALRUS_AGGREGATOR_URL', 'WALRUS_PUBLISHER_TOKEN',
  'MEMWAL_KEY', 'MEMWAL_PRIVATE_KEY', 'MEMWAL_ACCOUNT_ID', 'MEMWAL_SERVER_URL', 'WALMARK_ACCESS_TOKEN',
];
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});
function clean(vars: Record<string, string> = {}) {
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, vars);
}

test('mainnet has a public aggregator but no publisher, so blobs are read-only until you add one', () => {
  clean({ WALRUS_NETWORK: 'mainnet' });
  const w = walrusEnv();
  assert.equal(w.network, 'mainnet');
  assert.match(w.aggregator, /walrus-mainnet/);
  assert.equal(w.publisher, '');
  assert.equal(w.canWrite, false);
});

test('your own mainnet publisher makes writes possible and carries the bearer token', () => {
  clean({ WALRUS_NETWORK: 'mainnet', WALRUS_PUBLISHER_URL: 'https://pub.example.com/', WALRUS_PUBLISHER_TOKEN: 'jwt' });
  const w = walrusEnv();
  assert.equal(w.canWrite, true);
  assert.equal(w.publisher, 'https://pub.example.com');
  assert.equal(w.publisherToken, 'jwt');
});

test('testnet stays the default and mock mode can always write', () => {
  clean();
  assert.equal(walrusEnv().network, 'testnet');
  assert.equal(walrusEnv().canWrite, true);
  clean({ WALRUS_MODE: 'mock', WALRUS_NETWORK: 'mainnet' });
  assert.equal(walrusEnv().canWrite, true);
});

test('network is inferred from the URLs when WALRUS_NETWORK is unset, but mixed URLs stay testnet', () => {
  assert.equal(detectNetwork({ WALRUS_AGGREGATOR_URL: 'https://aggregator.walrus-mainnet.walrus.space' }), 'mainnet');
  assert.equal(
    detectNetwork({ WALRUS_PUBLISHER_URL: 'https://publisher.walrus-testnet.walrus.space', WALRUS_AGGREGATOR_URL: 'https://aggregator.walrus-mainnet.walrus.space' }),
    'testnet',
  );
  assert.equal(detectNetwork({ WALRUS_NETWORK: 'MAINNET' }), 'mainnet');
});

test('MemWal needs key, account and token; the docs name MEMWAL_PRIVATE_KEY is accepted too', () => {
  clean();
  assert.deepEqual(memwalMissing(), ['MEMWAL_KEY', 'MEMWAL_ACCOUNT_ID', 'WALMARK_ACCESS_TOKEN']);
  assert.equal(memwalEnabled(), false);
  clean({ MEMWAL_PRIVATE_KEY: 'k', MEMWAL_ACCOUNT_ID: '0xabc' });
  assert.equal(memwalEnv().key, 'k');
  assert.deepEqual(memwalMissing(), ['WALMARK_ACCESS_TOKEN']);
  process.env.WALMARK_ACCESS_TOKEN = 'secret';
  assert.equal(memwalEnabled(), true);
});

test('relayer network: empty URL is the mainnet default', () => {
  clean();
  assert.equal(memwalNetwork(), 'mainnet');
  process.env.MEMWAL_SERVER_URL = 'https://relayer.memory.walrus.xyz';
  assert.equal(memwalNetwork(), 'mainnet');
  process.env.MEMWAL_SERVER_URL = 'https://relayer.dev.memwal.ai';
  assert.equal(memwalNetwork(), 'testnet');
  process.env.MEMWAL_SERVER_URL = 'https://relayer.mine.example';
  assert.equal(memwalNetwork(), 'custom');
});

test('env file helpers keep comments, replace duplicates, and survive Windows line endings', () => {
  const text = '# keep me\r\nMEMWAL_KEY=old\r\nWALRUS_PUBLISHER_URL=https://publisher.walrus-testnet.walrus.space\r\nMEMWAL_KEY=dup\r\n';
  let t = setEnv(text, 'MEMWAL_KEY', 'new');
  assert.equal(t.match(/MEMWAL_KEY=/g)?.length, 1);
  assert.ok(t.includes('# keep me'));
  assert.ok(t.includes('\r\n') && !/[^\r]\n/.test(t));
  t = removeEnv(t, 'WALRUS_PUBLISHER_URL');
  assert.ok(!t.includes('WALRUS_PUBLISHER_URL'));
  t = setEnv(t, 'WALRUS_NETWORK', 'mainnet');
  const m = parseEnv(t);
  assert.equal(m.get('MEMWAL_KEY'), 'new');
  assert.equal(m.get('WALRUS_NETWORK'), 'mainnet');
  assert.equal(parseEnv('A="x y"\nB=1 # note\n# C=2\n').get('B'), '1');
  assert.equal(parseEnv('A="x y"').get('A'), 'x y');
  assert.equal(setEnv('', 'A', '1'), 'A=1\n');
});

/* ---------------- direct Sui + Walrus (Tatum) ---------------- */
import { suiEnabled, suiEnv, suiMissing } from '../src/lib/server/env.ts';
import { SuiBackendError, explainWriteError, formatCoin, parseBlobObject } from '../src/lib/server/sui-util.ts';

const SUI_KEYS = ['TATUM_API_KEY', 'SUI_PRIVATE_KEY', 'SUI_RPC_URL', 'WALRUS_UPLOAD_RELAY_URL', 'WALMARK_MAX_WRITES_PER_DAY'];
function cleanSui(vars: Record<string, string> = {}) {
  clean();
  for (const k of SUI_KEYS) delete process.env[k];
  Object.assign(process.env, vars);
}

test('direct backend defaults to the Tatum gateway for the chosen network', () => {
  cleanSui({ WALRUS_NETWORK: 'mainnet' });
  assert.equal(suiEnv().rpcUrl, 'https://sui-mainnet.gateway.tatum.io');
  assert.equal(suiEnv().usesTatum, true);
  assert.equal(suiEnv().uploadRelay, 'https://upload-relay.mainnet.walrus.space');
  cleanSui({ WALRUS_NETWORK: 'testnet' });
  assert.equal(suiEnv().rpcUrl, 'https://sui-testnet.gateway.tatum.io');
});

test('direct backend needs the Tatum key, the wallet key and the access token', () => {
  cleanSui({ WALRUS_NETWORK: 'mainnet' });
  assert.deepEqual(suiMissing(), ['TATUM_API_KEY', 'SUI_PRIVATE_KEY', 'WALMARK_ACCESS_TOKEN']);
  assert.equal(suiEnabled(), false);
  process.env.TATUM_API_KEY = 't';
  process.env.SUI_PRIVATE_KEY = 'suiprivkey1abc';
  process.env.WALMARK_ACCESS_TOKEN = 'secret';
  assert.equal(suiEnabled(), true);
});

test('a non-Tatum RPC does not demand a Tatum key, and the relay can be switched off', () => {
  cleanSui({ SUI_RPC_URL: 'https://my-node.example/', SUI_PRIVATE_KEY: 'k', WALMARK_ACCESS_TOKEN: 's', WALRUS_UPLOAD_RELAY_URL: 'none' });
  assert.equal(suiEnv().usesTatum, false);
  assert.equal(suiEnv().rpcUrl, 'https://my-node.example');
  assert.equal(suiEnv().uploadRelay, '');
  assert.equal(suiEnabled(), true);
});

test('mock mode only needs the access token for the direct backend', () => {
  cleanSui({ WALRUS_MODE: 'mock', WALMARK_ACCESS_TOKEN: 's' });
  assert.equal(suiEnabled(), true);
});

test('coin amounts are shown in whole units with up to four decimals', () => {
  assert.equal(formatCoin('1500000000'), '1.5');
  assert.equal(formatCoin('25000000000'), '25');
  assert.equal(formatCoin('1234'), '0');
  assert.equal(formatCoin(0n), '0');
  assert.equal(formatCoin('12340000'), '0.0123');
});

test('a Walrus Blob object is read out of a sui_getObject response', () => {
  const raw = {
    data: {
      type: '0xabc::blob::Blob',
      owner: { AddressOwner: '0xme' },
      content: { fields: { blob_id: '7', size: '2048', certified_epoch: 41, deletable: false, storage: { fields: { start_epoch: 41, end_epoch: 46 } } } },
    },
  };
  const info = parseBlobObject(raw, (v) => `id-${v}`);
  assert.deepEqual(info, {
    exists: true, isWalrusBlob: true, blobId: 'id-7', size: 2048, certified: true,
    startEpoch: 41, endEpoch: 46, deletable: false, owner: '0xme',
  });
  assert.equal(parseBlobObject({ error: { code: 'notExists' } }, String).exists, false);
  const notBlob = parseBlobObject({ data: { type: '0x2::coin::Coin<0x2::sui::SUI>', content: { fields: {} } } }, String);
  assert.equal(notBlob.isWalrusBlob, false);
  const uncertified = parseBlobObject({ data: { type: '0xabc::blob::Blob', content: { fields: { blob_id: '1', certified_epoch: null } } } }, String);
  assert.equal(uncertified.certified, false);
});

test('SDK failures become actionable messages', () => {
  assert.equal(explainWriteError(new Error('Insufficient gas: GasBalanceTooLow')).status, 402);
  assert.match(explainWriteError(new Error('Not enough WAL coin balance')).message, /WAL/);
  assert.match(explainWriteError(new Error('HTTP 401 unauthorized')).message, /TATUM_API_KEY/);
  assert.equal(explainWriteError(new Error('429 Too Many Requests')).status, 429);
  assert.match(explainWriteError(new Error('boom')).message, /Walrus write failed: boom/);
  const own = new SuiBackendError('x', 418);
  assert.equal(explainWriteError(own), own);
});

test('in demo mode MemWal only needs the access token, so the whole app can be tested offline', () => {
  clean({ WALRUS_MODE: 'mock' });
  assert.deepEqual(memwalMissing(), ['WALMARK_ACCESS_TOKEN']);
  clean({ WALRUS_MODE: 'mock', WALMARK_ACCESS_TOKEN: 'tok-1234567890abcdef' });
  assert.equal(memwalEnabled(), true);
});
