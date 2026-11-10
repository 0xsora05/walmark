import { checkToken, json, limited, suiEnabled, suiMissing, walrusEnv } from '@/lib/server/env';
import { SuiBackendError, verifyBlobObject } from '@/lib/server/sui';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Reads the Walrus Blob object from Sui (through Tatum) and reports whether it is registered, certified and still paid for. */
export async function GET(req: Request) {
  if (!suiEnabled()) return json({ error: `Direct Sui backend is not configured. Missing: ${suiMissing().join(', ')}.` }, 503);
  if (!checkToken(req)) return json({ error: 'Missing or wrong access token.' }, 401);
  if (limited(req, 'sui-verify', 60)) return json({ error: 'Too many requests' }, 429);

  const url = new URL(req.url);
  const id = url.searchParams.get('id') ?? '';
  const blobId = url.searchParams.get('blobId') ?? undefined;
  if (!/^0x[0-9a-fA-F]{1,64}$/.test(id)) return json({ error: 'Bad object id' }, 400);
  if (blobId && !/^[A-Za-z0-9_-]{8,64}$/.test(blobId)) return json({ error: 'Bad blob id' }, 400);

  if (walrusEnv().mode === 'mock') {
    return json({ mock: true, exists: true, isWalrusBlob: true, certified: true, blobId, matchesBlobId: true, size: 1024, endEpoch: 105, currentEpoch: 100, epochsLeft: 5, verified: true });
  }
  try {
    return json(await verifyBlobObject(id, blobId));
  } catch (e) {
    if (e instanceof SuiBackendError) return json({ error: e.message }, e.status);
    return json({ error: e instanceof Error ? e.message : 'Verify failed' }, 502);
  }
}
