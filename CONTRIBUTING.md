# Contributing

Thanks for contributing to claude-devtools.

## Prerequisites
- Node.js 20+
- pnpm 10+
- macOS or Windows

## Setup
```bash
pnpm install
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
