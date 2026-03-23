import React from 'react';

import { CopyButton } from '@renderer/components/common/CopyButton';
import { useStore } from '@renderer/store';
import { Hash, Terminal } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';

interface SessionInfoBarProps {
  readonly tabId?: string;
}

/**
 * Compact info strip showing the current session UUID with copy actions.
 * Sits between SearchBar and ChatHistory in MiddlePanel so users can
 * quickly grab the session ID or `claude --resume <id>` command.
 */
export const SessionInfoBar: React.FC<SessionInfoBarProps> = ({ tabId }) => {
  const { sessionDetail } = useStore(
    useShallow((s) => {
      const td = tabId ? s.tabSessionData[tabId] : null;
      return { sessionDetail: td?.sessionDetail ?? s.sessionDetail };
    }),
  );

  if (!sessionDetail) return null;

  const sessionId = sessionDetail.session.id;
  const resumeCommand = `claude --resume ${sessionId}`;
  const shortId = sessionId.slice(0, 8);

  return (
    <div
      className="flex shrink-0 items-center gap-2 border-b px-3"
      style={{
        height: '28px',
        borderColor: 'var(--color-border)',
        backgroundColor: 'var(--color-surface-raised)',
      }}
    >
      <Hash
        className="size-3 shrink-0"
        style={{ color: 'var(--color-text-muted)', opacity: 0.7 }}
      />
      <span
        className="select-all font-mono"
        title={sessionId}
        style={{
          fontSize: '10px',
          color: 'var(--color-text-muted)',
          opacity: 0.8,
        }}
      >
        {shortId}
      </span>
      <CopyButton text={sessionId} inline />
      <div
        className="mx-1 h-3 border-l"
        style={{ borderColor: 'var(--color-border)' }}
      />
      <button
        onClick={() => navigator.clipboard.writeText(resumeCommand)}
        className="flex items-center gap-1 rounded px-1 py-0.5 transition-colors hover:opacity-80"
        title={resumeCommand}
        style={{ color: 'var(--color-text-muted)' }}
      >
        <Terminal className="size-3" />
        <span style={{ fontSize: '10px' }}>Resume</span>
      </button>
    </div>
  );
};
