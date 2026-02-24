# Unify Cost Calculation — Single Source of Truth

## Problem

Two independent cost calculation paths produce different numbers in the UI:
- **Chat header** (SessionContextHeader): Shows $6.35 — uses `detail.metrics.costUsd` from main process `calculateMetrics()`
- **Cost analysis panel** (CostSection): Shows $6.57 — uses `parentCost` recomputed by `sessionAnalyzer.ts`

The parent costs are close but the subagent costs diverge significantly because `sessionAnalyzer` recomputes subagent cost using `calculateMessageCost()` with a single model per subagent (first assistant message model), while `calculateMetrics()` correctly computes per-message costs.

## Design

**Principle:** `calculateMetrics()` in the main process is the single source of truth for all cost numbers. The renderer consumes these costs — it never recomputes them.

### Changes

1. **Parent cost** — `sessionAnalyzer` stops accumulating `parentCost` from its message loop. Instead reads `detail.metrics.costUsd`.

2. **Subagent cost** — `sessionAnalyzer` uses `proc.metrics.costUsd` (from `calculateMetrics()`) instead of recomputing via `calculateMessageCost()` with aggregated tokens and a single model.

3. **Per-model cost in report table** — The loop still accumulates per-model token stats. Per-model costs are derived from those tokens via `calculateMessageCost()`. This is display-only math for the breakdown table, not the authoritative totals.

4. **`costByModel` total vs authoritative total** — Per-model costs may not sum exactly to `detail.metrics.costUsd` (rounding, model granularity). `totalSessionCostUsd` uses the authoritative value.

5. **ChatHistory's `subagentCostUsd` useMemo** — Already uses `proc.metrics.costUsd`. No change needed.

### What stays the same

- The per-model token accumulation loop in sessionAnalyzer
- Cache economics, cold start detection
- All 20+ other analyses (tool health, thinking blocks, idle gaps, etc.)
- `calculateMetrics()` implementation (already deduped)

### What changes

- `sessionAnalyzer.ts`: Remove `parentCost` variable and its accumulation. Use `detail.metrics.costUsd` as parent cost.
- `sessionAnalyzer.ts`: Use `proc.metrics.costUsd` for subagent cost instead of recomputing.
- `sessionAnalyzer.ts`: Keep `modelStats[].costUsd` for per-model table (derived from tokens, display-only).
- Remove stale comment "proc.metrics.costUsd is not populated upstream" — it is.

## Files

- `src/renderer/utils/sessionAnalyzer.ts` — main changes
- `test/renderer/utils/sessionAnalyzer.test.ts` — update expectations
