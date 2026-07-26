# Contributing

Thanks for contributing to claude-devtools.

## Project Philosophy & Scope

claude-devtools exists to make the invisible parts of Claude Code visible — the token flows, context injections, tool executions, and session dynamics that are otherwise hidden behind the CLI. It is not a general-purpose dashboard or an IDE.

Our priorities:

1. **Parity with Claude Code** — When Claude Code ships new capabilities (agent teams, context tracking, new tool types), we adopt them quickly so users always have full visibility.
2. **Context engineering insight** — Features that help users understand *what* is consuming their context window, *how* tokens flow through a session, and *where* to optimize. If it doesn't help someone make better decisions about their Claude Code usage, it probably doesn't belong here.
3. **Stability over novelty** — A reliable, fast tool for professional workflows. We'd rather do fewer things well than many things poorly.

**What we generally do not accept:**
- Large custom features that don't directly serve context visibility or Claude Code parity.
- Speculative features that add maintenance burden without solving a concrete problem users face today.
- PRs that significantly expand scope without prior discussion in an Issue.

If you're considering a non-trivial contribution, **open an Issue first** to check alignment with the current roadmap. This saves everyone time and keeps the project focused.

## Prerequisites
- Node.js 20+
- pnpm 10+
- macOS or Windows

## Setup
```bash
pnpm install
pnpm hooks:install   # installs the pre-commit leak check (see below)
pnpm dev
```

## Quality Gates
Before opening a PR, run:
```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

## Pull Request Guidelines
- Keep changes focused and small — one purpose per PR.
- Add/adjust tests for behavior changes.
- Update docs when changing public behavior or setup.
- Use clear PR titles and include a short validation checklist.
- **Large changes (new features, new dependencies, large data additions) must have a discussion in an Issue first.** Do not open a large PR without prior agreement on the approach.
- Avoid committing large hardcoded data blobs. If data can be fetched at runtime or generated at build time, prefer that approach.

## AI-Assisted Contributions

AI coding tools are welcome, but **you are responsible for what you submit**:

- **Review before submitting.** Read every line of AI-generated code and understand what it does. Do not submit raw, unreviewed AI output.
- **Do not commit AI workflow artifacts.** Planning documents, session logs, step-by-step plans, or other outputs from AI tools (e.g. `docs/plans/`, `.speckit/`, etc.) do not belong in the repository.
- **Test it yourself.** AI-generated code must be manually verified — run the app, confirm the feature works, check edge cases.
- **Keep it intentional.** Every line in your PR should exist for a reason you can explain. If you can't explain why a piece of code is there, remove it.

## What Does NOT Belong in the Repo
- Personal planning/workflow artifacts (AI session plans, task lists, etc.)
- Large static data that could be fetched at runtime
- Generated files that aren't part of the build output
- Experimental features without prior discussion
- **Anything specific to your machine or your other projects** — see below

## Keeping Your Environment Out of the History

This is a viewer for Claude Code sessions, so working copies sit next to real
transcripts, real ticket IDs and real credentials. It is easy to paste one into
a test fixture by accident, and the history is public.

`scripts/leak-check.mjs` guards against that. It is fully generic — no
usernames, hostnames or project names are hardcoded — so it behaves the same for
every contributor. It flags:

- credentials (Anthropic/OpenAI/Stripe/AWS/GitHub/Google/Slack/npm tokens,
  private keys, connection strings with inline passwords, hardcoded
  `apiKey`/`password`/`secret` assignments)
- absolute paths containing a real account name (`/home/…`, `/Users/…`,
  `C:\Users\…`) — placeholders like `/home/user` are fine
- issue-tracker keys such as `ACME-123`, which name projects that may be private
- files that should never be committed: `*.jsonl` transcripts, `.env`, SSH keys,
  certificates, `docker-compose.override.yml`

Run it manually any time:
```bash
pnpm leakcheck            # staged changes (what the hook runs)
pnpm leakcheck:all        # every tracked file
node scripts/leak-check.mjs --range main..HEAD
```
`pnpm quality` runs the full-tree scan too.

Install the hook once per clone with `pnpm hooks:install` (it points
`core.hooksPath` at `.githooks/`). Only staged **added** lines are scanned, so
pre-existing content never blocks an unrelated commit.

**False positives:** append `leak-check-ignore` to the line, or add an
`allow <text>` / `path <glob>` entry to `.leakcheckignore`. Keep those entries
narrow and explain them — anything allowlisted will be published.

**Local-only files:** keep host-specific setup in `docker-compose.override.yml`,
`update-devtools.sh` or `*.local.sh`. All three are gitignored, so your hardening
and paths stay on your machine and `git pull` stays conflict-free.

## Commit Style
- Prefer conventional commits (`feat:`, `fix:`, `chore:`, `docs:`).
- Include rationale in commit body for non-trivial changes.

## Reporting Bugs
Please include:
- OS version
- app version / commit hash
- repro steps
- expected vs actual behavior
- logs/screenshots when possible
