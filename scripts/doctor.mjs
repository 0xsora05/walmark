// npm run doctor
// Checks .env.local for a working Walrus mainnet setup. Prints which variables are set, never their values.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadProjectEnv, looksLikeKey, looksLikeSuiId, looksLikeSuiKey } from './lib/envfile.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { env, files } = loadProjectEnv(root);
const get = (k) => env.get(k) || '';

let failures = 0;
let warnings = 0;
const out = (tag, msg) => console.log(`  ${tag} ${msg}`);
const ok = (m) => out('[ ok ]', m);
const info = (m) => out('[ -- ]', m);
const warn = (m) => {
  warnings++;
  out('[ !! ]', m);
};
const bad = (m) => {
  failures++;
  out('[FAIL]', m);
};

async function http(url, init = {}, ms = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    const body = await res.json().catch(() => null);
    return { status: res.status, body };
  } catch (e) {
    return { error: e?.name === 'AbortError' ? 'timed out' : e?.cause?.code || e?.message || 'unreachable' };
  } finally {
    clearTimeout(t);
  }
}

const MAINNET_CHAIN = '4btiuiMPvEENsttpZC7CZ53DruC3MAgfznDbASZ7DR6S';
const fmt = (raw) => {
  const v = BigInt(raw || '0');
  const frac = (v % 1_000_000_000n).toString().padStart(9, '0').slice(0, 4).replace(/0+$/, '');
  return `${v / 1_000_000_000n}${frac ? '.' + frac : ''}`;
};


async function suiGrpc(rpcUrl, apiKey, network) {
  const [{ SuiGrpcClient }, { GrpcTransport }, { ChannelCredentials }] =
    await Promise.all([
      import('@mysten/sui/grpc'),
      import('@protobuf-ts/grpc-transport'),
      import('@grpc/grpc-js'),
    ]);

  if (!apiKey) throw new Error('TATUM_API_KEY is missing');

  const hostname = new URL(rpcUrl).hostname;
  const grpcHost = hostname.endsWith('-grpc.gateway.tatum.io')
    ? hostname
    : hostname.replace('.gateway.tatum.io', '-grpc.gateway.tatum.io');

  const transport = new GrpcTransport({
    host: `${grpcHost}:443`,
    channelCredentials: ChannelCredentials.createSsl(),
    meta: { 'x-api-key': apiKey },
  });

  return new SuiGrpcClient({ network, transport });
}

console.log(`\nWalMark doctor  (reading: ${files.length ? files.join(' + ') : 'no .env file found'}${process.env.TATUM_API_KEY || process.env.MEMWAL_KEY ? ' + shell environment' : ''})\n`);
if (!files.length) bad('No .env.local found. Run: npm run setup:mainnet');

/* ---------------- network ---------------- */
console.log('Network');
const mode = get('WALRUS_MODE') || 'walrus';
const pub = get('WALRUS_PUBLISHER_URL');
const agg = get('WALRUS_AGGREGATOR_URL');
const explicit = get('WALRUS_NETWORK').toLowerCase();
const inferred = /mainnet/i.test(`${pub} ${agg}`) && !/testnet/i.test(`${pub} ${agg}`) ? 'mainnet' : 'testnet';
const network = explicit === 'mainnet' || explicit === 'testnet' ? explicit : inferred;
if (mode === 'mock') warn('WALRUS_MODE=mock: nothing is sent to Walrus (demo mode). Remove it or set WALRUS_MODE=walrus.');
if (network === 'mainnet') ok('Walrus network: mainnet');
else warn(`Walrus network: ${network}. Set WALRUS_NETWORK=mainnet for mainnet.${explicit ? '' : ' (WALRUS_NETWORK is not set.)'}`);
if (/testnet/i.test(pub) && /mainnet/i.test(agg)) bad('WALRUS_PUBLISHER_URL is testnet but WALRUS_AGGREGATOR_URL is mainnet. Blobs you write could never be read back. Use one network for both.');
if (/mainnet/i.test(pub) && /testnet/i.test(agg)) bad('WALRUS_PUBLISHER_URL is mainnet but WALRUS_AGGREGATOR_URL is testnet. Use one network for both.');
if (network === 'mainnet' && /testnet/i.test(pub)) bad('A testnet publisher is set while WALRUS_NETWORK=mainnet.');

const token = get('WALMARK_ACCESS_TOKEN');
if (token) {
  ok('WALMARK_ACCESS_TOKEN is set');
  if (token.length < 16) warn('The access token is short. Use 16+ random characters (npm run setup:mainnet makes one).');
} else bad('WALMARK_ACCESS_TOKEN is missing. It is a secret you invent; both server-key backends stay off without it.');

/* ---------------- direct Sui + Walrus via Tatum ---------------- */
console.log('\nDirect Sui + Walrus (your wallet signs, Tatum is the Sui RPC)');
const tatum = get('TATUM_API_KEY');
const suiKey = get('SUI_PRIVATE_KEY');
const rpcUrl = (get('SUI_RPC_URL') || `https://sui-${network}.gateway.tatum.io`).replace(/\/+$/, '');
const usesTatum = /tatum\.io/i.test(rpcUrl);
const anyDirect = Boolean(suiKey);
let directReady = false;

if (!anyDirect) {
  if (tatum) ok('TATUM_API_KEY is set (used to read the MemWal account and other onchain data)');
  info('Direct write backend is off (SUI_PRIVATE_KEY is unset). That is fine when you save through MemWal.');
} else {
  let keyOk = true;
  if (usesTatum && !tatum) {
    bad('TATUM_API_KEY is missing (get a free one at https://dashboard.tatum.io).');
    keyOk = false;
  } else if (tatum) ok('TATUM_API_KEY is set');
  if (!suiKey) {
    bad('SUI_PRIVATE_KEY is missing (a dedicated wallet, suiprivkey1... or 64 hex).');
    keyOk = false;
  } else {
    ok('SUI_PRIVATE_KEY is set');
    if (!looksLikeSuiKey(suiKey)) {
      bad('SUI_PRIVATE_KEY is not a suiprivkey1... string or 64 hex characters.');
      keyOk = false;
    }
  }
  if (/testnet|devnet/i.test(rpcUrl) && network === 'mainnet') bad(`SUI_RPC_URL (${new URL(rpcUrl).host}) is not mainnet but WALRUS_NETWORK=mainnet.`);
  if (/mainnet/i.test(rpcUrl) && network === 'testnet') bad(`SUI_RPC_URL (${new URL(rpcUrl).host}) is mainnet but WALRUS_NETWORK is testnet.`);
  info(`Sui RPC: ${new URL(rpcUrl).host}${get('SUI_RPC_URL') ? '' : ' (default for the network)'}`);

  if (keyOk) {
    // derive the public address so you know which wallet to fund
    let address = '';
    try {
      const { Ed25519Keypair } = await import(pathToFileURL(path.join(root, 'node_modules/@mysten/sui/dist/keypairs/ed25519/index.mjs')).href);
      const kp = /^(0x)?[0-9a-fA-F]{64}$/.test(suiKey) ? Ed25519Keypair.fromSecretKey(Uint8Array.from(Buffer.from(suiKey.replace(/^0x/, ''), 'hex'))) : Ed25519Keypair.fromSecretKey(suiKey);
      address = kp.toSuiAddress();
      ok(`Wallet address: ${address}`);
    } catch {
      bad('Could not read SUI_PRIVATE_KEY. Is it copied completely?');
    }

    try {
      const client = await suiGrpc(rpcUrl, tatum, network);
      const chain = await client.core.getChainIdentifier();
      const id = chain.chainIdentifier;

      if (network === 'mainnet') {
        if (id === MAINNET_CHAIN) {
          ok(`Tatum Sui gRPC works and is on mainnet (chain ${id})`);
        } else {
          bad(`Sui gRPC returned chain ${id}, which does not match Mainnet.`);
        }
      } else {
        info(`Tatum Sui gRPC responded with chain ID ${id}; testnet identity not independently verified.`);
      }

      directReady = true;

      if (address) {
        const result = await client.core.listBalances({ owner: address });
        const rows = result.balances ?? [];
        const sui = rows.find((r) => r.coinType === '0x2::sui::SUI')?.balance ?? '0';
        const wal = rows.find((r) => /::wal::WAL$/.test(r.coinType))?.balance ?? '0';

        if (BigInt(sui) > 0n) ok(`SUI balance: ${fmt(sui)} (gas)`);
        else warn('The wallet has no SUI. It needs a little for gas.');

        if (BigInt(wal) > 0n) ok(`WAL balance: ${fmt(wal)} (storage)`);
        else warn('The wallet has no WAL. Swap some SUI for WAL, or saves will fail.');
      }
    } catch (e) {
      warn(`Tatum Sui gRPC: ${e?.message || 'unreachable'}. Check API key, internet and firewall.`);
    }

    const relay = (get('WALRUS_UPLOAD_RELAY_URL') === 'none' ? '' : get('WALRUS_UPLOAD_RELAY_URL') || `https://upload-relay.${network}.walrus.space`).replace(/\/+$/, '');
    if (relay) {
      const r = await http(`${relay}/v1/tip-config`);
      if (r.error) warn(`Upload relay ${new URL(relay).host}: ${r.error}. Set WALRUS_UPLOAD_RELAY_URL=none to write to the storage nodes directly (slower).`);
      else if (r.status >= 400) warn(`Upload relay ${new URL(relay).host} answered HTTP ${r.status}.`);
      else ok(`Upload relay ${new URL(relay).host} is up`);
    } else info('Upload relay disabled: writes go to the storage nodes directly (about 2000 requests per mark, slow).');
  }
}

/* ---------------- MemWal ---------------- */
console.log('\nMemWal / Walrus Memory (saves through the managed relayer; the Total Recall hackathon requires it on mainnet)');
const key = get('MEMWAL_KEY') || get('MEMWAL_PRIVATE_KEY');
const account = get('MEMWAL_ACCOUNT_ID');
const anyMemwal = Boolean(key || account);
let memwalReady = false;
const relayer = (get('MEMWAL_SERVER_URL') || 'https://relayer.memory.walrus.xyz').replace(/\/+$/, '');
if (!anyMemwal) {
  warn('Not configured. Total Recall needs Walrus Memory writing on mainnet: run npm run setup:mainnet and give it the MemWal account ID and delegate key.');
} else {
  let complete = true;
  if (key) {
    ok(`MEMWAL_KEY is set${get('MEMWAL_KEY') ? '' : ' (read from MEMWAL_PRIVATE_KEY)'}`);
    if (!looksLikeKey(key)) warn('The key is not 64 hex characters or a suiprivkey1... string. It may be copied wrong.');
  } else {
    bad('MEMWAL_KEY is missing (MEMWAL_PRIVATE_KEY also works).');
    complete = false;
  }
  if (account) {
    ok('MEMWAL_ACCOUNT_ID is set');
    if (!looksLikeSuiId(account)) warn('The account ID is not 0x + 64 hex characters. It may be copied wrong.');
  } else {
    bad('MEMWAL_ACCOUNT_ID is missing.');
    complete = false;
  }
  const relayerNet = /relayer\.memory\.walrus\.xyz/i.test(relayer) ? 'mainnet' : /dev\.memwal\.ai/i.test(relayer) ? 'testnet' : 'custom';
  if (relayerNet === 'mainnet') ok('Relayer: mainnet');
  else if (relayerNet === 'testnet') warn('Relayer is the TESTNET one (relayer.dev.memwal.ai). Use https://relayer.memory.walrus.xyz for mainnet.');
  else info(`Relayer: custom (${new URL(relayer).host})`);
  if (network === 'mainnet' && relayerNet === 'testnet') bad('WALRUS_NETWORK=mainnet but the MemWal relayer is testnet.');
  const r = await http(`${relayer}/health`);
  if (r.error) warn(`Relayer ${new URL(relayer).host}: ${r.error}. Check your internet / firewall.`);
  else if (r.status >= 500 || r.status === 404) warn(`Relayer ${new URL(relayer).host} answered HTTP ${r.status}.`);
  else if (r.body?.write_ready === false) warn(`Relayer ${new URL(relayer).host} is up but not ready for writes yet.`);
  else {
    ok(`Relayer ${new URL(relayer).host} is up${r.body?.status ? ` (status: ${r.body.status})` : ''}`);
    memwalReady = complete;
  }
  // Onchain account lookup through Tatum gRPC.
  const acctNet = relayerNet === 'testnet' ? 'testnet' : 'mainnet';
  const acctRpc = (get('SUI_RPC_URL') || `https://sui-${acctNet}.gateway.tatum.io`).replace(/\/+$/, '');

  if (account && looksLikeSuiId(account) && get('TATUM_API_KEY')) {
    try {
      const client = await suiGrpc(acctRpc, get('TATUM_API_KEY'), acctNet);
      const [chain, result] = await Promise.all([
        client.core.getChainIdentifier(),
        client.core.getObjects({
          objectIds: [account],
          include: { json: true },
        }),
      ]);

      const obj = result.objects?.[0];

      if (obj?.objectId) {
        const type = obj.type || '';
        if (acctNet === 'mainnet' && chain.chainIdentifier !== MAINNET_CHAIN) {
          warn('MemWal account exists, but the returned chain ID does not match Mainnet.');
        } else {
          ok(`MemWal account found on Sui ${acctNet} via Tatum gRPC${type ? ` (${type.replace(/^0x[0-9a-f]+::/i, '')})` : ''}`);
        }
      } else {
        warn(`MemWal account ${account.slice(0, 8)}… was not found on Sui ${acctNet}.`);
      }
    } catch (e) {
      warn(`MemWal account lookup via Tatum gRPC: ${e?.message || 'unreachable'}.`);
    }
  } else if (account) {
    info('Skipped the on-chain account lookup (needs TATUM_API_KEY).');
  }
}

/* ---------------- reading ---------------- */
console.log('\nReading blobs back');
const aggUrl = (agg || (network === 'mainnet' ? 'https://aggregator.walrus-mainnet.walrus.space' : 'https://aggregator.walrus-testnet.walrus.space')).replace(/\/+$/, '');
const a = await http(`${aggUrl}/v1/api`);
if (a.error) warn(`Aggregator ${new URL(aggUrl).host}: ${a.error}`);
else if (a.status >= 500) warn(`Aggregator ${new URL(aggUrl).host} answered HTTP ${a.status}.`);
else ok(`Aggregator ${new URL(aggUrl).host} is reachable`);

/* ---------------- Total Recall checklist ---------------- */
console.log('\nTotal Recall hackathon (Tatum x Walrus Memory, deadline 10 Nov 2026 17:00 UTC)');
if (memwalReady && network === 'mainnet') ok('Walrus Memory is configured for mainnet');
else warn('Walrus Memory on MAINNET is a submission requirement: set WALRUS_NETWORK=mainnet plus MEMWAL_ACCOUNT_ID and MEMWAL_KEY.');
if (get('TATUM_API_KEY')) ok('Tatum API key is set (Tatum RPC reads the MemWal account and the wallet)');
else warn('TATUM_API_KEY is missing: "Tatum RPC used for onchain data" is a requirement.');
info('By hand: save at least 10 memories on mainnet (Settings → Learned tab counts them), then publish the blog post, record the demo and push the public repo.');
info('For the form: MEMWAL_AGENT_ID = the public key under Delegate keys in the Memory dashboard; also your Tatum dashboard account ID.');

/* ---------------- verdict ---------------- */
console.log('');
if (!anyDirect && !anyMemwal) bad('No backend is configured. Run npm run setup:mainnet.');
if (failures) {
  console.log(`Not ready: ${failures} problem${failures > 1 ? 's' : ''} to fix. Then restart the app (env files are read at start).\n`);
  process.exit(1);
}
const which = memwalReady || (anyMemwal && !directReady) ? 'Walrus Memory (MemWal)' : 'Sui + Walrus, direct';
console.log(
  warnings
    ? `Almost there (${warnings} warning${warnings > 1 ? 's' : ''}). Restart the app, open Settings and choose "${which}".\n`
    : `Ready for mainnet. Restart the app, open Settings, choose "${which}" and paste your access token once.\n`,
);
