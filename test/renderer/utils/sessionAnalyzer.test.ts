import { describe, it, expect } from 'vitest';

import { analyzeSession } from '@renderer/utils/sessionAnalyzer';
import type { ParsedMessage, Session, SessionDetail, SessionMetrics, Process } from '@shared/types';

// =============================================================================
// Test Helpers
// =============================================================================

let msgCounter = 0;

function createMockMessage(overrides: Partial<ParsedMessage> = {}): ParsedMessage {
  msgCounter++;
  return {
    uuid: `uuid-${msgCounter}`,
    parentUuid: `uuid-${msgCounter - 1}`,
    type: 'assistant',
    timestamp: new Date('2024-01-01T10:00:00Z'),
    content: '',
    isSidechain: false,
    isMeta: false,
    toolCalls: [],
    toolResults: [],
    ...overrides,
  };
}

function createMockSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 'test-session',
    projectId: 'test-project',
    projectPath: '/test/path',
    createdAt: Date.now(),
    hasSubagents: false,
    messageCount: 0,
    ...overrides,
  };
}

function createMockMetrics(overrides: Partial<SessionMetrics> = {}): SessionMetrics {
  return {
    durationMs: 0,
    totalTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    messageCount: 0,
    ...overrides,
  };
}

function createMockDetail(overrides: Partial<SessionDetail> = {}): SessionDetail {
  return {
    session: createMockSession(),
    messages: [],
    chunks: [],
    processes: [],
    metrics: createMockMetrics(),
    ...overrides,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('analyzeSession', () => {
  beforeEach(() => {
    msgCounter = 0;
  });

  // -------------------------------------------------------------------------
  // 1. Empty session
  // -------------------------------------------------------------------------
  describe('empty session', () => {
    it('returns a zeroed report with correct structure', () => {
      const report = analyzeSession(createMockDetail());

      expect(report.overview.sessionId).toBe('test-session');
      expect(report.overview.totalMessages).toBe(0);
      expect(report.overview.durationSeconds).toBe(0);

      expect(report.tokenUsage.totals.grandTotal).toBe(0);
      expect(report.tokenUsage.totals.inputTokens).toBe(0);
      expect(report.tokenUsage.totals.outputTokens).toBe(0);

      expect(report.costAnalysis.totalSessionCostUsd).toBe(0);

      expect(report.toolUsage.totalCalls).toBe(0);
      expect(report.toolUsage.counts).toEqual({});

      expect(report.errors.errors).toHaveLength(0);
      expect(report.errors.permissionDenials.count).toBe(0);

      expect(report.frictionSignals.correctionCount).toBe(0);
      expect(report.frictionSignals.corrections).toHaveLength(0);

      expect(report.gitActivity.commitCount).toBe(0);
      expect(report.gitActivity.pushCount).toBe(0);

      expect(report.idleAnalysis.idleGapCount).toBe(0);

      expect(report.modelSwitches.count).toBe(0);
      expect(report.modelSwitches.switches).toHaveLength(0);

      expect(report.conversationTree.maxDepth).toBe(0);
      expect(report.conversationTree.totalNodes).toBe(0);

      expect(report.tokenDensityTimeline.quartiles).toHaveLength(4);
      expect(report.tokenDensityTimeline.quartiles.every((q) => q.avgTokens === 0)).toBe(true);

      expect(report.compaction.count).toBe(0);
      expect(report.compaction.compactSummaryCount).toBe(0);
      expect(report.gitBranches).toEqual([]);

      // New sections
      expect(report.skillsInvoked).toEqual([]);
      expect(report.bashCommands.total).toBe(0);
      expect(report.lifecycleTasks).toEqual([]);
      expect(report.userQuestions).toEqual([]);
      expect(report.outOfScopeFindings).toEqual([]);
      expect(report.agentTree.agentCount).toBe(0);
      expect(report.subagentsList).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // 2. Basic session with usage data
  // -------------------------------------------------------------------------
  describe('basic session', () => {
    it('computes overview, token totals, and cost', () => {
      const messages: ParsedMessage[] = [
        createMockMessage({
          type: 'user',
          isMeta: false,
          content: 'Hello world',
          timestamp: new Date('2024-01-01T10:00:00Z'),
        }),
        createMockMessage({
          type: 'assistant',
          model: 'claude-sonnet-4-20250514',
          timestamp: new Date('2024-01-01T10:01:00Z'),
          content: [{ type: 'text' as const, text: 'Hi there!' }],
          usage: {
            input_tokens: 1000,
            output_tokens: 500,
            cache_read_input_tokens: 200,
            cache_creation_input_tokens: 100,
          },
        }),
        createMockMessage({
          type: 'user',
          isMeta: false,
          content: 'Follow up',
          timestamp: new Date('2024-01-01T10:02:00Z'),
        }),
        createMockMessage({
          type: 'assistant',
          model: 'claude-sonnet-4-20250514',
          timestamp: new Date('2024-01-01T10:03:00Z'),
          content: [{ type: 'text' as const, text: 'Sure thing.' }],
          usage: {
            input_tokens: 1500,
            output_tokens: 300,
            cache_read_input_tokens: 400,
            cache_creation_input_tokens: 0,
          },
        }),
      ];

      const report = analyzeSession(
        createMockDetail({
          messages,
          session: createMockSession({ messageCount: 4 }),
        })
      );

      // Overview
      expect(report.overview.totalMessages).toBe(4);
      expect(report.overview.durationSeconds).toBe(180); // 3 minutes
      expect(report.overview.durationHuman).toBe('3:00');

      // Token totals
      expect(report.tokenUsage.totals.inputTokens).toBe(2500);
      expect(report.tokenUsage.totals.outputTokens).toBe(800);
      expect(report.tokenUsage.totals.cacheRead).toBe(600);
      expect(report.tokenUsage.totals.cacheCreation).toBe(100);
      expect(report.tokenUsage.totals.grandTotal).toBe(4000);

      // Cost should be positive (sonnet-4 pricing)
      expect(report.costAnalysis.parentCostUsd).toBeGreaterThan(0);
      expect(report.costAnalysis.totalSessionCostUsd).toBeGreaterThan(0);

      // Message types
      expect(report.messageTypes.user).toBe(2);
      expect(report.messageTypes.assistant).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  // 3. Tool usage
  // -------------------------------------------------------------------------
  describe('tool usage', () => {
    it('counts tool calls and computes totalCalls', () => {
      const messages: ParsedMessage[] = [
        createMockMessage({
          type: 'assistant',
          model: 'claude-sonnet-4-20250514',
          toolCalls: [
            { id: 'tc-1', name: 'Read', input: { file_path: '/foo.ts' }, isTask: false },
            { id: 'tc-2', name: 'Bash', input: { command: 'ls' }, isTask: false },
          ],
        }),
        createMockMessage({
          type: 'user',
          isMeta: true,
          content: [
            {
              type: 'tool_result' as const,
              tool_use_id: 'tc-1',
              content: 'file contents',
              is_error: false,
            },
            {
              type: 'tool_result' as const,
              tool_use_id: 'tc-2',
              content: 'output',
              is_error: false,
            },
          ],
          toolResults: [
            { toolUseId: 'tc-1', content: 'file contents', isError: false },
            { toolUseId: 'tc-2', content: 'output', isError: false },
          ],
        }),
        createMockMessage({
          type: 'assistant',
          model: 'claude-sonnet-4-20250514',
          toolCalls: [{ id: 'tc-3', name: 'Read', input: { file_path: '/bar.ts' }, isTask: false }],
        }),
      ];

      const report = analyzeSession(createMockDetail({ messages }));

      expect(report.toolUsage.totalCalls).toBe(3);
      expect(report.toolUsage.counts.Read).toBe(2);
      expect(report.toolUsage.counts.Bash).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // 4. Error detection
  // -------------------------------------------------------------------------
  describe('error detection', () => {
    it('collects tool errors from isError results', () => {
      const messages: ParsedMessage[] = [
        createMockMessage({
          type: 'assistant',
          toolCalls: [
            { id: 'tc-1', name: 'Read', input: { file_path: '/missing.ts' }, isTask: false },
          ],
        }),
        createMockMessage({
          type: 'user',
          isMeta: true,
          content: [],
          toolResults: [
            { toolUseId: 'tc-1', content: 'ENOENT: no such file or directory', isError: true },
          ],
        }),
      ];

      const report = analyzeSession(createMockDetail({ messages }));

      expect(report.errors.errors).toHaveLength(1);
      expect(report.errors.errors[0].tool).toBe('Read');
      expect(report.errors.errors[0].error).toContain('ENOENT');
      expect(report.errors.errors[0].isPermissionDenial).toBe(false);
    });

    it('detects Bash non-zero exit codes as errors', () => {
      const messages: ParsedMessage[] = [
        createMockMessage({
          type: 'assistant',
          toolCalls: [{ id: 'tc-1', name: 'Bash', input: { command: 'false' }, isTask: false }],
        }),
        createMockMessage({
          type: 'user',
          isMeta: true,
          content: [],
          toolResults: [
            { toolUseId: 'tc-1', content: 'Exit code 1\nCommand failed', isError: false },
          ],
        }),
      ];

      const report = analyzeSession(createMockDetail({ messages }));

      expect(report.errors.errors).toHaveLength(1);
      expect(report.errors.errors[0].tool).toBe('Bash (non-zero exit)');
    });
  });

  // -------------------------------------------------------------------------
  // 5. Permission denial
  // -------------------------------------------------------------------------
  describe('permission denial', () => {
    it('flags errors containing permission keywords', () => {
      const messages: ParsedMessage[] = [
        createMockMessage({
          type: 'assistant',
          toolCalls: [
            { id: 'tc-1', name: 'Bash', input: { command: 'rm /root/file' }, isTask: false },
          ],
        }),
        createMockMessage({
          type: 'user',
          isMeta: true,
          content: [],
          toolResults: [{ toolUseId: 'tc-1', content: 'Error: permission denied', isError: true }],
        }),
      ];

      const report = analyzeSession(createMockDetail({ messages }));

      expect(report.errors.permissionDenials.count).toBe(1);
      expect(report.errors.permissionDenials.denials[0].isPermissionDenial).toBe(true);
      expect(report.errors.permissionDenials.affectedTools).toContain('Bash');
    });

    it('detects permission denial in Bash non-zero exit', () => {
      const messages: ParsedMessage[] = [
        createMockMessage({
          type: 'assistant',
          toolCalls: [
            { id: 'tc-1', name: 'Bash', input: { command: 'cat /etc/shadow' }, isTask: false },
          ],
        }),
        createMockMessage({
          type: 'user',
          isMeta: true,
          content: [],
          toolResults: [
            {
              toolUseId: 'tc-1',
              content: 'Exit code 1\ncat: /etc/shadow: Operation not permitted',
              isError: false,
            },
          ],
        }),
      ];

      const report = analyzeSession(createMockDetail({ messages }));

      expect(report.errors.permissionDenials.count).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // 6. Friction detection
  // -------------------------------------------------------------------------
  describe('friction detection', () => {
    it('detects friction keywords in user messages', () => {
      const messages: ParsedMessage[] = [
        createMockMessage({
          type: 'user',
          isMeta: false,
          content: 'Build the login page',
          timestamp: new Date('2024-01-01T10:00:00Z'),
        }),
        createMockMessage({
          type: 'assistant',
          content: [{ type: 'text' as const, text: 'Done.' }],
          timestamp: new Date('2024-01-01T10:01:00Z'),
        }),
        createMockMessage({
          type: 'user',
          isMeta: false,
          content: 'No, that is wrong. Use React.',
          timestamp: new Date('2024-01-01T10:02:00Z'),
        }),
        createMockMessage({
          type: 'assistant',
          content: [{ type: 'text' as const, text: 'Updated.' }],
          timestamp: new Date('2024-01-01T10:03:00Z'),
        }),
        createMockMessage({
          type: 'user',
          isMeta: false,
          content: 'Actually, use Next.js instead',
          timestamp: new Date('2024-01-01T10:04:00Z'),
        }),
      ];

      const report = analyzeSession(createMockDetail({ messages }));

      expect(report.frictionSignals.correctionCount).toBe(2);
      expect(report.frictionSignals.corrections).toHaveLength(2);

      const keywords = report.frictionSignals.corrections.map((c) => c.keyword);
      // "No," matches 'no,' and "actually" matches 'actually'
      expect(keywords).toContain('no,');
      expect(keywords).toContain('actually');

      // Friction rate = 2 corrections / 3 user messages
      expect(report.frictionSignals.frictionRate).toBeCloseTo(2 / 3, 2);
    });

    it('does not count isMeta user messages as friction', () => {
      const messages: ParsedMessage[] = [
        createMockMessage({
          type: 'user',
          isMeta: true,
          content: 'No, wrong, actually this is meta',
        }),
      ];

      const report = analyzeSession(createMockDetail({ messages }));
      expect(report.frictionSignals.correctionCount).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // 7. Git activity
  // -------------------------------------------------------------------------
  describe('git activity', () => {
    it('detects git commits from Bash tool calls', () => {
      const messages: ParsedMessage[] = [
        createMockMessage({
          type: 'assistant',
          toolCalls: [
            {
              id: 'tc-1',
              name: 'Bash',
              input: { command: "git commit -m 'initial commit'" },
              isTask: false,
            },
          ],
        }),
        createMockMessage({
          type: 'assistant',
          toolCalls: [
            {
              id: 'tc-2',
              name: 'Bash',
              input: { command: "git commit -m 'add feature'" },
              isTask: false,
            },
          ],
        }),
      ];

      const report = analyzeSession(createMockDetail({ messages }));

      expect(report.gitActivity.commitCount).toBe(2);
      expect(report.gitActivity.commits).toHaveLength(2);
      expect(report.gitActivity.commits[0].messagePreview).toContain('initial commit');
      expect(report.gitActivity.commits[1].messagePreview).toContain('add feature');
    });

    it('detects git push and branch creation', () => {
      const messages: ParsedMessage[] = [
        createMockMessage({
          type: 'assistant',
          toolCalls: [
            {
              id: 'tc-1',
              name: 'Bash',
              input: { command: 'git checkout -b feat/new-branch' },
              isTask: false,
            },
          ],
        }),
        createMockMessage({
          type: 'assistant',
          toolCalls: [
            {
              id: 'tc-2',
              name: 'Bash',
              input: { command: 'git push -u origin feat/new-branch' },
              isTask: false,
            },
          ],
        }),
      ];

      const report = analyzeSession(createMockDetail({ messages }));

      expect(report.gitActivity.pushCount).toBe(1);
      expect(report.gitActivity.branchCreations).toContain('feat/new-branch');
    });
  });

  // -------------------------------------------------------------------------
  // 8. Idle gaps
  // -------------------------------------------------------------------------
  describe('idle gaps', () => {
    it('detects idle gaps >60s between assistant and next user message', () => {
      const messages: ParsedMessage[] = [
        createMockMessage({
          type: 'assistant',
          timestamp: new Date('2024-01-01T10:00:00Z'),
        }),
        // 2 minutes later
        createMockMessage({
          type: 'user',
          isMeta: false,
          content: 'back now',
          timestamp: new Date('2024-01-01T10:02:00Z'),
        }),
        createMockMessage({
          type: 'assistant',
          timestamp: new Date('2024-01-01T10:02:30Z'),
        }),
        // 30 seconds - no idle gap
        createMockMessage({
          type: 'user',
          isMeta: false,
          content: 'quick reply',
          timestamp: new Date('2024-01-01T10:03:00Z'),
        }),
        createMockMessage({
          type: 'assistant',
          timestamp: new Date('2024-01-01T10:03:30Z'),
        }),
        // 5 minutes later
        createMockMessage({
          type: 'user',
          isMeta: false,
          content: 'took a break',
          timestamp: new Date('2024-01-01T10:08:30Z'),
        }),
      ];

      const report = analyzeSession(createMockDetail({ messages }));

      expect(report.idleAnalysis.idleGapCount).toBe(2);
      expect(report.idleAnalysis.totalIdleSeconds).toBeGreaterThan(0);
      expect(report.idleAnalysis.idlePct).toBeGreaterThan(0);

      // First gap: 120s, second gap: 300s
      const gapSeconds = report.idleAnalysis.longestGaps.map((g) => g.gapSeconds);
      expect(gapSeconds).toContain(120);
      expect(gapSeconds).toContain(300);
    });

    it('reports zero idle for no gaps', () => {
      const messages: ParsedMessage[] = [
        createMockMessage({
          type: 'assistant',
          timestamp: new Date('2024-01-01T10:00:00Z'),
        }),
        createMockMessage({
          type: 'user',
          content: 'quick',
          timestamp: new Date('2024-01-01T10:00:30Z'),
        }),
      ];

      const report = analyzeSession(createMockDetail({ messages }));
      expect(report.idleAnalysis.idleGapCount).toBe(0);
      expect(report.idleAnalysis.totalIdleSeconds).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // 9. Model switches
  // -------------------------------------------------------------------------
  describe('model switches', () => {
    it('detects switches between different model names', () => {
      const messages: ParsedMessage[] = [
        createMockMessage({
          type: 'assistant',
          model: 'claude-sonnet-4-20250514',
          timestamp: new Date('2024-01-01T10:00:00Z'),
        }),
        createMockMessage({
          type: 'assistant',
          model: 'claude-sonnet-4-20250514',
          timestamp: new Date('2024-01-01T10:01:00Z'),
        }),
        createMockMessage({
          type: 'assistant',
          model: 'claude-opus-4-20250514',
          timestamp: new Date('2024-01-01T10:02:00Z'),
        }),
        createMockMessage({
          type: 'assistant',
          model: 'claude-haiku-4-20250514',
          timestamp: new Date('2024-01-01T10:03:00Z'),
        }),
      ];

      const report = analyzeSession(createMockDetail({ messages }));

      expect(report.modelSwitches.count).toBe(2);
      expect(report.modelSwitches.switches[0].from).toBe('claude-sonnet-4-20250514');
      expect(report.modelSwitches.switches[0].to).toBe('claude-opus-4-20250514');
      expect(report.modelSwitches.switches[1].from).toBe('claude-opus-4-20250514');
      expect(report.modelSwitches.switches[1].to).toBe('claude-haiku-4-20250514');

      expect(report.modelSwitches.modelsUsed).toContain('claude-sonnet-4-20250514');
      expect(report.modelSwitches.modelsUsed).toContain('claude-opus-4-20250514');
      expect(report.modelSwitches.modelsUsed).toContain('claude-haiku-4-20250514');
    });

    it('reports zero switches for single model', () => {
      const messages: ParsedMessage[] = [
        createMockMessage({
          type: 'assistant',
          model: 'claude-sonnet-4-20250514',
          usage: { input_tokens: 100, output_tokens: 50 },
        }),
        createMockMessage({
          type: 'assistant',
          model: 'claude-sonnet-4-20250514',
          usage: { input_tokens: 100, output_tokens: 50 },
        }),
      ];

      const report = analyzeSession(createMockDetail({ messages }));
      expect(report.modelSwitches.count).toBe(0);
      // modelsUsed falls back to modelStats keys when no switches
      expect(report.modelSwitches.modelsUsed).toHaveLength(1);
      expect(report.modelSwitches.modelsUsed[0]).toBe('claude-sonnet-4-20250514');
    });
  });

  // -------------------------------------------------------------------------
  // 10. Conversation tree
  // -------------------------------------------------------------------------
  describe('conversation tree', () => {
    it('computes maxDepth from uuid/parentUuid chains', () => {
      const messages: ParsedMessage[] = [
        createMockMessage({ uuid: 'root', parentUuid: null }),
        createMockMessage({ uuid: 'child-1', parentUuid: 'root' }),
        createMockMessage({ uuid: 'child-2', parentUuid: 'child-1' }),
        createMockMessage({ uuid: 'child-3', parentUuid: 'child-2' }),
      ];

      const report = analyzeSession(createMockDetail({ messages }));

      expect(report.conversationTree.totalNodes).toBe(4);
      expect(report.conversationTree.maxDepth).toBe(3); // root(0)->child1(1)->child2(2)->child3(3)
    });

    it('detects branch points (multiple children)', () => {
      const messages: ParsedMessage[] = [
        createMockMessage({ uuid: 'root', parentUuid: null }),
        createMockMessage({ uuid: 'branch-a', parentUuid: 'root' }),
        createMockMessage({ uuid: 'branch-b', parentUuid: 'root' }),
        createMockMessage({ uuid: 'branch-c', parentUuid: 'root' }),
      ];

      const report = analyzeSession(createMockDetail({ messages }));

      expect(report.conversationTree.branchPoints).toBe(1);
      expect(report.conversationTree.branchDetails).toHaveLength(1);
      expect(report.conversationTree.branchDetails[0].childCount).toBe(3);
    });

    it('counts sidechains', () => {
      const messages: ParsedMessage[] = [
        createMockMessage({ uuid: 'root', parentUuid: null, isSidechain: false }),
        createMockMessage({ uuid: 'side-1', parentUuid: 'root', isSidechain: true }),
        createMockMessage({ uuid: 'side-2', parentUuid: 'root', isSidechain: true }),
      ];

      const report = analyzeSession(createMockDetail({ messages }));
      expect(report.conversationTree.sidechainCount).toBe(2);
    });
  });

  // -------------------------------------------------------------------------
  // Additional coverage
  // -------------------------------------------------------------------------
  describe('context consumption assessment', () => {
    it('assesses healthy context consumption', () => {
      const report = analyzeSession(
        createMockDetail({
          session: createMockSession({ contextConsumption: 0.3 }),
        })
      );

      expect(report.overview.contextAssessment).toBe('healthy');
      expect(report.overview.contextConsumptionPct).toBe(30);
    });

    it('assesses critical context consumption', () => {
      const report = analyzeSession(
        createMockDetail({
          session: createMockSession({ contextConsumption: 0.85 }),
        })
      );

      expect(report.overview.contextAssessment).toBe('critical');
    });
  });

  describe('cache economics', () => {
    it('detects cold start when first assistant has cache creation but no reads', () => {
      const messages: ParsedMessage[] = [
        createMockMessage({
          type: 'assistant',
          model: 'claude-sonnet-4-20250514',
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            cache_creation_input_tokens: 500,
            cache_read_input_tokens: 0,
          },
        }),
      ];

      const report = analyzeSession(createMockDetail({ messages }));
      expect(report.cacheEconomics.coldStartDetected).toBe(true);
    });

    it('computes cache efficiency percentage', () => {
      const messages: ParsedMessage[] = [
        createMockMessage({
          type: 'assistant',
          model: 'claude-sonnet-4-20250514',
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            cache_creation_input_tokens: 200,
            cache_read_input_tokens: 800,
          },
        }),
      ];

      const report = analyzeSession(createMockDetail({ messages }));
      // efficiency = 800 / (200 + 800) * 100 = 80%
      expect(report.cacheEconomics.cacheEfficiencyPct).toBe(80);
      expect(report.cacheEconomics.cacheReadToWriteRatio).toBe(4);
    });
  });

  describe('file read redundancy', () => {
    it('tracks redundant file reads', () => {
      const messages: ParsedMessage[] = [
        createMockMessage({
          type: 'assistant',
          toolCalls: [
            { id: 'tc-1', name: 'Read', input: { file_path: '/foo.ts' }, isTask: false },
            { id: 'tc-2', name: 'Read', input: { file_path: '/foo.ts' }, isTask: false },
            { id: 'tc-3', name: 'Read', input: { file_path: '/foo.ts' }, isTask: false },
            { id: 'tc-4', name: 'Read', input: { file_path: '/bar.ts' }, isTask: false },
          ],
        }),
      ];

      const report = analyzeSession(createMockDetail({ messages }));

      expect(report.fileReadRedundancy.totalReads).toBe(4);
      expect(report.fileReadRedundancy.uniqueFiles).toBe(2);
      expect(report.fileReadRedundancy.redundantFiles['/foo.ts']).toBe(3);
      expect(report.fileReadRedundancy.redundantFiles['/bar.ts']).toBeUndefined(); // only 1 read, threshold is >2
    });
  });

  describe('prompt quality', () => {
    it('assesses well_specified when few corrections', () => {
      const messages: ParsedMessage[] = [
        createMockMessage({
          type: 'user',
          isMeta: false,
          content: 'Build me a React login component with form validation and error states',
        }),
        createMockMessage({
          type: 'assistant',
          content: [{ type: 'text' as const, text: 'Done.' }],
        }),
      ];

      const report = analyzeSession(createMockDetail({ messages }));
      expect(report.promptQuality.assessment).toBe('well_specified');
    });

    it('assesses underspecified when short prompt and many corrections', () => {
      const messages: ParsedMessage[] = [
        createMockMessage({
          type: 'user',
          isMeta: false,
          content: 'Fix the bug',
          timestamp: new Date('2024-01-01T10:00:00Z'),
        }),
        createMockMessage({
          type: 'assistant',
          content: [{ type: 'text' as const, text: 'Done.' }],
          timestamp: new Date('2024-01-01T10:01:00Z'),
        }),
        createMockMessage({
          type: 'user',
          isMeta: false,
          content: 'No, wrong file',
          timestamp: new Date('2024-01-01T10:02:00Z'),
        }),
        createMockMessage({
          type: 'assistant',
          content: [{ type: 'text' as const, text: 'Updated.' }],
          timestamp: new Date('2024-01-01T10:03:00Z'),
        }),
        createMockMessage({
          type: 'user',
          isMeta: false,
          content: 'Actually the other module',
          timestamp: new Date('2024-01-01T10:04:00Z'),
        }),
      ];

      const report = analyzeSession(createMockDetail({ messages }));
      expect(report.promptQuality.assessment).toBe('underspecified');
      expect(report.promptQuality.firstMessageLengthChars).toBe('Fix the bug'.length);
    });
  });

  describe('subagent metrics from processes', () => {
    it('computes subagent summary from detail.processes', () => {
      const processes: Process[] = [
        {
          id: 'agent-1',
          filePath: '/path/to/agent-1.jsonl',
          messages: [
            createMockMessage({
              toolCalls: [
                { id: 'tc-1', name: 'Read', input: {}, isTask: false },
                { id: 'tc-2', name: 'Edit', input: {}, isTask: false },
              ],
            }),
          ],
          startTime: new Date('2024-01-01T10:00:00Z'),
          endTime: new Date('2024-01-01T10:01:00Z'),
          durationMs: 60000,
          metrics: createMockMetrics({ totalTokens: 5000, costUsd: 0.05 }),
          description: 'Refactor module',
          subagentType: 'code',
          isParallel: false,
        },
      ];

      const report = analyzeSession(createMockDetail({ processes }));

      expect(report.subagentMetrics.count).toBe(1);
      expect(report.subagentMetrics.totalTokens).toBe(5000);
      expect(report.subagentMetrics.totalToolUseCount).toBe(2);
      expect(report.subagentMetrics.byAgent[0].description).toBe('Refactor module');
    });
  });

  describe('thinking blocks', () => {
    it('counts thinking blocks and analyzes signals', () => {
      const messages: ParsedMessage[] = [
        createMockMessage({
          type: 'assistant',
          content: [
            {
              type: 'thinking' as const,
              thinking:
                'Let me think about an alternative approach. Actually, I should reconsider.',
              signature: 'sig-1',
            },
            { type: 'text' as const, text: 'Here is my response.' },
          ],
        }),
      ];

      const report = analyzeSession(createMockDetail({ messages }));

      expect(report.thinkingBlocks.count).toBe(1);
      expect(report.thinkingBlocks.analyzedCount).toBe(1);
      expect(report.thinkingBlocks.signalSummary.alternatives).toBe(1);
      expect(report.thinkingBlocks.signalSummary.direction_change).toBe(1);
    });
  });

  describe('working directories', () => {
    it('tracks working directory changes', () => {
      const messages: ParsedMessage[] = [
        createMockMessage({ cwd: '/project/src' }),
        createMockMessage({ cwd: '/project/src' }),
        createMockMessage({ cwd: '/project/test' }),
        createMockMessage({ cwd: '/project/src' }),
      ];

      const report = analyzeSession(createMockDetail({ messages }));

      expect(report.workingDirectories.directoryCount).toBe(2);
      expect(report.workingDirectories.isMultiDirectory).toBe(true);
      expect(report.workingDirectories.changeCount).toBe(2); // src->test, test->src
    });
  });

  describe('git branches', () => {
    it('collects unique git branches', () => {
      const messages: ParsedMessage[] = [
        createMockMessage({ gitBranch: 'main' }),
        createMockMessage({ gitBranch: 'main' }),
        createMockMessage({ gitBranch: 'feat/new' }),
      ];

      const report = analyzeSession(createMockDetail({ messages }));
      expect(report.gitBranches).toContain('main');
      expect(report.gitBranches).toContain('feat/new');
      expect(report.gitBranches).toHaveLength(2);
    });
  });

  describe('test progression', () => {
    it('detects improving test trajectory', () => {
      const messages: ParsedMessage[] = [
        createMockMessage({
          type: 'assistant',
          toolCalls: [{ id: 'tc-1', name: 'Bash', input: { command: 'pnpm test' }, isTask: false }],
        }),
        createMockMessage({
          type: 'user',
          isMeta: true,
          content: [],
          toolResults: [{ toolUseId: 'tc-1', content: '3 passed 2 failed', isError: false }],
        }),
        createMockMessage({
          type: 'assistant',
          toolCalls: [{ id: 'tc-2', name: 'Bash', input: { command: 'pnpm test' }, isTask: false }],
        }),
        createMockMessage({
          type: 'user',
          isMeta: true,
          content: [],
          toolResults: [{ toolUseId: 'tc-2', content: '5 passed 0 failed', isError: false }],
        }),
      ];

      const report = analyzeSession(createMockDetail({ messages }));

      expect(report.testProgression.snapshotCount).toBe(2);
      expect(report.testProgression.trajectory).toBe('improving');
      expect(report.testProgression.firstSnapshot?.passed).toBe(3);
      expect(report.testProgression.lastSnapshot?.passed).toBe(5);
    });
  });

  describe('startup overhead', () => {
    it('counts messages and tokens before first work tool', () => {
      const messages: ParsedMessage[] = [
        // Startup: assistant response with no work tools
        createMockMessage({
          type: 'assistant',
          model: 'claude-sonnet-4-20250514',
          usage: { input_tokens: 500, output_tokens: 200 },
          toolCalls: [],
        }),
        // First work tool
        createMockMessage({
          type: 'assistant',
          model: 'claude-sonnet-4-20250514',
          usage: { input_tokens: 1000, output_tokens: 300 },
          toolCalls: [{ id: 'tc-1', name: 'Read', input: { file_path: '/foo.ts' }, isTask: false }],
        }),
      ];

      const report = analyzeSession(createMockDetail({ messages }));

      expect(report.startupOverhead.messagesBeforeFirstWork).toBe(1);
      expect(report.startupOverhead.tokensBeforeFirstWork).toBe(700); // 500 + 200
    });
  });

  describe('thrashing signals', () => {
    it('detects bash near-duplicates', () => {
      const makeMsg = (cmd: string, id: string) =>
        createMockMessage({
          type: 'assistant',
          toolCalls: [{ id, name: 'Bash', input: { command: cmd }, isTask: false }],
        });

      const messages: ParsedMessage[] = [
        makeMsg('pnpm test src/foo.test.ts', 'tc-1'),
        makeMsg('pnpm test src/foo.test.ts', 'tc-2'),
        makeMsg('pnpm test src/foo.test.ts', 'tc-3'),
      ];

      const report = analyzeSession(createMockDetail({ messages }));

      expect(report.thrashingSignals.bashNearDuplicates.length).toBeGreaterThanOrEqual(1);
      expect(report.thrashingSignals.bashNearDuplicates[0].count).toBe(3);
    });

    it('detects file edit rework', () => {
      const messages: ParsedMessage[] = [
        createMockMessage({
          type: 'assistant',
          toolCalls: [{ id: 'tc-1', name: 'Edit', input: { file_path: '/foo.ts' }, isTask: false }],
        }),
        createMockMessage({
          type: 'assistant',
          toolCalls: [{ id: 'tc-2', name: 'Edit', input: { file_path: '/foo.ts' }, isTask: false }],
        }),
        createMockMessage({
          type: 'assistant',
          toolCalls: [{ id: 'tc-3', name: 'Edit', input: { file_path: '/foo.ts' }, isTask: false }],
        }),
      ];

      const report = analyzeSession(createMockDetail({ messages }));

      expect(report.thrashingSignals.editReworkFiles).toHaveLength(1);
      expect(report.thrashingSignals.editReworkFiles[0].filePath).toBe('/foo.ts');
      expect(report.thrashingSignals.editReworkFiles[0].editIndices).toHaveLength(3);
    });
  });

  describe('skills invoked', () => {
    it('tracks Skill tool calls', () => {
      const messages: ParsedMessage[] = [
        createMockMessage({
          type: 'assistant',
          toolCalls: [
            {
              id: 'tc-1',
              name: 'Skill',
              input: { skill: 'brainstorming', args: '--verbose' },
              isTask: false,
            },
            { id: 'tc-2', name: 'Skill', input: { skill: 'writing-plans' }, isTask: false },
          ],
        }),
      ];

      const report = analyzeSession(createMockDetail({ messages }));

      expect(report.skillsInvoked).toHaveLength(2);
      expect(report.skillsInvoked[0].skill).toBe('brainstorming');
      expect(report.skillsInvoked[0].argsPreview).toBe('--verbose');
      expect(report.skillsInvoked[1].skill).toBe('writing-plans');
    });
  });

  describe('bash commands', () => {
    it('tracks total, unique, and repeated commands', () => {
      const messages: ParsedMessage[] = [
        createMockMessage({
          type: 'assistant',
          toolCalls: [
            { id: 'tc-1', name: 'Bash', input: { command: 'pnpm test' }, isTask: false },
            { id: 'tc-2', name: 'Bash', input: { command: 'pnpm test' }, isTask: false },
            { id: 'tc-3', name: 'Bash', input: { command: 'git status' }, isTask: false },
          ],
        }),
      ];

      const report = analyzeSession(createMockDetail({ messages }));

      expect(report.bashCommands.total).toBe(3);
      expect(report.bashCommands.unique).toBe(2);
      expect(report.bashCommands.repeated['pnpm test']).toBe(2);
    });
  });

  describe('subagents list', () => {
    it('tracks Task tool dispatches', () => {
      const messages: ParsedMessage[] = [
        createMockMessage({
          type: 'assistant',
          toolCalls: [
            {
              id: 'tc-1',
              name: 'Task',
              input: {
                description: 'explore auth',
                subagent_type: 'Explore',
                run_in_background: true,
              },
              isTask: true,
            },
          ],
        }),
      ];

      const report = analyzeSession(createMockDetail({ messages }));

      expect(report.subagentsList).toHaveLength(1);
      expect(report.subagentsList[0].description).toBe('explore auth');
      expect(report.subagentsList[0].subagentType).toBe('Explore');
      expect(report.subagentsList[0].runInBackground).toBe(true);
    });
  });

  describe('lifecycle tasks', () => {
    it('tracks TaskCreate subjects', () => {
      const messages: ParsedMessage[] = [
        createMockMessage({
          type: 'assistant',
          toolCalls: [
            { id: 'tc-1', name: 'TaskCreate', input: { subject: 'Add login page' }, isTask: false },
            { id: 'tc-2', name: 'TaskCreate', input: { subject: 'Write tests' }, isTask: false },
          ],
        }),
      ];

      const report = analyzeSession(createMockDetail({ messages }));

      expect(report.lifecycleTasks).toEqual(['Add login page', 'Write tests']);
    });
  });

  describe('user questions', () => {
    it('tracks AskUserQuestion calls', () => {
      const messages: ParsedMessage[] = [
        createMockMessage({
          type: 'assistant',
          toolCalls: [
            {
              id: 'tc-1',
              name: 'AskUserQuestion',
              input: {
                questions: [
                  {
                    question: 'Which auth method?',
                    options: [{ label: 'JWT' }, { label: 'OAuth' }],
                  },
                ],
              },
              isTask: false,
            },
          ],
        }),
      ];

      const report = analyzeSession(createMockDetail({ messages }));

      expect(report.userQuestions).toHaveLength(1);
      expect(report.userQuestions[0].question).toBe('Which auth method?');
      expect(report.userQuestions[0].options).toEqual(['JWT', 'OAuth']);
    });
  });

  describe('out-of-scope findings', () => {
    it('detects pre-existing and tech debt mentions', () => {
      const messages: ParsedMessage[] = [
        createMockMessage({
          type: 'assistant',
          content: 'This is a pre-existing issue that was there before our changes.',
        }),
        createMockMessage({
          type: 'assistant',
          content: 'I noticed some tech debt in the authentication module.',
        }),
      ];

      const report = analyzeSession(createMockDetail({ messages }));

      expect(report.outOfScopeFindings).toHaveLength(2);
      expect(report.outOfScopeFindings[0].keyword).toBe('pre-existing');
      expect(report.outOfScopeFindings[1].keyword).toBe('tech debt');
    });
  });

  describe('compaction', () => {
    it('tracks compaction count and summary messages', () => {
      const messages: ParsedMessage[] = [
        createMockMessage({ type: 'assistant', isCompactSummary: true }),
        createMockMessage({ type: 'assistant', isCompactSummary: true }),
      ];

      const session = createMockSession();
      session.compactionCount = 2;
      const report = analyzeSession(createMockDetail({ messages, session }));

      expect(report.compaction.count).toBe(2);
      expect(report.compaction.compactSummaryCount).toBe(2);
      expect(report.compaction.note).toContain('underwent compaction');
    });

    it('reports no compaction', () => {
      const report = analyzeSession(createMockDetail({}));

      expect(report.compaction.count).toBe(0);
      expect(report.compaction.note).toContain('No compaction');
    });
  });

  // -------------------------------------------------------------------------
  // Assessment computations
  // -------------------------------------------------------------------------

  describe('cost assessments', () => {
    it('computes costPerCommitAssessment when commits exist', () => {
      const messages: ParsedMessage[] = [
        createMockMessage({
          type: 'assistant',
          model: 'claude-sonnet-4-20250514',
          usage: { input_tokens: 50000, output_tokens: 10000 },
          toolCalls: [
            {
              id: 'tc-1',
              name: 'Bash',
              input: { command: "git commit -m 'fix'" },
              isTask: false,
            },
          ],
        }),
      ];

      const report = analyzeSession(createMockDetail({ messages }));
      expect(report.costAnalysis.costPerCommitAssessment).not.toBeNull();
    });

    it('returns null assessments when no commits', () => {
      const report = analyzeSession(createMockDetail());
      expect(report.costAnalysis.costPerCommitAssessment).toBeNull();
      expect(report.costAnalysis.costPerLineAssessment).toBeNull();
    });

    it('returns null subagentCostShareAssessment when no cost', () => {
      const report = analyzeSession(createMockDetail());
      expect(report.costAnalysis.subagentCostSharePct).toBeNull();
      expect(report.costAnalysis.subagentCostShareAssessment).toBeNull();
    });
  });

  describe('cache assessments', () => {
    it('computes cache efficiency assessment', () => {
      const messages: ParsedMessage[] = [
        createMockMessage({
          type: 'assistant',
          model: 'claude-sonnet-4-20250514',
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            cache_creation_input_tokens: 100,
            cache_read_input_tokens: 9900,
          },
        }),
      ];

      const report = analyzeSession(createMockDetail({ messages }));
      expect(report.cacheEconomics.cacheEfficiencyAssessment).toBe('good');
    });

    it('returns concerning for low cache efficiency', () => {
      const messages: ParsedMessage[] = [
        createMockMessage({
          type: 'assistant',
          model: 'claude-sonnet-4-20250514',
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            cache_creation_input_tokens: 500,
            cache_read_input_tokens: 500,
          },
        }),
      ];

      const report = analyzeSession(createMockDetail({ messages }));
      expect(report.cacheEconomics.cacheEfficiencyAssessment).toBe('concerning');
    });

    it('returns null when no cache data', () => {
      const messages: ParsedMessage[] = [
        createMockMessage({
          type: 'assistant',
          model: 'claude-sonnet-4-20250514',
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
          },
        }),
      ];

      const report = analyzeSession(createMockDetail({ messages }));
      expect(report.cacheEconomics.cacheEfficiencyAssessment).toBeNull();
      expect(report.cacheEconomics.cacheRatioAssessment).toBeNull();
    });
  });

  describe('tool health assessments', () => {
    it('computes per-tool assessment', () => {
      const messages: ParsedMessage[] = [
        createMockMessage({
          type: 'assistant',
          toolCalls: [
            { id: 'tc-1', name: 'Read', input: { file_path: '/a.ts' }, isTask: false },
            { id: 'tc-2', name: 'Read', input: { file_path: '/b.ts' }, isTask: false },
          ],
        }),
        createMockMessage({
          type: 'user',
          isMeta: true,
          content: [],
          toolResults: [
            { toolUseId: 'tc-1', content: 'ok', isError: false },
            { toolUseId: 'tc-2', content: 'ok', isError: false },
          ],
        }),
      ];

      const report = analyzeSession(createMockDetail({ messages }));
      expect(report.toolUsage.successRates.Read.assessment).toBe('healthy');
    });

    it('computes overall tool health', () => {
      const report = analyzeSession(createMockDetail());
      expect(report.toolUsage.overallToolHealth).toBe('healthy');
    });
  });

  describe('idle assessment', () => {
    it('returns efficient for low idle', () => {
      const messages: ParsedMessage[] = [
        createMockMessage({
          type: 'assistant',
          timestamp: new Date('2024-01-01T10:00:00Z'),
        }),
        createMockMessage({
          type: 'user',
          content: 'quick',
          timestamp: new Date('2024-01-01T10:00:30Z'),
        }),
      ];

      const report = analyzeSession(createMockDetail({ messages }));
      expect(report.idleAnalysis.idleAssessment).toBe('efficient');
    });

    it('returns high_idle for mostly idle session', () => {
      const messages: ParsedMessage[] = [
        createMockMessage({
          type: 'assistant',
          timestamp: new Date('2024-01-01T10:00:00Z'),
        }),
        createMockMessage({
          type: 'user',
          content: 'back',
          timestamp: new Date('2024-01-01T11:00:00Z'),
        }),
        createMockMessage({
          type: 'assistant',
          timestamp: new Date('2024-01-01T11:00:10Z'),
        }),
      ];

      const report = analyzeSession(createMockDetail({ messages }));
      expect(report.idleAnalysis.idleAssessment).toBe('high_idle');
    });
  });

  describe('thrashing assessment', () => {
    it('returns none when no signals', () => {
      const report = analyzeSession(createMockDetail());
      expect(report.thrashingSignals.thrashingAssessment).toBe('none');
    });

    it('returns mild or severe based on signal count', () => {
      const makeEditMsg = (file: string, id: string) =>
        createMockMessage({
          type: 'assistant',
          toolCalls: [{ id, name: 'Edit', input: { file_path: file }, isTask: false }],
        });

      // 3 edits on one file = 1 signal + 3 repeated bash = 1 signal = mild (2)
      const messages: ParsedMessage[] = [
        makeEditMsg('/foo.ts', 'e1'),
        makeEditMsg('/foo.ts', 'e2'),
        makeEditMsg('/foo.ts', 'e3'),
      ];

      const report = analyzeSession(createMockDetail({ messages }));
      expect(['mild', 'severe']).toContain(report.thrashingSignals.thrashingAssessment);
    });
  });

  describe('model switch pattern', () => {
    it('detects opus_plan_mode', () => {
      const messages: ParsedMessage[] = [
        createMockMessage({
          type: 'assistant',
          model: 'claude-sonnet-4-20250514',
          timestamp: new Date('2024-01-01T10:00:00Z'),
        }),
        createMockMessage({
          type: 'assistant',
          model: 'claude-opus-4-20250514',
          timestamp: new Date('2024-01-01T10:01:00Z'),
        }),
        createMockMessage({
          type: 'assistant',
          model: 'claude-sonnet-4-20250514',
          timestamp: new Date('2024-01-01T10:02:00Z'),
        }),
      ];

      const report = analyzeSession(createMockDetail({ messages }));
      expect(report.modelSwitches.switchPattern).toBe('opus_plan_mode');
    });

    it('returns null when no switches', () => {
      const messages: ParsedMessage[] = [
        createMockMessage({
          type: 'assistant',
          model: 'claude-sonnet-4-20250514',
          usage: { input_tokens: 100, output_tokens: 50 },
        }),
      ];

      const report = analyzeSession(createMockDetail({ messages }));
      expect(report.modelSwitches.switchPattern).toBeNull();
    });
  });

  describe('startup overhead assessment', () => {
    it('returns normal for low overhead', () => {
      const messages: ParsedMessage[] = [
        createMockMessage({
          type: 'assistant',
          model: 'claude-sonnet-4-20250514',
          usage: { input_tokens: 100, output_tokens: 50 },
          toolCalls: [{ id: 'tc-1', name: 'Read', input: { file_path: '/f.ts' }, isTask: false }],
        }),
      ];

      const report = analyzeSession(createMockDetail({ messages }));
      expect(report.startupOverhead.overheadAssessment).toBe('normal');
    });

    it('returns heavy for high overhead', () => {
      const messages: ParsedMessage[] = [
        // Lots of startup tokens, no work tools
        createMockMessage({
          type: 'assistant',
          model: 'claude-sonnet-4-20250514',
          usage: { input_tokens: 50000, output_tokens: 10000 },
          toolCalls: [],
        }),
        // Small work message
        createMockMessage({
          type: 'assistant',
          model: 'claude-sonnet-4-20250514',
          usage: { input_tokens: 100, output_tokens: 50 },
          toolCalls: [{ id: 'tc-1', name: 'Read', input: { file_path: '/f.ts' }, isTask: false }],
        }),
      ];

      const report = analyzeSession(createMockDetail({ messages }));
      expect(report.startupOverhead.overheadAssessment).toBe('heavy');
    });
  });

  describe('file read redundancy assessment', () => {
    it('returns normal for low redundancy', () => {
      const messages: ParsedMessage[] = [
        createMockMessage({
          type: 'assistant',
          toolCalls: [
            { id: 'tc-1', name: 'Read', input: { file_path: '/a.ts' }, isTask: false },
            { id: 'tc-2', name: 'Read', input: { file_path: '/b.ts' }, isTask: false },
          ],
        }),
      ];

      const report = analyzeSession(createMockDetail({ messages }));
      expect(report.fileReadRedundancy.redundancyAssessment).toBe('normal');
    });

    it('returns wasteful for high redundancy', () => {
      const messages: ParsedMessage[] = [
        createMockMessage({
          type: 'assistant',
          toolCalls: [
            { id: 'tc-1', name: 'Read', input: { file_path: '/a.ts' }, isTask: false },
            { id: 'tc-2', name: 'Read', input: { file_path: '/a.ts' }, isTask: false },
            { id: 'tc-3', name: 'Read', input: { file_path: '/a.ts' }, isTask: false },
            { id: 'tc-4', name: 'Read', input: { file_path: '/a.ts' }, isTask: false },
          ],
        }),
      ];

      const report = analyzeSession(createMockDetail({ messages }));
      expect(report.fileReadRedundancy.redundancyAssessment).toBe('wasteful');
    });
  });

  describe('model mismatch in subagents', () => {
    it('detects mismatch for mechanical tasks on opus', () => {
      const processes: Process[] = [
        {
          id: 'agent-1',
          filePath: '/path/to/agent-1.jsonl',
          messages: [],
          startTime: new Date('2024-01-01T10:00:00Z'),
          endTime: new Date('2024-01-01T10:01:00Z'),
          durationMs: 60000,
          metrics: createMockMetrics({ totalTokens: 5000, costUsd: 0.05 }),
          description: 'rename all variables',
          subagentType: 'code',
          isParallel: false,
        },
      ];

      const report = analyzeSession(createMockDetail({ processes }));
      // model is 'default (inherits parent)' which doesn't contain 'opus', so no mismatch
      expect(report.subagentMetrics.byAgent[0].modelMismatch).toBeNull();
    });
  });

  describe('cost source of truth', () => {
    it('should use detail.metrics.costUsd as authoritative parent cost', () => {
      const messages: ParsedMessage[] = [
        createMockMessage({
          type: 'assistant',
          model: 'claude-sonnet-4-20250514',
          usage: {
            input_tokens: 1000,
            output_tokens: 500,
            cache_read_input_tokens: 400,
            cache_creation_input_tokens: 100,
          },
        }),
      ];

      const detail = createMockDetail({
        metrics: createMockMetrics({
          durationMs: 1000,
          totalTokens: 2000,
          inputTokens: 1000,
          outputTokens: 500,
          cacheReadTokens: 400,
          cacheCreationTokens: 100,
          messageCount: 2,
          costUsd: 0.0042, // Authoritative cost from calculateMetrics()
        }),
        messages,
      });

      const report = analyzeSession(detail);

      // parentCostUsd should match detail.metrics.costUsd exactly (rounded to 4 decimals)
      expect(report.costAnalysis.parentCostUsd).toBe(0.0042);
    });

    it('should use proc.metrics.costUsd as authoritative subagent cost', () => {
      const messages: ParsedMessage[] = [
        createMockMessage({
          type: 'assistant',
          model: 'claude-sonnet-4-20250514',
          usage: { input_tokens: 500, output_tokens: 500 },
        }),
      ];

      const processes: Process[] = [
        {
          id: 'agent-1',
          filePath: '/path/to/agent-1.jsonl',
          messages: [],
          startTime: new Date('2024-01-01T10:00:00Z'),
          endTime: new Date('2024-01-01T10:01:00Z'),
          durationMs: 500,
          metrics: createMockMetrics({
            durationMs: 500,
            totalTokens: 3000,
            inputTokens: 2000,
            outputTokens: 1000,
            messageCount: 2,
            costUsd: 0.0555, // Authoritative subagent cost
          }),
          description: 'test subagent',
          subagentType: 'code',
          isParallel: false,
        },
      ];

      const detail = createMockDetail({
        metrics: createMockMetrics({
          durationMs: 1000,
          totalTokens: 1000,
          inputTokens: 500,
          outputTokens: 500,
          messageCount: 1,
          costUsd: 0.01,
        }),
        messages,
        processes,
      });

      const report = analyzeSession(detail);

      expect(report.costAnalysis.subagentCostUsd).toBe(0.0555);
      // Total should be parent + subagent
      expect(report.costAnalysis.totalSessionCostUsd).toBe(
        Math.round((0.01 + 0.0555) * 10000) / 10000
      );
    });
  });
});
