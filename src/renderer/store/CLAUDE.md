# Store (Zustand)

State management with slices pattern for domain organization.

## Structure
- `index.ts` - Store creation, combines all slices
- `types.ts` - AppState type definition
- `slices/` - Individual domain slices
- `utils/` - Store utilities (`paneHelpers.ts`, `pathResolution.ts`)

## Slices (12 total)
| Slice | Purpose |
|-------|---------|
| `projectSlice` | Projects list, selectedProjectId |
| `repositorySlice` | Repository grouping, worktrees |
| `sessionSlice` | Sessions list, pagination, selectedSessionId |
| `sessionDetailSlice` | Session detail, chunks, metrics |
| `subagentSlice` | Subagent data, selectedSubagentId |
| `conversationSlice` | Messages, conversation metadata |
| `tabSlice` | Tabs list, activeTabId, tab ordering |
| `tabUISlice` | Per-tab UI state (expansions, scroll) |
| `paneSlice` | Pane layout, split views |
| `uiSlice` | UI flags (sidebar visible, etc.) |
| `notificationSlice` | Notifications, unreadCount |
| `configSlice` | App config, triggers |

## Slice Pattern
Each slice follows:
```typescript
data: T[]
selectedId: string | null
loading: boolean
error: string | null
```

## Key Pattern: Per-Tab UI Isolation
`tabUISlice` maintains independent UI state per tab using tabId:
- `collapsedAIGroupIds`, `collapsedDisplayItemIds` (default presentation is EXPANDED; these
  track the exceptions the user manually collapsed), `expandedSubagentTraceIds`
- Ensures collapsing a group in tab A doesn't affect tab B

## Global Filter Selection
The per-type chip filter is NOT per-tab. `filterSlice` holds a single global
`globalHiddenFilterTypes: Set<string>` (empty = all shown) shared across every session/tab
and persisted to `localStorage['devtools.hiddenFilterTypes']` (serialized as a `string[]`),
so a chip toggle applies everywhere and survives restarts. Actions:
`toggleGlobalFilterType`, `setGlobalHiddenFilterTypes`.

## Store Initialization
Call `initializeNotificationListeners()` once in App.tsx useEffect:
- Subscribes to file change events
- Auto-refreshes sessions on new files
- Updates session detail on content change
- Uses `refreshSessionInPlace` to prevent flickering

## Adding a Slice
1. Create `slices/{domain}Slice.ts`
2. Export `create{Domain}Slice` function
3. Add to store composition in `index.ts`
4. Update `AppState` type in `types.ts`
