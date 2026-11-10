import { createHash } from 'node:crypto';
import { checkToken, json, limited, suiEnabled, suiMissing, walrusEnv } from '@/lib/server/env';
import { mockStore } from '@/lib/server/mock';
import { SuiBackendError, writeBlob } from '@/lib/server/sui';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 180;

/**
 * Browser -> this route -> Walrus, signed by the server's Sui wallet, with every Sui call going through Tatum.
 * Guarded by WALMARK_ACCESS_TOKEN because the server wallet pays for each write.
 */
export async function POST(req: Request) {
  if (!suiEnabled()) return json({ error: `Direct Sui backend is not configured. Missing: ${suiMissing().join(', ')}.` }, 503);
  if (!checkToken(req)) return json({ error: 'Missing or wrong access token.' }, 401);
  if (limited(req, 'sui-store', 20)) return json({ error: 'Too many requests, slow down.' }, 429);

  const env = walrusEnv();
  const epochs = Math.min(env.maxEpochs, Math.max(1, parseInt(new URL(req.url).searchParams.get('epochs') ?? '5', 10) || 5));
  const body = new Uint8Array(await req.arrayBuffer());
  if (body.byteLength === 0 || body.byteLength > env.maxBytes) return json({ error: `Payload must be 1..${env.maxBytes} bytes.` }, 413);

  if (env.mode === 'mock') {
    const blobId = await mockStore(env.mockDir, body);
    const objectId = '0x' + createHash('sha256').update(blobId).digest('hex');
    return json({ blobId, blobObjectId: objectId, endEpoch: 100 + epochs, address: '0xmock', network: env.network, mode: 'mock' });
  }

  try {
    return json({ ...(await writeBlob(body, epochs)), mode: 'walrus' });
  } catch (e) {
    if (e instanceof SuiBackendError) return json({ error: e.message }, e.status);
    return json({ error: e instanceof Error ? e.message : 'Write failed' }, 502);
  }
}
