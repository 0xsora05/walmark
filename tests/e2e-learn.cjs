/**
 * End-to-end check of the Total Recall angle, in demo mode: Walrus Memory (MemWal) is the default backend,
 * the MemWal account is read through the Tatum RPC, and WalMark learns how you ask for a mark.
 *
 *   WALRUS_MODE=mock WALMARK_MOCK_DIR=$(mktemp -d) WALMARK_ACCESS_TOKEN=tok-1234567890abcdef npx next start -p 3117 &
 *   BASE_URL=http://localhost:3117 WALMARK_ACCESS_TOKEN=tok-1234567890abcdef node tests/e2e-learn.cjs
 */
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const BASE = process.env.BASE_URL || 'http://localhost:3117';
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

const forgetAliasesLocally = (page) =>
  page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open('walmark');
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const tx = req.result.transaction('memories', 'readwrite');
          const store = tx.objectStore('memories');
          const q = store.getAll();
          q.onsuccess = () => {
            for (const m of q.result) {
              delete m.aliases;
              delete m.confirmed;
              store.put(m);
            }
          };
          tx.oncomplete = () => resolve(true);
          tx.onerror = () => reject(tx.error);
        };
      }),
  );

async function ask(page, text) {
  await page.getByTestId('ask-input').fill(text);
  await page.getByTestId('ask-send').click();
  await page.getByTestId('msg-bot').last().waitFor();
  await page.waitForFunction(() => !document.body.innerText.includes('Searching…'));
}

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()));
  page.on('dialog', (d) => d.accept());

  console.log('WalMark Total Recall e2e (MemWal + Tatum + learning) against', BASE);

  const cfg = await (await fetch(BASE + '/api/config')).json();
  assert.equal(cfg.memwal.enabled, true, 'server must run with WALMARK_ACCESS_TOKEN set');
  assert.equal(cfg.memwal.tatumReads, true);
  ok('server reports MemWal enabled and the Tatum account read available');

  const noTok = await fetch(BASE + '/api/memwal/account');
  assert.equal(noTok.status, 401);
  ok('the on-chain account route refuses requests without the access token');

  await page.goto(BASE);
  await page.getByTestId('library').waitFor();
  await page.getByTestId('load-sample').click();
  await page.getByTestId('text-page').waitFor();

  // Settings: MemWal is the default, and the account is read from Sui through Tatum
  await page.getByTestId('open-settings').click();
  await page.getByTestId('settings').waitFor();
  assert.equal(await page.getByTestId('backend-memwal').isChecked(), true);
  await page.getByPlaceholder('WALMARK_ACCESS_TOKEN').fill(TOKEN);
  await page.getByTestId('check-account').click();
  await page.getByTestId('account-status').waitFor();
  const acct = await page.getByTestId('account-status').innerText();
  assert.match(acct, /Account found on Sui/);
  assert.match(acct, /Delegate keys/);
  await page.screenshot({ path: path.join(SHOTS, '30-memwal-account-tatum.png') });
  ok('Walrus Memory is the default and its account is read from Sui via the Tatum RPC');
  await page.locator('.sheet-backdrop-modal').click({ position: { x: 5, y: 5 } });
  await page.getByTestId('settings').waitFor({ state: 'detached' });

  // save a mark to Walrus Memory
  await page.getByTestId('next-page').click();
  await page.waitForFunction(() => document.querySelector('[data-testid=text-page]')?.textContent?.includes('Seventh Schedule'));
  await selectText(page, '[data-testid=text-page]', 'Concurrent List');
  await page.getByTestId('confirm-sheet').waitFor();
  await page.getByTestId('confirm-save').click();
  await page.getByTestId('toast').waitFor();
  assert.match(await page.getByTestId('toast').innerText(), /Saved “Concurrent List” to Walrus Memory/);
  let mems = await dbMemories(page);
  assert.equal(mems.length, 1);
  assert.equal(mems[0].backend, 'memwal');
  assert.equal(mems[0].status, 'synced');
  ok('the mark is written to Walrus Memory (backend memwal, synced)');

  // ask in your own words: nothing matches, so WalMark asks which mark you meant
  await page.getByTestId('nav-recall').click();
  await ask(page, 'tandem zone');
  assert.match(await page.getByTestId('msg-bot').last().innerText(), /Which of these did you mean/);
  await page.screenshot({ path: path.join(SHOTS, '31-learn-pick.png') });
  await page.getByTestId('fb-pick').first().click();
  await page.getByTestId('feedback-done').waitFor();
  assert.match(await page.getByTestId('feedback-done').innerText(), /Learned: “tandem”, “zone” now finds “Concurrent List”\. Saved to Walrus Memory/);
  mems = await dbMemories(page);
  assert.deepEqual(mems[0].aliases, ['tandem', 'zone']);
  assert.equal(mems[0].confirmed, 1);
  ok('you point at the right mark once; WalMark learns your words and writes the lesson to Walrus Memory');

  // the same question now works, and says why
  await ask(page, 'tandem zone');
  const reply = await page.getByTestId('msg-bot').last().innerText();
  assert.match(reply, /From what you taught me: “Concurrent List”/);
  assert.match(reply, /Page 2/);
  await page.getByTestId('learned-chip').last().waitFor();
  assert.match(reply, /You also call this: “tandem”, “zone”/);
  await page.screenshot({ path: path.join(SHOTS, '32-learned-answer.png') });
  ok('the next time you ask the same way, the answer is right and shows what it learned');

  // marks you confirm become suggestions
  await page.getByTestId('nav-library').click();
  await page.getByTestId('nav-recall').click();
  assert.match(await page.getByTestId('recall').innerText(), /Concurrent List/);
  ok('the suggestions on an empty Ask screen start with the marks you recall most');

  // the Learned tab shows the numbers
  await page.getByTestId('tab-learned').click();
  await page.getByTestId('learned-panel').waitFor();
  assert.equal(await page.getByTestId('stat-nicknames').innerText(), '2');
  assert.equal(await page.getByTestId('stat-confirms').innerText(), '1');
  const progress = await page.getByTestId('mainnet-progress').innerText();
  assert.match(progress, /Written to Walrus Memory \(mainnet\): 2 \(1 mark \+ 1 lesson\)\. 8 more to reach 10/);
  assert.match(await page.getByTestId('learned-row').first().innerText(), /You call it: “tandem”, “zone”/);
  await page.screenshot({ path: path.join(SHOTS, '33-learned-tab.png') });
  ok('the Learned tab counts nicknames, confirmations and Walrus Memory writes toward 10');

  // another device: the local lessons are gone, Walrus Memory still has them
  await forgetAliasesLocally(page);
  await page.reload();
  await page.getByTestId('nav-recall').click();
  await page.getByTestId('tab-learned').click();
  await page.getByTestId('pull-lessons').click();
  await page.waitForFunction(() => document.querySelector('[data-testid=stat-nicknames]')?.textContent === '2');
  mems = await dbMemories(page);
  assert.deepEqual(mems[0].aliases, ['tandem', 'zone']);
  ok('"Pull lessons from Walrus Memory" restores what WalMark learned on a fresh device');

  assert.deepEqual(errors.filter((e) => !/favicon|manifest|sw\.js/.test(e)), [], 'no browser errors');
  ok('no console or page errors');

  await browser.close();
  console.log(`\nAll ${step} checks passed. Screenshots: ${SHOTS}`);
})().catch((e) => {
  console.error('\nFAILED:', e);
  process.exit(1);
});
