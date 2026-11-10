// npm run setup:mainnet
// Writes .env.local so WalMark saves to Walrus MAINNET:
//   - directly, with a Sui wallet you fund and the Tatum Sui RPC (the hackathon path), and/or
//   - through MemWal's managed relayer.
// Existing values are kept, the previous file is backed up once, and secrets are never printed
// (except the access token you paste into Settings).
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { looksLikeKey, looksLikeSuiId, looksLikeSuiKey, parseEnv, removeEnv, setEnv } from './lib/envfile.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, '.env.local');
const RELAYER = 'https://relayer.memory.walrus.xyz';

function ask(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    let muted = false;
    const out = new Writable({
      write(chunk, enc, cb) {
        if (!muted) process.stdout.write(chunk, enc);
        cb();
      },
    });
    const rl = readline.createInterface({ input: process.stdin, output: out, terminal: Boolean(process.stdin.isTTY) });
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write('\n');
      resolve(answer.trim());
    });
    muted = hidden;
  });
}

let text = existsSync(target) ? readFileSync(target, 'utf8') : '';
const current = parseEnv(text);
if (text && !existsSync(`${target}.bak`)) copyFileSync(target, `${target}.bak`);
const tty = Boolean(process.stdin.isTTY);

console.log('\nWalMark mainnet setup\n---------------------');
console.log('Total Recall (Tatum x Walrus Memory) needs two things; a third is optional. Press Enter to skip any you do not have:');
console.log('  MemWal          https://memory.walrus.xyz  (account ID + delegate key). Walrus Memory on mainnet: the main backend.');
console.log('  Tatum API key   https://dashboard.tatum.io  (free). The Sui RPC: WalMark reads your MemWal account on Sui through it.');
console.log('  Sui wallet key  optional: a DEDICATED wallet with a little SUI + WAL for the direct Sui + Walrus backend. Never your main wallet.');
console.log('Keys are hidden while you type and are only written to .env.local on this computer.\n');

async function value(name, label, { hidden = false, check, hint } = {}) {
  const existing = current.get(name) || (name === 'MEMWAL_KEY' ? current.get('MEMWAL_PRIVATE_KEY') : '') || '';
  if (existing) {
    console.log(`Keeping the ${name} already in .env.local`);
    return existing;
  }
  if (!tty) return '';
  const v = await ask(`${label} (Enter to skip): `, { hidden });
  if (v && check && !check(v)) console.log(`  ! ${hint}`);
  return v;
}

const accountId = await value('MEMWAL_ACCOUNT_ID', 'MemWal account ID (0x...)', {
  check: looksLikeSuiId,
  hint: 'The account ID should be 0x + 64 hex characters.',
});
const memKey = accountId ? await value('MEMWAL_KEY', 'MemWal delegate key', { hidden: true, check: looksLikeKey, hint: 'The key should be 64 hex characters or suiprivkey1....' }) : '';

const tatum = await value('TATUM_API_KEY', 'Tatum API key', { hidden: true });
const suiKey = await value('SUI_PRIVATE_KEY', 'Sui wallet private key (suiprivkey1...)', {
  hidden: true,
  check: looksLikeSuiKey,
  hint: 'That is not a suiprivkey1... string or 64 hex characters. Double-check it.',
});
const direct = Boolean(tatum && suiKey);
const memwal = Boolean(accountId && memKey);
if (!direct && !memwal) {
  console.error('\nNothing to set up yet: give me the MemWal account ID + delegate key (main path), or the Tatum key + Sui wallet key (direct path).');
  console.error('Run npm run setup:mainnet again when you have them.');
  process.exit(1);
}

let token = current.get('WALMARK_ACCESS_TOKEN') || '';
const generated = !token;
if (!token) token = randomBytes(18).toString('base64url');

text = setEnv(text, 'WALRUS_MODE', 'walrus');
text = setEnv(text, 'WALRUS_NETWORK', 'mainnet');
text = setEnv(text, 'WALMARK_ACCESS_TOKEN', token);
if (tatum) text = setEnv(text, 'TATUM_API_KEY', tatum);
if (suiKey) text = setEnv(text, 'SUI_PRIVATE_KEY', suiKey);
if (memwal) {
  text = setEnv(text, 'MEMWAL_SERVER_URL', RELAYER);
  text = setEnv(text, 'MEMWAL_NAMESPACE', current.get('MEMWAL_NAMESPACE') || 'walmark');
  text = setEnv(text, 'MEMWAL_ACCOUNT_ID', accountId);
  text = setEnv(text, 'MEMWAL_KEY', memKey);
  text = removeEnv(text, 'MEMWAL_PRIVATE_KEY'); // the app reads MEMWAL_KEY; keep one copy
}
for (const k of ['WALRUS_PUBLISHER_URL', 'WALRUS_AGGREGATOR_URL']) {
  if (/testnet/i.test(current.get(k) || '')) text = removeEnv(text, k); // a testnet URL would mix networks
}
for (const k of ['SUI_RPC_URL']) {
  if (/testnet|devnet/i.test(current.get(k) || '')) text = removeEnv(text, k);
}
writeFileSync(target, text);

console.log(`\nWrote ${path.relative(process.cwd(), target) || '.env.local'}${existsSync(`${target}.bak`) ? ' (previous version saved as .env.local.bak)' : ''}`);
console.log('  network ............. Walrus mainnet');
console.log(`  Walrus Memory ....... ${memwal ? `on (${RELAYER})` : 'off (needs the account ID and delegate key)'}`);
console.log(`  Tatum RPC ........... ${tatum ? 'key saved (reads the MemWal account on Sui)' : 'no key yet (required by Total Recall)'}`);
console.log(`  direct Sui + Walrus . ${direct ? 'on (your wallet signs)' : 'off (optional: needs the wallet key)'}`);
console.log(`  access token ........ ${generated ? 'generated for you' : 'kept from your file'}`);
console.log('\nNext:');
if (direct) console.log('  0. Fund the wallet: SUI for gas and WAL for storage (swap some SUI for WAL). npm run doctor shows its address and balances.');
console.log('  1. Restart the app (Ctrl+C, then npm run dev). Env files are only read at start.');
console.log(`  2. Open Settings, choose "${memwal ? 'Walrus Memory (MemWal)' : 'Sui + Walrus, direct'}" and paste this access token once:`);
console.log(`\n       ${token}\n`);
console.log('Running the check now...\n');
const r = spawnSync(process.execPath, [path.join(root, 'scripts', 'doctor.mjs')], { stdio: 'inherit' });
process.exit(r.status ?? 0);
