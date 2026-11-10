import { checkToken, json, limited, suiEnabled, suiEnv, suiMissing, walrusEnv } from '@/lib/server/env';
import { walletStatus } from '@/lib/server/sui';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/** Wallet + Tatum RPC health: network, chain ID, current epoch, SUI/WAL balances, estimated cost per mark. */
export async function GET(req: Request) {
  if (!suiEnabled()) return json({ error: `Direct Sui backend is not configured. Missing: ${suiMissing().join(', ')}.` }, 503);
  if (!checkToken(req)) return json({ error: 'Missing or wrong access token.' }, 401);
  if (limited(req, 'sui-status', 20)) return json({ error: 'Too many requests' }, 429);

  const e = suiEnv();
  if (walrusEnv().mode === 'mock') {
    return json({
      mock: true,
      network: e.network,
      rpcHost: new URL(e.rpcUrl).host,
      rpcOk: true,
      latencyMs: 0,
      chainMatches: true,
      epoch: 100,
      address: '0xmock0000000000000000000000000000000000000000000000000000000000',
      sui: '1.5',
      wal: '10',
      uploadRelay: e.uploadRelay ? new URL(e.uploadRelay).host : null,
      estCostWal: '0.0123',
    });
  }
  const epochs = Math.min(53, Math.max(1, parseInt(new URL(req.url).searchParams.get('epochs') ?? '5', 10) || 5));
  return json(await walletStatus(epochs));
}
