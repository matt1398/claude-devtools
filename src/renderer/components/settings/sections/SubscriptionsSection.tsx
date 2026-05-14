/**
 * SubscriptionsSection - Manage Claude subscription payments for ROI tracking.
 *
 * Users can log one or more payments per month (e.g. Pro + Max upgrade).
 * The data is stored in the local config file and used by the Dashboard ROI block.
 */

import { useCallback, useMemo, useState } from 'react';

import { createLogger } from '@shared/utils/logger';
import { Calendar, DollarSign, Plus, Trash2 } from 'lucide-react';

import { SettingsSectionHeader } from '../components';

import type { AppConfig } from '@shared/types/notifications';

const logger = createLogger('Component:SubscriptionsSection');

// Pre-defined plan labels for the quick-pick
const PLAN_OPTIONS = ['Pro', 'Max', 'Team', 'Enterprise'];

type SubscriptionEntry = NonNullable<AppConfig['subscriptions']>['entries'][number];

interface NewEntryForm {
  date: string;
  plan: string;
  customPlan: string;
  amountUsd: string;
  note: string;
}

interface SubscriptionsSectionProps {
  readonly config: AppConfig | null;
  readonly saving: boolean;
  readonly onSave: (entries: SubscriptionEntry[]) => Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatDate(iso: string): string {
  try {
    return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}

function newId(): string {
  return crypto.randomUUID();
}

// ─────────────────────────────────────────────────────────────────────────────
// SubscriptionsSection
// ─────────────────────────────────────────────────────────────────────────────

export const SubscriptionsSection = ({
  config,
  saving,
  onSave,
}: SubscriptionsSectionProps): React.JSX.Element => {
  const entries: SubscriptionEntry[] = useMemo(
    () => config?.subscriptions?.entries ?? [],
    [config?.subscriptions?.entries]
  );

  const [showForm, setShowForm] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [amountError, setAmountError] = useState<string | null>(null);
  const [form, setForm] = useState<NewEntryForm>({
    date: todayIso(),
    plan: 'Pro',
    customPlan: '',
    amountUsd: '',
    note: '',
  });

  const effectivePlan = form.plan === 'Custom' ? form.customPlan.trim() : form.plan;
  const amountNum = parseFloat(form.amountUsd);
  const amountValid = !isNaN(amountNum) && amountNum > 0;

  const handleAdd = useCallback(async () => {
    if (saving) return;
    if (!amountValid) {
      setAmountError('Enter a valid amount greater than 0');
      return;
    }
    setAmountError(null);
    const next: SubscriptionEntry[] = [
      ...entries,
      { id: newId(), date: form.date, plan: effectivePlan, amountUsd: amountNum, note: form.note.trim() || undefined },
    ].sort((a, b) => a.date.localeCompare(b.date));
    await onSave(next);
    setAmountError(null);
    setForm({ date: todayIso(), plan: 'Pro', customPlan: '', amountUsd: '', note: '' });
    setShowForm(false);
  }, [saving, amountValid, entries, form, effectivePlan, amountNum, onSave]);

  const handleDelete = useCallback(
    async (id: string) => {
      setDeleting(id);
      try {
        await onSave(entries.filter((e) => e.id !== id));
      } catch (err) {
        logger.error('Failed to delete subscription entry:', err);
      } finally {
        setDeleting(null);
      }
    },
    [entries, onSave]
  );

  // Group entries by month for display
  const grouped = entries.reduce<Record<string, SubscriptionEntry[]>>((acc, e) => {
    const key = e.date.slice(0, 7); // "YYYY-MM"
    if (!acc[key]) acc[key] = [];
    acc[key].push(e);
    return acc;
  }, {});
  const monthKeys = Object.keys(grouped).sort((a, b) => b.localeCompare(a));

  return (
    <div className="space-y-6">
      <SettingsSectionHeader title="Subscription Payments" />
      <p className="text-xs text-text-muted">
        Record your Claude subscription charges to track ROI vs. pay-per-token API costs on the dashboard.
      </p>

      {/* Entry list */}
      {monthKeys.length === 0 && !showForm && (
        <div
          className="flex flex-col items-center justify-center rounded-sm border border-dashed border-border px-6 py-10 text-center"
        >
          <DollarSign className="mb-3 size-8 text-text-muted" />
          <p className="mb-1 text-sm text-text-secondary">No subscription entries yet</p>
          <p className="text-xs text-text-muted">
            Add payments to see your ROI vs. API-equivalent cost on the dashboard.
          </p>
        </div>
      )}

      {monthKeys.map((monthKey) => {
        const monthLabel = new Date(`${monthKey}-01T00:00:00`).toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
        });
        const monthTotal = grouped[monthKey].reduce((s, e) => s + e.amountUsd, 0);

        return (
          <div key={monthKey}>
            {/* Month header */}
            <div
              className="mb-2 flex items-center justify-between pb-2"
              style={{ borderBottom: '1px solid var(--color-border)' }}
            >
              <span className="text-xs font-medium uppercase tracking-wider text-text-muted">
                {monthLabel}
              </span>
              <span className="text-xs font-medium tabular-nums text-text-secondary">
                ${monthTotal.toFixed(2)}
              </span>
            </div>

            {/* Entries */}
            <div className="space-y-2">
              {grouped[monthKey].map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-center justify-between rounded-sm border border-border bg-surface-raised px-3 py-2.5"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <Calendar className="size-3.5 shrink-0 text-text-muted" />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-text">{entry.plan}</span>
                        {entry.note && (
                          <span className="truncate text-xs text-text-muted">{entry.note}</span>
                        )}
                      </div>
                      <span className="text-[10px] text-text-muted">{formatDate(entry.date)}</span>
                    </div>
                  </div>

                  <div className="ml-4 flex shrink-0 items-center gap-3">
                    <span className="tabular-nums text-sm font-medium text-text">
                      ${entry.amountUsd.toFixed(2)}
                    </span>
                    <button
                      onClick={() => void handleDelete(entry.id)}
                      disabled={deleting === entry.id || saving}
                      className="text-text-muted transition-colors hover:text-red-400 disabled:opacity-40"
                      title="Remove entry"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}

      {/* Add entry form */}
      {showForm && (
        <div
          className="rounded-sm border border-border bg-surface-raised p-4"
        >
          <h3 className="mb-4 text-sm font-medium text-text">Add Payment</h3>

          <div className="grid grid-cols-2 gap-3">
            {/* Date */}
            <div>
              <label htmlFor="sub-date" className="mb-1 block text-xs text-text-muted">Date</label>
              <input
                id="sub-date"
                type="date"
                value={form.date}
                onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                className="w-full rounded-sm border border-border bg-surface px-3 py-2 text-sm text-text outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-600/30"
              />
            </div>

            {/* Amount */}
            <div>
              <label htmlFor="sub-amount" className="mb-1 block text-xs text-text-muted">Amount (USD)</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-text-muted">$</span>
                <input
                  id="sub-amount"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={form.amountUsd}
                  onChange={(e) => {
                    setAmountError(null);
                    setForm((f) => ({ ...f, amountUsd: e.target.value }));
                  }}
                  className={`w-full rounded-sm border bg-surface py-2 pl-6 pr-3 text-sm text-text outline-none focus:ring-1 focus:ring-zinc-600/30 ${
                    amountError ? 'border-red-500/60 focus:border-red-500' : 'border-border focus:border-zinc-500'
                  }`}
                />
              </div>
              {amountError && (
                <p className="mt-1 text-[10px] text-red-400">{amountError}</p>
              )}
            </div>

            {/* Plan */}
            <div>
              <p className="mb-1 text-xs text-text-muted">Plan</p>
              <div className="flex flex-wrap gap-1.5">
                {PLAN_OPTIONS.map((p) => (
                  <button
                    key={p}
                    onClick={() => setForm((f) => ({ ...f, plan: p }))}
                    className={`rounded-sm border px-2.5 py-1 text-xs transition-colors ${
                      form.plan === p
                        ? 'border-zinc-500 bg-surface-overlay text-text'
                        : 'border-border bg-surface text-text-muted hover:border-border-emphasis hover:text-text-secondary'
                    }`}
                  >
                    {p}
                  </button>
                ))}
                <button
                  onClick={() => setForm((f) => ({ ...f, plan: 'Custom' }))}
                  className={`rounded-sm border px-2.5 py-1 text-xs transition-colors ${
                    form.plan === 'Custom'
                      ? 'border-zinc-500 bg-surface-overlay text-text'
                      : 'border-border bg-surface text-text-muted hover:border-border-emphasis hover:text-text-secondary'
                  }`}
                >
                  Custom
                </button>
              </div>
            </div>

            {/* Custom plan name */}
            {form.plan === 'Custom' && (
              <div>
                <label htmlFor="sub-custom-plan" className="mb-1 block text-xs text-text-muted">Plan name</label>
                <input
                  id="sub-custom-plan"
                  type="text"
                  placeholder="e.g. Business"
                  value={form.customPlan}
                  onChange={(e) => setForm((f) => ({ ...f, customPlan: e.target.value }))}
                  className="w-full rounded-sm border border-border bg-surface px-3 py-2 text-sm text-text outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-600/30"
                />
              </div>
            )}

            {/* Note (full width) */}
            <div className="col-span-2">
              <label htmlFor="sub-note" className="mb-1 block text-xs text-text-muted">Note (optional)</label>
              <input
                id="sub-note"
                type="text"
                placeholder="e.g. Upgraded mid-month"
                value={form.note}
                onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
                className="w-full rounded-sm border border-border bg-surface px-3 py-2 text-sm text-text outline-none focus:border-zinc-500 focus:ring-1 focus:ring-zinc-600/30"
              />
            </div>
          </div>

          <div className="mt-4 flex justify-end gap-2">
            <button
              onClick={() => setShowForm(false)}
              className="rounded-sm border border-border px-3 py-1.5 text-xs text-text-muted transition-colors hover:text-text-secondary"
            >
              Cancel
            </button>
            <button
              onClick={() => void handleAdd()}
              disabled={saving}
              className="rounded-sm border border-border bg-surface-raised px-3 py-1.5 text-xs text-text transition-colors hover:border-border-emphasis hover:bg-surface-overlay disabled:cursor-not-allowed disabled:opacity-40"
            >
              {saving ? 'Saving…' : 'Add payment'}
            </button>
          </div>
        </div>
      )}

      {/* Add button */}
      {!showForm && (
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 rounded-sm border border-dashed border-border px-3 py-2 text-xs text-text-muted transition-colors hover:border-border-emphasis hover:text-text-secondary"
        >
          <Plus className="size-3.5" />
          Add payment
        </button>
      )}
    </div>
  );
};
