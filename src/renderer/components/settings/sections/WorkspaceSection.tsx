/**
 * WorkspaceSection - Settings section for managing saved SSH connection profiles.
 *
 * Provides CRUD UI for:
 * - Listing saved SSH profiles
 * - Adding new profiles (name, host, port, username, auth method)
 * - Inline editing existing profile fields
 * - Deleting profiles with confirmation
 *
 * Profile changes persist via ConfigManager and trigger context list refresh.
 */

import { useCallback, useEffect, useState } from 'react';

import { api } from '@renderer/api';
import { confirm } from '@renderer/components/common/ConfirmDialog';
import { useStore } from '@renderer/store';
import { Edit2, Loader2, Plus, Save, Server, Trash2, X } from 'lucide-react';

import { SettingsSectionHeader } from '../components/SettingsSectionHeader';
import { SettingsSelect } from '../components/SettingsSelect';

import type { SshAuthMethod, SshConnectionProfile } from '@shared/types';

const inputClass = 'w-full rounded-md border px-3 py-1.5 text-sm focus:outline-none focus:ring-1';
const inputStyle = {
  backgroundColor: 'var(--color-surface-raised)',
  borderColor: 'var(--color-border)',
  color: 'var(--color-text)',
};

const authMethodOptions: readonly { value: SshAuthMethod; label: string }[] = [
  { value: 'auto', label: 'Auto (from SSH Config)' },
  { value: 'agent', label: 'SSH Agent' },
  { value: 'privateKey', label: 'Private Key' },
  { value: 'password', label: 'Password' },
];

const defaultForm = {
  name: '',
  host: '',
  port: '22',
  username: '',
  authMethod: 'auto' as SshAuthMethod,
  privateKeyPath: '',
};

export const WorkspaceSection = (): React.JSX.Element => {
  const [profiles, setProfiles] = useState<SshConnectionProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);

  // Form state
  const [formName, setFormName] = useState(defaultForm.name);
  const [formHost, setFormHost] = useState(defaultForm.host);
  const [formPort, setFormPort] = useState(defaultForm.port);
  const [formUsername, setFormUsername] = useState(defaultForm.username);
  const [formAuthMethod, setFormAuthMethod] = useState<SshAuthMethod>(defaultForm.authMethod);
  const [formPrivateKeyPath, setFormPrivateKeyPath] = useState(defaultForm.privateKeyPath);
  const fetchAvailableContexts = useStore((s) => s.fetchAvailableContexts);

  const resetForm = useCallback(() => {
    setFormName(defaultForm.name);
    setFormHost(defaultForm.host);
    setFormPort(defaultForm.port);
    setFormUsername(defaultForm.username);
    setFormAuthMethod(defaultForm.authMethod);
    setFormPrivateKeyPath(defaultForm.privateKeyPath);
  }, []);

  const loadProfiles = useCallback(async () => {
    try {
      const config = await api.config.get();
      // AppConfig type doesn't include ssh field, but ConfigManager returns it at runtime
      const loaded = config.ssh;
      setProfiles(loaded?.profiles ?? []);
    } catch (err) {
      console.error('[WorkspaceSection] Failed to load profiles:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadProfiles();
  }, [loadProfiles]);

  useEffect(() => {
    if (!error) return;
    const timer = window.setTimeout(() => {
      setError(null);
    }, 5000);
    return () => window.clearTimeout(timer);
  }, [error]);

  // Populate form when editing starts
  useEffect(() => {
    if (editingId) {
      const profile = profiles.find((p) => p.id === editingId);
      if (profile) {
        setFormName(profile.name);
        setFormHost(profile.host);
        setFormPort(String(profile.port));
        setFormUsername(profile.username);
        setFormAuthMethod(profile.authMethod);
        setFormPrivateKeyPath(profile.privateKeyPath ?? '');
      }
    }
  }, [editingId, profiles]);

  const handleAdd = async (): Promise<void> => {
    const newProfile: SshConnectionProfile = {
      id: crypto.randomUUID(),
      name: formName.trim(),
      host: formHost.trim(),
      port: parseInt(formPort, 10) || 22,
      username: formUsername.trim(),
      authMethod: formAuthMethod,
      privateKeyPath: formAuthMethod === 'privateKey' ? formPrivateKeyPath.trim() : undefined,
    };

    await api.config.update('ssh', { profiles: [...profiles, newProfile] });
    await loadProfiles();
    resetForm();
    setShowAddForm(false);
    void fetchAvailableContexts();
  };

  const handleEdit = async (): Promise<void> => {
    const updatedProfiles = profiles.map((p) =>
      p.id === editingId
        ? {
            ...p,
            name: formName.trim(),
            host: formHost.trim(),
            port: parseInt(formPort, 10) || 22,
            username: formUsername.trim(),
            authMethod: formAuthMethod,
            privateKeyPath: formAuthMethod === 'privateKey' ? formPrivateKeyPath.trim() : undefined,
          }
        : p
    );

    await api.config.update('ssh', { profiles: updatedProfiles });
    await loadProfiles();
    setEditingId(null);
    resetForm();
    void fetchAvailableContexts();
  };

  const handleDelete = async (id: string): Promise<void> => {
    const profile = profiles.find((p) => p.id === id);
    if (!profile) return;

    const config = await api.config.get();
    const referencedRoot = config.roots.items.find(
      (root) => root.type === 'ssh' && root.sshProfileId === id
    );
    if (referencedRoot) {
      setError(`Profile is used by root "${referencedRoot.name}". Remove the root first.`);
      return;
    }
    setError(null);

    const confirmed = await confirm({
      title: 'Delete Profile',
      message: `Are you sure you want to delete "${profile.name}"? This cannot be undone.`,
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (!confirmed) return;

    const filtered = profiles.filter((p) => p.id !== id);
    await api.config.update('ssh', { profiles: filtered });
    await loadProfiles();
    void fetchAvailableContexts();
  };

  const isFormValid =
    formName.trim() !== '' && formHost.trim() !== '' && formUsername.trim() !== '';

  const renderForm = (onSave: () => Promise<void>, onCancel: () => void): React.JSX.Element => (
    <div
      className="space-y-3 rounded-md border p-4"
      style={{
        backgroundColor: 'var(--color-surface-raised)',
        borderColor: 'var(--color-border)',
      }}
    >
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label
            htmlFor="ws-profile-name"
            className="mb-1 block text-xs"
            style={{ color: 'var(--color-text-muted)' }}
          >
            Name
          </label>
          <input
            id="ws-profile-name"
            type="text"
            value={formName}
            onChange={(e) => setFormName(e.target.value)}
            placeholder="My Server"
            className={inputClass}
            style={inputStyle}
          />
        </div>
        <div>
          <label
            htmlFor="ws-profile-host"
            className="mb-1 block text-xs"
            style={{ color: 'var(--color-text-muted)' }}
          >
            Host
          </label>
          <input
            id="ws-profile-host"
            type="text"
            value={formHost}
            onChange={(e) => setFormHost(e.target.value)}
            placeholder="hostname or IP"
            className={inputClass}
            style={inputStyle}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label
            htmlFor="ws-profile-port"
            className="mb-1 block text-xs"
            style={{ color: 'var(--color-text-muted)' }}
          >
            Port
          </label>
          <input
            id="ws-profile-port"
            type="text"
            value={formPort}
            onChange={(e) => setFormPort(e.target.value)}
            placeholder="22"
            className={inputClass}
            style={inputStyle}
          />
        </div>
        <div>
          <label
            htmlFor="ws-profile-username"
            className="mb-1 block text-xs"
            style={{ color: 'var(--color-text-muted)' }}
          >
            Username
          </label>
          <input
            id="ws-profile-username"
            type="text"
            value={formUsername}
            onChange={(e) => setFormUsername(e.target.value)}
            placeholder="user"
            className={inputClass}
            style={inputStyle}
          />
        </div>
      </div>

      <div>
        {/* eslint-disable-next-line jsx-a11y/label-has-associated-control -- SettingsSelect is a custom dropdown without a native control */}
        <label className="mb-1 block text-xs" style={{ color: 'var(--color-text-muted)' }}>
          Authentication
        </label>
        <SettingsSelect
          value={formAuthMethod}
          options={authMethodOptions}
          onChange={setFormAuthMethod}
          fullWidth
        />
      </div>

      {formAuthMethod === 'privateKey' && (
        <div>
          <label
            htmlFor="ws-profile-private-key-path"
            className="mb-1 block text-xs"
            style={{ color: 'var(--color-text-muted)' }}
          >
            Private Key Path
          </label>
          <input
            id="ws-profile-private-key-path"
            type="text"
            value={formPrivateKeyPath}
            onChange={(e) => setFormPrivateKeyPath(e.target.value)}
            placeholder="~/.ssh/id_rsa"
            className={inputClass}
            style={inputStyle}
          />
        </div>
      )}

      {formAuthMethod === 'password' && (
        <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
          You will be prompted for the password when connecting.
        </p>
      )}

      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={() => void onSave()}
          disabled={!isFormValid}
          className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors disabled:opacity-50"
          style={{
            backgroundColor: 'var(--color-surface-raised)',
            color: 'var(--color-text)',
          }}
        >
          <Save className="size-3.5" />
          Save
        </button>
        <button
          onClick={onCancel}
          className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors"
          style={{
            backgroundColor: 'transparent',
            color: 'var(--color-text-muted)',
          }}
        >
          <X className="size-3.5" />
          Cancel
        </button>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <SettingsSectionHeader title="Workspace Profiles" />

      {error && (
        <div className="rounded-md border border-red-500/20 bg-red-500/10 px-4 py-3">
          <p className="text-sm text-red-400">{error}</p>
        </div>
      )}
      <p className="text-sm" style={{ color: 'var(--color-text-muted)' }}>
        Save SSH connection profiles for quick reconnection
      </p>

      {loading && (
        <div className="flex items-center gap-2 py-4" style={{ color: 'var(--color-text-muted)' }}>
          <Loader2 className="size-4 animate-spin" />
          <span className="text-sm">Loading profiles...</span>
        </div>
      )}

      {!loading && profiles.length === 0 && !showAddForm && (
        <div
          className="rounded-md border py-8 text-center"
          style={{
            borderColor: 'var(--color-border)',
            color: 'var(--color-text-muted)',
          }}
        >
          <Server className="mx-auto mb-2 size-8 opacity-40" />
          <p className="text-sm">No saved profiles</p>
          <p className="mt-1 text-xs">Add an SSH profile to connect quickly</p>
        </div>
      )}

      {!loading && (
        <div className="space-y-3">
          {profiles.map((profile) =>
            editingId === profile.id ? (
              <div key={profile.id}>
                {renderForm(handleEdit, () => {
                  setEditingId(null);
                  resetForm();
                })}
              </div>
            ) : (
              <div
                key={profile.id}
                className="flex items-center gap-3 rounded-md border p-4"
                style={{
                  backgroundColor: 'var(--color-surface-raised)',
                  borderColor: 'var(--color-border)',
                }}
              >
                <Server className="size-4 shrink-0" style={{ color: 'var(--color-text-muted)' }} />
                <div className="min-w-0 flex-1">
                  <p
                    className="truncate text-sm font-medium"
                    style={{ color: 'var(--color-text)' }}
                  >
                    {profile.name}
                  </p>
                  <p className="truncate text-xs" style={{ color: 'var(--color-text-muted)' }}>
                    {profile.username}@{profile.host}:{profile.port}
                  </p>
                </div>
                <span
                  className="shrink-0 rounded px-1.5 py-0.5 text-xs"
                  style={{
                    backgroundColor: 'var(--color-surface)',
                    color: 'var(--color-text-muted)',
                  }}
                >
                  {profile.authMethod}
                </span>
                <button
                  onClick={() => setEditingId(profile.id)}
                  className="shrink-0 rounded p-1 transition-colors hover:bg-surface-raised"
                  style={{ color: 'var(--color-text-muted)' }}
                  title="Edit profile"
                >
                  <Edit2 className="size-3.5" />
                </button>
                <button
                  onClick={() => void handleDelete(profile.id)}
                  className="shrink-0 rounded p-1 transition-colors hover:bg-surface-raised"
                  style={{ color: 'var(--color-text-muted)' }}
                  title="Delete profile"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            )
          )}
        </div>
      )}

      {!loading && (
        <div>
          {showAddForm ? (
            renderForm(handleAdd, () => {
              setShowAddForm(false);
              resetForm();
            })
          ) : (
            <button
              onClick={() => {
                resetForm();
                setShowAddForm(true);
              }}
              className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors"
              style={{
                backgroundColor: 'var(--color-surface-raised)',
                color: 'var(--color-text-secondary)',
              }}
            >
              <Plus className="size-3.5" />
              Add Profile
            </button>
          )}
        </div>
      )}
    </div>
  );
};
