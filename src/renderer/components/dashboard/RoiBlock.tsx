/**
 * RoiBlock - Subscription ROI summary for the Dashboard.
 *
 * Shows for the current calendar month:
 *   • What you paid (subscription)
 *   • What the same usage would cost on the pay-per-token API
 *   • Your savings (or how much you need to use to break even)
 *
 * Data sources:
 *   - Subscription entries from app config (Settings → Billing)
 *   - Monthly token usage from the `get-usage-stats` IPC endpoint
 */

import React, { useCallback, useEffect, useState } from 'react';

import { api } from '@renderer/api';
import { useStore } from '@renderer/store';
import { createLogger } from '@shared/utils/logger';
import { ArrowRight, CreditCard, Loader2, TrendingDown, TrendingUp, Zap } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

import type { AppConfig } from '@renderer/types/data';
import type { UsageStats } from '@shared/types';

const logger = createLogger('Component:RoiBlock');

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function formatUsd(value: number): string {
  if (value >= 1000) return `$${(value / 1000).toFixed(1)}k`;
  if (value >= 100) return `$${value.toFixed(0)}`;
  if (value >= 10) return `$${value.toFixed(1)}`;
  return `$${value.toFixed(2)}`;
}

function currentYearMonth(): { year: number; month: number } {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

function monthLabel(year: number, month: number): string {
  return new Date(year, month - 1, 1).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
  });
}

function subscriptionTotalForMonth(
  entries: AppConfig['subscriptions'],
  year: number,
  month: number
): number {
  const prefix = `${year}-${String(month).padStart(2, '0')}`;
  return (entries?.entries ?? [])
    .filter((e) => e.date.startsWith(prefix))
    .reduce((sum, e) => sum + e.amountUsd, 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// Stat card
// ─────────────────────────────────────────────────────────────────────────────

interface StatCardProps {
  label: string;
  value: string;
  icon: React.ReactNode;
  accent?: 'green' | 'red' | 'neutral';
  subtitle?: string;
}

const StatCard = ({ label, value, icon, accent = 'neutral', subtitle }: StatCardProps): React.JSX.Element => {
  const accentColor =
    accent === 'green'
      ? 'var(--semantic-success, #22c55e)'
      : accent === 'red'
        ? 'var(--semantic-error, #ef4444)'
        : 'var(--color-text-secondary)';

  return (
    <div
      className="flex flex-col gap-3 rounded-sm border border-border bg-surface-raised p-4"
    >
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-wider text-text-muted">{label}</span>
        <span style={{ color: accentColor }}>{icon}</span>
      </div>
      <div>
        <span
          className="text-2xl font-semibold tabular-nums"
          style={{ color: accentColor === 'var(--color-text-secondary)' ? 'var(--color-text)' : accentColor }}
        >
          {value}
        </span>
        {subtitle && (
          <p className="mt-0.5 text-[10px] text-text-muted">{subtitle}</p>
        )}
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// RoiBlock
// ─────────────────────────────────────────────────────────────────────────────

export const RoiBlock = (): React.JSX.Element | null => {
  const { year, month } = currentYearMonth();
  const { appConfig, openSettingsTab } = useStore(
    useShallow((s) => ({
      appConfig: s.appConfig,
      openSettingsTab: s.openSettingsTab,
    }))
  );

  const [stats, setStats] = useState<UsageStats | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.getUsageStats(year, month);
      setStats(result);
    } catch (err) {
      logger.error('Failed to load usage stats:', err);
    } finally {
      setLoading(false);
    }
  }, [year, month]);

  useEffect(() => {
    void load();
  }, [load]);

  const subPaid = subscriptionTotalForMonth(appConfig?.subscriptions, year, month);
  const apiEquiv = stats?.totalCostUsd ?? 0;
  const savings = apiEquiv - subPaid;
  const hasSubscription = subPaid > 0;
  const hasUsage = (stats?.sessionCount ?? 0) > 0;

  // Don't render anything if user hasn't configured subscriptions yet
  if (!hasSubscription && !loading) {
    return (
      <div
        className="flex items-center justify-between rounded-sm border border-dashed border-border px-4 py-3"
      >
        <div className="flex items-center gap-3 text-text-muted">
          <CreditCard className="size-4" />
          <span className="text-xs">
            Add your subscription payments to see ROI vs. API pricing
          </span>
        </div>
        <button
          onClick={() => openSettingsTab('billing')}
          className="flex items-center gap-1 text-xs text-text-muted transition-colors hover:text-text-secondary"
        >
          Set up
          <ArrowRight className="size-3" />
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Section header */}
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-medium uppercase tracking-wider text-text-muted">
          {monthLabel(year, month)} — Subscription ROI
        </h2>
        <button
          onClick={() => openSettingsTab('billing')}
          className="text-xs text-text-muted transition-colors hover:text-text-secondary"
        >
          Manage billing
        </button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-4 text-text-muted">
          <Loader2 className="size-4 animate-spin" />
          <span className="text-xs">Calculating usage…</span>
        </div>
      ) : (
        <>
          {/* Three stat cards */}
          <div className="grid grid-cols-3 gap-3">
            <StatCard
              label="Paid (subscription)"
              value={formatUsd(subPaid)}
              icon={<CreditCard className="size-4" />}
              subtitle={
                (appConfig?.subscriptions?.entries ?? [])
                  .filter((e) => e.date.startsWith(`${year}-${String(month).padStart(2, '0')}`))
                  .map((e) => e.plan)
                  .join(' + ') || undefined
              }
            />
            <StatCard
              label="API equivalent"
              value={hasUsage ? formatUsd(apiEquiv) : '—'}
              icon={<Zap className="size-4" />}
              subtitle={hasUsage ? `${stats!.sessionCount} sessions` : 'No sessions yet'}
            />
            <StatCard
              label={savings >= 0 ? 'You saved' : 'Break-even gap'}
              value={hasUsage ? formatUsd(Math.abs(savings)) : '—'}
              icon={
                savings >= 0
                  ? <TrendingDown className="size-4" />
                  : <TrendingUp className="size-4" />
              }
              accent={!hasUsage ? 'neutral' : savings >= 0 ? 'green' : 'red'}
              subtitle={
                hasUsage
                  ? savings >= 0
                    ? `${((savings / subPaid) * 100).toFixed(0)}% return on subscription`
                    : `Need $${(subPaid - apiEquiv).toFixed(2)} more API usage to break even`
                  : undefined
              }
            />
          </div>

          {/* Progress bar: API usage vs subscription cost */}
          {hasUsage && subPaid > 0 && (
            <div>
              <div
                className="h-1 w-full overflow-hidden rounded-full"
                style={{ backgroundColor: 'var(--color-surface-raised)' }}
              >
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${Math.min((apiEquiv / subPaid) * 100, 100).toFixed(1)}%`,
                    backgroundColor:
                      apiEquiv >= subPaid ? 'var(--semantic-success, #22c55e)' : 'var(--semantic-warning, #f59e0b)',
                  }}
                />
              </div>
              <p className="mt-1 text-[10px] text-text-muted">
                {((apiEquiv / subPaid) * 100).toFixed(0)}% of subscription cost covered by API usage
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
};
