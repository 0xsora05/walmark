'use client';

import { useRef, useState } from 'react';
import { IconClose } from './icons';
import { checkWalrus, memwalAccount, suiStatus, type MemwalAccountStatus, type SuiWalletStatus, type WalrusHealth } from '@/lib/service';
import type { ServerInfo, Settings } from '@/lib/types';

interface Props {
  settings: Settings;
  server: ServerInfo | null;
  memoryCount: number;
  onChange: (s: Settings) => void;
  onExport: () => void;
  onRestore: (file: File) => void;
  onWipe: () => void;
  onClose: () => void;
}

export default function SettingsSheet({ settings, server, memoryCount, onChange, onExport, onRestore, onWipe, onClose }: Props) {
  const [health, setHealth] = useState<WalrusHealth | null>(null);
  const [healthErr, setHealthErr] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [wallet, setWallet] = useState<SuiWalletStatus | null>(null);
  const [walletErr, setWalletErr] = useState<string | null>(null);
  const [walletBusy, setWalletBusy] = useState(false);
  const [account, setAccount] = useState<MemwalAccountStatus | null>(null);
  const [accountErr, setAccountErr] = useState<string | null>(null);
  const [accountBusy, setAccountBusy] = useState(false);
  const restoreRef = useRef<HTMLInputElement>(null);
  const memwalOn = server?.memwal.enabled ?? false;
  const suiOn = server?.sui.enabled ?? false;
  const network = server?.walrus.network ?? 'testnet';
  const blobsOn = server ? server.walrus.canWrite : true;
  const netLabel = (n: string) => (n === 'mainnet' ? 'Mainnet' : n === 'testnet' ? 'Testnet' : 'Custom relayer');

  const test = async () => {
    setTesting(true);
    setHealth(null);
    setHealthErr(null);
    try {
      setHealth(await checkWalrus());
    } catch (e) {
      setHealthErr(e instanceof Error ? e.message : 'Failed');
    } finally {
      setTesting(false);
    }
  };

  const checkAccount = async () => {
    setAccountBusy(true);
    setAccount(null);
    setAccountErr(null);
    try {
      setAccount(await memwalAccount(settings));
    } catch (e) {
      setAccountErr(e instanceof Error ? e.message : 'Failed');
    } finally {
      setAccountBusy(false);
    }
  };

  const checkWallet = async () => {
    setWalletBusy(true);
    setWallet(null);
    setWalletErr(null);
    try {
      setWallet(await suiStatus(settings));
    } catch (e) {
      setWalletErr(e instanceof Error ? e.message : 'Failed');
    } finally {
      setWalletBusy(false);
    }
  };

  return (
    <div className="sheet-backdrop sheet-backdrop-modal" onClick={onClose}>
      <div className="sheet sheet-tall" role="dialog" aria-modal="true" aria-label="Settings" onClick={(e) => e.stopPropagation()} data-testid="settings">
        <div className="sheet-head">
          <h2>Settings</h2>
          <button className="icon-btn" aria-label="Close settings" onClick={onClose}>
            <IconClose />
          </button>
        </div>

        <h3>Where memories go</h3>
        <label className={`radio ${memwalOn ? '' : 'radio-off'}`}>
          <input
            type="radio"
            name="backend"
            data-testid="backend-memwal"
            disabled={!memwalOn}
            checked={settings.backend === 'memwal'}
            onChange={() => onChange({ ...settings, backend: 'memwal' })}
          />
          <span>
            <strong>Walrus Memory (MemWal){server ? ` · ${netLabel(server.memwal.network)}` : ''}</strong>
            <small>
              {memwalOn
                ? `Marks and the lessons WalMark learns from you are written to Walrus Memory, namespace “${server?.memwal.namespace}”. Recall is semantic.`
                : server && server.memwal.missing.length > 0
                  ? `Missing on the server: ${server.memwal.missing.join(', ')}. Add ${server.memwal.missing.length > 1 ? 'them' : 'it'} to .env.local, restart, then run npm run doctor.`
                  : 'Reading server config…'}
            </small>
          </span>
        </label>

        <label className={`radio ${suiOn ? '' : 'radio-off'}`}>
          <input
            type="radio"
            name="backend"
            data-testid="backend-sui"
            disabled={!suiOn}
            checked={settings.backend === 'sui'}
            onChange={() => onChange({ ...settings, backend: 'sui' })}
          />
          <span>
            <strong>Sui + Walrus, direct{server ? ` · ${netLabel(server.sui.network)}` : ''}</strong>
            <small>
              {suiOn
                ? `Each mark becomes an on-chain Walrus blob, signed by your server wallet. Sui is read through ${server?.sui.tatum ? 'Tatum RPC' : 'your RPC'} (${server?.sui.rpcHost}). You can verify any mark on Sui.`
                : server && server.sui.missing.length > 0
                  ? `Missing on the server: ${server.sui.missing.join(', ')}. Add ${server.sui.missing.length > 1 ? 'them' : 'it'} to .env.local, restart, then run npm run doctor.`
                  : 'Reading server config…'}
            </small>
          </span>
        </label>
        <label className={`radio ${blobsOn ? '' : 'radio-off'}`}>
          <input
            type="radio"
            name="backend"
            disabled={!blobsOn}
            checked={settings.backend === 'walrus'}
            onChange={() => onChange({ ...settings, backend: 'walrus' })}
          />
          <span>
            <strong>Walrus blobs{server ? ` · ${netLabel(network)}` : ''}</strong>
            <small>
              {blobsOn
                ? 'Each mark is a small blob on Walrus, encrypted in your browser. Recall is a local search over your index.'
                : 'Needs a Walrus publisher, and mainnet has no public one. Set WALRUS_PUBLISHER_URL (and WALRUS_PUBLISHER_TOKEN) to your own, or use MemWal below.'}
            </small>
          </span>
        </label>
        {((settings.backend === 'memwal' && memwalOn) || (settings.backend === 'sui' && suiOn)) && (
          <label className="field">
            <span>Access token</span>
            <input
              className="input"
              type="password"
              autoComplete="off"
              value={settings.accessToken}
              onChange={(e) => onChange({ ...settings, accessToken: e.target.value })}
              placeholder="WALMARK_ACCESS_TOKEN"
            />
          </label>
        )}

        {(settings.backend === 'walrus' || (settings.backend === 'sui' && suiOn)) && (
          <>
            <label className="switch">
              <input type="checkbox" checked={settings.encrypt} onChange={(e) => onChange({ ...settings, encrypt: e.target.checked })} />
              <span>
                <strong>Encrypt before upload</strong>
                <small>Walrus blobs are public. Keep this on unless you want readable records.</small>
              </span>
            </label>
            <label className="field">
              <span>Storage duration (epochs)</span>
              <input
                className="input input-narrow"
                type="number"
                min={1}
                max={53}
                value={settings.epochs}
                onChange={(e) => onChange({ ...settings, epochs: Math.min(53, Math.max(1, parseInt(e.target.value, 10) || 1)) })}
              />
              <small>
                {(settings.backend === 'sui' ? (server?.sui.network ?? network) : network) === 'mainnet'
                  ? 'One mainnet epoch is about two weeks, so 5 epochs is roughly 10 weeks. The maximum is 53 (about two years).'
                  : 'One testnet epoch is about a day. Testnet can be wiped at any time.'}
              </small>
            </label>
          </>
        )}

        {settings.backend === 'memwal' && memwalOn && (
          <>
            <h3>MemWal account on Sui</h3>
            <p className="muted small">
              Reads your MemWal account object straight from Sui through the Tatum RPC. It needs only the Tatum key, never a wallet.
              {server && !server.memwal.tatumReads ? ' Add TATUM_API_KEY to the server to turn this on.' : ''}
            </p>
            <button className="btn btn-ghost" onClick={checkAccount} disabled={accountBusy || !settings.accessToken} data-testid="check-account">
              {accountBusy ? 'Reading Sui…' : 'Read MemWal account via Tatum'}
            </button>
            {!settings.accessToken && <p className="muted small">Enter the access token above first.</p>}
            {accountErr && <p className="small err">{accountErr}</p>}
            {account && (
              <div className="wallet" data-testid="account-status">
                {account.error ? (
                  <p className="small err">{account.error}</p>
                ) : (
                  <>
                    <p className={`small ${account.exists && account.chainMatches !== false ? 'ok' : 'err'}`}>
                      {account.exists ? 'Account found on Sui' : 'No object with that ID on Sui'} via {account.rpcHost}
                      {account.latencyMs !== undefined ? ` (${account.latencyMs} ms)` : ''}.
                      {account.chainMatches === false ? ' The RPC is on a different network than the one configured.' : ''}
                    </p>
                    <dl className="kv small">
                      <dt>Account</dt>
                      <dd title={account.accountId}>{`${account.accountId.slice(0, 8)}…${account.accountId.slice(-6)}`}</dd>
                      {account.type && (
                        <>
                          <dt>Type</dt>
                          <dd>{account.type}</dd>
                        </>
                      )}
                      {account.owner && (
                        <>
                          <dt>Owner</dt>
                          <dd>{account.owner.length > 20 ? `${account.owner.slice(0, 8)}…${account.owner.slice(-6)}` : account.owner}</dd>
                        </>
                      )}
                      {account.delegateKeys !== undefined && (
                        <>
                          <dt>Delegate keys</dt>
                          <dd>{account.delegateKeys}</dd>
                        </>
                      )}
                      {account.version && (
                        <>
                          <dt>Version</dt>
                          <dd>{account.version}</dd>
                        </>
                      )}
                    </dl>
                  </>
                )}
              </div>
            )}
          </>
        )}

        {settings.backend === 'sui' && suiOn && (
          <>
            <h3>Wallet and Tatum RPC</h3>
            <p className="muted small">The server wallet pays gas (SUI) and storage (WAL). Use a dedicated wallet with a small balance, never your main one.</p>
            <button className="btn btn-ghost" onClick={checkWallet} disabled={walletBusy || !settings.accessToken} data-testid="check-wallet">
              {walletBusy ? 'Checking…' : 'Check wallet and Tatum RPC'}
            </button>
            {!settings.accessToken && <p className="muted small">Enter the access token above first.</p>}
            {walletErr && <p className="small err">{walletErr}</p>}
            {wallet && (
              <div className="wallet" data-testid="wallet-status">
                {wallet.error ? (
                  <p className="small err">{wallet.error}</p>
                ) : (
                  <>
                    <p className="small ok">
                      RPC {wallet.rpcHost} reachable ({wallet.latencyMs} ms){wallet.chainMatches === false ? '' : ` · ${netLabel(wallet.network)}`}
                      {wallet.epoch !== undefined ? ` · epoch ${wallet.epoch}` : ''}
                    </p>
                    {wallet.chainMatches === false && <p className="small err">The RPC is on a different network than {netLabel(wallet.network)}. Use the matching Tatum endpoint.</p>}
                    <dl className="kv small">
                      <dt>Wallet</dt>
                      <dd title={wallet.address}>{wallet.address ? `${wallet.address.slice(0, 8)}…${wallet.address.slice(-6)}` : '—'}</dd>
                      <dt>SUI (gas)</dt>
                      <dd className={Number(wallet.sui) > 0 ? '' : 'err'}>{wallet.sui ?? '—'}</dd>
                      <dt>WAL (storage)</dt>
                      <dd className={Number(wallet.wal) > 0 ? '' : 'err'}>{wallet.wal ?? '—'}</dd>
                      {wallet.estCostWal && (
                        <>
                          <dt>≈ per mark</dt>
                          <dd>{wallet.estCostWal} WAL for {settings.epochs} epochs</dd>
                        </>
                      )}
                      <dt>Upload</dt>
                      <dd>{wallet.uploadRelay ? `relay ${wallet.uploadRelay}` : 'direct to storage nodes'}</dd>
                    </dl>
                    {Number(wallet.wal) <= 0 && <p className="small err">No WAL in the wallet: saves will fail until you swap some SUI for WAL.</p>}
                    {Number(wallet.sui) <= 0 && <p className="small err">No SUI in the wallet: it needs some for gas.</p>}
                  </>
                )}
              </div>
            )}
          </>
        )}

        <h3>Connection</h3>
        <p className="muted small">
          {server
            ? server.walrus.mode === 'mock'
              ? 'Demo mode: blobs are stored on this server’s disk, not on Walrus.'
              : `${netLabel(server.walrus.network)}. ${
                  server.walrus.publisherHost ? `Publisher ${server.walrus.publisherHost}, ` : 'No publisher set, '
                }aggregator ${server.walrus.aggregatorHost}.${
                  settings.backend === 'memwal' && server.memwal.enabled ? ` MemWal relayer: ${netLabel(server.memwal.network)}.` : ''
                }${
                  settings.backend === 'sui' && server.sui.enabled ? ` Sui RPC: ${server.sui.rpcHost}.` : ''
                }`
            : 'Reading server config…'}
        </p>
        <button className="btn btn-ghost" onClick={test} disabled={testing} data-testid="test-walrus">
          {testing ? 'Testing…' : 'Test Walrus connection'}
        </button>
        {health && (
          <p className={`small ${health.ok || (health.memwal?.ok && health.publisher?.configured === false && health.aggregator?.ok) ? 'ok' : 'err'}`} data-testid="health-result">
            {health.mode === 'mock'
              ? 'Demo mode is on and working.'
              : [
                  `${health.ok ? 'Walrus reachable' : 'Walrus problem'}: aggregator ${health.aggregator?.ok ? 'ok' : 'unreachable'}${
                    health.publisher?.configured === false ? ', no publisher set' : `, publisher ${health.publisher?.ok ? 'ok' : 'unreachable'}`
                  } (${health.latencyMs} ms).`,
                  health.memwal
                    ? ` MemWal relayer (${health.memwal.network}): ${health.memwal.ok ? 'ready' : 'not ready'}.`
                    : '',
                ].join('')}
          </p>
        )}
        {healthErr && <p className="small err">{healthErr}</p>}

        <h3>Backup</h3>
        <p className="muted small">
          The backup holds your encryption key and the list of Walrus blob IDs ({memoryCount} saved). Import it on another device to get the same memory back. Keep the file private.
        </p>
        <div className="row">
          <button className="btn btn-ghost" onClick={onExport} data-testid="export-backup">
            Export backup
          </button>
          <button className="btn btn-ghost" onClick={() => restoreRef.current?.click()}>
            Import backup
          </button>
          <input
            ref={restoreRef}
            type="file"
            hidden
            accept="application/json,.json"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onRestore(f);
              e.target.value = '';
            }}
          />
        </div>

        <h3>Danger zone</h3>
        <button
          className="btn btn-danger"
          onClick={() => {
            if (window.confirm('Delete every document, saved word and the encryption key from this browser? Export a backup first if you want to keep access to your Walrus blobs.')) onWipe();
          }}
        >
          Erase everything on this device
        </button>
      </div>
    </div>
  );
}
