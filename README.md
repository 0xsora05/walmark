# WalMark

Highlight or circle a word in a document, confirm, and it is saved to Walrus. Ask for it later and you get the word back with its **document title and page**.

Web app (Next.js PWA), works with touch on a phone. PDFs and plain text / Markdown.

## How it works

1. **Open a document**: upload a PDF / `.txt` / `.md`, paste text, or load the built-in sample.
2. **Mark a word**
   - Long-press / drag to select (normal text selection), or
   - tap **Circle** and draw a loop around the word (or a short phrase, up to 12 words).
3. **Confirm**: a sheet asks *"Save to memory?"* and shows the word, its sentence, the title and the page. Nothing is written until you tap **Save**. Cancel saves nothing. You can add an optional note.
4. **Recall**: in the **Recall** tab, ask in plain words (English or Tanglish: `antha concurrent word enna page 2 la?`). Every answer shows `Title · Page N`, the sentence, and an **Open page** button.

Saved words are painted back onto the page when you reopen it.

## Run it

```bash
npm install          # also copies the pdf.js worker + fonts into public/pdfjs
cp .env.example .env.local
npm run dev          # http://localhost:3000
```

On a phone, open the dev server's network URL, or deploy it and use "Add to Home Screen".

### Run on Walrus mainnet: Walrus Memory + Tatum (main path)

No wallet to run: MemWal's managed relayer does the Walrus writes. You need three things: the **MemWal account ID** and **delegate key** (create them at <https://memory.walrus.xyz>), a free **Tatum API key** (<https://dashboard.tatum.io>), and an **access token** that `setup:mainnet` invents for you.

```bash
npm install
npm run setup:mainnet   # asks for the MemWal account ID + key, then the Tatum key (all hidden); press Enter on the wallet prompt
npm run doctor          # checks relayer, the MemWal account on Sui via Tatum, keys, network, and prints the Total Recall checklist
npm run dev             # restart whenever .env.local changes
```

Open **Settings**, keep **Walrus Memory (MemWal)** selected (it is the default when the server supports it), paste the access token once, and tap **Read MemWal account via Tatum** to see the account on Sui. Save marks, then watch **Recall → Learned** count toward 10 mainnet memories.

| Variable | Needed for | Notes |
| --- | --- | --- |
| `WALMARK_ACCESS_TOKEN` | both server-key backends | A secret you invent. |
| `TATUM_API_KEY` | direct | Needed unless `SUI_RPC_URL` points at a non-Tatum node. |
| `SUI_PRIVATE_KEY` | direct | `suiprivkey1...` or 64 hex. Dedicated wallet only. |
| `SUI_RPC_URL` | direct | Defaults to `https://sui-<network>.gateway.tatum.io`. |
| `WALRUS_UPLOAD_RELAY_URL` | direct | Defaults to the public relay for the network; `none` writes to storage nodes directly (about 2000 requests per mark). |
| `MEMWAL_KEY` | MemWal | Delegate private key. `MEMWAL_PRIVATE_KEY` (the name in the Walrus docs) also works. |
| `MEMWAL_ACCOUNT_ID` | MemWal | Account object ID from memory.walrus.xyz. |
| `MEMWAL_SERVER_URL` | MemWal | `https://relayer.memory.walrus.xyz` (mainnet, also the SDK default) or `https://relayer.dev.memwal.ai` (testnet). Must match where the account was created. |
| `WALRUS_NETWORK` | all | `mainnet` or `testnet` (default). |
| `WALRUS_PUBLISHER_URL`, `WALRUS_PUBLISHER_TOKEN` | plain blobs on mainnet | Only if you run your own publisher; the token is sent as `Authorization: Bearer`. |

Settings shows the network and, if a backend is greyed out, exactly which variables the server is missing. `npm run doctor` also catches: a testnet endpoint on a mainnet setup (it compares the chain ID Tatum reports), a Tatum key Tatum rejects, an empty wallet, a testnet publisher with a mainnet aggregator, and a missing token.

### Optional: direct Sui + Walrus (Tatum RPC + your Sui wallet)

This is a second way to write on mainnet, with no MemWal: mainnet has public aggregators (reading) but **no public publisher** (writing needs a wallet with SUI + WAL). WalMark's **Sui + Walrus, direct** backend is built for that. It does not satisfy the Total Recall "Walrus Memory" requirement on its own, so use it alongside MemWal: the server signs Walrus transactions with a Sui wallet you fund, and **every Sui call goes through the Tatum RPC gateway** (`x-api-key`). Each mark becomes an on-chain Walrus blob that the Recall card can **verify on Sui**.

You need three different things:

| What | Where | Used for |
| --- | --- | --- |
| **Tatum API key** | <https://dashboard.tatum.io> | The Sui RPC (`https://sui-mainnet.gateway.tatum.io`) |
| **Sui wallet key** (`suiprivkey1...`) | A *dedicated* wallet holding a little SUI (gas) and some WAL (storage) | Signs the Walrus write. Never use your main wallet. |
| **Access token** | You invent it (`setup:mainnet` makes one) | Stops strangers spending the wallet if the app is public |

```bash
npm install
npm run setup:mainnet   # asks for the Tatum key + wallet key (hidden), writes .env.local, makes an access token
npm run doctor          # checks the keys, the chain (mainnet vs testnet), the wallet balances and the upload relay
npm run dev             # restart whenever .env.local changes
npm run smoke:sui       # optional: ONE real tiny write + read-back + on-chain verify (spends a little SUI/WAL)
```

1. Get a Tatum key, make a fresh Sui wallet, fund it with SUI, and swap a little SUI for WAL.
2. `npm run setup:mainnet`. It keeps anything already in `.env.local` and saves a `.env.local.bak`.
3. `npm run doctor` prints the wallet address, its SUI/WAL balances, and whether Tatum accepts the key on the right network.
4. Restart, open **Settings**, choose **Sui + Walrus, direct** (it is preselected when the server supports it) and paste the access token once. **Check wallet and Tatum RPC** shows balances and the estimated WAL cost per mark.

How a save works: the browser encrypts the record, `POST /api/sui/store` hands the bytes to the server, which writes them to Walrus with `@mysten/walrus` (through the public upload relay by default, tipping it a few MIST of SUI) and returns the blob ID plus the Sui object ID. **Verify on Sui** (`GET /api/sui/verify`) reads that object through Tatum and checks it is a certified Walrus blob, matches the blob ID, and has epochs left. Reading uses the public Walrus aggregator.

Safety rails: writes need the access token, are rate limited, capped at `WALMARK_MAX_WRITES_PER_DAY` (default 300), serialised one at a time, and limited to 64 KB. The wallet key never reaches the browser.

### Other Walrus backends

| `WALRUS_MODE` | What happens |
| --- | --- |
| `walrus` (default) | Plain blobs go to the publisher/aggregator for `WALRUS_NETWORK`. Testnet uses the public ones. |
| `mock` | Blobs are kept in a temp folder. For tests and offline work. |

If Walrus is unreachable when you save, the word is kept on the device with a "Saved on this device only" badge and a **Retry** button. Nothing is lost. Settings → **Test Walrus connection** also checks the MemWal relayer.

### MemWal on testnet

Use `https://relayer.dev.memwal.ai` and an account from <https://dev.memwal.ai>. MemWal is off unless the key, account ID and access token are all set, because the key lives on the server.

## Privacy

Walrus blobs are public, so records are **encrypted in the browser** (AES-GCM) before upload. The key is generated on your device and never sent anywhere. Settings → **Export backup** downloads the key plus the blob references; **Restore** on another device rebuilds your memory from Walrus. Treat that file like a password. (You can switch encryption off in Settings; the app labels such blobs "public".)

## Tests

```bash
npm run typecheck
npm test                                   # unit tests: search + learning, circle geometry, mainnet/Tatum env, Sui + MemWal account helpers, env-file helpers
WALRUS_MODE=mock npm run build && WALRUS_MODE=mock npx next start -p 3111 &
BASE_URL=http://localhost:3111 npm run test:e2e   # needs Playwright + Chromium
```

`npm run test:e2e:learn` (server started with `WALRUS_MODE=mock WALMARK_MOCK_DIR=$(mktemp -d) WALMARK_ACCESS_TOKEN=...`) covers the Total Recall flow in demo mode: MemWal default, Tatum account read, pick-the-right-mark learning, the 10-memory counter and pulling lessons back on a fresh device.

`npm run test:e2e:sui` (server started with `WALRUS_MODE=mock WALMARK_ACCESS_TOKEN=...`) runs the direct-backend flow in demo mode: wallet card, save, recall, Verify on Sui, backup. Demo mode mocks the chain, so only `npm run smoke:sui` exercises real transactions.

The main e2e run drives a phone-sized Chromium through: highlight → confirm → cancel → save, circle gesture, recall with title + page, PDF selection and circling, persistence, backup → wipe → restore from the stored blobs, and checks that the uploaded blob contains no plaintext.

## Layout

```
src/components   App, Library, Reader (text + PDF + circle overlay), ConfirmSheet, Recall, SettingsSheet
scripts          setup-mainnet.mjs, doctor.mjs
src/lib          text.ts (selection + word geometry), circle.ts, search.ts, crypto.ts, db.ts (IndexedDB), service.ts
src/app/api      memwal/{remember,recall,account}, sui/{store,status,verify}, walrus/{store,blob/[id],health}, config
src/lib/server   sui.ts (Tatum RPC + Walrus SDK), sui-util.ts, env.ts, memwal.ts
public           PWA manifest, service worker, pdf.js worker + fonts
```

## Known limits

- Circle mode takes over touch on the page, so tap **Circle** again to scroll.
- Scanned PDFs without a text layer can't be selected (no OCR).
- Search is lexical (words, titles, pages, "latest") plus what you taught it, and semantic only when MemWal is on.
- The MemWal account read shows what any Sui object exposes (type, owner, version, delegate keys if listed); it does not decode MemWal's private fields.
- Mock mode fakes the MemWal relayer and the Sui chain. Only a run with real keys proves mainnet writes.
