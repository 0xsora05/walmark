import { hostOf, json, memwalEnabled, memwalEnv, memwalMissing, memwalNetwork, suiEnabled, suiEnv, suiMissing, walrusEnv } from '@/lib/server/env';
import type { ServerInfo } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const w = walrusEnv();
  const info: ServerInfo = {
    walrus: {
      mode: w.mode,
      network: w.network,
      publisherHost: w.publisher ? hostOf(w.publisher) : '',
      aggregatorHost: hostOf(w.aggregator),
      canWrite: w.canWrite,
    },
    memwal: {
      enabled: memwalEnabled(),
      namespace: memwalEnv().namespace,
      network: memwalNetwork(),
      missing: memwalEnabled() ? [] : memwalMissing(),
      tatumReads: Boolean(suiEnv().tatumKey) || walrusEnv().mode === 'mock',
    },
    sui: {
      enabled: suiEnabled(),
      network: suiEnv().network,
      rpcHost: hostOf(suiEnv().rpcUrl),
      tatum: suiEnv().usesTatum,
      missing: suiEnabled() ? [] : suiMissing(),
    },
  };
  return json(info);
}
