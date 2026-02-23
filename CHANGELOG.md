# Changelog

All notable changes to this project are documented in this file.

The format is based on Keep a Changelog and this project follows Semantic Versioning.

## [Unreleased]

### Added
- `general.autoExpandAIGroups` setting: automatically expands all AI response groups when opening a transcript or when new AI responses arrive in a live session. Defaults to off. Stored in the on-disk config so it persists across restarts.


- Strict IPC input validation guards for project/session/subagent/search limits.
- `get-waterfall-data` IPC endpoint implementation.
- Cross-platform path normalization in renderer path resolvers.
- `onTodoChange` preload API event bridge.
- CI workflow for macOS/Windows (typecheck, lint, test, build).
- Release workflow for signed package builds.
- Open-source governance docs (`LICENSE`, `CONTRIBUTING`, `CODE_OF_CONDUCT`, `SECURITY`).

### Changed
- `readMentionedFile` preload API signature now requires `projectRoot`.
- Notification update event contract standardized to `{ total, unreadCount }`.
- Session pagination uses cached displayable-content detection for performance.
- File watcher error detection optimized for append-only updates.

### Fixed
- Lint violations in navigation and markdown/subagent UI components.
- Test mock drift causing runtime errors in test output.
- Multiple Windows path handling edge cases.
