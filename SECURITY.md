# Security & Privacy

## Network Activity

claude-devtools makes **zero** outbound network calls to third-party servers. There is no telemetry, analytics, tracking, or data exfiltration of any kind.

| Network activity | When | Mode | User-initiated |
|---|---|---|---|
| GitHub Releases API (auto-updater) | App launch | Electron only | No (automatic) |
| SSH connections | Settings > SSH | Electron only | Yes |
| HTTP server (`127.0.0.1` or `0.0.0.0`) | When enabled | Both | Yes |

### Standalone / Docker mode

In standalone mode (Docker or `node dist-standalone/index.cjs`), the auto-updater and SSH features are disabled entirely. The only network activity is the HTTP server listening for incoming connections on the configured port.

## Data Handling

- All session data is read **locally** from `~/.claude/` — it never leaves your machine.
- The app does not write to session files. Volume mounts in Docker use `:ro` (read-only) by default.
- Configuration is stored at `~/.claude/claude-devtools-config.json` on the local filesystem.
- No data is sent to Anthropic, GitHub (other than the auto-updater in Electron mode), or any other third party.

## Docker Network Isolation

For maximum trust, run the Docker container with `--network none`:

```bash
docker build -t claude-devtools .
docker run --network none -p 3456:3456 -v ~/.claude:/data/.claude:ro claude-devtools
```

Or with Docker Compose, uncomment `network_mode: "none"` in `docker-compose.yml`.

## IPC & Input Validation

- All IPC handlers validate inputs with strict path containment checks
- File reads are constrained to the project root and `~/.claude/`
- Path traversal attacks are blocked
- Sensitive credential paths are rejected

## Supported Versions

Only the latest release is supported with security fixes.

## Reporting a Vulnerability

Please report vulnerabilities privately and do not open public issues for undisclosed security problems.

Include:
- affected version/commit
- vulnerability description
- impact assessment
- reproduction steps or proof of concept

If you do not have a private contact path yet, open a minimal GitHub issue asking for a secure reporting channel without disclosing technical details.

## Disclosure Process

- We will acknowledge reports as quickly as possible.
- We will validate, triage severity, and prepare a fix.
- We will coordinate a release and publish advisories when appropriate.
