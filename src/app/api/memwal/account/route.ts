import {
  checkToken,
  json,
  limited,
  memwalEnabled,
  memwalEnv,
  memwalNetwork,
  suiEnv,
  walrusEnv,
} from '@/lib/server/env';

import {
  SuiBackendError,
  parseAccountObject,
} from '@/lib/server/sui-util';

import { readSuiObject } from '@/lib/server/sui';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const MAINNET_CHAIN_ID = '4btiuiMPvEENsttpZC7CZ53DruC3MAgfznDbASZ7DR6S';

export async function GET(req: Request) {
  if (!memwalEnabled()) {
    return json({ error: 'MemWal is not configured on this server.' }, 503);
  }

  if (!checkToken(req)) {
    return json({ error: 'Missing or wrong access token.' }, 401);
  }

  if (limited(req, 'memwal-account', 20)) {
    return json({ error: 'Too many requests' }, 429);
  }

  const e = suiEnv();
  const accountId = memwalEnv().accountId;
  const network = memwalNetwork() === 'testnet' ? 'testnet' : 'mainnet';

  const hostname = new URL(e.rpcUrl).hostname;
  const grpcHostname = hostname.endsWith('.gateway.tatum.io')
    ? hostname.replace('.gateway.tatum.io', '-grpc.gateway.tatum.io')
    : hostname;

  const base = {
    accountId,
    network,
    rpcHost: `${grpcHostname}:443`,
    tatum: e.usesTatum,
  };

  if (walrusEnv().mode === 'mock') {
    return json({
      ...base,
      mock: true,
      rpcOk: true,
      chainMatches: true,
      exists: true,
      type: 'account::MemWalAccount',
      version: '1',
      owner: 'shared object',
      delegateKeys: 1,
      latencyMs: 0,
    });
  }

  if (e.usesTatum && !e.tatumKey) {
    return json({
      ...base,
      configured: false,
      error: 'Add TATUM_API_KEY to read the MemWal account from Sui through Tatum.',
    });
  }

  const started = Date.now();

  try {
    const result = await readSuiObject(accountId);

    return json({
      ...base,
      rpcOk: true,
      latencyMs: Date.now() - started,
      chainMatches:
        network === 'mainnet'
          ? result.chainIdentifier === MAINNET_CHAIN_ID
          : undefined,
      ...parseAccountObject(result.object),
    });
  } catch (err) {
    const status = err instanceof SuiBackendError ? err.status : 502;

    return json(
      {
        ...base,
        rpcOk: false,
        error: err instanceof Error ? err.message : 'Sui gRPC failed',
      },
      status === 429 ? 429 : 200,
    );
  }
}
