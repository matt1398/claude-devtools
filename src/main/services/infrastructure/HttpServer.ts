/**
 * HttpServer - Fastify-based HTTP server for serving the renderer UI and API routes.
 *
 * Binds to 127.0.0.1 only for localhost security.
 * Dynamically allocates a port starting from 3456.
 * In production, serves static files from the renderer output directory.
 * In development, Vite dev server handles static files.
 */

import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { type HttpServices, registerHttpRoutes } from '@main/http';
import { broadcastEvent } from '@main/http/events';
import { createLogger } from '@shared/utils/logger';
import Fastify, { type FastifyInstance } from 'fastify';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const logger = createLogger('Service:HttpServer');

/**
 * Resolves the renderer output directory from multiple candidate paths.
 * Returns the first path that exists on disk.
 */
function resolveRendererPath(): string | null {
  const candidates = [
    // Electron production paths
    join(__dirname, '../../../out/renderer'),
    join(__dirname, '../../renderer'),
    // Standalone: dist-standalone/index.cjs → ../out/renderer
    join(__dirname, '../out/renderer'),
    // Fallback: relative to cwd (for standalone bundles)
    join(process.cwd(), 'out/renderer'),
  ];

  // Allow explicit override via env
  if (process.env.RENDERER_PATH) {
    candidates.unshift(process.env.RENDERER_PATH);
  }

  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

export class HttpServer {
  private app: FastifyInstance | null = null;
  private port: number = 3456;
  private running: boolean = false;

  /**
   * Start the HTTP server.
   * @param services - Service instances to pass to route handlers
   * @param sshModeSwitchCallback - Callback for SSH mode switching
   * @param preferredPort - Port to try first (default 3456)
   * @param host - Host to bind to (default '127.0.0.1')
   */
  async start(
    services: HttpServices,
    sshModeSwitchCallback: (mode: 'local' | 'ssh') => Promise<void>,
    preferredPort: number = 3456,
    host: string = '127.0.0.1'
  ): Promise<number> {
    this.app = Fastify({ logger: false });

    // Register CORS
    const corsOrigin = process.env.CORS_ORIGIN;
    if (corsOrigin === '*') {
      // Standalone/Docker mode: allow all origins (Docker network isolation replaces CORS)
      await this.app.register(cors, { origin: true, credentials: true });
    } else if (corsOrigin) {
      // Custom origin(s) from env
      const origins = corsOrigin.split(',').map((o) => o.trim());
      await this.app.register(cors, { origin: origins, credentials: true });
    } else {
      // Default: allow all localhost origins
      const localhostPattern = /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/;
      await this.app.register(cors, {
        origin: (origin, cb) => {
          if (!origin) {
            cb(null, true);
            return;
          }
          if (localhostPattern.test(origin)) {
            cb(null, true);
            return;
          }
          cb(new Error('Not allowed by CORS'), false);
        },
        credentials: true,
      });
    }

    // Register static file serving and SPA fallback (production only)
    const isDev = process.env.NODE_ENV === 'development';
    if (!isDev) {
      const rendererPath = resolveRendererPath();
      if (rendererPath) {
        logger.info(`Serving static files from: ${rendererPath}`);

        // Cache index.html for SPA fallback
        const indexHtml = readFileSync(join(rendererPath, 'index.html'), 'utf-8');

        await this.app.register(fastifyStatic, {
          root: rendererPath,
          prefix: '/',
          wildcard: false,
        });

        // Register all API routes BEFORE the not-found handler
        registerHttpRoutes(this.app, services, sshModeSwitchCallback);

        // SPA fallback: serve index.html for all non-API routes
        this.app.setNotFoundHandler(async (request, reply) => {
          if (request.url.startsWith('/api/')) {
            return reply.status(404).send({ error: 'Not found' });
          }
          return reply.type('text/html').send(indexHtml);
        });
      } else {
        logger.warn('Renderer output directory not found, serving API only');
        registerHttpRoutes(this.app, services, sshModeSwitchCallback);
      }
    } else {
      // Dev mode: no static serving, just API routes
      registerHttpRoutes(this.app, services, sshModeSwitchCallback);
    }

    // Try ports starting from preferredPort
    for (let attempt = 0; attempt <= 10; attempt++) {
      const tryPort = preferredPort + attempt;
      try {
        await this.app.listen({ host, port: tryPort });
        this.port = tryPort;
        this.running = true;
        logger.info(`HTTP server started on http://${host}:${tryPort}`);
        return tryPort;
      } catch (err: unknown) {
        const error = err as NodeJS.ErrnoException;
        if (error.code === 'EADDRINUSE') {
          logger.info(`Port ${tryPort} in use, trying next...`);
          continue;
        }
        throw err;
      }
    }

    throw new Error(`Could not find available port (tried ${preferredPort}-${preferredPort + 10})`);
  }

  /**
   * Stop the HTTP server gracefully.
   */
  async stop(): Promise<void> {
    if (this.app && this.running) {
      await this.app.close();
      this.running = false;
      this.app = null;
      logger.info('HTTP server stopped');
    }
  }

  /**
   * Broadcast an event to all connected SSE clients.
   */
  broadcast(channel: string, data: unknown): void {
    broadcastEvent(channel, data);
  }

  /**
   * Get the current port the server is running on.
   */
  getPort(): number {
    return this.port;
  }

  /**
   * Check if the server is currently running.
   */
  isRunning(): boolean {
    return this.running;
  }
}
