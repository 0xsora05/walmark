import { MemWal } from '@mysten-incubation/memwal';
import { memwalEnv } from './env';

let client: MemWal | null = null;

export function getMemwal(): MemWal {
  if (!client) {
    const e = memwalEnv();
    client = MemWal.create({
      key: e.key,
      accountId: e.accountId,
      serverUrl: e.serverUrl || undefined,
      namespace: e.namespace,
    });
  }
  return client;
}
