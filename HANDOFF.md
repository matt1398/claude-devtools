# HANDOFF — claude-devtools UI work

**For:** the Claude Code session making edits to this repo.
**Repo:** this checkout (Electron + electron-vite + Fastify backend + React/TS renderer; also builds a standalone HTTP server for Docker).
**Goal:** Improve this as a live viewer for Claude Code sessions in `~/.claude/`. Owner finds it heavier than a hand-rolled viewer; the job is to make it fast to iterate on and finish a short list of UI features.

## ⚠️ Read this first — most features already exist

A read-only survey of the codebase found that **6 of the 10 requested features are already built**. **Do NOT rebuild them.** Verify each exists and works before writing anything new. The real problems are (1) a slow dev loop and (2) a few unpolished/uncomposed pieces — not missing infrastructure.

## PRIORITY 0 — Fix the dev loop before anything else  ✅ DONE

**Verified dev loop (WSL-friendly, browser HMR, no Electron):**

```bash
# Terminal 1 — API + data + SSE on :3456 (reads ~/.claude). Docker is simplest:
docker compose up -d          # (or: pnpm standalone:build && PORT=3456 CLAUDE_ROOT=~/.claude pnpm standalone:start)
# Terminal 2 — renderer with Vite HMR on :5174:
pnpm web
# Open in browser:
#   http://localhost:5174/?port=3456
```

Renderer edits hot-reload in <2s at :5174; the `?port=3456` points the renderer's
API client at the :3456 server (permissive CORS, verified). Only **renderer** edits
HMR — main-process/parser changes need the API server rebuilt/restarted.

Config: `vite.web.config.ts` + the `web` script in `package.json`.

**Gotcha:** `pnpm dev` launches an Electron window (needs WSLg; flaky on WSL).
`pnpm standalone` (raw tsx) currently **crashes** — `NotificationManager.ts` does a
top-level `import { Notification } from 'electron'`, which has no such export outside
Electron. Use the Docker container or `standalone:build && standalone:start` for the API.
Docker rebuilds (`update-devtools.sh` → `docker compose up -d --build`, multi-minute) are
now only needed for a packaged/stable build or main-process changes, not for UI iteration.

## Architecture map (so you don't re-explore)

**Data flow:** `~/.claude/projects/` → `ProjectScanner` → `src/main/utils/jsonl.ts` + `src/main/services/parsing/SessionParser.ts` → typed model → API layer (Electron IPC **or** Fastify HTTP+SSE, selected in `src/renderer/api/index.ts`) → renderer store `src/renderer/store/`.

**Types / model:**
- `src/main/types/jsonl.ts` — raw JSONL; `UsageMetadata` (input/output/cache tokens) ~line 80; assistant `usage` ~line 104.
- `src/main/types/messages.ts` — `ParsedMessage` (63), `ToolCall` (28), `ToolResult` (46).
- `src/main/types/domain.ts` — `Session` (81; has `hasSubagents`, `isOngoing`, `contextConsumption`), `SessionMetrics` (119).
- `src/renderer/types/groups.ts` — view model: `LinkedToolItem` (`callTokens` 163, `result.tokenCount` 170), `DisplayItem` union (subagent variant ~253), `AIChatGroup` (`processes: Process[]` 352, `isOngoing` 360).

**Per-tool rendering (the main extension point):**
- Dispatch: `src/renderer/components/chat/items/LinkedToolItem.tsx:136-189` (boolean `useXViewer` flags → matching component).
- Viewers: `src/renderer/components/chat/items/linkedTool/` (barrel `index.ts`): `ReadToolViewer`, `EditToolViewer`, `WriteToolViewer`, `SkillToolViewer`, `AskUserQuestionToolViewer`, `DefaultToolViewer`, `ToolErrorDisplay`.
- Input helpers / older if-chain: `renderHelpers.tsx:19-186`.
- Content guards: `src/renderer/utils/toolRendering/toolContentChecks.ts`.
- Per-tool one-line summaries (~25 tools): `src/renderer/utils/toolRendering/toolSummaryHelpers.ts`.
- **Template to copy for a new per-tool view:** the AskUserQuestion viewer (`AskUserQuestionToolViewer.tsx` + branch in `renderHelpers.tsx:99-171`). Pattern = add a `useXViewer` flag in `LinkedToolItem.tsx` + a component in `linkedTool/` + a `hasXContent` guard in `toolContentChecks.ts`.

**Live pipeline (already wired end-to-end):** `src/main/services/infrastructure/FileWatcher.ts` (`fs.watch(projectsPath,{recursive:true})` ~283, debounced, 30s catch-up, 3s SSH fallback) → emits `file-change` → Electron `src/main/index.ts:130` `webContents.send` / HTTP `HttpServer.ts:162` → SSE `src/main/http/events.ts:53` (`GET /api/events`) → renderer `src/renderer/api/httpClient.ts:69` `EventSource`, `onFileChange` (502) → store `src/renderer/store/index.ts:236-305` → `refreshSessionInPlace` (`sessionDetailSlice.ts:543`).

**Ongoing/thinking detection:** `checkMessagesOngoing` in `sessionStateDetection.ts:94` (true when thinking/tool_use/tool_result occurs after last text output). Surfaced by `OngoingIndicator.tsx` (green pulsing dot ~23; `OngoingBanner` spinner ~49) via `LastOutputDisplay.tsx:69`.

**Subagents:** parsed from `{sessionId}/subagents/agent-*.jsonl` by `SubagentResolver.ts` (metrics, timing, `isOngoing`, `isSidechain`, warmup/acompact filtering). Linked to parent `Task` calls via `linkToTaskCalls()` (matches `agentId` in tool_result, positional fallback) + `propagateTeamMetadata` (parentUuid chains) + `detectParallelExecution`. Routes: `src/main/http/subagents.ts`, `src/main/ipc/subagents.ts`. Rendered: `src/renderer/components/chat/items/SubagentItem.tsx` (~500-line dashboard) + `ExecutionTrace.tsx`.

**Tabs layout:** `TabBar.tsx`, `SortableTab.tsx`, `PaneContainer`/`PaneView`, `TabbedLayout.tsx`.

**Diff:** `src/renderer/components/chat/viewers/DiffViewer.tsx` (hand-rolled LCS, +/- stats, no external lib). Used by `EditToolViewer.tsx`.

## Original feature requests (all 10, verbatim → status)

These are the owner's exact asks. Status: ✅ already built · 🟡 partial/uncomposed · 🔴 net-new.

1. **A view for each tool.** — 🟡 Per-tool dispatch exists (`LinkedToolItem.tsx:136-189`); custom views today: Read, Edit, Write, Skill, AskUserQuestion. All other tools hit the raw `DefaultToolViewer`. Add more via the template.
2. **A UI for viewing what subagents are doing.** — ✅ `SubagentItem.tsx` dashboard + `SubagentResolver.ts` parsing of `subagents/agent-*.jsonl`.
3. **The main thread had clear info about each subagent.** — ✅ Parent `Task` ↔ subagent linkage via `SubagentResolver.linkToTaskCalls()`; `AIChatGroup.processes`. (A one-line summary badge on the parent row is the only possible polish — S.)
4. **Diff viewer.** — ✅ `DiffViewer.tsx` (LCS, +/- stats), used by `EditToolViewer.tsx`.
5. **Token counts for every tool call/message.** — ✅ Per-message (real `usage`) + per-tool (`getToolContextTokens`, `toolTokens.ts:15`). Caveat: tool-call tokens are **estimated**; label rather than "fix" (S).
6. **Tabs with status indicators like wezterm.** — 🟡 Tabs exist (`SortableTab.tsx`) but have **no status dot**; `OngoingIndicator` exists but isn't composed in. Wire it (S).
7. **Realtime updating.** — ✅ `FileWatcher` (`fs.watch`) → SSE/IPC → `refreshSessionInPlace`. Fully wired.
8. **Thinking indicator.** — ✅ `checkMessagesOngoing` → `OngoingBanner` spinner. Splitting "thinking" vs "running <tool>" is S (activity type already known).
9. **Status line type information.** — 🔴 No status-bar component exists. All data/selectors do (`ContextBadge`, `MetricsPill`, `contextTracker`). Compose into a persistent bar (M).
10. **Indicator of which sessions are live/open.** — ✅ Sidebar green pulsing dot (`SessionItem.tsx:267` → `OngoingIndicator`), activity-based, live-refreshed.

**Summary:** ✅ built = 2,3,4,5,7,8,10 · 🟡 partial = 1,6 · 🔴 net-new = 9. Verify the ✅ set works before building; do NOT rebuild it.

## Task list (do in this order)

Legend: ✅ verify-only · **S** <1hr · **M** ~half-day

**P0.** Fix dev loop (above). Blocks everything; do first.

**Verify these already work (✅ — do NOT rebuild; just confirm and note any bug):**
- Diff viewer (`DiffViewer.tsx`) renders Edit old/new with +/- stats.
- Realtime: edit a live session's `.jsonl`, confirm the UI updates without manual refresh.
- Sidebar live-session dot (`SessionItem.tsx:267` → `OngoingIndicator`).
- Subagent dashboard (`SubagentItem.tsx`) shows what a Task subagent did.
- Main-thread → subagent linkage (`SubagentResolver.linkToTaskCalls`).
- Per-message + per-tool token counts (`getToolContextTokens` in `toolTokens.ts:15`). NOTE: tool-*call* tokens are **estimated** (`estimateTokens` in `toolLinkingEngine.ts:84`), results carry real counts. If you touch this, label estimated vs. actual rather than "fixing" the number.

**Then build (small, strong existing hooks):**
- **[S] Tab status dots (#6):** drop the existing `OngoingIndicator` into `SortableTab.tsx` (data: `session.isOngoing` already available). Currently the tab has no status dot.
- **[S] Thinking-vs-tool indicator (#8):** `checkMessagesOngoing` already knows the last activity type — surface "Thinking…" vs "Running <tool>…" in `OngoingIndicator`/`OngoingBanner`.
- **[S] Token labeling (#5):** if desired, label call-tokens as estimated in the tool row.
- **[S each] More per-tool viewers (#1):** add custom views for high-value tools currently hitting `DefaultToolViewer` (Bash, Grep/Glob, Task, WebFetch/WebSearch, TodoWrite…). One component + flag + guard each, following the AskUserQuestion template.

**Then (only genuine net-new):**
- **[M] Status-line bar (#9):** no status-bar component exists. Compose existing selectors/data (`ContextBadge.tsx`, `MetricsPill.tsx`, `contextTracker.ts`/`contextAccumulator.ts`) into a persistent bottom bar (session id, model, context %, tokens, ongoing state). All data exists; the component doesn't.

## Constraints & conventions

- **No new heavy deps.** Diff is hand-rolled LCS; markdown/mermaid/syntax-highlight already present. Don't add a diff/token library.
- **Touch the renderer, not the backend,** unless a feature genuinely needs new data. Most of these are render-layer only (`src/renderer/components/chat/items/` and `linkedTool/`).
- Match existing component style; copy the AskUserQuestion viewer as the pattern for new tool views.
- `docker-compose.override.yml` mounts `~/.claude:ro` and hardens the container (read-only rootfs) — that's why hot-reload into the container isn't set up. Use `pnpm dev` instead of the container for iteration.
- The renderer never touches the filesystem directly — always via the API layer (IPC or HTTP). Don't add `fs` calls in the renderer.

## Acceptance criteria

- `pnpm dev` runs against real `~/.claude`; a source edit reflects in <2s (documented in this file).
- Each ✅ feature confirmed working (or a bug noted) — none rebuilt from scratch.
- Tab status dot visible on ongoing sessions; thinking-vs-tool text distinguishes the two states.
- Any new per-tool viewer replaces the raw-JSON fallback for that tool and degrades gracefully (falls back to `DefaultToolViewer` on unexpected shape).
- No new runtime dependencies added to `package.json` without calling it out.
