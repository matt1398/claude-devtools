/**
 * SessionContextPanel - Panel showing all context injections for a session.
 * Displays CLAUDE.md files, mentioned files, and tool outputs in collapsible sections.
 */

import React, { useMemo, useState } from 'react';

import { COLOR_BORDER, COLOR_SURFACE, COLOR_TEXT_MUTED } from '@renderer/constants/cssVariables';

import { ClaudeMdFilesSection } from './components/ClaudeMdFilesSection';
import { MentionedFilesSection } from './components/MentionedFilesSection';
import { RankedInjectionList } from './components/RankedInjectionList';
import { SessionContextHeader } from './components/SessionContextHeader';
import { TaskCoordinationSection } from './components/TaskCoordinationSection';
import { ThinkingTextSection } from './components/ThinkingTextSection';
import { ToolOutputsSection } from './components/ToolOutputsSection';
import { UserMessagesSection } from './components/UserMessagesSection';
import {
  SECTION_CLAUDE_MD,
  SECTION_MENTIONED_FILES,
  SECTION_TASK_COORDINATION,
  SECTION_THINKING_TEXT,
  SECTION_TOOL_OUTPUTS,
  SECTION_USER_MESSAGES,
} from './types';

import type { ContextViewMode, SectionType, SessionContextPanelProps } from './types';
import type {
  ClaudeMdContextInjection,
  MentionedFileInjection,
  TaskCoordinationInjection,
  ThinkingTextInjection,
  ToolOutputInjection,
  UserMessageInjection,
} from '@renderer/types/contextInjection';

export const SessionContextPanel = ({
  injections,
  onClose,
  projectRoot,
  onNavigateToTurn,
  onNavigateToTool,
  onNavigateToUserGroup,
  totalSessionTokens,
  phaseInfo,
  selectedPhase,
  onPhaseChange,
}: Readonly<SessionContextPanelProps>): React.ReactElement => {
  // View mode: category sections or flat ranked list
  const [viewMode, setViewMode] = useState<ContextViewMode>('category');

  // Track which main sections are expanded
  const [expandedSections, setExpandedSections] = useState<Set<SectionType>>(
    new Set([
      SECTION_USER_MESSAGES,
      SECTION_CLAUDE_MD,
      SECTION_MENTIONED_FILES,
      SECTION_TOOL_OUTPUTS,
      SECTION_TASK_COORDINATION,
      SECTION_THINKING_TEXT,
    ])
  );

  // Separate injections by category
  const {
    claudeMdInjections,
    mentionedFileInjections,
    toolOutputInjections,
    thinkingTextInjections,
    taskCoordinationInjections,
    userMessageInjections,
  } = useMemo(() => {
    const claudeMd: ClaudeMdContextInjection[] = [];
    const mentionedFiles: MentionedFileInjection[] = [];
    const toolOutputs: ToolOutputInjection[] = [];
    const thinkingText: ThinkingTextInjection[] = [];
    const taskCoordination: TaskCoordinationInjection[] = [];
    const userMessages: UserMessageInjection[] = [];

    for (const injection of injections) {
      switch (injection.category) {
        case 'claude-md':
          claudeMd.push(injection);
          break;
        case 'mentioned-file':
          mentionedFiles.push(injection);
          break;
        case 'tool-output':
          toolOutputs.push(injection);
          break;
        case 'thinking-text':
          thinkingText.push(injection);
          break;
        case 'task-coordination':
          taskCoordination.push(injection);
          break;
        case 'user-message':
          userMessages.push(injection);
          break;
      }
    }

    // Sort mentioned files and tool outputs by tokens descending
    mentionedFiles.sort((a, b) => b.estimatedTokens - a.estimatedTokens);
    toolOutputs.sort((a, b) => b.estimatedTokens - a.estimatedTokens);
    // Sort task coordination by tokens descending
    taskCoordination.sort((a, b) => b.estimatedTokens - a.estimatedTokens);
    // Sort thinking-text by turn index ascending
    thinkingText.sort((a, b) => a.turnIndex - b.turnIndex);
    // Sort user messages by turn index ascending
    userMessages.sort((a, b) => a.turnIndex - b.turnIndex);

    return {
      claudeMdInjections: claudeMd,
      mentionedFileInjections: mentionedFiles,
      toolOutputInjections: toolOutputs,
      thinkingTextInjections: thinkingText,
      taskCoordinationInjections: taskCoordination,
      userMessageInjections: userMessages,
    };
  }, [injections]);

  // Calculate total tokens
  const totalTokens = useMemo(
    () => injections.reduce((sum, inj) => sum + inj.estimatedTokens, 0),
    [injections]
  );

  // Section token counts
  const claudeMdTokens = useMemo(
    () => claudeMdInjections.reduce((sum, inj) => sum + inj.estimatedTokens, 0),
    [claudeMdInjections]
  );

  const mentionedFilesTokens = useMemo(
    () => mentionedFileInjections.reduce((sum, inj) => sum + inj.estimatedTokens, 0),
    [mentionedFileInjections]
  );

  const toolOutputsTokens = useMemo(
    () => toolOutputInjections.reduce((sum, inj) => sum + inj.estimatedTokens, 0),
    [toolOutputInjections]
  );

  const thinkingTextTokens = useMemo(
    () => thinkingTextInjections.reduce((sum, inj) => sum + inj.estimatedTokens, 0),
    [thinkingTextInjections]
  );

  const taskCoordinationTokens = useMemo(
    () => taskCoordinationInjections.reduce((sum, inj) => sum + inj.estimatedTokens, 0),
    [taskCoordinationInjections]
  );

  const userMessagesTokens = useMemo(
    () => userMessageInjections.reduce((sum, inj) => sum + inj.estimatedTokens, 0),
    [userMessageInjections]
  );

  // Toggle section expansion
  const toggleSection = (section: SectionType): void => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(section)) {
        next.delete(section);
      } else {
        next.add(section);
      }
      return next;
    });
  };

  return (
    <div
      className="flex h-full flex-col"
      style={{
        backgroundColor: COLOR_SURFACE,
        borderLeft: `1px solid ${COLOR_BORDER}`,
      }}
    >
      <SessionContextHeader
        injectionCount={injections.length}
        totalTokens={totalTokens}
        totalSessionTokens={totalSessionTokens}
        onClose={onClose}
        phaseInfo={phaseInfo}
        selectedPhase={selectedPhase}
        onPhaseChange={onPhaseChange}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
      />

      {/* Content */}
      <div className="flex-1 space-y-2 overflow-y-auto p-3">
        {injections.length === 0 ? (
          <div
            className="flex h-full items-center justify-center text-sm"
            style={{ color: COLOR_TEXT_MUTED }}
          >
            No context injections detected in this session
          </div>
        ) : viewMode === 'category' ? (
          <>
            <UserMessagesSection
              injections={userMessageInjections}
              tokenCount={userMessagesTokens}
              isExpanded={expandedSections.has(SECTION_USER_MESSAGES)}
              onToggle={() => toggleSection(SECTION_USER_MESSAGES)}
              onNavigateToTurn={onNavigateToTurn}
            />

            <ClaudeMdFilesSection
              injections={claudeMdInjections}
              tokenCount={claudeMdTokens}
              isExpanded={expandedSections.has(SECTION_CLAUDE_MD)}
              onToggle={() => toggleSection(SECTION_CLAUDE_MD)}
              projectRoot={projectRoot ?? ''}
              onNavigateToTurn={onNavigateToTurn}
            />

            <MentionedFilesSection
              injections={mentionedFileInjections}
              tokenCount={mentionedFilesTokens}
              isExpanded={expandedSections.has(SECTION_MENTIONED_FILES)}
              onToggle={() => toggleSection(SECTION_MENTIONED_FILES)}
              projectRoot={projectRoot}
              onNavigateToTurn={onNavigateToTurn}
            />

            <ToolOutputsSection
              injections={toolOutputInjections}
              tokenCount={toolOutputsTokens}
              isExpanded={expandedSections.has(SECTION_TOOL_OUTPUTS)}
              onToggle={() => toggleSection(SECTION_TOOL_OUTPUTS)}
              onNavigateToTurn={onNavigateToTurn}
            />

            <TaskCoordinationSection
              injections={taskCoordinationInjections}
              tokenCount={taskCoordinationTokens}
              isExpanded={expandedSections.has(SECTION_TASK_COORDINATION)}
              onToggle={() => toggleSection(SECTION_TASK_COORDINATION)}
              onNavigateToTurn={onNavigateToTurn}
            />

            <ThinkingTextSection
              injections={thinkingTextInjections}
              tokenCount={thinkingTextTokens}
              isExpanded={expandedSections.has(SECTION_THINKING_TEXT)}
              onToggle={() => toggleSection(SECTION_THINKING_TEXT)}
              onNavigateToTurn={onNavigateToTurn}
            />
          </>
        ) : (
          <RankedInjectionList
            injections={injections}
            onNavigateToTurn={onNavigateToTurn}
            onNavigateToTool={onNavigateToTool}
            onNavigateToUserGroup={onNavigateToUserGroup}
          />
        )}
      </div>
    </div>
  );
};
