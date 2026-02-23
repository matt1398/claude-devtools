/**
 * SessionSearcher - Searches sessions for query strings.
 *
 * Responsibilities:
 * - Search across sessions in a project
 * - Search within a single session file
 * - Restrict matching scope to User text + AI last text output
 * - Extract context around each match occurrence
 *
 * Uses SearchTextExtractor for lightweight text extraction (skips ChunkBuilder)
 * and SearchTextCache for mtime-based caching of extracted entries.
 */

import { LocalFileSystemProvider } from '@main/services/infrastructure/LocalFileSystemProvider';
import { parseJsonlFile } from '@main/utils/jsonl';
import { extractBaseDir, extractSessionId } from '@main/utils/pathDecoder';
import { createLogger } from '@shared/utils/logger';
import {
  extractMarkdownPlainText,
  findMarkdownSearchMatches,
} from '@shared/utils/markdownTextSearch';
import * as path from 'path';

import { SearchTextCache } from './SearchTextCache';
import { extractSearchableEntries } from './SearchTextExtractor';
import { subprojectRegistry } from './SubprojectRegistry';

import type { SearchableEntry } from './SearchTextExtractor';
import type { FileSystemProvider } from '@main/services/infrastructure/FileSystemProvider';
import type { SearchResult, SearchSessionsResult } from '@main/types';

const logger = createLogger('Discovery:SessionSearcher');
const SSH_FAST_SEARCH_STAGE_LIMITS = [40, 140, 320] as const;
const SSH_FAST_SEARCH_MIN_RESULTS = 8;
const SSH_FAST_SEARCH_TIME_BUDGET_MS = 4500;

/**
 * SessionSearcher provides methods for searching sessions.
 */
export class SessionSearcher {
  private readonly projectsDir: string;
  private readonly fsProvider: FileSystemProvider;
  private readonly searchCache: SearchTextCache;

  constructor(projectsDir: string, fsProvider?: FileSystemProvider) {
    this.projectsDir = projectsDir;
    this.fsProvider = fsProvider ?? new LocalFileSystemProvider();
    this.searchCache = new SearchTextCache();
  }

  /**
   * Searches sessions in a project for a query string.
   * Filters out noise messages and returns matching content.
   *
   * @param projectId - The project ID to search in
   * @param query - Search query string
   * @param maxResults - Maximum number of results to return (default 50)
   * @returns Search results with matches and metadata
   */
  async searchSessions(
    projectId: string,
    query: string,
    maxResults: number = 50
  ): Promise<SearchSessionsResult> {
    const startedAt = Date.now();
    const results: SearchResult[] = [];
    let sessionsSearched = 0;
    const fastMode = this.fsProvider.type === 'ssh';
    let isPartial = false;

    if (!query || query.trim().length === 0) {
      return { results: [], totalMatches: 0, sessionsSearched: 0, query };
    }

    const normalizedQuery = query.toLowerCase().trim();

    try {
      const baseDir = extractBaseDir(projectId);
      const projectPath = path.join(this.projectsDir, baseDir);
      const sessionFilter = subprojectRegistry.getSessionFilter(projectId);

      if (!(await this.fsProvider.exists(projectPath))) {
        return { results: [], totalMatches: 0, sessionsSearched: 0, query };
      }

      // Get all session files
      const entries = await this.fsProvider.readdir(projectPath);
      const sessionEntries = entries.filter((entry) => {
        if (!entry.isFile() || !entry.name.endsWith('.jsonl')) return false;
        // Filter to only sessions belonging to this subproject
        if (sessionFilter) {
          const sessionId = extractSessionId(entry.name);
          return sessionFilter.has(sessionId);
        }
        return true;
      });
      const sessionFiles = await this.collectFulfilledInBatches(
        sessionEntries,
        this.fsProvider.type === 'ssh' ? 24 : 128,
        async (entry) => {
          const filePath = path.join(projectPath, entry.name);
          const mtimeMs =
            typeof entry.mtimeMs === 'number'
              ? entry.mtimeMs
              : (await this.fsProvider.stat(filePath)).mtimeMs;
          return { name: entry.name, filePath, mtimeMs };
        }
      );
      sessionFiles.sort((a, b) => b.mtimeMs - a.mtimeMs);

      // Search session files with bounded concurrency and staged breadth in SSH mode.
      const searchBatchSize = fastMode ? 3 : 8;
      const stageBoundaries = fastMode
        ? this.buildFastSearchStageBoundaries(sessionFiles.length)
        : [sessionFiles.length];
      let searchedUntil = 0;
      let shouldStop = false;

      for (const stageBoundary of stageBoundaries) {
        for (
          let i = searchedUntil;
          i < stageBoundary && results.length < maxResults;
          i += searchBatchSize
        ) {
          if (fastMode && Date.now() - startedAt >= SSH_FAST_SEARCH_TIME_BUDGET_MS) {
            isPartial = true;
            shouldStop = true;
            break;
          }

          const batch = sessionFiles.slice(i, i + searchBatchSize);
          sessionsSearched += batch.length;

          const settled = await Promise.allSettled(
            batch.map(async (file) => {
              const sessionId = extractSessionId(file.name);
              return this.searchSessionFile(
                projectId,
                sessionId,
                file.filePath,
                normalizedQuery,
                maxResults,
                file.mtimeMs
              );
            })
          );

          for (const result of settled) {
            if (results.length >= maxResults) {
              break;
            }
            if (result.status !== 'fulfilled' || result.value.length === 0) {
              continue;
            }

            const remaining = maxResults - results.length;
            results.push(...result.value.slice(0, remaining));
          }
        }

        searchedUntil = stageBoundary;

        if (shouldStop || !fastMode || results.length >= maxResults) {
          break;
        }

        if (stageBoundary < sessionFiles.length && results.length >= SSH_FAST_SEARCH_MIN_RESULTS) {
          isPartial = true;
          break;
        }
      }

      if (fastMode && results.length < maxResults && sessionsSearched < sessionFiles.length) {
        isPartial = true;
      }

      if (fastMode) {
        logger.debug(
          `SSH fast search scanned ${sessionsSearched}/${sessionFiles.length} sessions in ${Date.now() - startedAt}ms (results=${results.length}, partial=${isPartial})`
        );
      }

      return {
        results,
        totalMatches: results.length,
        sessionsSearched,
        query,
        isPartial: fastMode ? isPartial : undefined,
      };
    } catch (error) {
      logger.error(`Error searching sessions for project ${projectId}:`, error);
      return { results: [], totalMatches: 0, sessionsSearched: 0, query };
    }
  }

  /**
   * Searches a single session file for a query string.
   *
   * Uses SearchTextExtractor for lightweight text extraction (no ChunkBuilder)
   * and SearchTextCache for mtime-based caching.
   *
   * @param projectId - The project ID
   * @param sessionId - The session ID
   * @param filePath - Path to the session file
   * @param query - Normalized search query (lowercase)
   * @param maxResults - Maximum number of results to return
   * @param mtimeMs - File modification time for cache invalidation
   * @returns Array of search results
   */
  async searchSessionFile(
    projectId: string,
    sessionId: string,
    filePath: string,
    query: string,
    maxResults: number,
    mtimeMs: number
  ): Promise<SearchResult[]> {
    const results: SearchResult[] = [];

    // Check cache first
    let cached = this.searchCache.get(filePath, mtimeMs);
    if (!cached) {
      // Cache miss — parse and extract
      const messages = await parseJsonlFile(filePath, this.fsProvider);
      const extracted = extractSearchableEntries(messages);
      this.searchCache.set(filePath, mtimeMs, extracted.entries, extracted.sessionTitle);
      cached = extracted;
    }

    const { entries, sessionTitle } = cached;

    for (const entry of entries) {
      if (results.length >= maxResults) break;

      this.collectMatchesForEntry(
        entry,
        query,
        results,
        maxResults,
        projectId,
        sessionId,
        sessionTitle
      );
    }

    return results;
  }

  private collectMatchesForEntry(
    entry: SearchableEntry,
    query: string,
    results: SearchResult[],
    maxResults: number,
    projectId: string,
    sessionId: string,
    sessionTitle?: string
  ): void {
    const mdMatches = findMarkdownSearchMatches(entry.text, query);
    if (mdMatches.length === 0) return;

    // Build plain text once for context snippet extraction
    const plainText = extractMarkdownPlainText(entry.text);
    const lowerPlain = plainText.toLowerCase();

    for (const mdMatch of mdMatches) {
      if (results.length >= maxResults) return;

      // Find approximate position in plain text for context extraction
      let pos = 0;
      for (let i = 0; i < mdMatch.matchIndexInItem; i++) {
        const idx = lowerPlain.indexOf(query, pos);
        if (idx === -1) break;
        pos = idx + query.length;
      }
      const matchPos = lowerPlain.indexOf(query, pos);
      const effectivePos = matchPos >= 0 ? matchPos : 0;

      const contextStart = Math.max(0, effectivePos - 50);
      const contextEnd = Math.min(plainText.length, effectivePos + query.length + 50);
      const context = plainText.slice(contextStart, contextEnd);
      const matchedText =
        matchPos >= 0 ? plainText.slice(matchPos, matchPos + query.length) : query;

      results.push({
        sessionId,
        projectId,
        sessionTitle: sessionTitle ?? 'Untitled Session',
        matchedText,
        context:
          (contextStart > 0 ? '...' : '') + context + (contextEnd < plainText.length ? '...' : ''),
        messageType: entry.messageType,
        timestamp: entry.timestamp,
        groupId: entry.groupId,
        itemType: entry.itemType,
        matchIndexInItem: mdMatch.matchIndexInItem,
        matchStartOffset: effectivePos,
        messageUuid: entry.messageUuid,
      });
    }
  }

  private async collectFulfilledInBatches<T, R>(
    items: T[],
    batchSize: number,
    mapper: (item: T) => Promise<R>
  ): Promise<R[]> {
    const safeBatchSize = Math.max(1, batchSize);
    const results: R[] = [];

    for (let i = 0; i < items.length; i += safeBatchSize) {
      const batch = items.slice(i, i + safeBatchSize);
      const settled = await Promise.allSettled(batch.map((item) => mapper(item)));
      for (const result of settled) {
        if (result.status === 'fulfilled') {
          results.push(result.value);
        }
      }
    }

    return results;
  }

  private buildFastSearchStageBoundaries(totalFiles: number): number[] {
    if (totalFiles <= 0) {
      return [];
    }

    const boundaries: number[] = [];
    for (const limit of SSH_FAST_SEARCH_STAGE_LIMITS) {
      const boundary = Math.min(totalFiles, limit);
      if (boundaries.length === 0 || boundary > boundaries[boundaries.length - 1]) {
        boundaries.push(boundary);
      }
    }

    if (boundaries.length === 0) {
      boundaries.push(totalFiles);
    }

    return boundaries;
  }
}
