## Summary

Adds **Logical Projects** — a user-curated grouping layer on top of cwd-derived projects — plus two sidebar UX refinements: an active-only filter and an active/inactive split within each group.

Opt-in via a sidebar toggle; defaults unchanged.

## What's in it

- **Logical Projects**: named, coloured groups. Assignment is two-tiered — session-level override wins over cwd-level default. Persisted in `AppConfig.sessions`.
- **Manager modal**: create, rename, recolour, delete, reorder (up/down), and map the current cwd folder.
- **Drag-and-drop**: drop a session onto any logical-project header to assign; drop on *Ungrouped* to clear.
- **Active-only filter**: hide finished sessions via the Activity icon in the sidebar header.
- **Active/inactive split**: inside every group, ongoing sessions render first, then a subtle `Inactive` divider, then finished ones. Single-state groups render unchanged.

## Why two maps (session + cwd)?

Common case: a whole folder belongs to Feature X (set at cwd level once, every session inherits). Occasional case: one stray session belongs elsewhere (per-session override). A single map would force per-session tagging for folder-wide assignment.

## Backward compatibility

All new fields sit under `AppConfig.sessions` and are filled in by the existing `mergeWithDefaults` shallow-spread — old configs load without errors. `sidebarGroupBy` defaults to `'date'`, so users who don't opt in see no change.

## Tests

- New `logicalProjectSlice.test.ts` (20 tests): CRUD, cascade cleanup, target validation, resolution precedence, orphan-ref handling, rollback on persistence failure.
- Full suite: **704/704 passing**. Typecheck and lint: clean.

## Test plan

- [ ] Create a project, drag a session onto its header, reload — assignment persists
- [ ] Drop onto *Ungrouped* — clears the override
- [ ] Delete a project — assigned sessions fall back to Ungrouped
- [ ] Toggle active-only filter — only ongoing sessions remain
- [ ] With filter off, verify active sessions appear above the `Inactive` divider
- [ ] Reorder via up/down arrows in the manager modal
- [ ] Load a pre-PR config file — app starts in date grouping, no errors
