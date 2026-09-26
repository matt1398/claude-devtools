import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ProjectScanner } from '../../../src/main/services/discovery/ProjectScanner';

import type { Project, SearchSessionsResult } from '../../../src/main/types';

/**
 * Tests for global search functionality across all projects
 */
describe('Global Search - ProjectScanner.searchAllProjects', () => {
  let projectScanner: ProjectScanner;
  let mockScan: ReturnType<typeof vi.fn>;
  let mockSearchSessions: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Create a real ProjectScanner instance
    projectScanner = new ProjectScanner();

    // Mock the scan() method
    mockScan = vi.fn();
    projectScanner.scan = mockScan;

    // Mock the sessionSearcher.searchSessions() method
    mockSearchSessions = vi.fn();
    // @ts-expect-error - Accessing private property for testing
    projectScanner.sessionSearcher = {
      searchSessions: mockSearchSessions,
    };
  });

  describe('searchAllProjects', () => {
    it('should return empty results for empty query', async () => {
      const result = await projectScanner.searchAllProjects('', 50);

      expect(result.results).toEqual([]);
      expect(result.totalMatches).toBe(0);
      expect(result.sessionsSearched).toBe(0);
      expect(mockScan).not.toHaveBeenCalled();
    });

    it('should return empty results for whitespace query', async () => {
      const result = await projectScanner.searchAllProjects('   ', 50);

      expect(result.results).toEqual([]);
      expect(result.totalMatches).toBe(0);
      expect(result.sessionsSearched).toBe(0);
      expect(mockScan).not.toHaveBeenCalled();
    });

    it('should return empty results when no projects exist', async () => {
      mockScan.mockResolvedValue([]);

      const result = await projectScanner.searchAllProjects('test', 50);

      expect(result.results).toEqual([]);
      expect(result.totalMatches).toBe(0);
      expect(result.sessionsSearched).toBe(0);
      expect(mockScan).toHaveBeenCalledOnce();
    });

    it('should search across multiple projects and merge results', async () => {
      const now = Date.now();

      // Mock scan() to return 2 projects
      const mockProjects: Project[] = [
        {
          id: 'project1',
          path: '/path/to/project1',
          name: 'Project 1',
          sessions: ['session1'],
          createdAt: now - 10000,
          mostRecentSession: now,
        },
        {
          id: 'project2',
          path: '/path/to/project2',
          name: 'Project 2',
          sessions: ['session2'],
          createdAt: now - 20000,
          mostRecentSession: now - 1000,
        },
      ];
      mockScan.mockResolvedValue(mockProjects);

      // Mock searchSessions() to return different results for each project
      mockSearchSessions.mockImplementation((projectId: string) => {
        if (projectId === 'project1') {
          return Promise.resolve({
            results: [
              {
                projectId: 'project1',
                sessionId: 'session1',
                sessionTitle: 'Test Session 1',
                context: 'This is a test message',
                matchedText: 'test',
                messageType: 'user' as const,
                timestamp: now,
                groupId: 'group1',
                matchIndexInItem: 0,
                matchStartOffset: 10,
                messageUuid: 'uuid1',
              },
            ],
            totalMatches: 1,
            sessionsSearched: 5,
            query: 'test',
          } satisfies SearchSessionsResult);
        } else {
          return Promise.resolve({
            results: [
              {
                projectId: 'project2',
                sessionId: 'session2',
                sessionTitle: 'Test Session 2',
                context: 'Another test message',
                matchedText: 'test',
                messageType: 'assistant' as const,
                timestamp: now - 1000,
                groupId: 'group2',
                matchIndexInItem: 0,
                matchStartOffset: 8,
                messageUuid: 'uuid2',
              },
            ],
            totalMatches: 1,
            sessionsSearched: 3,
            query: 'test',
          } satisfies SearchSessionsResult);
        }
      });

      const result = await projectScanner.searchAllProjects('test', 50);

      expect(mockScan).toHaveBeenCalledOnce();
      expect(mockSearchSessions).toHaveBeenCalledTimes(2);
      expect(mockSearchSessions).toHaveBeenCalledWith('project1', 'test', 50, false);
      expect(mockSearchSessions).toHaveBeenCalledWith('project2', 'test', 50, false);

      expect(result.results).toHaveLength(2);
      expect(result.totalMatches).toBe(2);
      expect(result.sessionsSearched).toBe(8); // 5 + 3

      // Verify results from different projects
      expect(result.results[0].projectId).toBe('project1');
      expect(result.results[1].projectId).toBe('project2');
    });

    it('should rank fuzzy results across every project before limiting', async () => {
      const now = Date.now();
      const mockProjects: Project[] = Array.from({ length: 9 }, (_, i) => ({
        id: `project${i}`,
        path: `/path/to/project${i}`,
        name: `Project ${i}`,
        sessions: [`session${i}`],
        createdAt: now - i,
      }));
      mockScan.mockResolvedValue(mockProjects);
      mockSearchSessions.mockImplementation((projectId: string) => {
        const isBestMatch = projectId === 'project8';
        return Promise.resolve({
          results: [
            {
              projectId,
              sessionId: projectId,
              sessionTitle: projectId,
              context: 'authentication',
              matchedText: 'authentication',
              messageType: 'user' as const,
              timestamp: isBestMatch ? now - 10_000 : now,
              matchScore: isBestMatch ? 0.01 : 0.5,
            },
          ],
          totalMatches: 1,
          sessionsSearched: 1,
          query: 'authentication',
        } satisfies SearchSessionsResult);
      });

      const result = await projectScanner.searchAllProjects('authentication', 1, true);

      expect(mockSearchSessions).toHaveBeenCalledTimes(9);
      expect(mockSearchSessions).toHaveBeenCalledWith('project8', 'authentication', 1, true);
      expect(result.results).toHaveLength(1);
      expect(result.results[0].projectId).toBe('project8');
    });

    it('should sort results by timestamp (most recent first)', async () => {
      const now = Date.now();

      const mockProjects: Project[] = [
        {
          id: 'project1',
          path: '/path/to/project1',
          name: 'Project 1',
          sessions: ['session1'],
          createdAt: now - 10000,
        },
        {
          id: 'project2',
          path: '/path/to/project2',
          name: 'Project 2',
          sessions: ['session2'],
          createdAt: now - 20000,
        },
      ];
      mockScan.mockResolvedValue(mockProjects);

      // Project1 has older result, Project2 has newer result
      mockSearchSessions.mockImplementation((projectId: string) => {
        if (projectId === 'project1') {
          return Promise.resolve({
            results: [
              {
                projectId: 'project1',
                sessionId: 'session1',
                sessionTitle: 'Old Session',
                context: 'test',
                matchedText: 'test',
                messageType: 'user' as const,
                timestamp: now - 10000, // Older
                groupId: 'group1',
                matchIndexInItem: 0,
                matchStartOffset: 0,
                messageUuid: 'uuid1',
              },
            ],
            totalMatches: 1,
            sessionsSearched: 5,
            query: 'test',
          } satisfies SearchSessionsResult);
        } else {
          return Promise.resolve({
            results: [
              {
                projectId: 'project2',
                sessionId: 'session2',
                sessionTitle: 'New Session',
                context: 'test',
                matchedText: 'test',
                messageType: 'user' as const,
                timestamp: now, // Newer
                groupId: 'group2',
                matchIndexInItem: 0,
                matchStartOffset: 0,
                messageUuid: 'uuid2',
              },
            ],
            totalMatches: 1,
            sessionsSearched: 3,
            query: 'test',
          } satisfies SearchSessionsResult);
        }
      });

      const result = await projectScanner.searchAllProjects('test', 50);

      // Should be sorted newest first
      expect(result.results[0].sessionTitle).toBe('New Session');
      expect(result.results[1].sessionTitle).toBe('Old Session');
      expect(result.results[0].timestamp).toBeGreaterThan(result.results[1].timestamp);
    });

    it('should respect maxResults limit', async () => {
      const now = Date.now();

      const mockProjects: Project[] = [
        {
          id: 'project1',
          path: '/path/to/project1',
          name: 'Project 1',
          sessions: ['session1'],
          createdAt: now,
        },
      ];
      mockScan.mockResolvedValue(mockProjects);

      // Return 30 results from search
      const mockResults = Array.from({ length: 30 }, (_, i) => ({
        projectId: 'project1',
        sessionId: `session${i}`,
        sessionTitle: `Session ${i}`,
        context: 'test context',
        matchedText: 'test',
        messageType: 'user' as const,
        timestamp: now - i * 1000,
        groupId: `group${i}`,
        matchIndexInItem: 0,
        matchStartOffset: 0,
        messageUuid: `uuid${i}`,
      }));

      mockSearchSessions.mockResolvedValue({
        results: mockResults,
        totalMatches: 30,
        sessionsSearched: 50,
        query: 'test',
      } satisfies SearchSessionsResult);

      const result = await projectScanner.searchAllProjects('test', 25);

      expect(result.results.length).toBe(25); // Limited to maxResults
      expect(mockSearchSessions).toHaveBeenCalledWith('project1', 'test', 25, false);
    });

    it('should handle search errors gracefully', async () => {
      const now = Date.now();

      const mockProjects: Project[] = [
        {
          id: 'project1',
          path: '/path/to/project1',
          name: 'Project 1',
          sessions: ['session1'],
          createdAt: now,
        },
        {
          id: 'project2',
          path: '/path/to/project2',
          name: 'Project 2',
          sessions: ['session2'],
          createdAt: now - 1000,
        },
      ];
      mockScan.mockResolvedValue(mockProjects);

      // First project fails, second succeeds
      mockSearchSessions.mockImplementation((projectId: string) => {
        if (projectId === 'project1') {
          return Promise.reject(new Error('Search failed'));
        } else {
          return Promise.resolve({
            results: [
              {
                projectId: 'project2',
                sessionId: 'session2',
                sessionTitle: 'Test Session 2',
                context: 'test',
                matchedText: 'test',
                messageType: 'user' as const,
                timestamp: now,
                groupId: 'group2',
                matchIndexInItem: 0,
                matchStartOffset: 0,
                messageUuid: 'uuid2',
              },
            ],
            totalMatches: 1,
            sessionsSearched: 3,
            query: 'test',
          } satisfies SearchSessionsResult);
        }
      });

      const result = await projectScanner.searchAllProjects('test', 50);

      // Should still return results from successful project
      expect(result.results).toHaveLength(1);
      expect(result.results[0].projectId).toBe('project2');
      expect(result.totalMatches).toBe(1);
      expect(result.sessionsSearched).toBe(3);
    });

    it('should use batched concurrency for local FS', async () => {
      const now = Date.now();

      // Create 10 projects to test batching (local uses batch size 4)
      const mockProjects: Project[] = Array.from({ length: 10 }, (_, i) => ({
        id: `project${i}`,
        path: `/path/to/project${i}`,
        name: `Project ${i}`,
        sessions: [`session${i}`],
        createdAt: now - i * 1000,
      }));
      mockScan.mockResolvedValue(mockProjects);

      // Track call order to verify batching
      const callOrder: string[] = [];
      mockSearchSessions.mockImplementation((projectId: string) => {
        callOrder.push(projectId);
        return Promise.resolve({
          results: [],
          totalMatches: 0,
          sessionsSearched: 1,
          query: 'test',
        } satisfies SearchSessionsResult);
      });

      await projectScanner.searchAllProjects('test', 50);

      // All 10 projects should be searched
      expect(mockSearchSessions).toHaveBeenCalledTimes(10);
      expect(callOrder).toHaveLength(10);
    });

    it('should stop searching when enough results are found', async () => {
      const now = Date.now();

      // Create 10 projects
      const mockProjects: Project[] = Array.from({ length: 10 }, (_, i) => ({
        id: `project${i}`,
        path: `/path/to/project${i}`,
        name: `Project ${i}`,
        sessions: [`session${i}`],
        createdAt: now - i * 1000,
      }));
      mockScan.mockResolvedValue(mockProjects);

      // Each project returns 10 results (total would be 100)
      mockSearchSessions.mockImplementation((projectId: string) => {
        const results = Array.from({ length: 10 }, (_, i) => ({
          projectId,
          sessionId: `session${i}`,
          sessionTitle: `Session ${i}`,
          context: 'test',
          matchedText: 'test',
          messageType: 'user' as const,
          timestamp: now - i * 1000,
          groupId: `group${i}`,
          matchIndexInItem: 0,
          matchStartOffset: 0,
          messageUuid: `uuid${i}`,
        }));

        return Promise.resolve({
          results,
          totalMatches: 10,
          sessionsSearched: 1,
          query: 'test',
        } satisfies SearchSessionsResult);
      });

      const result = await projectScanner.searchAllProjects('test', 50);

      // Should stop after getting enough results (checks after each batch of 4)
      // Batch 1 (4 projects): 40 matches < 50, continue
      // Batch 2 (4 projects): 80 matches >= 50, stop
      expect(mockSearchSessions.mock.calls.length).toBeGreaterThanOrEqual(4);
      expect(mockSearchSessions.mock.calls.length).toBeLessThanOrEqual(8);

      // Result should be limited to maxResults
      expect(result.results.length).toBe(50);
    });
  });
});
