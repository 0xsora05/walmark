import { Buffer } from 'node:buffer';
import { CHAIN_IDS, suiEnv } from './env';
import {
  SuiBackendError,
  explainWriteError,
  formatCoin,
  parseBlobObject,
} from './sui-util';

export { SuiBackendError } from './sui-util';
export type { BlobObjectInfo } from './sui-util';

const MAINNET_CHAIN_ID = '4btiuiMPvEENsttpZC7CZ53DruC3MAgfznDbASZ7DR6S';

async function buildType() {
  const [
    { SuiGrpcClient },
    { GrpcTransport },
    { ChannelCredentials },
    { walrus },
  ] = await Promise.all([
    import('@mysten/sui/grpc'),
    import('@protobuf-ts/grpc-transport'),
    import('@grpc/grpc-js'),
    import('@mysten/walrus'),
  ]);

  const e = suiEnv();

  if (!e.tatumKey) {
    throw new SuiBackendError('TATUM_API_KEY is required for Sui gRPC.', 500);
  }

  const hostname = new URL(e.rpcUrl).hostname;
  const grpcHostname = hostname.endsWith('.gateway.tatum.io')
    ? hostname.replace('.gateway.tatum.io', '-grpc.gateway.tatum.io')
    : hostname;

  const transport = new GrpcTransport({
    host: `${grpcHostname}:443`,
    channelCredentials: ChannelCredentials.createSsl(),
    meta: { 'x-api-key': e.tatumKey },
  });

  const client = new SuiGrpcClient({
    network: e.network,
    transport,
  });

  return client.$extend(
    walrus({
      storageNodeClientOptions: { timeout: 60_000 },
      ...(e.uploadRelay
        ? {
            uploadRelay: {
              host: e.uploadRelay,
              timeout: 120_000,
              sendTip: { max: 5_000_000 },
            },
          }
        : {}),
    }),
  );
}

type AppClient = Awaited<ReturnType<typeof buildType>>;

let clientPromise: Promise<AppClient> | null = null;

async function walrusClient(): Promise<AppClient> {
  if (!clientPromise) {
    clientPromise = buildType().catch((err) => {
      clientPromise = null;
      throw err;
    });
  }
  return clientPromise;
}

/* ------------------------------------------------------------------ */
/* Wallet                                                              */
/* ------------------------------------------------------------------ */

export async function keypairFrom(secret: string) {
  const { Ed25519Keypair } = await import('@mysten/sui/keypairs/ed25519');
  const s = secret.trim();

  if (/^(0x)?[0-9a-fA-F]{64}$/.test(s)) {
    return Ed25519Keypair.fromSecretKey(
      Uint8Array.from(Buffer.from(s.replace(/^0x/, ''), 'hex')),
    );
  }

  if (s.startsWith('suiprivkey')) {
    return Ed25519Keypair.fromSecretKey(s);
  }

  throw new SuiBackendError(
    'SUI_PRIVATE_KEY must be a suiprivkey1... string or 64 hex characters.',
    500,
  );
}

export async function walletAddress(): Promise<string> {
  const kp = await keypairFrom(suiEnv().privateKey);
  return kp.toSuiAddress();
}

/* ------------------------------------------------------------------ */
/* Writing                                                             */
/* ------------------------------------------------------------------ */

export interface SuiWriteResult {
  blobId: string;
  blobObjectId: string;
  endEpoch?: number;
  size?: number;
  address: string;
  network: string;
}

let queue: Promise<unknown> = Promise.resolve();
let day = '';
let writesToday = 0;

function countWrite(): void {
  const today = new Date().toISOString().slice(0, 10);

  if (today !== day) {
    day = today;
    writesToday = 0;
  }

  if (writesToday >= suiEnv().maxWritesPerDay) {
    throw new SuiBackendError(
      `Daily write limit reached (${suiEnv().maxWritesPerDay}). Raise WALMARK_MAX_WRITES_PER_DAY if this is expected.`,
      429,
    );
  }

  writesToday++;
}

export function writeBlob(
  bytes: Uint8Array,
  epochs: number,
): Promise<SuiWriteResult> {
  const run = async (): Promise<SuiWriteResult> => {
    countWrite();
    const e = suiEnv();
    const signer = await keypairFrom(e.privateKey);
    const client = await walrusClient();

    try {
      const res = await client.walrus.writeBlob({
        blob: bytes,
        deletable: false,
        epochs,
        signer,
      });

      const obj = res.blobObject as {
        id?: string;
        size?: string | number;
        storage?: { end_epoch?: number | string };
      };

      return {
        blobId: res.blobId,
        blobObjectId: String(obj?.id ?? ''),
        endEpoch:
          obj?.storage?.end_epoch !== undefined
            ? Number(obj.storage.end_epoch)
            : undefined,
        size: obj?.size !== undefined ? Number(obj.size) : undefined,
        address: signer.toSuiAddress(),
        network: e.network,
      };
    } catch (err) {
      writesToday = Math.max(0, writesToday - 1);
      throw explainWriteError(err);
    }
  };

  const next = queue.then(run, run);
  queue = next.catch(() => undefined);
  return next;
}

/* ------------------------------------------------------------------ */
/* Reading chain state through Tatum gRPC                               */
/* ------------------------------------------------------------------ */

export interface WalletStatus {
  network: string;
  rpcHost: string;
  rpcOk: boolean;
  latencyMs: number;
  chainId?: string;
  chainMatches?: boolean;
  epoch?: number;
  address?: string;
  sui?: string;
  wal?: string;
  uploadRelay: string | null;
  estCostWal?: string;
  error?: string;
}

export async function walletStatus(epochs: number): Promise<WalletStatus> {
  const e = suiEnv();
  const hostname = new URL(e.rpcUrl).hostname;
  const grpcHostname = hostname.endsWith('.gateway.tatum.io')
    ? hostname.replace('.gateway.tatum.io', '-grpc.gateway.tatum.io')
    : hostname;

  const started = Date.now();

  const out: WalletStatus = {
    network: e.network,
    rpcHost: `${grpcHostname}:443`,
    rpcOk: false,
    latencyMs: 0,
    uploadRelay: e.uploadRelay ? new URL(e.uploadRelay).host : null,
  };

  try {
    const address = await walletAddress();
    out.address = address;

    const client = await walrusClient();

    const [chain, state, balanceResult] = await Promise.all([
      client.core.getChainIdentifier(),
      client.core.getCurrentSystemState(),
      client.core.listBalances({ owner: address }),
    ]);

    out.rpcOk = true;
    out.chainId = chain.chainIdentifier;
    out.chainMatches =
      chain.chainIdentifier ===
      (e.network === 'mainnet' ? MAINNET_CHAIN_ID : CHAIN_IDS.testnet);

    out.epoch = Number(state.systemState.epoch);

    const balances = balanceResult.balances as Array<{
      coinType: string;
      balance?: string;
      coinBalance?: string;
    }>;

    const suiBalance = balances.find(
      (b) => b.coinType === '0x2::sui::SUI',
    );

    const walBalance = balances.find(
      (b) => /::wal::WAL$/.test(b.coinType),
    );

    out.sui = formatCoin(
      suiBalance?.balance ?? suiBalance?.coinBalance ?? '0',
    );

    out.wal = formatCoin(
      walBalance?.balance ?? walBalance?.coinBalance ?? '0',
    );
  } catch (err) {
    out.error =
      err instanceof Error ? err.message : 'Could not read the wallet';
  }

  out.latencyMs = Date.now() - started;

  if (out.rpcOk) {
    try {
      const client = await walrusClient();
      const cost = await client.walrus.storageCost(2048, epochs);
      out.estCostWal = formatCoin(cost.totalCost);
    } catch {
      // The cost estimate is optional.
    }
  }

  return out;
}

/* ------------------------------------------------------------------ */
/* Verifying a stored blob on chain                                    */
/* ------------------------------------------------------------------ */

export async function verifyBlobObject(
  objectId: string,
  expectedBlobId?: string,
) {
  const { blobIdFromInt } = await import('@mysten/walrus');
  const client = await walrusClient();

  const [raw, state] = await Promise.all([
    client.core.getObjects({
      objectIds: [objectId],
      include: { json: true },
    }),
    client.core.getCurrentSystemState(),
  ]);

  const info = parseBlobObject(raw, blobIdFromInt);
  const currentEpoch = Number(state.systemState.epoch);

  const epochsLeft =
    info.endEpoch !== undefined
      ? Math.max(0, info.endEpoch - currentEpoch)
      : undefined;

  return {
    ...info,
    currentEpoch,
    epochsLeft,
    matchesBlobId:
      expectedBlobId && info.blobId
        ? info.blobId === expectedBlobId
        : undefined,
    verified: Boolean(
      info.exists &&
        info.isWalrusBlob &&
        info.certified &&
        (expectedBlobId ? info.blobId === expectedBlobId : true) &&
        (epochsLeft === undefined || epochsLeft > 0),
    ),
  };
}

/** Read a Sui object and the connected network identity through gRPC. */
export async function readSuiObject(objectId: string) {
  const client = await walrusClient();

  const [chain, object] = await Promise.all([
    client.core.getChainIdentifier(),
    client.core.getObjects({
      objectIds: [objectId],
      include: { json: true },
    }),
  ]);

  return {
    chainIdentifier: chain.chainIdentifier,
    object,
  };
}
