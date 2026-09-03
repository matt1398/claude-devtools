/**
 * HTTP route handlers for Search Operations.
 *
 * Routes:
 * - GET /api/projects/:projectId/search - Search sessions in a project
 */

import { createLogger } from '@shared/utils/logger';
import { isSessionIdFragment } from '@shared/utils/sessionIdValidator';

import {
  coerceSearchMaxResults,
  validateProjectId,
  validateSearchQuery,
  validateSessionId,
} from '../ipc/guards';

import type { HttpServices } from './index';
import type { FastifyInstance } from 'fastify';

const logger = createLogger('HTTP:search');

export function registerSearchRoutes(app: FastifyInstance, services: HttpServices): void {
  app.get<{
    Params: { projectId: string };
    Querystring: { q?: string; maxResults?: string; fuzzy?: string };
  }>('/api/projects/:projectId/search', async (request) => {
    const query = request.query.q ?? '';

    try {
      const validatedProject = validateProjectId(request.params.projectId);
      const validatedQuery = validateSearchQuery(query);
      if (!validatedProject.valid || !validatedQuery.valid) {
        logger.error(
          `GET search rejected: ${validatedProject.error ?? validatedQuery.error ?? 'Invalid inputs'}`
        );
        return { results: [], totalMatches: 0, sessionsSearched: 0, query };
      }

      const maxResults = coerceSearchMaxResults(
        request.query.maxResults ? Number(request.query.maxResults) : undefined,
        50
      );

      const result = await services.projectScanner.searchSessions(
        validatedProject.value!,
        validatedQuery.value!,
        maxResults,
        request.query.fuzzy === '1' || request.query.fuzzy === 'true'
      );
      return result;
    } catch (error) {
      logger.error(`Error in GET search for ${request.params.projectId}:`, error);
      return { results: [], totalMatches: 0, sessionsSearched: 0, query };
    }
  });

  app.get<{
    Querystring: { q?: string; maxResults?: string; fuzzy?: string };
  }>('/api/search', async (request) => {
    const query = request.query.q ?? '';

    try {
      const validatedQuery = validateSearchQuery(query);
      if (!validatedQuery.valid) {
        logger.error(`GET global search rejected: ${validatedQuery.error ?? 'Invalid query'}`);
        return { results: [], totalMatches: 0, sessionsSearched: 0, query };
      }

      const maxResults = coerceSearchMaxResults(
        request.query.maxResults ? Number(request.query.maxResults) : undefined,
        50
      );

      const result = await services.projectScanner.searchAllProjects(
        validatedQuery.value!,
        maxResults,
        request.query.fuzzy === '1' || request.query.fuzzy === 'true'
      );
      return result;
    } catch (error) {
      logger.error('Error in GET global search:', error);
      return { results: [], totalMatches: 0, sessionsSearched: 0, query };
    }
  });

  app.get<{
    Params: { sessionId: string };
  }>('/api/sessions/:sessionId/locate', async (request) => {
    try {
      const validated = validateSessionId(request.params.sessionId);
      if (!validated.valid) {
        logger.error(`GET locate session rejected: ${validated.error ?? 'Invalid sessionId'}`);
        return { found: false };
      }

      return await services.projectScanner.findSessionById(validated.value!);
    } catch (error) {
      logger.error(`Error in GET locate session ${request.params.sessionId}:`, error);
      return { found: false };
    }
  });

  app.get<{
    Params: { fragment: string };
  }>('/api/sessions/search-by-id/:fragment', async (request) => {
    try {
      const fragment = request.params.fragment;
      if (!fragment || !isSessionIdFragment(fragment)) {
        logger.error('GET search-by-id rejected: invalid fragment');
        return { found: false, results: [] };
      }

      return await services.projectScanner.findSessionsByPartialId(fragment);
    } catch (error) {
      logger.error(`Error in GET search-by-id ${request.params.fragment}:`, error);
      return { found: false, results: [] };
    }
  });
}
