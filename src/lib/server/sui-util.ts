// Pure helpers for the direct Sui + Walrus backend.

export class SuiBackendError extends Error {
  status: number;

  constructor(message: string, status = 502) {
    super(message);
    this.status = status;
  }
}

export function explainWriteError(err: unknown): SuiBackendError {
  if (err instanceof SuiBackendError) return err;

  const msg = err instanceof Error ? err.message : String(err);

  if (/insufficient|not enough.*(gas|coin|balance)|no valid gas|GasBalanceTooLow/i.test(msg)) {
    return new SuiBackendError(
      'The server wallet is out of SUI (gas) or WAL (storage). Fund it, then retry. See Settings for the wallet address.',
      402,
    );
  }

  if (/WAL/i.test(msg) && /(balance|coin|enough)/i.test(msg)) {
    return new SuiBackendError(
      'The server wallet has no WAL to pay for storage. Swap some SUI for WAL, then retry.',
      402,
    );
  }

  if (/401|403|api key|unauthorized/i.test(msg)) {
    return new SuiBackendError('The Sui RPC rejected the API key (check TATUM_API_KEY).', 502);
  }

  if (/429|rate/i.test(msg)) {
    return new SuiBackendError('Rate limited by the Sui RPC or the upload relay. Try again shortly.', 429);
  }

  return new SuiBackendError(`Walrus write failed: ${msg.slice(0, 240)}`);
}

const MIST = 1_000_000_000n;

export function formatCoin(raw: string | bigint): string {
  const v = typeof raw === 'bigint' ? raw : BigInt(raw || '0');
  const whole = v / MIST;
  const frac = (v % MIST).toString().padStart(9, '0').slice(0, 4).replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : `${whole}`;
}

export interface BlobObjectInfo {
  exists: boolean;
  isWalrusBlob: boolean;
  blobId?: string;
  size?: number;
  certified?: boolean;
  startEpoch?: number;
  endEpoch?: number;
  deletable?: boolean;
  owner?: string;
}

/** Supports both legacy JSON-RPC and gRPC object responses. */
export function parseBlobObject(
  raw: unknown,
  blobIdFromInt: (v: string) => string,
): BlobObjectInfo {
  const r = raw as {
    data?: Record<string, unknown>;
    objects?: Array<Record<string, unknown>>;
  } | null;

  const data = r?.data ?? r?.objects?.[0];
  if (!data || !data.objectId) return { exists: false, isWalrusBlob: false };

  const json = (data.json ?? {}) as Record<string, unknown>;
  const legacyContent = data.content as
    | { fields?: Record<string, unknown> }
    | undefined;

  const fields = (json.fields as Record<string, unknown> | undefined)
    ?? json
    ?? legacyContent?.fields
    ?? {};

  const type = typeof data.type === 'string' ? data.type : '';
  const isBlob = /::blob::Blob$/.test(type);

  const storageRaw = fields.storage as
    | { fields?: Record<string, unknown> }
    | Record<string, unknown>
    | undefined;

  const storage =
    ((storageRaw as { fields?: Record<string, unknown> } | undefined)?.fields
      ?? storageRaw
      ?? {}) as Record<string, unknown>;

  const num = (v: unknown) =>
    v === undefined || v === null ? undefined : Number(v);

  let blobId: string | undefined;
  try {
    const rawBlobId = fields.blob_id;
    if (typeof rawBlobId === 'string') blobId = blobIdFromInt(rawBlobId);
  } catch {
    blobId = undefined;
  }

  const owner = data.owner as Record<string, unknown> | string | undefined;
  let ownerAddress: string | undefined;

  if (typeof owner === 'string') {
    ownerAddress = owner;
  } else if (owner && typeof owner === 'object') {
    ownerAddress =
      typeof owner.AddressOwner === 'string' ? owner.AddressOwner : undefined;
  }

  return {
    exists: true,
    isWalrusBlob: isBlob,
    blobId,
    size: num(fields.size),
    certified:
      fields.certified_epoch !== undefined && fields.certified_epoch !== null,
    startEpoch: num(storage.start_epoch),
    endEpoch: num(storage.end_epoch),
    deletable:
      typeof fields.deletable === 'boolean' ? fields.deletable : undefined,
    owner: ownerAddress,
  };
}

export interface AccountObjectInfo {
  exists: boolean;
  type?: string;
  version?: string;
  owner?: string;
  delegateKeys?: number;
}

/** Supports both legacy JSON-RPC and gRPC object responses. */
export function parseAccountObject(raw: unknown): AccountObjectInfo {
  const response = raw as {
    data?: Record<string, unknown>;
    objects?: Array<Record<string, unknown>>;
  } | null;

  const data = response?.data ?? response?.objects?.[0];
  if (!data || !data.objectId) return { exists: false };

  const owner = data.owner as Record<string, unknown> | string | undefined;
  let ownerLabel: string | undefined;

  if (typeof owner === 'string') {
    ownerLabel = owner;
  } else if (owner && typeof owner === 'object') {
    if (typeof owner.AddressOwner === 'string') {
      ownerLabel = owner.AddressOwner;
    } else if ('Shared' in owner) {
      ownerLabel = 'shared object';
    } else if (typeof owner.ObjectOwner === 'string') {
      ownerLabel = `object ${owner.ObjectOwner}`;
    }
  }

  const json = (data.json ?? {}) as Record<string, unknown>;
  const legacyContent = data.content as
    | { fields?: Record<string, unknown> }
    | undefined;

  const fields = (json.fields as Record<string, unknown> | undefined)
    ?? json
    ?? legacyContent?.fields
    ?? {};

  const delegates = fields.delegate_keys ?? fields.delegateKeys;
  let delegateKeys: number | undefined;

  if (Array.isArray(delegates)) {
    delegateKeys = delegates.length;
  } else if (delegates && typeof delegates === 'object') {
    const inner = (delegates as { fields?: { contents?: unknown[] } }).fields?.contents;
    if (Array.isArray(inner)) delegateKeys = inner.length;
  }

  const type = typeof data.type === 'string' ? data.type : undefined;

  return {
    exists: true,
    type: type ? type.replace(/^0x[0-9a-fA-F]+::/, '') : undefined,
    version: data.version === undefined ? undefined : String(data.version),
    owner: ownerLabel,
    delegateKeys,
  };
}
