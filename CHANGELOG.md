# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

For the full list of merged PRs per release, see [GitHub Releases](https://github.com/matt1398/claude-devtools/releases).

## [Unreleased]

### Added
- Session scratchpad viewer: open a session's Claude Code scratchpad directory (`/tmp/claude-<uid>/<project>/<session-id>/scratchpad/`) in its own tab from the session context menu or the `⋯` menu, with a lazily-loaded file tree, text / Markdown / image preview, and live refresh.
- `general.autoExpandAIGroups` setting: automatically expands all AI response groups when opening a transcript or when new AI responses arrive in a live session. Defaults to off. Persists across restarts.
- Strict IPC input validation guards for project / session / subagent / search limits.
- `get-waterfall-data` IPC endpoint implementation.
- Cross-platform path normalization in renderer path resolvers.
- `onTodoChange` preload API event bridge.
- CI workflow for macOS / Windows (typecheck, lint, test, build).
- Release workflow for signed package builds.
- Open-source governance docs (`LICENSE`, `CONTRIBUTING`, `CODE_OF_CONDUCT`, `SECURITY`).

### Changed
- `readMentionedFile` preload API signature now requires `projectRoot`.
- Notification update event contract standardized to `{ total, unreadCount }`.
- Session pagination uses cached displayable-content detection for performance.
- File watcher error detection optimized for append-only updates.

### Fixed
- Lint violations in navigation and markdown / subagent UI components.
- Test mock drift causing runtime errors in test output.
- Multiple Windows path handling edge cases.

## [0.4.16] — 2026-05-06

### Added
- SSH connection is now robust and self-diagnosing — clearer error reporting when remote inspection fails (#192).

### Fixed
- Sessions from git worktrees now appear in project discovery (#191, thanks @Arshgill01 for first contribution).

## [0.4.15] — 2026-04-30

### Fixed
- Correct architecture routing for macOS `.dmg` downloads and in-app updates (#189).

## [0.4.13] — 2026-04-27

### Added
- Hover-to-copy button on the last-output Markdown viewer (#182).

### Fixed
- Eliminate ~60s lag and stale session detail when switching tabs (#183).
- MermaidViewer no longer leaves orphan error SVGs in `document.body` (#184, thanks @GoldenXPig for first contribution).

## [0.4.10] — 2026-04-05

### Added
- Render Mermaid code blocks as interactive diagrams (#128).
- Session-ID lookup in the Command Palette (Cmd+K) (#153, thanks @WesleyMFrederick).
- Tab rename and improved sidebar collapse layout (#133).

### Changed
- Featured in [Awesome Claude Code](https://github.com/hesreallyhim/awesome-claude-code) (#157).
- Open external links in the system browser instead of an Electron window (#143).
- Mermaid is now lazy-loaded to reduce main bundle size (#164).

### Fixed
- Sessions not loading on project navigation without a restart (#137, thanks @Psypeal).
- Settings not applied on startup (#161, thanks @nevdelap).
- Resolve SSH private-key paths correctly (#159, thanks @adriencaccia).
- Show copy button only on code blocks, not the entire text output (#145).
- Plain HTTP UUID creation (#135, thanks @RubbaBoy).
- Compute the real message count in the light metadata path (#134, thanks @romeromarcelo).

### Performance
- macOS UI responsiveness improvements (#163).
- Fix renderer heap exhaustion on long-running sessions (#120).

## [0.4.9] — 2026-03-23

### Added
- `CollapsibleOutputSection` and Markdown preview toggle (#112).
- Render task notifications as styled cards (#122).

### Fixed
- Normalize Windows drive-letter casing in `extractCwd` (#126).
- Translate WSL mount paths to Windows drive-letter paths (#127).

### Performance
- Replace 8 filter passes with single-pass message categorization (#108, thanks @MintCollector for first contribution).
- Cache compiled regexes in `TriggerMatcher` (#109).
- Convert synchronous file reads to async in the main process (#111).

## [0.4.8] — 2026-03-09

### Added
- Syntax highlighting for R, Ruby, PHP, and SQL (#76).
- Ctrl+R session refresh via IPC with scroll-to-bottom (#89).

### Fixed
- Deduplicate streaming JSONL entries to prevent ~2× cost overcounting (#77).
- Sidebar header repo / branch not syncing when switching tabs (#97, thanks @LeeJuOh).
- Mark stale ongoing sessions as dead after 5 min inactivity (#100).

### Performance
- Optimize search and reduce unnecessary re-renders (#99).

## [0.4.7] — 2026-02-26

### Changed
- Updated `CONTRIBUTING.md` with guidelines for PRs and AI-assisted contributions (#78).
- Reverted PRs #60, #65, #73 and clarified project scope (#87).

## [0.4.6] — 2026-02-24

### Added
- Cost-calculation metric (#65).
- Session analysis report with assessment badges (#60).
- `MoreMenu` component for toolbar actions (#71).
- Custom title bar on Linux with native toggle (#68).
- Auto-expand AI response groups setting (#59, thanks @proxikal).

### Changed
- Unified cost calculation with a shared pricing module (#73).
- Updated GitHub issue templates (#63).

### Fixed
- Auto-expand sidebar when a project is selected (#56).
- Performance regression in transcript loading and session search (#55).
- Wrap `HTTP_SERVER_GET_STATUS` response in `IpcResult` envelope (#57).
- Prevent Ctrl+R page reload and show platform-aware shortcuts (#66).
- Guard `Notification.isSupported` for standalone / Docker builds (#67).
- Reliable window drag region in the tab bar (#69).

## [0.4.5] — 2026-02-21

### Added
- Global session search across projects (#44, thanks @KaustubhPatange).
- Session export to Markdown, JSON, or plain text (#51, thanks @holstein13).
- `SearchTextCache` and `SearchTextExtractor` for efficient cross-session search (#53).
- Color badges for subagent types with `.claude/agents/` config support (#50).

### Changed
- Disabled default notification triggers in favor of explicit user opt-in (#43).

### Fixed
- Prevent false `cwd` split that hid all sessions in some projects (#40).
- Increase macOS traffic-light content gap for better title spacing (#48).
- Correct context badge count — sum actual items instead of injection objects (#45, thanks @Psypeal).

## [0.4.4] — 2026-02-20

### Added
- Improved MCP tool input/output rendering (#33).
- Scoped notification actions for finer-grained alerts (#36).
- Copy functionality on the session context menu (#37).
- New `FlatInjection` model — enhanced ContextBadge and SessionContextPanel (#38).

## [0.4.3] — 2026-02-19

### Fixed
- Linux sandbox permissions (#29).

## [0.4.2] — 2026-02-19

### Added
- Docker / standalone deployment support, session management improvements, context insights, and subagent display improvements (#15).
- Markdown preview toggle for Write tool output (#21, thanks @sanathks).

### Fixed
- Collect tool results from subagent messages with absent `isMeta` field (#23, thanks @cesarafonseca).

## [0.4.0] — 2026-02-14

### Added
- Intel macOS support.
- Linux support.
- WSL support for discovering Claude root path candidates.

## [0.3.0] — 2026-02-12

Initial public-facing development releases (`0.1.x` – `0.3.x`). Core functionality: read `~/.claude/` JSONL transcripts, render structured conversation views, inspect tool calls, view per-turn token usage. See the [GitHub Releases page](https://github.com/matt1398/claude-devtools/releases) for the full early-version history.
