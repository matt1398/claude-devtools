# claude-devtools

Electron app that visualizes Claude Code session execution

## Tech Stack
Electron 28.x, React 18.x, TypeScript 5.x, Tailwind CSS 3.x, Zustand 4.x

## Commands
Always use pnpm (not npm/yarn) for this project.

- `pnpm install` - Install dependencies
- `pnpm dev` - Dev server with hot reload
- `pnpm build` - Production build
- `pnpm typecheck` - Type checking
- `pnpm lint:fix` - Lint and auto-fix
- `pnpm format` - Format code
- `pnpm test` - Run all vitest tests
- `pnpm test:watch` - Watch mode
- `pnpm test:coverage` - Coverage report
- `pnpm test:coverage:critical` - Critical path coverage
- `pnpm test:chunks` - Chunk building tests
- `pnpm test:semantic` - Semantic step extraction tests
- `pnpm test:noise` - Noise filtering tests
- `pnpm test:task-filtering` - Task tool filtering tests

## Path Aliases
Use path aliases for imports:
- `@main/*` → `src/main/*`
- `@renderer/*` → `src/renderer/*`
- `@shared/*` → `src/shared/*`
- `@preload/*` → `src/preload/*`

## Data Sources
~/.claude/projects/{encoded-path}/*.jsonl - Session files
~/.claude/todos/{sessionId}.json - Todo data

Path encoding: `/Users/name/project` → `-Users-name-project`

## Critical Concepts

### isMeta Flag
- `isMeta: false` = Real user message (creates new chunks)
- `isMeta: true` = Internal message (tool results, system-generated)

### Chunk Structure
Independent chunk types for timeline visualization:
- **UserChunk**: Single user message with metrics
- **AIChunk**: All assistant responses with tool executions and spawned subagents
- **SystemChunk**: Command output/system messages
- **CompactChunk**: System metadata/structural messages

Each chunk has: timestamp, duration, metrics (tokens, cost, tools)

### Task/Subagent Filtering
Task tool_use blocks are filtered when subagent exists
Keep orphaned Task calls (no matching subagent) for visibility.

### Agent Teams
Claude Code's "Orchestrate Teams" feature: multiple sessions coordinate as a team.
- **Process.team?** `{ teamName, memberName, memberColor }` — enriched by SubagentResolver from Task call inputs and `teammate_spawned` tool results
- **Teammate messages** arrive as `<teammate-message teammate_id="..." color="..." summary="...">content</teammate-message>` in user messages (isMeta: false). Detected by `isParsedTeammateMessage()` — excluded from UserChunks, rendered as `TeammateMessageItem` cards
- **Session ongoing detection** treats `SendMessage` shutdown_response (approve: true) and its tool_result as ending events, not ongoing activity
- **Display summary** counts distinct teammates (by name) separately from regular subagents
- **Team tools**: TeamCreate, TaskCreate, TaskUpdate, TaskList, TaskGet, SendMessage, TeamDelete — have readable summaries in `toolSummaryHelpers.ts`

### Visible Context Tracking
Tracks what consumes tokens in Claude's context window across 6 categories (discriminated union on `category` field):

| Category | Type | Source |
|----------|------|--------|
| `claude-md` | `ClaudeMdContextInjection` | CLAUDE.md files (global, project, directory) |
| `mentioned-file` | `MentionedFileInjection` | User @-mentioned files |
| `tool-output` | `ToolOutputInjection` | Tool execution results (Read, Bash, etc.) |
| `thinking-text` | `ThinkingTextInjection` | Extended thinking + text output tokens |
| `team-coordination` | `TeamCoordinationInjection` | Team tools (SendMessage, TaskCreate, etc.) |
| `user-message` | `UserMessageInjection` | User prompt text per turn |

- **Types**: `src/renderer/types/contextInjection.ts` — `ContextInjection` union, `ContextStats`, `TokensByCategory`
- **Tracker**: `src/renderer/utils/contextTracker.ts` — `computeContextStats()`, `processSessionContextWithPhases()`
- **Context Phases**: Compaction events reset accumulated injections, tracked via `ContextPhaseInfo`
- **Display surfaces**: `ContextBadge` (per-turn popover), `TokenUsageDisplay` (hover breakdown), `SessionContextPanel` (full panel)

## Error Handling
- Main: try/catch, console.error, return safe defaults
- Renderer: error state in Zustand store
- IPC: parameter validation, graceful degradation

## Performance
- LRU Cache: Avoid re-parsing large JSONL files
- Streaming JSONL: Line-by-line processing
- Virtual Scrolling: For large session/message lists
- Debounced File Watching: 100ms debounce

## URL Scheme (Deep Links)
Registered protocol: `claude-devtools://`

| Route | Description |
|-------|-------------|
| `claude-devtools://projects` | Open projects list |
| `claude-devtools://projects?q={substring}` | Open projects list with search pre-filled |
| `claude-devtools://projects/{project_name}` | Open project by folder name |
| `claude-devtools://projects/{project_name}?q={substring}` | Open project, session search pre-filled |
| `claude-devtools://projects/{project_name}/sessions/{sessionId}` | Open session |
| `claude-devtools://projects/{project_name}/sessions/{sessionId}/subagents/{subagentId}` | Open subagent |
| `claude-devtools://notifications` | Open notifications |
| `claude-devtools://settings/{section}` | Open settings section (general/connection/workspace/notifications/advanced) |

- `{project_name}` = folder name as shown on the project card (e.g. `dotfiles`, not `-Users-steven-dotfiles`)
- Parser: `src/shared/utils/deepLinkParser.ts`
- Main process handler: `src/main/index.ts` (`handleDeepLinkUrl`, `open-url`, `second-instance`)
- IPC channel: `deeplink:navigate` (main → renderer push)
- Renderer listener: `src/renderer/store/index.ts` (in `initializeNotificationListeners`)
- Deferred name resolution: `repositorySlice.selectRepositoryByName` / `navigateToSessionByProjectName`

## Troubleshooting

### Build Issues
```bash
rm -rf dist dist-electron node_modules
pnpm install
pnpm build
```

### Type Errors
```bash
pnpm typecheck
```

### Test Failures
Check for changes in message parsing or chunk building logic.

## TypeScript Conventions

### Naming
| Category | Convention | Example |
|----------|------------|---------|
| Services/Components | PascalCase | `ProjectScanner.ts` |
| Utilities | camelCase | `pathDecoder.ts` |
| Constants | UPPER_SNAKE_CASE | `PARALLEL_WINDOW_MS` |
| Type Guards | isXxx | `isRealUserMessage()` |
| Builders | buildXxx | `buildChunks()` |
| Getters | getXxx | `getResponses()` |

### Type Guards
```typescript
// Message type guards (src/main/types/messages.ts)
isParsedRealUserMessage(msg)      // isMeta: false, string content
isParsedInternalUserMessage(msg)  // isMeta: true, array content
isAssistantMessage(msg)           // type: "assistant"

// Chunk type guards
isUserChunk(chunk)          // type: "user"
isAIChunk(chunk)            // type: "ai"
isSystemChunk(chunk)        // type: "system"
isCompactChunk(chunk)       // type: "compact"

// Context injection type guards (component-scoped in ContextBadge.tsx, not exported)
isClaudeMdInjection(inj)          // category: "claude-md"
isMentionedFileInjection(inj)     // category: "mentioned-file"
isToolOutputInjection(inj)        // category: "tool-output"
isThinkingTextInjection(inj)      // category: "thinking-text"
isTeamCoordinationInjection(inj)  // category: "team-coordination"
isUserMessageInjection(inj)       // category: "user-message"
```

### Barrel Exports
`src/main/services/` and its domain subdirectories have barrel exports via index.ts:
```typescript
// Preferred
import { ChunkBuilder, ProjectScanner } from './services';
// Also valid
import { ChunkBuilder } from './services/analysis';
```
Note: renderer utils/hooks/types do NOT have barrel exports — import directly from files.

### Import Order
1. External packages
2. Path aliases (@main, @renderer, @shared)
3. Relative imports
