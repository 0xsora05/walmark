/**
 * End-to-end check of the direct "Sui + Walrus" backend (server wallet + Tatum RPC), in demo mode:
 * the server mocks the chain, so this verifies the whole app flow, not real transactions.
 *
 *   WALRUS_MODE=mock WALMARK_ACCESS_TOKEN=tok-1234567890abcdef npx next start -p 3116 &
 *   BASE_URL=http://localhost:3116 WALMARK_ACCESS_TOKEN=tok-1234567890abcdef node tests/e2e-sui.cjs
 */
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const BASE = process.env.BASE_URL || 'http://localhost:3116';
const TOKEN = process.env.WALMARK_ACCESS_TOKEN || 'tok-1234567890abcdef';
const SHOTS = process.env.SHOTS_DIR || path.join(os.tmpdir(), 'walmark-shots');
fs.mkdirSync(SHOTS, { recursive: true });
let step = 0;
const ok = (msg) => console.log(`  ✓ ${String(++step).padStart(2, '0')} ${msg}`);

async function selectText(page, rootSel, needle) {
  await page.evaluate(
    ([sel, needle]) => {
      const root = document.querySelector(sel);
      const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = w.nextNode())) {
        const i = n.data.indexOf(needle);
        if (i >= 0) {
          n.parentElement.scrollIntoView({ block: 'center' });
          const r = document.createRange();
          r.setStart(n, i);
          r.setEnd(n, i + needle.length);
          const s = getSelection();
          s.removeAllRanges();
          s.addRange(r);
          return;
        }
      }
      throw new Error('needle not found: ' + needle);
    },
    [rootSel, needle],
  );
}

const dbMemories = (page) =>
  page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open('walmark');
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const q = req.result.transaction('memories').objectStore('memories').getAll();
          q.onsuccess = () => resolve(q.result);
        };
      }),
  );

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()));
  page.on('dialog', (d) => d.accept());

  console.log('WalMark direct Sui + Walrus e2e against', BASE);

  const cfg = await (await fetch(BASE + '/api/config')).json();
  assert.equal(cfg.sui.enabled, true, 'server must have WALMARK_ACCESS_TOKEN set');
  ok('server reports the direct Sui backend as enabled');

  // no token -> refused, wrong token -> refused
  const noTok = await fetch(BASE + '/api/sui/store', { method: 'POST', body: 'x' });
  assert.equal(noTok.status, 401);
  const badTok = await fetch(BASE + '/api/sui/status', { headers: { 'x-walmark-token': 'nope' } });
  assert.equal(badTok.status, 401);
  ok('store and status refuse requests without the access token');

  await page.goto(BASE);
  await page.getByTestId('library').waitFor();
  await page.getByTestId('load-sample').click();
  await page.getByTestId('text-page').waitFor();

  // Settings: Walrus Memory (MemWal) is the default on a first run; this test switches to the direct backend
  await page.getByTestId('open-settings').click();
  await page.getByTestId('settings').waitFor();
  assert.equal(await page.getByTestId('backend-memwal').isChecked(), true);
  await page.getByTestId('backend-sui').check();
  assert.match(await page.getByTestId('settings').innerText(), /Sui \+ Walrus, direct/);
  ok('MemWal is the default; the direct Sui + Walrus backend can be chosen');

  await page.getByPlaceholder('WALMARK_ACCESS_TOKEN').fill(TOKEN);
  await page.getByTestId('check-wallet').click();
  await page.getByTestId('wallet-status').waitFor();
  const wallet = await page.getByTestId('wallet-status').innerText();
  assert.match(wallet, /reachable/);
  assert.match(wallet, /SUI \(gas\)/);
  assert.match(wallet, /WAL \(storage\)/);
  await page.screenshot({ path: path.join(SHOTS, '20-sui-settings-wallet.png') });
  ok('wallet card shows RPC, epoch, SUI and WAL balances');
  await page.locator('.sheet-backdrop-modal').click({ position: { x: 5, y: 5 } }); // tap outside the sheet to close
  await page.getByTestId('settings').waitFor({ state: 'detached' });

  // highlight -> confirm -> save through /api/sui/store
  await page.getByTestId('next-page').click();
  await page.waitForFunction(() => document.querySelector('[data-testid=text-page]')?.textContent?.includes('Seventh Schedule'));
  await selectText(page, '[data-testid=text-page]', 'Concurrent List');
  await page.getByTestId('confirm-sheet').waitFor();
  await page.getByTestId('confirm-save').click();
  await page.getByTestId('toast').waitFor();
  assert.match(await page.getByTestId('toast').innerText(), /Saved “Concurrent List” to Walrus on Sui/);
  const mems = await dbMemories(page);
  assert.equal(mems.length, 1);
  assert.equal(mems[0].backend, 'sui');
  assert.equal(mems[0].status, 'synced');
  assert.match(mems[0].suiObjectId, /^0x[0-9a-f]{64}$/);
  assert.ok(mems[0].blobId);
  ok(`saved via the server wallet; blobId=${mems[0].blobId.slice(0, 12)}… object=${mems[0].suiObjectId.slice(0, 10)}…`);

  // recall + verify on Sui through Tatum
  await page.getByTestId('nav-recall').click();
  await page.getByTestId('ask-input').fill('concurrent');
  await page.getByTestId('ask-send').click();
  await page.getByTestId('memory-card').first().waitFor();
  const card = await page.getByTestId('memory-card').first().innerText();
  assert.match(card, /Concurrent List/);
  assert.match(card, /Page 2/);
  assert.match(card, /Sui \+ Walrus/);
  ok('recall shows the mark with title + page and the Sui + Walrus badge');

  await page.getByTestId('verify-sui').click();
  await page.getByTestId('verify-result').waitFor();
  assert.match(await page.getByTestId('verify-result').innerText(), /certified/);
  assert.match(await page.getByTestId('verify-sui').innerText(), /Verified on Sui/);
  await page.screenshot({ path: path.join(SHOTS, '21-sui-verified.png') });
  ok('"Verify on Sui" confirms the blob object on chain');

  // the stored blob is encrypted
  const blob = await page.evaluate(async (id) => {
    const r = await fetch('/api/walrus/blob/' + id);
    const b = new Uint8Array(await r.arrayBuffer());
    return { status: r.status, first: b[0], text: new TextDecoder().decode(b) };
  }, mems[0].blobId);
  assert.equal(blob.status, 200);
  assert.equal(blob.first, 1);
  assert.ok(!blob.text.includes('Concurrent'));
  ok('the blob written through the server wallet is encrypted (no plaintext)');

  // backup -> restore keeps the on-chain object id
  await page.getByTestId('open-settings').click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-backup').click()]);
  const backupPath = path.join(os.tmpdir(), 'walmark-sui-backup.json');
  await download.saveAs(backupPath);
  const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
  assert.equal(backup.refs.length, 1);
  assert.equal(backup.refs[0].backend, 'sui');
  assert.equal(backup.refs[0].objectId, mems[0].suiObjectId);
  ok('backup keeps the blob id, the Sui object id and the backend');

  assert.deepEqual(errors.filter((e) => !/favicon|manifest|sw\.js/.test(e)), [], 'no browser errors');
  ok('no console or page errors');

  await browser.close();
  console.log(`\nAll ${step} checks passed. Screenshots: ${SHOTS}`);
})().catch((e) => {
  console.error('\nFAILED:', e);
  process.exit(1);
});
