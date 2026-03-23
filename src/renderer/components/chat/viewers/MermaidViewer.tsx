import React, { useEffect, useId, useState } from 'react';

import { CopyButton } from '@renderer/components/common/CopyButton';
import {
  CODE_BG,
  CODE_BORDER,
  COLOR_TEXT,
  COLOR_TEXT_MUTED,
  PROSE_PRE_BG,
  PROSE_PRE_BORDER,
} from '@renderer/constants/cssVariables';
import { useTheme } from '@renderer/hooks/useTheme';
import { Code, GitBranch } from 'lucide-react';
import mermaid from 'mermaid';

// =============================================================================
// Mermaid initialization
// =============================================================================

let lastMermaidTheme: 'dark' | 'default' | null = null;

function ensureMermaidInit(isDark: boolean): void {
  const theme: 'dark' | 'default' = isDark ? 'dark' : 'default';
  if (lastMermaidTheme === theme) {
    return;
  }
  mermaid.initialize({
    startOnLoad: false,
    theme,
    securityLevel: 'strict',
    fontFamily: 'ui-sans-serif, system-ui, sans-serif',
  });
  lastMermaidTheme = theme;
}

// =============================================================================
// Component
// =============================================================================

interface MermaidViewerProps {
  code: string;
}

export const MermaidViewer: React.FC<MermaidViewerProps> = ({ code }) => {
  const uniqueId = useId().replace(/:/g, '-');
  const [showCode, setShowCode] = useState(false);
  const [svg, setSvg] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const { isDark } = useTheme();

  // Render mermaid diagram
  useEffect(() => {
    let cancelled = false;
    const render = async (): Promise<void> => {
      try {
        ensureMermaidInit(isDark);
        const id = `mermaid-${uniqueId}`;
        const { svg: rendered } = await mermaid.render(id, code);
        if (!cancelled) {
          setSvg(rendered);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          console.error('Failed to render mermaid diagram:', err);
          setError(err instanceof Error ? err.message : 'Failed to render mermaid diagram');
          setSvg('');
        }
      }
    };
    void render();
    return () => {
      cancelled = true;
    };
  }, [code, isDark, uniqueId]);

  return (
    <div
      className="group relative overflow-hidden rounded-lg shadow-sm"
      style={{
        backgroundColor: CODE_BG,
        border: `1px solid ${CODE_BORDER}`,
      }}
    >
      {/* Header */}
      <div
        className="flex items-center gap-2 px-3 py-1.5"
        style={{ borderBottom: `1px solid ${CODE_BORDER}` }}
      >
        <GitBranch className="size-3.5 shrink-0" style={{ color: COLOR_TEXT_MUTED }} />
        <span className="text-xs font-medium" style={{ color: COLOR_TEXT_MUTED }}>
          Mermaid Diagram
        </span>
        <span className="flex-1" />
        <button
          onClick={() => setShowCode(!showCode)}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs transition-colors hover:bg-white/10"
          style={{ color: COLOR_TEXT_MUTED }}
          title={showCode ? 'Show diagram' : 'Show code'}
        >
          <Code className="size-3" />
          {showCode ? 'Diagram' : 'Code'}
        </button>
        <CopyButton text={code} inline />
      </div>

      {/* Content */}
      {showCode ? (
        <pre
          className="overflow-x-auto p-3 text-xs leading-relaxed"
          style={{
            backgroundColor: PROSE_PRE_BG,
            color: COLOR_TEXT,
          }}
        >
          <code className="font-mono">{code}</code>
        </pre>
      ) : error ? (
        <div className="p-3">
          <div
            className="mb-2 rounded px-2 py-1 text-xs"
            style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', color: '#ef4444' }}
          >
            {error}
          </div>
          <pre
            className="overflow-x-auto rounded p-2 text-xs leading-relaxed"
            style={{
              backgroundColor: PROSE_PRE_BG,
              border: `1px solid ${PROSE_PRE_BORDER}`,
              color: COLOR_TEXT,
            }}
          >
            <code className="font-mono">{code}</code>
          </pre>
        </div>
      ) : svg ? (
        <div
          className="flex justify-center overflow-auto p-4"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : (
        <div className="flex items-center justify-center p-4">
          <span className="text-xs" style={{ color: COLOR_TEXT_MUTED }}>
            Rendering...
          </span>
        </div>
      )}
    </div>
  );
};
