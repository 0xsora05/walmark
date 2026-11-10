export type DocKind = 'pdf' | 'text';

export interface DocRecord {
  id: string;
  title: string;
  kind: DocKind;
  numPages: number;
  createdAt: number;
  lastPage: number;
  /** Text documents are stored as ready-made pages. PDFs live in the `files` store. */
  pages?: string[];
}

export type SyncStatus = 'synced' | 'local' | 'failed';
export type BackendName = 'walrus' | 'memwal' | 'sui';

export interface MemoryRecord {
  id: string;
  /** The marked word or short phrase. */
  word: string;
  /** The sentence around it. */
  context: string;
  note?: string;
  docId: string;
  docTitle: string;
  page: number;
  createdAt: number;
  backend: BackendName;
  /** Walrus blob ID (walrus / sui backends) or MemWal blob_id (memwal backend). */
  blobId?: string;
  /** Sui object ID of the on-chain Walrus Blob (sui backend only). Lets you verify the mark on chain. */
  suiObjectId?: string;
  status: SyncStatus;
  encrypted?: boolean;
  error?: string;
  /** What you called this mark when you asked for it. Learned from "Right one" taps; searched like the word itself. */
  aliases?: string[];
  /** Times you confirmed this mark was the one you meant. Ranks it higher next time. */
  confirmed?: number;
  /** Query terms you said did NOT mean this mark. Demotes it for those terms. */
  avoid?: string[];
  lastRecalledAt?: number;
}

/** One lesson written to Walrus Memory: "when I ask X, I mean this mark". */
export interface LearnPayload {
  v: 1;
  app: 'walmark';
  kind: 'alias' | 'avoid';
  memoryId: string;
  word: string;
  docTitle: string;
  page: number;
  terms: string[];
  at: number;
}

/** What actually gets uploaded to Walrus (encrypted client-side unless disabled). */
export interface MemoryPayload {
  v: 1;
  app: 'walmark';
  id: string;
  word: string;
  context: string;
  note?: string;
  docId: string;
  docTitle: string;
  page: number;
  createdAt: number;
}

export interface Settings {
  backend: BackendName;
  /** Encrypt with AES-GCM in the browser before anything leaves the device. */
  encrypt: boolean;
  /** Walrus storage duration. One testnet epoch is about one day. */
  epochs: number;
  /** Matches WALMARK_ACCESS_TOKEN on the server; only needed for the MemWal backend. */
  accessToken: string;
}

export const DEFAULT_SETTINGS: Settings = {
  backend: 'walrus',
  encrypt: true,
  epochs: 5,
  accessToken: '',
};

export interface ServerInfo {
  walrus: {
    mode: 'walrus' | 'mock';
    network: 'mainnet' | 'testnet';
    publisherHost: string;
    aggregatorHost: string;
    /** False on mainnet until you point WALRUS_PUBLISHER_URL at a publisher you run. */
    canWrite: boolean;
  };
  memwal: {
    enabled: boolean;
    namespace: string;
    network: 'mainnet' | 'testnet' | 'custom';
    /** Names (never values) of the env vars the server is still missing. */
    missing: string[];
    /** True when a Tatum key is set, so the MemWal account can be read from Sui through Tatum. */
    tatumReads: boolean;
  };
  /** Direct Sui + Walrus backend: server wallet signs, Tatum is the Sui RPC. */
  sui: {
    enabled: boolean;
    network: 'mainnet' | 'testnet';
    rpcHost: string;
    tatum: boolean;
    missing: string[];
  };
}
