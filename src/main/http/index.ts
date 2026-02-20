/**
 * HTTP Route Registration Orchestrator.
 *
 * Registers all domain-specific route handlers on a Fastify instance.
 * Each route file mirrors the corresponding IPC handler.
 */

import { createLogger } from '@shared/utils/logger';

import { registerConfigRoutes } from './config';
import { registerContextRoutes } from './contexts';
import { registerEventRoutes } from './events';
import { registerNotificationRoutes } from './notifications';
import { registerProjectRoutes } from './projects';
import { registerSearchRoutes } from './search';
import { registerSessionRoutes } from './sessions';
import { registerSshRoutes } from './ssh';
import { registerSubagentRoutes } from './subagents';
import { registerUpdaterRoutes } from './updater';
import { registerUtilityRoutes } from './utility';
import { registerValidationRoutes } from './validation';

import type {
  ChunkBuilder,
  DataCache,
  ProjectScanner,
  ServiceContext,
  ServiceContextRegistry,
  SessionParser,
  SubagentResolver,
  UpdaterService,
} from '../services';
import type { SshConnectionManager } from '../services/infrastructure/SshConnectionManager';
import type { CombinedWatcherManager } from '../utils/combinedWatcherManager';
import type { DataRoot } from '@shared/types';
import type { FastifyInstance } from 'fastify';

const logger = createLogger('HTTP:routes');

export interface HttpServices {
  projectScanner: ProjectScanner;
  sessionParser: SessionParser;
  subagentResolver: SubagentResolver;
  chunkBuilder: ChunkBuilder;
  dataCache: DataCache;
  contextRegistry: ServiceContextRegistry;
  updaterService: UpdaterService;
  sshConnectionManager: SshConnectionManager;
}

interface RootLifecycleCallbacks {
  onRootAdded?: (root: DataRoot) => Promise<void> | void;
  onRootUpdated?: (root: DataRoot) => Promise<void> | void;
  onRootRemoved?: (rootId: string) => Promise<void> | void;
  onRootActivated?: (rootId: string) => Promise<void> | void;
}

interface RegisterHttpRouteOptions {
  mode?: 'electron' | 'standalone';
  rootLifecycleCallbacks?: RootLifecycleCallbacks;
  onClaudeRootPathUpdated?: (claudeRootPath: string | null) => Promise<void> | void;
  onContextSwitched?: (context: ServiceContext) => void;
  onSetCombinedWatchers?: (enabled: boolean) => void;
  combinedWatcherManager?: CombinedWatcherManager;
}

export function registerHttpRoutes(
  app: FastifyInstance,
  services: HttpServices,
  sshModeSwitchCallback: (mode: 'local' | 'ssh') => Promise<void>,
  options: RegisterHttpRouteOptions = {}
): void {
  const mode = options.mode ?? 'electron';

  registerProjectRoutes(app, services);
  registerSessionRoutes(app, services, options.combinedWatcherManager);
  registerSearchRoutes(app, services);
  registerSubagentRoutes(app, services);
  registerNotificationRoutes(app);
  registerConfigRoutes(app, {
    mode,
    rootLifecycleCallbacks: options.rootLifecycleCallbacks,
    onClaudeRootPathUpdated: options.onClaudeRootPathUpdated,
  });
  registerContextRoutes(
    app,
    services.contextRegistry,
    options.onContextSwitched,
    options.onSetCombinedWatchers
  );
  registerValidationRoutes(app);
  registerUtilityRoutes(app);
  registerSshRoutes(
    app,
    services.sshConnectionManager,
    services.contextRegistry,
    sshModeSwitchCallback,
    options.onContextSwitched
  );
  registerUpdaterRoutes(app, services);
  registerEventRoutes(app);

  logger.info('All HTTP routes registered');
}
