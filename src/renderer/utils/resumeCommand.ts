function quotePosixArgument(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export function buildResumeCommand(sessionId: string, cwd?: string): string {
  const resume = `claude --resume ${quotePosixArgument(sessionId)}`;
  if (!cwd) {
    return resume;
  }
  return `cd ${quotePosixArgument(cwd.replace(/\\/g, '/'))} && ${resume}`;
}
