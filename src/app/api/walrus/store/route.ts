import { fetchWithTimeout, json, limited, walrusEnv } from '@/lib/server/env';
import { mockStore } from '@/lib/server/mock';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface PublisherResponse {
  newlyCreated?: { blobObject?: { blobId?: string; storage?: { endEpoch?: number } } };
  alreadyCertified?: { blobId?: string; endEpoch?: number };
}

/** Browser -> this route -> Walrus publisher (PUT /v1/blobs). Avoids CORS and keeps the publisher URL server-side. */
export async function POST(req: Request) {
  const env = walrusEnv();
  if (limited(req, 'walrus-store', 40)) return json({ error: 'Too many requests, slow down.' }, 429);

  const epochs = Math.min(
    env.maxEpochs,
    Math.max(1, parseInt(new URL(req.url).searchParams.get('epochs') ?? '5', 10) || 5),
  );
  const body = new Uint8Array(await req.arrayBuffer());
  if (body.byteLength === 0 || body.byteLength > env.maxBytes) {
    return json({ error: `Payload must be 1..${env.maxBytes} bytes.` }, 413);
  }

  if (env.mode === 'mock') {
    const blobId = await mockStore(env.mockDir, body);
    return json({ blobId, endEpoch: epochs, mode: 'mock' });
  }

  if (!env.canWrite) {
    return json(
      {
        error:
          'No Walrus publisher is configured for mainnet. Use the MemWal backend, or set WALRUS_PUBLISHER_URL (and WALRUS_PUBLISHER_TOKEN) to your own publisher.',
      },
      503,
    );
  }
  const headers: Record<string, string> = { 'content-type': 'application/octet-stream' };
  if (env.publisherToken) headers.authorization = `Bearer ${env.publisherToken}`;

  try {
    // Be explicit about permanence: the docs contradict themselves on the default.
    let res = await fetchWithTimeout(
      `${env.publisher}/v1/blobs?epochs=${epochs}&permanent=true`,
      { method: 'PUT', body, headers },
      45_000,
    );
    if (res.status === 400) {
      res = await fetchWithTimeout(
        `${env.publisher}/v1/blobs?epochs=${epochs}`,
        { method: 'PUT', body, headers },
        45_000,
      );
    }
    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 300);
      return json({ error: `Publisher returned ${res.status}`, detail }, 502);
    }
    const data = (await res.json()) as PublisherResponse;
    const blobId = data.newlyCreated?.blobObject?.blobId ?? data.alreadyCertified?.blobId;
    if (!blobId) return json({ error: 'Publisher response had no blobId' }, 502);
    const endEpoch = data.newlyCreated?.blobObject?.storage?.endEpoch ?? data.alreadyCertified?.endEpoch;
    return json({ blobId, endEpoch, mode: 'walrus' });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Publisher unreachable' }, 502);
  }
}
