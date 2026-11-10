import { checkToken, json, limited, memwalEnabled, walrusEnv } from '@/lib/server/env';
import { mockMemwalRecall } from '@/lib/server/mock';
import { getMemwal } from '@/lib/server/memwal';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: Request) {
  if (!memwalEnabled()) return json({ error: 'MemWal backend is not configured on this server.' }, 503);
  if (!checkToken(req)) return json({ error: 'Missing or wrong access token.' }, 401);
  if (limited(req, 'memwal-recall', 60)) return json({ error: 'Too many requests' }, 429);

  const body = (await req.json().catch(() => null)) as { query?: unknown; limit?: unknown } | null;
  const query = typeof body?.query === 'string' ? body.query.trim() : '';
  const limit = Math.min(20, Math.max(1, Number(body?.limit) || 8));
  if (!query || query.length > 500) return json({ error: 'query must be 1..500 chars' }, 400);

  const w = walrusEnv();
  if (w.mode === 'mock') return json({ results: await mockMemwalRecall(w.mockDir, query, limit) });

  try {
    const r = await getMemwal().recall({ query, limit });
    return json({
      results: r.results.map((x) => ({
        text: x.text,
        distance: x.distance,
        blobId: x.blob_id,
        createdAt: x.created_at,
      })),
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'MemWal recall failed' }, 502);
  }
}
