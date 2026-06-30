/**
 * Builds the shell command that resumes a Claude Code session.
 *
 * When the session's working directory is known, the command first `cd`s into
 * it so the resumed session starts in the right project. Without it, the user
 * has to find and change into the directory by hand before resuming — the pain
 * point this helper removes. The directory is double-quoted so paths with
 * spaces stay intact when pasted into a shell.
 */
export function buildResumeCommand(sessionId: string, cwd?: string): string {
  const resume = `claude --resume ${sessionId}`;
  if (!cwd) {
    return resume;
  }
  return `cd "${cwd}" && ${resume}`;
}
