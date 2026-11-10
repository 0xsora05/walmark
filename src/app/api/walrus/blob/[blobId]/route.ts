import { fetchWithTimeout, json, limited, walrusEnv } from '@/lib/server/env';
import { BLOB_ID_RE, mockRead } from '@/lib/server/mock';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Browser -> this route -> Walrus aggregator (GET /v1/blobs/<id>). */
export async function GET(req: Request, ctx: { params: Promise<{ blobId: string }> }) {
  const { blobId } = await ctx.params;
  const env = walrusEnv();
  if (limited(req, 'walrus-read', 120)) return json({ error: 'Too many requests, slow down.' }, 429);
  if (!BLOB_ID_RE.test(blobId)) return json({ error: 'Bad blob id' }, 400);

  if (env.mode === 'mock') {
    const bytes = await mockRead(env.mockDir, blobId);
    if (!bytes) return json({ error: 'Not found' }, 404);
    return new Response(new Uint8Array(bytes), { headers: { 'content-type': 'application/octet-stream' } });
  }

  try {
    const res = await fetchWithTimeout(`${env.aggregator}/v1/blobs/${blobId}`, {}, 30_000);
    if (!res.ok) return json({ error: `Aggregator returned ${res.status}` }, res.status === 404 ? 404 : 502);
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength > env.maxBytes) return json({ error: 'Blob is not a WalMark record' }, 422);
    return new Response(bytes, {
      headers: { 'content-type': 'application/octet-stream', 'cache-control': 'private, max-age=3600' },
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Aggregator unreachable' }, 502);
  }
}
