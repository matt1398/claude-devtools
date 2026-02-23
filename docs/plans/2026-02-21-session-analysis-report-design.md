# Session Analysis Report — Design Document

**Date:** 2026-02-21
**Status:** Approved

## Overview

Port the `scripts/analyze-session.py` analysis logic to TypeScript and display results as a beautifully formatted report in a new tab. An Activity icon button in the session toolbar triggers the analysis.

## Decisions

- **TypeScript port** — no Python dependency; runs in-process in the renderer
- **New tab** — opens a dedicated report tab (consistent with Settings/Notifications pattern)
- **Activity icon** — in the toolbar next to the Export dropdown
- **Full port** — all ~30 analysis sections from the Python script
- **Renderer-only** — no new IPC; `SessionDetail.messages` already has all raw data

## Architecture

```
TabBar.tsx (Activity button click)
  → store action: openSessionReport(sourceTabId)
    → creates tab { type: 'report', projectId, sessionId, sourceTabId }
    → SessionReportTab mounts
      → analyzeSession(sessionDetail) from sessionAnalyzer.ts
      → renders report sections
```

## New Files

### Types
- `src/renderer/types/sessionReport.ts` — `SessionReport` interface with all section types

### Analysis Engine
- `src/renderer/utils/sessionAnalyzer.ts` — `analyzeSession(detail: SessionDetail): SessionReport`
  - Single-pass over `detail.messages` (mirrors the Python script's accumulator pattern)
  - Post-pass aggregation for derived metrics
  - Uses `detail.session` for metadata, `detail.processes` for subagent data

### Report UI
- `src/renderer/components/report/SessionReportTab.tsx` — Main report tab
- `src/renderer/components/report/sections/` — Section components:
  - `OverviewSection` — Session ID, project, duration, message count, context assessment
  - `CostSection` — Cost by model, total, per-commit, per-line
  - `TokenSection` — Token usage by model, cache economics, density timeline
  - `ToolSection` — Tool counts, success rates
  - `SubagentSection` — Subagent metrics, cost, token usage
  - `ErrorSection` — Tool errors, permission denials
  - `GitSection` — Commits, pushes, branches, lines changed
  - `FrictionSection` — User corrections, thrashing signals
  - `TimelineSection` — Idle gaps, model switches, key events
  - `ConversationTreeSection` — Tree depth, branching, sidechains
  - `QualitySection` — Prompt quality, startup overhead, test progression

### Integration Points (modified files)
- `src/renderer/types/tabs.ts` — Add `'report'` tab type
- `src/renderer/store/slices/tabSlice.ts` — Add `openSessionReport` action
- `src/renderer/components/layout/TabBar.tsx` — Add Activity icon button
- `src/renderer/App.tsx` (or routing equivalent) — Route `report` tabs to `SessionReportTab`

## Report Visual Design

- Each section is a card with `bg-surface-raised` background and `border-border` border
- Section headers with lucide-react icons and bold titles
- Data in tables and stat grids using theme-aware CSS variables
- Color-coded assessments: green (healthy), amber (warning), red (critical)
- Collapsible detail sections for verbose data (thinking blocks, error details, idle gaps)
- Scrollable report body with sticky section navigation

## Data Flow

The `SessionDetail` already contains:
- `messages: ParsedMessage[]` — raw messages with toolCalls, toolResults, usage, model, timestamp, uuid/parentUuid, isMeta, cwd, gitBranch, agentId, isSidechain
- `session: Session` — metadata (contextConsumption, compactionCount, phaseBreakdown, etc.)
- `processes: Process[]` — subagent executions with nested messages and metrics
- `metrics: SessionMetrics` — pre-computed aggregates

The analyzer works directly with these types — no JSON serialization or IPC needed.

## Analysis Sections (ported from Python)

| Section | Key Metrics |
|---------|------------|
| Overview | Duration, message count, context consumption, compaction count |
| Cost Analysis | Parent + subagent cost, cost by model, per-commit, per-line |
| Token Usage | By model (input/output/cache), totals, cache read % |
| Cache Economics | Creation 5m/1h, read/write ratio, cold start, efficiency % |
| Tool Usage | Counts, success rates per tool |
| Subagent Metrics | Count, tokens, duration, cost per agent |
| Errors | Tool errors, permission denials, affected tools |
| Git Activity | Commits, pushes, branch creations, lines changed |
| Friction Signals | Correction count, friction rate, keyword matches |
| Thrashing | Bash near-duplicates, file edit rework |
| Conversation Tree | Max depth, sidechain count, branch points |
| Idle Analysis | Gap count, total idle time, active working time |
| Model Switches | Switch count, models used |
| Working Directories | Unique dirs, change count |
| Test Progression | Snapshots, trajectory (improving/regressing/stable) |
| Startup Overhead | Messages/tokens before first work tool |
| Token Density Timeline | Quartile averages |
| Prompt Quality | First message length, friction rate, assessment |
| Thinking Blocks | Count, signal analysis (alternatives, uncertainty, planning) |
| Key Events | Timestamped skill invocations, task launches |
| Service Tiers | API tier usage distribution |
| File Read Redundancy | Reads per unique file, redundant files |
| Compact Summaries | Count of context compaction events |
| Out-of-scope Findings | Keywords detected in assistant responses |
