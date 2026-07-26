/**
 * HTTP Route Registration Orchestrator.
 *
 * Registers all domain-specific route handlers on a Fastify instance.
 * Each route file mirrors the corresponding IPC handler.
 */

import { createLogger } from '@shared/utils/logger';

import { registerConfigRoutes } from './config';
import { registerEventRoutes } from './events';
import { registerMemoryRoutes } from './memory';
import { registerNotificationRoutes } from './notifications';
import { registerProjectRoutes } from './projects';
import { registerSearchRoutes } from './search';
import { registerSessionRoutes } from './sessions';
import { registerSshRoutes } from './ssh';
import { registerSubagentRoutes } from './subagents';
import { registerUpdaterRoutes } from './updater';
import { registerUsageRoutes } from './usage';
import { registerUtilityRoutes } from './utility';
import { registerValidationRoutes } from './validation';

import type {
  ChunkBuilder,
  DataCache,
  MemoryReader,
  ProjectScanner,
  SessionParser,
  SubagentResolver,
  UpdaterService,
} from '../services';
import type { SshConnectionManager } from '../services/infrastructure/SshConnectionManager';
import type { SessionTailer } from '../services/streaming/SessionTailer';
import type { FastifyInstance } from 'fastify';

const logger = createLogger('HTTP:routes');

export interface HttpServices {
  projectScanner: ProjectScanner;
  sessionParser: SessionParser;
  subagentResolver: SubagentResolver;
  chunkBuilder: ChunkBuilder;
  dataCache: DataCache;
  memoryReader: MemoryReader;
  updaterService: UpdaterService;
  sshConnectionManager: SshConnectionManager;
  /**
   * Streams appended session content as `session-append` deltas. The session-detail
   * route registers a baseline offset here so streaming starts where the load ended.
   * Optional so alternate service assemblies (tests) can omit it.
   */
  sessionTailer?: SessionTailer;
}

export function registerHttpRoutes(
  app: FastifyInstance,
  services: HttpServices,
  sshModeSwitchCallback: (mode: 'local' | 'ssh') => Promise<void>
): void {
  registerProjectRoutes(app, services);
  registerSessionRoutes(app, services);
  registerSearchRoutes(app, services);
  registerSubagentRoutes(app, services);
  registerNotificationRoutes(app);
  registerConfigRoutes(app);
  registerValidationRoutes(app);
  registerUtilityRoutes(app);
  registerUsageRoutes(app);
  registerSshRoutes(app, services.sshConnectionManager, sshModeSwitchCallback);
  registerUpdaterRoutes(app, services);
  registerMemoryRoutes(app, services);
  registerEventRoutes(app);

  logger.info('All HTTP routes registered');
}
