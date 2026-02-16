/**
 * ConnectionSection - Settings section for SSH connection management.
 *
 * Provides UI for:
 * - Toggling between local and SSH modes
 * - Configuring SSH connection (host, port, username, auth)
 * - SSH config host alias combobox with auto-fill
 * - Testing and connecting to remote hosts
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { api } from '@renderer/api';
import { useStore } from '@renderer/store';
import { Loader2, Monitor, Server, Wifi, WifiOff } from 'lucide-react';

import { SettingRow } from '../components/SettingRow';
import { SettingsSectionHeader } from '../components/SettingsSectionHeader';
import { SettingsSelect } from '../components/SettingsSelect';

import type {
  ClaudeRootInfo,
  SshAuthMethod,
  SshConfigHostEntry,
  SshConnectionConfig,
  SshConnectionProfile,
} from '@shared/types';

const authMethodOptions: readonly { value: SshAuthMethod; label: string }[] = [
  { value: 'auto', label: 'Auto (from SSH Config)' },
  { value: 'agent', label: 'SSH Agent' },
  { value: 'privateKey', label: 'Private Key' },
  { value: 'password', label: 'Password' },
];

export const ConnectionSection = (): React.JSX.Element => {
  const connectionState = useStore((s) => s.connectionState);
  const connectedHost = useStore((s) => s.connectedHost);
  const connectionError = useStore((s) => s.connectionError);
  const connectSsh = useStore((s) => s.connectSsh);
  const disconnectSsh = useStore((s) => s.disconnectSsh);
  const testConnection = useStore((s) => s.testConnection);
  const sshConfigHosts = useStore((s) => s.sshConfigHosts);
  const fetchSshConfigHosts = useStore((s) => s.fetchSshConfigHosts);
  const lastSshConfig = useStore((s) => s.lastSshConfig);
  const loadLastConnection = useStore((s) => s.loadLastConnection);

  // Form state
  const [host, setHost] = useState('');
  const [port, setPort] = useState('22');
  const [username, setUsername] = useState('');
  const [authMethod, setAuthMethod] = useState<SshAuthMethod>('auto');
  const [password, setPassword] = useState('');
  const [privateKeyPath, setPrivateKeyPath] = useState('~/.ssh/id_rsa');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; error?: string } | null>(null);

  // Combobox state
  const [showDropdown, setShowDropdown] = useState(false);
  const hostInputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Saved profiles
  const [savedProfiles, setSavedProfiles] = useState<SshConnectionProfile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);
  const [claudeRootInfo, setClaudeRootInfo] = useState<ClaudeRootInfo | null>(null);

  const loadProfiles = useCallback(async () => {
    try {
      const config = await api.config.get();
      const loaded = config.ssh;
      setSavedProfiles(loaded?.profiles ?? []);
    } catch {
      // ignore
    }
  }, []);

  const loadClaudeRootInfo = useCallback(async () => {
    try {
      const info = await api.config.getClaudeRootInfo();
      setClaudeRootInfo(info);
    } catch {
      // ignore
    }
  }, []);

  // Fetch SSH config hosts, saved profiles, and load last connection on mount
  useEffect(() => {
    void fetchSshConfigHosts();
    void loadLastConnection();
    void loadProfiles();
    void loadClaudeRootInfo();
  }, [fetchSshConfigHosts, loadLastConnection, loadProfiles, loadClaudeRootInfo]);

  // Pre-fill form from saved connection config when it arrives (one-time on mount).
  // setState in effect is intentional: lastSshConfig loads async from IPC, so we can't
  // use it as useState initializers.
  const prefilled = useRef(false);
  useEffect(() => {
    if (lastSshConfig && connectionState !== 'connected' && !prefilled.current) {
      prefilled.current = true;
      setHost(lastSshConfig.host);
      setPort(String(lastSshConfig.port));
      setUsername(lastSshConfig.username);
      setAuthMethod(lastSshConfig.authMethod);
      if (lastSshConfig.privateKeyPath) {
        setPrivateKeyPath(lastSshConfig.privateKeyPath);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-time prefill when async data arrives
  }, [lastSshConfig]);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent): void => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node) &&
        hostInputRef.current &&
        !hostInputRef.current.contains(e.target as Node)
      ) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Filter config hosts based on input
  const filteredHosts = useMemo(() => {
    if (!host.trim()) return sshConfigHosts;
    const lower = host.toLowerCase();
    return sshConfigHosts.filter(
      (entry) =>
        entry.alias.toLowerCase().includes(lower) || entry.hostName?.toLowerCase().includes(lower)
    );
  }, [host, sshConfigHosts]);

  const clearProfileSelection = (): void => setSelectedProfileId(null);

  const handleSelectConfigHost = (entry: SshConfigHostEntry): void => {
    setHost(entry.alias);
    if (entry.port) setPort(String(entry.port));
    if (entry.user) setUsername(entry.user);
    setAuthMethod('auto');
    setShowDropdown(false);
    setTestResult(null);
    clearProfileSelection();
  };

  const handleSelectProfile = (profile: SshConnectionProfile): void => {
    setHost(profile.host);
    setPort(String(profile.port));
    setUsername(profile.username);
    setAuthMethod(profile.authMethod);
    if (profile.privateKeyPath) setPrivateKeyPath(profile.privateKeyPath);
    setPassword('');
    setTestResult(null);
    setSelectedProfileId(profile.id);
  };

  const buildConfig = (): SshConnectionConfig => ({
    host,
    port: parseInt(port, 10) || 22,
    username,
    authMethod,
    password: authMethod === 'password' ? password : undefined,
    privateKeyPath: authMethod === 'privateKey' ? privateKeyPath : undefined,
  });

  const handleTest = async (): Promise<void> => {
    setTesting(true);
    setTestResult(null);
    const result = await testConnection(buildConfig());
    setTestResult(result);
    setTesting(false);
  };

  const handleConnect = async (): Promise<void> => {
    await connectSsh(buildConfig());
  };

  const handleDisconnect = async (): Promise<void> => {
    await disconnectSsh();
  };

  const isConnecting = connectionState === 'connecting';
  const isConnected = connectionState === 'connected';
  const resolvedClaudeRootPath = claudeRootInfo?.resolvedPath ?? '~/.claude';

  const inputClass = 'w-full rounded-md border px-3 py-1.5 text-sm focus:outline-none focus:ring-1';
  const inputStyle = {
    backgroundColor: 'var(--color-surface-raised)',
    borderColor: 'var(--color-border)',
    color: 'var(--color-text)',
  };

  return (
    <div className="space-y-6">
      <SettingsSectionHeader title="Remote Connection" />
      <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
        Connect to a remote machine to view Claude Code sessions running there
      </p>

      {/* Connection Status */}
      {isConnected && (
        <div
          className="flex items-center gap-3 rounded-md border px-4 py-3"
          style={{
            borderColor: 'rgba(34, 197, 94, 0.3)',
            backgroundColor: 'rgba(34, 197, 94, 0.05)',
          }}
        >
          <Wifi className="size-4 text-green-400" />
          <div className="flex-1">
            <p className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>
              Connected to {connectedHost}
            </p>
            <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
              Viewing remote sessions via SSH
            </p>
          </div>
          <button
            onClick={() => void handleDisconnect()}
            className="rounded-md px-3 py-1.5 text-sm transition-colors"
            style={{
              backgroundColor: 'var(--color-surface-raised)',
              color: 'var(--color-text-secondary)',
            }}
          >
            Disconnect
          </button>
        </div>
      )}

      {connectionError && (
        <div className="rounded-md border border-red-500/20 bg-red-500/10 px-4 py-3">
          <p className="text-sm text-red-400">{connectionError}</p>
        </div>
      )}

      {/* Mode indicator */}
      {!isConnected && (
        <SettingRow label="Current Mode" description="Data source for session files">
          <div
            className="flex items-center gap-2 text-sm"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            <Monitor className="size-4" />
            <span>Local ({resolvedClaudeRootPath})</span>
          </div>
        </SettingRow>
      )}

      {/* Saved Profiles */}
      {!isConnected && savedProfiles.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium" style={{ color: 'var(--color-text-secondary)' }}>
            Saved Profiles
          </h3>
          <div className="flex flex-wrap gap-2">
            {savedProfiles.map((profile) => {
              const isSelected = selectedProfileId === profile.id;
              return (
                <button
                  key={profile.id}
                  type="button"
                  onClick={() => handleSelectProfile(profile)}
                  className={`flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm transition-colors ${isSelected ? '' : 'hover:bg-surface-raised'}`}
                  style={{
                    borderColor: isSelected ? 'rgba(99, 102, 241, 0.4)' : 'var(--color-border)',
                    backgroundColor: isSelected ? 'rgba(99, 102, 241, 0.1)' : 'transparent',
                    color: isSelected ? 'var(--color-text)' : 'var(--color-text-secondary)',
                  }}
                >
                  <Server
                    className="size-3.5"
                    style={{
                      color: isSelected ? 'rgb(129, 140, 248)' : 'var(--color-text-muted)',
                    }}
                  />
                  <span>{profile.name}</span>
                  <span className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                    {profile.username}@{profile.host}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* SSH Connection Form */}
      {!isConnected && (
        <div className="space-y-4">
          <h3 className="text-sm font-medium" style={{ color: 'var(--color-text-secondary)' }}>
            SSH Connection
          </h3>

          <div className="grid grid-cols-2 gap-3">
            {/* Host input with combobox */}
            <div className="relative">
              <label
                htmlFor="ssh-host"
                className="mb-1 block text-xs"
                style={{ color: 'var(--color-text-muted)' }}
              >
                Host
              </label>
              <input
                id="ssh-host"
                ref={hostInputRef}
                type="text"
                value={host}
                onChange={(e) => {
                  setHost(e.target.value);
                  setShowDropdown(true);
                  setTestResult(null);
                  clearProfileSelection();
                }}
                onFocus={() => setShowDropdown(true)}
                placeholder="hostname or ssh config alias"
                className={inputClass}
                style={inputStyle}
              />
              {showDropdown && filteredHosts.length > 0 && (
                <div
                  ref={dropdownRef}
                  className="absolute z-50 mt-1 max-h-48 w-full overflow-y-auto rounded-md border shadow-lg"
                  style={{
                    backgroundColor: 'var(--color-surface-overlay)',
                    borderColor: 'var(--color-border-emphasis)',
                  }}
                >
                  {filteredHosts.map((entry) => (
                    <button
                      key={entry.alias}
                      type="button"
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-surface-raised"
                      style={{
                        color: 'var(--color-text)',
                      }}
                      onClick={() => handleSelectConfigHost(entry)}
                    >
                      <span className="font-medium">{entry.alias}</span>
                      {entry.hostName && (
                        <span style={{ color: 'var(--color-text-muted)' }}>{entry.hostName}</span>
                      )}
                      {entry.user && (
                        <span
                          className="ml-auto text-xs"
                          style={{ color: 'var(--color-text-muted)' }}
                        >
                          {entry.user}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div>
              <label
                htmlFor="ssh-port"
                className="mb-1 block text-xs"
                style={{ color: 'var(--color-text-muted)' }}
              >
                Port
              </label>
              <input
                id="ssh-port"
                type="text"
                value={port}
                onChange={(e) => setPort(e.target.value)}
                placeholder="22"
                className={inputClass}
                style={inputStyle}
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="ssh-username"
              className="mb-1 block text-xs"
              style={{ color: 'var(--color-text-muted)' }}
            >
              Username
            </label>
            <input
              id="ssh-username"
              type="text"
              value={username}
              onChange={(e) => {
                setUsername(e.target.value);
                clearProfileSelection();
              }}
              placeholder="user"
              className={inputClass}
              style={inputStyle}
            />
          </div>

          <div>
            {/* eslint-disable-next-line jsx-a11y/label-has-associated-control -- SettingsSelect is a custom dropdown without a native control */}
            <label className="mb-1 block text-xs" style={{ color: 'var(--color-text-muted)' }}>
              Authentication
            </label>
            <SettingsSelect
              value={authMethod}
              options={authMethodOptions}
              onChange={setAuthMethod}
              fullWidth
            />
          </div>

          {authMethod === 'privateKey' && (
            <div>
              <label
                htmlFor="ssh-private-key-path"
                className="mb-1 block text-xs"
                style={{ color: 'var(--color-text-muted)' }}
              >
                Private Key Path
              </label>
              <input
                id="ssh-private-key-path"
                type="text"
                value={privateKeyPath}
                onChange={(e) => setPrivateKeyPath(e.target.value)}
                placeholder="~/.ssh/id_rsa"
                className={inputClass}
                style={inputStyle}
              />
            </div>
          )}

          {authMethod === 'password' && (
            <div>
              <label
                htmlFor="ssh-password"
                className="mb-1 block text-xs"
                style={{ color: 'var(--color-text-muted)' }}
              >
                Password
              </label>
              <input
                id="ssh-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inputClass}
                style={inputStyle}
              />
            </div>
          )}

          {/* Test result */}
          {testResult && (
            <div
              className={`rounded-md border px-3 py-2 text-sm ${
                testResult.success
                  ? 'border-green-500/20 bg-green-500/10 text-green-400'
                  : 'border-red-500/20 bg-red-500/10 text-red-400'
              }`}
            >
              {testResult.success
                ? 'Connection successful'
                : `Connection failed: ${testResult.error ?? 'Unknown error'}`}
            </div>
          )}

          {/* Action buttons */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => void handleTest()}
              disabled={!host || testing || isConnecting}
              className="rounded-md px-4 py-1.5 text-sm transition-colors disabled:opacity-50"
              style={{
                backgroundColor: 'var(--color-surface-raised)',
                color: 'var(--color-text-secondary)',
              }}
            >
              {testing ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="size-3 animate-spin" />
                  Testing...
                </span>
              ) : (
                'Test Connection'
              )}
            </button>

            <button
              onClick={() => void handleConnect()}
              disabled={!host || isConnecting}
              className="rounded-md px-4 py-1.5 text-sm transition-colors disabled:opacity-50"
              style={{
                backgroundColor: 'var(--color-surface-raised)',
                color: 'var(--color-text)',
              }}
            >
              {isConnecting ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="size-3 animate-spin" />
                  Connecting...
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <WifiOff className="size-3" />
                  Connect
                </span>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
