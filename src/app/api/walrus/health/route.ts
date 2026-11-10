import { fetchWithTimeout, hostOf, json, limited, memwalEnabled, memwalNetwork, walrusEnv } from '@/lib/server/env';
import { getMemwal } from '@/lib/server/memwal';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const env = walrusEnv();
  if (limited(req, 'walrus-health', 20)) return json({ error: 'Too many requests' }, 429);
  if (env.mode === 'mock') return json({ ok: true, mode: 'mock', network: env.network, latencyMs: 0 });

  const started = Date.now();
  const check = async (base: string) => {
    try {
      const res = await fetchWithTimeout(`${base}/v1/api`, {}, 6_000);
      return res.status < 500;
    } catch {
      return false;
    }
  };

  // The relayer health endpoint is public and unsigned, so this never spends anything.
  const checkMemwal = async () => {
    if (!memwalEnabled()) return undefined;
    try {
      const h = await getMemwal().health();
      return { ok: h.status === 'ok' && h.write_ready !== false, network: memwalNetwork(), writeReady: h.write_ready };
    } catch {
      return { ok: false, network: memwalNetwork() };
    }
  };

  const [aggregator, publisher, memwal] = await Promise.all([
    check(env.aggregator),
    env.publisher ? check(env.publisher) : Promise.resolve(null),
    checkMemwal(),
  ]);
  return json({
    // With no publisher (mainnet) the aggregator alone decides; MemWal is reported separately.
    ok: aggregator && (publisher === null || publisher),
    mode: 'walrus',
    network: env.network,
    aggregator: { host: hostOf(env.aggregator), ok: aggregator },
    publisher: publisher === null ? { host: '', ok: false, configured: false } : { host: hostOf(env.publisher), ok: publisher, configured: true },
    memwal,
    latencyMs: Date.now() - started,
  });
}
