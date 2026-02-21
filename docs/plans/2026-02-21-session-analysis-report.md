# Session Analysis Report Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a toolbar button that runs a full session analysis and displays results in a beautifully formatted report tab.

**Architecture:** Pure renderer-side analysis engine (`sessionAnalyzer.ts`) processes `SessionDetail.messages` in a single pass. Report opens in a new tab type (`'report'`) rendered by `SessionReportTab`. No new IPC needed — all data is already available from `tabSessionData`.

**Tech Stack:** React 18, TypeScript, Zustand, Tailwind CSS, lucide-react icons

---

### Task 1: Add report types

**Acceptance Criteria:**
- [ ] File exists at `src/renderer/types/sessionReport.ts`
- [ ] `SessionReport` interface is exported from `src/renderer/types/sessionReport.ts`
- [ ] `pnpm typecheck` passes with no new errors

**Files:**
- Create: `src/renderer/types/sessionReport.ts`

**Step 1: Create the SessionReport type file**

This file defines all the report section types. The analyzer will return a `SessionReport` object.

```typescript
/**
 * Session analysis report types.
 * Output of analyzeSession() — one interface per report section.
 */

// =============================================================================
// Pricing
// =============================================================================

export interface ModelPricing {
  input: number;
  output: number;
  cache_read: number;
  cache_creation: number;
}

// =============================================================================
// Report Sections
// =============================================================================

export interface ReportOverview {
  sessionId: string;
  projectId: string;
  projectPath: string;
  firstMessage: string;
  messageCount: number;
  hasSubagents: boolean;
  contextConsumption: number;
  contextConsumptionPct: number | null;
  contextAssessment: 'critical' | 'high' | 'moderate' | 'healthy' | null;
  compactionCount: number;
  gitBranch: string;
  startTime: Date | null;
  endTime: Date | null;
  durationSeconds: number;
  durationHuman: string;
  totalMessages: number;
}

export interface ModelTokenStats {
  apiCalls: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreation: number;
  cacheRead: number;
  costUsd: number;
}

export interface TokenTotals {
  inputTokens: number;
  outputTokens: number;
  cacheCreation: number;
  cacheRead: number;
  grandTotal: number;
  cacheReadPct: number;
}

export interface ReportTokenUsage {
  byModel: Record<string, ModelTokenStats>;
  totals: TokenTotals;
}

export interface ReportCostAnalysis {
  parentCostUsd: number;
  subagentCostUsd: number;
  totalSessionCostUsd: number;
  costByModel: Record<string, number>;
  costPerCommit: number | null;
  costPerLineChanged: number | null;
}

export interface ReportCacheEconomics {
  cacheCreation5m: number;
  cacheCreation1h: number;
  cacheRead: number;
  cacheEfficiencyPct: number;
  coldStartDetected: boolean;
  cacheReadToWriteRatio: number;
}

export interface ToolSuccessRate {
  totalCalls: number;
  errors: number;
  successRatePct: number;
}

export interface ReportToolUsage {
  counts: Record<string, number>;
  totalCalls: number;
  successRates: Record<string, ToolSuccessRate>;
}

export interface SubagentEntry {
  description: string;
  subagentType: string;
  model: string;
  totalTokens: number;
  totalDurationMs: number;
  totalToolUseCount: number;
  costUsd: number;
  costNote?: string;
}

export interface ReportSubagentMetrics {
  count: number;
  totalTokens: number;
  totalDurationMs: number;
  totalToolUseCount: number;
  totalCostUsd: number;
  byAgent: SubagentEntry[];
}

export interface ToolError {
  tool: string;
  inputPreview: string;
  error: string;
  messageIndex: number;
  isPermissionDenial: boolean;
}

export interface ReportErrors {
  errors: ToolError[];
  permissionDenials: {
    count: number;
    denials: ToolError[];
    affectedTools: string[];
  };
}

export interface GitCommit {
  messagePreview: string;
  messageIndex: number;
}

export interface ReportGitActivity {
  commitCount: number;
  commits: GitCommit[];
  pushCount: number;
  branchCreations: string[];
  linesAdded: number;
  linesRemoved: number;
  linesChanged: number;
}

export interface FrictionCorrection {
  messageIndex: number;
  keyword: string;
  preview: string;
}

export interface ReportFrictionSignals {
  correctionCount: number;
  corrections: FrictionCorrection[];
  frictionRate: number;
}

export interface ReportThrashingSignals {
  bashNearDuplicates: { prefix: string; count: number }[];
  editReworkFiles: { filePath: string; editIndices: number[] }[];
}

export interface ReportConversationTree {
  totalNodes: number;
  maxDepth: number;
  sidechainCount: number;
  branchPoints: number;
  branchDetails: {
    parentUuid: string;
    childCount: number;
    parentMessageIndex: number | undefined;
  }[];
}

export interface IdleGap {
  gapSeconds: number;
  gapHuman: string;
  afterMessageIndex: number;
}

export interface ReportIdleAnalysis {
  idleThresholdSeconds: number;
  idleGapCount: number;
  totalIdleSeconds: number;
  totalIdleHuman: string;
  wallClockSeconds: number;
  activeWorkingSeconds: number;
  activeWorkingHuman: string;
  idlePct: number;
  longestGaps: IdleGap[];
}

export interface ModelSwitch {
  from: string;
  to: string;
  messageIndex: number;
  timestamp: Date | null;
}

export interface ReportModelSwitches {
  count: number;
  switches: ModelSwitch[];
  modelsUsed: string[];
}

export interface ReportWorkingDirectories {
  uniqueDirectories: string[];
  directoryCount: number;
  changes: { from: string; to: string; messageIndex: number }[];
  changeCount: number;
  isMultiDirectory: boolean;
}

export interface TestSnapshot {
  messageIndex: number;
  passed: number;
  failed: number;
  total: number;
  raw: string;
}

export interface ReportTestProgression {
  snapshotCount: number;
  snapshots: TestSnapshot[];
  trajectory: 'improving' | 'regressing' | 'stable' | 'insufficient_data';
  firstSnapshot: TestSnapshot | null;
  lastSnapshot: TestSnapshot | null;
}

export interface ReportStartupOverhead {
  messagesBeforeFirstWork: number;
  tokensBeforeFirstWork: number;
  pctOfTotal: number;
}

export interface ReportTokenDensityTimeline {
  quartiles: { q: number; avgTokens: number; messageCount: number }[];
}

export interface ReportPromptQuality {
  firstMessageLengthChars: number;
  userMessageCount: number;
  correctionCount: number;
  frictionRate: number;
  assessment: 'underspecified' | 'verbose_but_unclear' | 'well_specified' | 'moderate_friction';
  note: string;
}

export interface ThinkingBlockAnalysis {
  messageIndex: number;
  preview: string;
  charLength: number;
  signals: Record<string, boolean>;
}

export interface ReportThinkingBlocks {
  count: number;
  analyzedCount: number;
  signalSummary: Record<string, number>;
  notableBlocks: ThinkingBlockAnalysis[];
}

export interface KeyEvent {
  timestamp: Date;
  label: string;
  deltaSeconds?: number;
  deltaHuman?: string;
}

export interface ReportFileReadRedundancy {
  totalReads: number;
  uniqueFiles: number;
  readsPerUniqueFile: number;
  redundantFiles: Record<string, number>;
}

// =============================================================================
// Combined Report
// =============================================================================

export interface SessionReport {
  overview: ReportOverview;
  tokenUsage: ReportTokenUsage;
  costAnalysis: ReportCostAnalysis;
  cacheEconomics: ReportCacheEconomics;
  toolUsage: ReportToolUsage;
  subagentMetrics: ReportSubagentMetrics;
  errors: ReportErrors;
  gitActivity: ReportGitActivity;
  frictionSignals: ReportFrictionSignals;
  thrashingSignals: ReportThrashingSignals;
  conversationTree: ReportConversationTree;
  idleAnalysis: ReportIdleAnalysis;
  modelSwitches: ReportModelSwitches;
  workingDirectories: ReportWorkingDirectories;
  testProgression: ReportTestProgression;
  startupOverhead: ReportStartupOverhead;
  tokenDensityTimeline: ReportTokenDensityTimeline;
  promptQuality: ReportPromptQuality;
  thinkingBlocks: ReportThinkingBlocks;
  keyEvents: KeyEvent[];
  messageTypes: Record<string, number>;
  serviceTiers: Record<string, number>;
  fileReadRedundancy: ReportFileReadRedundancy;
  compactionCount: number;
  gitBranches: string[];
}
```

**Step 2: Verify types compile**

Run: `pnpm typecheck`
Expected: No errors related to sessionReport.ts (file is only types, no imports yet)

**Step 3: Commit**

```bash
git add src/renderer/types/sessionReport.ts
git commit -m "feat(report): add session analysis report type definitions"
```

---

### Task 2: Build the session analyzer

**Acceptance Criteria:**
- [ ] File exists at `src/renderer/utils/sessionAnalyzer.ts`
- [ ] `analyzeSession` function is exported from `src/renderer/utils/sessionAnalyzer.ts`
- [ ] `pnpm typecheck` passes with no new errors

**Files:**
- Create: `src/renderer/utils/sessionAnalyzer.ts`

**Docs to reference:**
- `scripts/analyze-session.py` — the Python script being ported (all logic)
- `src/main/types/messages.ts` — `ParsedMessage`, `ToolCall`, `ToolResult`
- `src/main/types/domain.ts` — `Session`, `SessionMetrics`, `TokenUsage` (= `UsageMetadata`)
- `src/main/types/chunks.ts` — `SessionDetail`, `Process`
- `src/main/types/jsonl.ts` — `UsageMetadata` (input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens)

**Step 1: Create the analyzer**

Port all logic from `scripts/analyze-session.py` to TypeScript. The analyzer takes a `SessionDetail` (which has `session`, `messages`, `processes`, `metrics`) and returns a `SessionReport`.

Key mapping from Python to TS:
- Python `data["messages"]` → `detail.messages: ParsedMessage[]`
- Python `data["session"]` → `detail.session: Session`
- Python `m.get("toolCalls", [])` → `msg.toolCalls: ToolCall[]`
- Python `m.get("toolResults", [])` → `msg.toolResults: ToolResult[]`
- Python `m.get("usage")` → `msg.usage?: TokenUsage` (fields: `input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`)
- Python `m.get("model")` → `msg.model?: string`
- Python `m.get("timestamp")` → `msg.timestamp: Date` (already parsed)
- Python `m.get("isMeta")` → `msg.isMeta: boolean`
- Python `m.get("uuid")` → `msg.uuid: string`
- Python `m.get("parentUuid")` → `msg.parentUuid: string | null`
- Python `m.get("cwd")` → `msg.cwd?: string`
- Python `m.get("gitBranch")` → `msg.gitBranch?: string`
- Python `m.get("isSidechain")` → `msg.isSidechain: boolean`
- Python `m.get("isCompactSummary")` → `msg.isCompactSummary?: boolean`
- Python `m.get("agentId")` → `msg.agentId?: string`
- For subagent data, use `detail.processes: Process[]` (already resolved with metrics, duration, description, subagentType)

The function signature:

```typescript
import type { SessionDetail } from '@renderer/types/data';
import type { SessionReport } from '@renderer/types/sessionReport';

export function analyzeSession(detail: SessionDetail): SessionReport { ... }
```

Follow the Python script's single-pass pattern:
1. Initialize accumulators
2. Loop over `detail.messages` once, extracting all data
3. Post-pass aggregation
4. Return typed `SessionReport`

For content text extraction, use this helper (mirrors Python's `extract_text_content`):

```typescript
function extractTextContent(msg: ParsedMessage): string {
  const { content } = msg;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join(' ');
  }
  return '';
}
```

For pricing, port the `MODEL_PRICING` table and `costUsd()` function directly.

For subagent metrics, use `detail.processes` instead of parsing `<usage>` tags — the data is already resolved:
```typescript
const subagentEntries: SubagentEntry[] = detail.processes.map((proc) => ({
  description: proc.description ?? 'unknown',
  subagentType: proc.subagentType ?? 'unknown',
  model: 'default (inherits parent)',
  totalTokens: proc.metrics.totalTokens,
  totalDurationMs: proc.durationMs,
  totalToolUseCount: proc.messages.reduce((sum, m) => sum + m.toolCalls.length, 0),
  costUsd: proc.metrics.costUsd ?? 0,
}));
```

Port ALL regex patterns from Python:
- `FRICTION_PATTERNS` — friction keyword detection
- `PERMISSION_PATTERNS` — permission denial detection
- `TEST_PASS_PATTERNS`, `TEST_FAIL_PATTERNS`, `TEST_SUMMARY_PATTERN` — test output parsing
- `THINKING_SIGNALS` — thinking block content analysis

**Step 2: Verify it compiles**

Run: `pnpm typecheck`
Expected: PASS

**Step 3: Commit**

```bash
git add src/renderer/utils/sessionAnalyzer.ts
git commit -m "feat(report): add session analyzer engine (TS port of analyze-session.py)"
```

---

### Task 3: Write analyzer tests

**Acceptance Criteria:**
- [ ] File exists at `test/renderer/utils/sessionAnalyzer.test.ts`
- [ ] `pnpm test test/renderer/utils/sessionAnalyzer.test.ts` passes with all tests green

**Files:**
- Create: `test/renderer/utils/sessionAnalyzer.test.ts`

**Step 1: Write tests**

Test the analyzer with mock `SessionDetail` objects. At minimum:

1. **Empty session** — no messages, returns zeroed report
2. **Basic session** — a few user + assistant messages with usage data, verify overview, token counts, cost
3. **Tool usage** — messages with toolCalls and toolResults, verify tool counts and success rates
4. **Error detection** — toolResults with `isError: true`, verify error list and permission denial detection
5. **Friction detection** — user messages with "no,", "wrong", "actually" keywords
6. **Git activity** — Bash toolCalls containing "git commit", "git push"
7. **Idle gaps** — messages with timestamps >60s apart
8. **Model switches** — assistant messages with different model fields
9. **Conversation tree** — messages with uuid/parentUuid, verify depth and branching

Create a `createMockMessage()` helper for building `ParsedMessage` objects easily:

```typescript
function createMockMessage(overrides: Partial<ParsedMessage> = {}): ParsedMessage {
  return {
    uuid: crypto.randomUUID(),
    parentUuid: null,
    type: 'assistant',
    timestamp: new Date(),
    content: '',
    isSidechain: false,
    isMeta: false,
    toolCalls: [],
    toolResults: [],
    ...overrides,
  };
}
```

And a `createMockDetail()` helper:

```typescript
function createMockDetail(overrides: Partial<SessionDetail> = {}): SessionDetail {
  return {
    session: { id: 'test', projectId: 'test', projectPath: '/test', createdAt: Date.now(), hasSubagents: false, messageCount: 0 } as Session,
    messages: [],
    chunks: [],
    processes: [],
    metrics: { durationMs: 0, totalTokens: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, messageCount: 0 },
    ...overrides,
  };
}
```

**Step 2: Run tests**

Run: `pnpm test test/renderer/utils/sessionAnalyzer.test.ts`
Expected: All tests pass

**Step 3: Commit**

```bash
git add test/renderer/utils/sessionAnalyzer.test.ts
git commit -m "test(report): add session analyzer tests"
```

---

### Task 4: Add 'report' tab type and store action

**Acceptance Criteria:**
- [ ] `src/renderer/types/tabs.ts` contains `'report'` in the Tab type union
- [ ] `src/renderer/components/layout/SortableTab.tsx` contains `report: Activity` in TAB_ICONS
- [ ] `openSessionReport` is declared in TabSlice interface in `src/renderer/store/slices/tabSlice.ts`
- [ ] `pnpm typecheck` passes with no new errors

**Files:**
- Modify: `src/renderer/types/tabs.ts:79` — add `'report'` to Tab type union
- Modify: `src/renderer/components/layout/SortableTab.tsx:28-33` — add report icon to TAB_ICONS
- Modify: `src/renderer/store/slices/tabSlice.ts` — add `openSessionReport` action
- Modify: `src/renderer/store/types.ts` (if needed for new slice, but likely just extend tabSlice)

**Step 1: Add 'report' to Tab type**

In `src/renderer/types/tabs.ts`, line 79, change:
```typescript
type: 'session' | 'dashboard' | 'notifications' | 'settings';
```
to:
```typescript
type: 'session' | 'dashboard' | 'notifications' | 'settings' | 'report';
```

**Step 2: Add report icon to SortableTab**

In `src/renderer/components/layout/SortableTab.tsx`, add `Activity` to the lucide-react import and to `TAB_ICONS`:

```typescript
import { Activity, Bell, FileText, LayoutDashboard, Pin, Search, Settings, X } from 'lucide-react';

const TAB_ICONS = {
  dashboard: LayoutDashboard,
  notifications: Bell,
  settings: Settings,
  session: FileText,
  report: Activity,
} as const;
```

**Step 3: Add openSessionReport action to tabSlice**

In `src/renderer/store/slices/tabSlice.ts`, add to the `TabSlice` interface:

```typescript
openSessionReport: (sourceTabId: string) => void;
```

Implement it following the `openNotificationsTab` pattern. It needs to:
1. Get `tabSessionData[sourceTabId]` to find the sessionDetail
2. Extract the session's firstMessage for the tab label
3. Open a new tab with `type: 'report'`, the same `projectId` and `sessionId` as the source tab

```typescript
openSessionReport: (sourceTabId: string) => {
  const state = get();
  const sourceTab = getAllTabs(state.paneLayout).find((t) => t.id === sourceTabId);
  if (!sourceTab || sourceTab.type !== 'session') return;

  const tabData = state.tabSessionData[sourceTabId];
  const sessionDetail = tabData?.sessionDetail;
  const label = sessionDetail?.session.firstMessage
    ? `Report: ${truncateLabel(sessionDetail.session.firstMessage, 30)}`
    : 'Session Report';

  state.openTab({
    type: 'report',
    label,
    projectId: sourceTab.projectId,
    sessionId: sourceTab.sessionId,
  });
},
```

**Step 4: Verify types compile**

Run: `pnpm typecheck`
Expected: PASS (PaneContent.tsx will have a gap for the `report` type — we'll add it in Task 6)

**Step 5: Commit**

```bash
git add src/renderer/types/tabs.ts src/renderer/components/layout/SortableTab.tsx src/renderer/store/slices/tabSlice.ts
git commit -m "feat(report): add 'report' tab type and openSessionReport store action"
```

---

### Task 5: Build the report UI components

**Acceptance Criteria:**
- [ ] File exists at `src/renderer/components/report/SessionReportTab.tsx`
- [ ] File exists at `src/renderer/components/report/ReportSection.tsx`
- [ ] Files exist at `src/renderer/components/report/sections/OverviewSection.tsx`, `CostSection.tsx`, `TokenSection.tsx`, `ToolSection.tsx`, `SubagentSection.tsx`, `ErrorSection.tsx`, `GitSection.tsx`, `FrictionSection.tsx`, `TimelineSection.tsx`, `QualitySection.tsx`
- [ ] `pnpm typecheck` passes with no new errors

**Files:**
- Create: `src/renderer/components/report/SessionReportTab.tsx`
- Create: `src/renderer/components/report/ReportSection.tsx` — reusable section card wrapper
- Create: `src/renderer/components/report/sections/OverviewSection.tsx`
- Create: `src/renderer/components/report/sections/CostSection.tsx`
- Create: `src/renderer/components/report/sections/TokenSection.tsx`
- Create: `src/renderer/components/report/sections/ToolSection.tsx`
- Create: `src/renderer/components/report/sections/SubagentSection.tsx`
- Create: `src/renderer/components/report/sections/ErrorSection.tsx`
- Create: `src/renderer/components/report/sections/GitSection.tsx`
- Create: `src/renderer/components/report/sections/FrictionSection.tsx`
- Create: `src/renderer/components/report/sections/TimelineSection.tsx`
- Create: `src/renderer/components/report/sections/QualitySection.tsx`

**Docs to reference:**
- `src/renderer/index.css` — CSS variables for theming
- `.claude/rules/tailwind.md` — Theme architecture (use `bg-surface-raised`, `text-text`, `border-border`, etc.)
- `src/renderer/components/common/TokenUsageDisplay.tsx` — Example of formatted token display
- `src/renderer/utils/formatters.ts` — Existing formatting utilities

**Step 1: Create ReportSection wrapper**

A reusable card component for each report section:

```tsx
interface ReportSectionProps {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
  defaultCollapsed?: boolean;
}
```

Uses `bg-surface-raised`, `border-border`, collapsible with ChevronDown/ChevronRight toggle.

**Step 2: Create section components**

Each section receives its typed data from the `SessionReport` and renders it. Design guidelines:

- **Stat grids**: 2-4 columns of key metrics with label + value
- **Tables**: For lists of items (tools, errors, subagents) using `<table>` with `text-xs`
- **Color coding**: Use inline styles with CSS variables — green for good, amber for warning, red for critical
- **Collapsible details**: For verbose lists (errors, thinking blocks), show count in header and expand for details

Key section designs:

**OverviewSection**: Grid of 6-8 stat cards (duration, messages, context %, compaction, branch, cost)

**CostSection**: Cost by model table + stat cards for total, per-commit, per-line

**TokenSection**: By-model table (input/output/cache-read/cache-create/cost per model) + totals row + cache economics stats

**ToolSection**: Sorted table (tool name, calls, errors, success %) — highlight tools with <90% success rate

**SubagentSection**: Table of subagents (description, type, tokens, duration, cost) + summary stats

**ErrorSection**: Grouped by tool, expandable error details with input preview

**GitSection**: Commits list + stat cards (pushes, branches, lines added/removed)

**FrictionSection**: Friction rate badge + corrections list with message previews + thrashing signals

**TimelineSection**: Idle gaps table + model switches list + key events timeline

**QualitySection**: Prompt quality assessment badge + startup overhead stats + test progression

**Step 3: Create SessionReportTab**

Main component that:
1. Gets `sessionDetail` from `tabSessionData` using the tab's `sessionId` (find the source session tab's data)
2. Calls `analyzeSession(sessionDetail)` with `useMemo`
3. Renders a scrollable container with all section components
4. Shows loading/error states if session data isn't loaded

```tsx
import { useMemo } from 'react';
import { useStore } from '@renderer/store';
import { analyzeSession } from '@renderer/utils/sessionAnalyzer';
import type { Tab } from '@renderer/types/tabs';

interface SessionReportTabProps {
  tab: Tab;
}

export const SessionReportTab = ({ tab }: SessionReportTabProps) => {
  // Find session data from any session tab with matching sessionId
  const sessionDetail = useStore((s) => {
    const allTabs = s.paneLayout.panes.flatMap((p) => p.tabs);
    const sourceTab = allTabs.find(
      (t) => t.type === 'session' && t.sessionId === tab.sessionId
    );
    return sourceTab ? s.tabSessionData[sourceTab.id]?.sessionDetail : null;
  });

  const report = useMemo(
    () => (sessionDetail ? analyzeSession(sessionDetail) : null),
    [sessionDetail]
  );

  if (!report) {
    return <div>No session data available. Open the session first.</div>;
  }

  return (
    <div className="h-full overflow-y-auto p-6" style={{ backgroundColor: 'var(--color-surface)' }}>
      <h1 className="mb-6 text-lg font-semibold" style={{ color: 'var(--color-text)' }}>
        Session Analysis Report
      </h1>
      <div className="flex flex-col gap-4">
        <OverviewSection data={report.overview} />
        <CostSection data={report.costAnalysis} />
        <TokenSection data={report.tokenUsage} cacheEconomics={report.cacheEconomics} />
        <ToolSection data={report.toolUsage} />
        <SubagentSection data={report.subagentMetrics} />
        <ErrorSection data={report.errors} />
        <GitSection data={report.gitActivity} />
        <FrictionSection data={report.frictionSignals} thrashing={report.thrashingSignals} />
        <TimelineSection idle={report.idleAnalysis} modelSwitches={report.modelSwitches} keyEvents={report.keyEvents} />
        <QualitySection prompt={report.promptQuality} startup={report.startupOverhead} testProgression={report.testProgression} />
      </div>
    </div>
  );
};
```

**Step 4: Verify it compiles**

Run: `pnpm typecheck`
Expected: PASS

**Step 5: Commit**

```bash
git add src/renderer/components/report/
git commit -m "feat(report): add session report tab and all section components"
```

---

### Task 6: Wire up routing and toolbar button

**Acceptance Criteria:**
- [ ] `src/renderer/components/layout/PaneContent.tsx` imports and renders `SessionReportTab` for `tab.type === 'report'`
- [ ] `src/renderer/components/layout/TabBar.tsx` contains an Activity button with `onClick` calling `openSessionReport`
- [ ] `pnpm typecheck` passes with no new errors
- [ ] `pnpm test` passes with all existing tests green

**Files:**
- Modify: `src/renderer/components/layout/PaneContent.tsx:42-49` — add report tab routing
- Modify: `src/renderer/components/layout/TabBar.tsx:17,56,102-107,384-387` — add analyze button

**Step 1: Add report routing in PaneContent**

In `src/renderer/components/layout/PaneContent.tsx`, import `SessionReportTab` and add the route:

```tsx
import { SessionReportTab } from '../report/SessionReportTab';
```

In the tab rendering map (around line 42), add before or after the session case:

```tsx
{tab.type === 'report' && <SessionReportTab tab={tab} />}
```

**Step 2: Add analyze button in TabBar**

In `src/renderer/components/layout/TabBar.tsx`:

1. Add `Activity` to the lucide-react import (line 17)
2. Add `openSessionReport` to the store destructure (line 56 area)
3. Add a hover state: `const [analyzeHover, setAnalyzeHover] = useState(false);`
4. Add the button next to ExportDropdown (after line 387):

```tsx
{/* Analyze button - show only for session tabs with loaded data */}
{activeTab?.type === 'session' && activeTabSessionDetail && activeTabId && (
  <button
    onClick={() => openSessionReport(activeTabId)}
    onMouseEnter={() => setAnalyzeHover(true)}
    onMouseLeave={() => setAnalyzeHover(false)}
    className="rounded-md p-2 transition-colors"
    style={{
      color: analyzeHover ? 'var(--color-text)' : 'var(--color-text-muted)',
      backgroundColor: analyzeHover ? 'var(--color-surface-raised)' : 'transparent',
    }}
    title="Analyze Session"
  >
    <Activity className="size-4" />
  </button>
)}
```

**Step 3: Verify it compiles**

Run: `pnpm typecheck`
Expected: PASS

**Step 4: Run existing tests to verify nothing broke**

Run: `pnpm test`
Expected: All existing tests still pass

**Step 5: Commit**

```bash
git add src/renderer/components/layout/PaneContent.tsx src/renderer/components/layout/TabBar.tsx
git commit -m "feat(report): wire up toolbar button and report tab routing"
```

---

### Task 7: Manual verification and polish

**Acceptance Criteria:**
- [ ] [MANUAL] App launches with `pnpm dev` and report tab opens when Activity button is clicked
- [ ] [MANUAL] All report sections render with data from the active session
- [ ] `pnpm test` passes
- [ ] `pnpm typecheck` passes
- [ ] `pnpm lint:fix && pnpm format` passes with no remaining issues

**Step 1: Run the app**

Run: `pnpm dev`

1. Open a session tab
2. Click the Activity (analyze) icon in the toolbar
3. Verify a new "Report: ..." tab opens
4. Verify all sections render with data
5. Check that section cards use correct theme colors
6. Verify collapsible sections work
7. Verify the tab icon shows the Activity icon in the tab bar

**Step 2: Run full test suite**

Run: `pnpm test`
Expected: All tests pass

**Step 3: Run typecheck**

Run: `pnpm typecheck`
Expected: No errors

**Step 4: Run lint and format**

Run: `pnpm lint:fix && pnpm format`

**Step 5: Final commit if any polish changes**

```bash
git add -A
git commit -m "feat(report): polish and fix lint issues"
```
