/**
 * SessionParser service - Parses Claude Code session JSONL files.
 *
 * Responsibilities:
 * - Parse JSONL files into structured messages
 * - Extract all message metadata
 * - Identify tool calls and tool results
 * - Calculate session metrics
 */

import {
  isParsedInternalUserMessage,
  isParsedRealUserMessage,
  type ParsedMessage,
  type SessionMetrics,
  type ToolCall,
  type ToolResult,
} from '@main/types';
import {
  calculateMetrics,
  extractTextContent,
  getTaskCalls,
  parseJsonlFile,
} from '@main/utils/jsonl';
import * as path from 'path';

import { type ProjectScanner } from '../discovery/ProjectScanner';

/**
 * Result of parsing a session file.
 */
export interface ParsedSession {
  /** All parsed messages */
  messages: ParsedMessage[];
  /** Session metrics */
  metrics: SessionMetrics;
  /** All Task calls found in the session */
  taskCalls: ToolCall[];
  /** Messages grouped by type */
  byType: {
    user: ParsedMessage[]; // All user messages
    realUser: ParsedMessage[]; // Only real user messages (not tool results)
    internalUser: ParsedMessage[]; // Only tool result messages
    assistant: ParsedMessage[];
    system: ParsedMessage[];
    other: ParsedMessage[];
  };
  /** Sidechain messages */
  sidechainMessages: ParsedMessage[];
  /** Main thread messages (non-sidechain) */
  mainMessages: ParsedMessage[];
}

export class SessionParser {
  private projectScanner: ProjectScanner;

  constructor(projectScanner: ProjectScanner) {
    this.projectScanner = projectScanner;
  }

  // ===========================================================================
  // Core Parsing
  // ===========================================================================

  /**
   * Parse a session JSONL file and return structured data.
   */
  async parseSession(projectId: string, sessionId: string): Promise<ParsedSession> {
    const sessionPath = this.projectScanner.getSessionPath(projectId, sessionId);
    return this.parseSessionFile(sessionPath);
  }

  /**
   * Parse a JSONL file at the given path.
   */
  async parseSessionFile(filePath: string): Promise<ParsedSession> {
    const messages = await parseJsonlFile(filePath, this.projectScanner.getFileSystemProvider());
    return this.processMessages(messages);
  }

  /**
   * Process parsed messages into structured data.
   */
  private processMessages(messages: ParsedMessage[]): ParsedSession {
    // Single-pass categorization instead of 8 separate filter passes
    const byType = {
      user: [] as ParsedMessage[],
      realUser: [] as ParsedMessage[],
      internalUser: [] as ParsedMessage[],
      assistant: [] as ParsedMessage[],
      system: [] as ParsedMessage[],
      other: [] as ParsedMessage[],
    };
    const sidechainMessages: ParsedMessage[] = [];
    const mainMessages: ParsedMessage[] = [];

    for (const m of messages) {
      switch (m.type) {
        case 'user':
          byType.user.push(m);
          if (isParsedRealUserMessage(m)) byType.realUser.push(m);
          if (isParsedInternalUserMessage(m)) byType.internalUser.push(m);
          break;
        case 'assistant':
          byType.assistant.push(m);
          break;
        case 'system':
          byType.system.push(m);
          break;
        default:
          byType.other.push(m);
          break;
      }

      if (m.isSidechain) {
        sidechainMessages.push(m);
      } else {
        mainMessages.push(m);
      }
    }

    // Calculate metrics
    const metrics = calculateMetrics(messages);

    // Extract all Task calls
    const taskCalls = getTaskCalls(messages);

    return {
      messages,
      metrics,
      taskCalls,
      byType,
      sidechainMessages,
      mainMessages,
    };
  }

  // ===========================================================================
  // Message Queries
  // ===========================================================================

  /**
   * Get user messages from a parsed session.
   */
  getUserMessages(session: ParsedSession): ParsedMessage[] {
    return session.byType.user;
  }

  /**
   * Get assistant messages from a parsed session.
   */
  getAssistantMessages(session: ParsedSession): ParsedMessage[] {
    return session.byType.assistant;
  }

  /**
   * Get messages in a time range.
   */
  getMessagesInRange(messages: ParsedMessage[], startTime: Date, endTime: Date): ParsedMessage[] {
    return messages.filter((m) => m.timestamp >= startTime && m.timestamp <= endTime);
  }

  /**
   * Get responses to a specific user message.
   * Finds all assistant messages that follow the user message until the next user message.
   */
  getResponses(messages: ParsedMessage[], userMessageUuid: string): ParsedMessage[] {
    const userMsgIndex = messages.findIndex((m) => m.uuid === userMessageUuid);
    if (userMsgIndex === -1) return [];

    const responses: ParsedMessage[] = [];

    for (let i = userMsgIndex + 1; i < messages.length; i++) {
      const msg = messages[i];

      // Stop at next user message
      if (msg.type === 'user') break;

      // Include assistant responses
      if (msg.type === 'assistant') {
        responses.push(msg);
      }
    }

    return responses;
  }

  // ===========================================================================
  // Tool Call Analysis
  // ===========================================================================

  /**
   * Get all Task (subagent) calls from messages.
   */
  getTaskCalls(messages: ParsedMessage[]): ToolCall[] {
    return getTaskCalls(messages);
  }

  /**
   * Get all tool calls of a specific type.
   */
  getToolCallsByName(messages: ParsedMessage[], toolName: string): ToolCall[] {
    return messages.flatMap((m) => m.toolCalls.filter((tc) => tc.name === toolName));
  }

  /**
   * Find the tool result for a specific tool call.
   */
  findToolResult(
    messages: ParsedMessage[],
    toolCallId: string
  ): { message: ParsedMessage; result: ToolResult } | null {
    for (const msg of messages) {
      const result = msg.toolResults.find((tr) => tr.toolUseId === toolCallId);
      if (result) {
        return { message: msg, result };
      }
    }
    return null;
  }

  // ===========================================================================
  // Timing Analysis
  // ===========================================================================

  /**
   * Get the time range of messages.
   */
  getTimeRange(messages: ParsedMessage[]): { start: Date; end: Date; durationMs: number } {
    if (messages.length === 0) {
      const now = new Date();
      return { start: now, end: now, durationMs: 0 };
    }

    const timestamps = messages.map((m) => m.timestamp.getTime());
    let min = timestamps[0];
    let max = timestamps[0];
    for (let i = 1; i < timestamps.length; i++) {
      if (timestamps[i] < min) min = timestamps[i];
      if (timestamps[i] > max) max = timestamps[i];
    }
    const start = new Date(min);
    const end = new Date(max);

    return {
      start,
      end,
      durationMs: end.getTime() - start.getTime(),
    };
  }

  /**
   * Calculate metrics for a subset of messages.
   */
  calculateMetrics(messages: ParsedMessage[]): SessionMetrics {
    return calculateMetrics(messages);
  }

  // ===========================================================================
  // Text Extraction
  // ===========================================================================

  /**
   * Extract text content from a message.
   */
  extractText(message: ParsedMessage): string {
    return extractTextContent(message);
  }

  /**
   * Get a preview of a message (first N characters).
   */
  getMessagePreview(message: ParsedMessage, maxLength: number = 100): string {
    const text = extractTextContent(message);
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
  }

  // ===========================================================================
  // Message Threading
  // ===========================================================================

  /**
   * Build a parent-child message tree.
   */
  buildMessageTree(messages: ParsedMessage[]): Map<string, ParsedMessage[]> {
    const tree = new Map<string, ParsedMessage[]>();

    for (const msg of messages) {
      const parentId = msg.parentUuid ?? 'root';
      if (!tree.has(parentId)) {
        tree.set(parentId, []);
      }
      tree.get(parentId)!.push(msg);
    }

    return tree;
  }

  /**
   * Get child messages of a specific message.
   */
  getChildMessages(messages: ParsedMessage[], parentUuid: string): ParsedMessage[] {
    return messages.filter((m) => m.parentUuid === parentUuid);
  }

  /**
   * Get the conversation thread for a message (ancestors + descendants).
   */
  getThread(messages: ParsedMessage[], messageUuid: string): ParsedMessage[] {
    const thread: ParsedMessage[] = [];
    const messageMap = new Map(messages.map((m) => [m.uuid, m]));

    // Get ancestors
    let current = messageMap.get(messageUuid);
    const ancestors: ParsedMessage[] = [];

    while (current) {
      ancestors.unshift(current);
      current = current.parentUuid ? messageMap.get(current.parentUuid) : undefined;
    }

    thread.push(...ancestors);

    // Get descendants
    const descendants = this.getDescendants(messages, messageUuid);
    // Add descendants that aren't already in thread
    for (const desc of descendants) {
      if (!thread.find((m) => m.uuid === desc.uuid)) {
        thread.push(desc);
      }
    }

    return thread;
  }

  /**
   * Get all descendants of a message.
   */
  private getDescendants(messages: ParsedMessage[], parentUuid: string): ParsedMessage[] {
    const result: ParsedMessage[] = [];
    const children = messages.filter((m) => m.parentUuid === parentUuid);

    for (const child of children) {
      result.push(child);
      result.push(...this.getDescendants(messages, child.uuid));
    }

    return result;
  }

  // ===========================================================================
  // Subagent File Parsing
  // ===========================================================================

  /**
   * Parse a subagent JSONL file.
   */
  async parseSubagentFile(filePath: string): Promise<{
    messages: ParsedMessage[];
    metrics: SessionMetrics;
  }> {
    const messages = await parseJsonlFile(filePath, this.projectScanner.getFileSystemProvider());
    const metrics = calculateMetrics(messages);

    return { messages, metrics };
  }

  /**
   * Parse all subagent files for a session.
   */
  async parseAllSubagents(
    projectId: string,
    sessionId: string
  ): Promise<
    Map<
      string,
      {
        filePath: string;
        messages: ParsedMessage[];
        metrics: SessionMetrics;
      }
    >
  > {
    const subagentFiles = await this.projectScanner.listSubagentFiles(projectId, sessionId);
    const results = new Map();

    for (const filePath of subagentFiles) {
      // Extract agent ID from filename (agent-{id}.jsonl)
      const filename = path.basename(filePath);
      const agentId = filename.replace(/^agent-/, '').replace(/\.jsonl$/, '');

      const { messages, metrics } = await this.parseSubagentFile(filePath);
      results.set(agentId, { filePath, messages, metrics });
    }

    return results;
  }
}
