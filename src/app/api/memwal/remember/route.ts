import { checkToken, json, limited, memwalEnabled, walrusEnv } from '@/lib/server/env';
import { mockMemwalRemember } from '@/lib/server/mock';
import { getMemwal } from '@/lib/server/memwal';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(req: Request) {
  if (!memwalEnabled()) return json({ error: 'MemWal backend is not configured on this server.' }, 503);
  if (!checkToken(req)) return json({ error: 'Missing or wrong access token.' }, 401);
  if (limited(req, 'memwal-remember', 30)) return json({ error: 'Too many requests' }, 429);

  const body = (await req.json().catch(() => null)) as { text?: unknown } | null;
  const text = typeof body?.text === 'string' ? body.text : '';
  if (!text || text.length > 4000) return json({ error: 'text must be 1..4000 chars' }, 400);

  const w = walrusEnv();
  if (w.mode === 'mock') return json(await mockMemwalRemember(w.mockDir, text));

  try {
    const r = await getMemwal().rememberAndWait(text);
    return json({ id: r.id, blobId: r.blob_id });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'MemWal remember failed' }, 502);
  }
}
