/**
 * SessionParserPool - Single worker manager with request queuing and timeout.
 *
 * Dispatches session-parsing work to a Worker Thread so the main Electron
 * process stays responsive during large JSONL file processing.
 */

import { createLogger } from '@shared/utils/logger';
import { join } from 'path';
import { Worker } from 'worker_threads';

import type { WorkerRequest } from './sessionParseWorker';
import type { SessionDetail } from '@main/types';

const logger = createLogger('Workers:SessionParserPool');

interface PendingRequest {
  resolve: (value: SessionDetail) => void;
  reject: (reason: Error) => void;
  timer: NodeJS.Timeout;
}

export class SessionParserPool {
  private worker: Worker | null = null;
  private pending = new Map<string, PendingRequest>();
  private requestCounter = 0;
  private readonly timeoutMs = 30_000;

  /**
   * Parse a session in the worker thread.
   * Returns the fully assembled SessionDetail.
   */
  async parse(request: Omit<WorkerRequest, 'id'>): Promise<SessionDetail> {
    const worker = this.ensureWorker();
    const id = String(++this.requestCounter);

    return new Promise<SessionDetail>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('Worker timeout after ' + this.timeoutMs + 'ms'));
        this.restartWorker();
      }, this.timeoutMs);

      this.pending.set(id, { resolve, reject, timer });
      worker.postMessage({ ...request, id });
    });
  }

  private ensureWorker(): Worker {
    if (!this.worker) {
      // Resolve worker path relative to this file's compiled location.
      // In dev (electron-vite): both files compile to dist-electron/main/
      // In production (asar): same directory via electron-builder.
      const workerPath = join(__dirname, 'sessionParseWorker.cjs');
      this.worker = new Worker(workerPath);

      this.worker.on('message', (msg: { id: string; result?: SessionDetail; error?: string }) => {
        const entry = this.pending.get(msg.id);
        if (!entry) return;

        clearTimeout(entry.timer);
        this.pending.delete(msg.id);

        if (msg.error) {
          entry.reject(new Error(msg.error));
        } else if (msg.result) {
          entry.resolve(msg.result);
        } else {
          entry.reject(new Error('Worker returned empty response'));
        }
      });

      this.worker.on('error', (err: Error) => {
        logger.error('Worker error:', err);
        this.rejectAllPending(new Error('Worker error: ' + err.message));
        this.worker = null;
      });

      this.worker.on('exit', (code) => {
        if (code !== 0) {
          logger.warn(`Worker exited with code ${code}`);
          this.rejectAllPending(new Error(`Worker exited with code ${code}`));
        }
        this.worker = null;
      });

      logger.info('Session parser worker started');
    }
    return this.worker;
  }

  private restartWorker(): void {
    logger.warn('Restarting worker due to timeout');
    void this.worker?.terminate();
    this.worker = null;
  }

  private rejectAllPending(error: Error): void {
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    this.pending.clear();
  }

  /**
   * Terminate the worker and reject all pending requests.
   * Called during app shutdown.
   */
  terminate(): void {
    void this.worker?.terminate();
    this.worker = null;
    this.rejectAllPending(new Error('Pool terminated'));
  }
}

/** Singleton instance used by session IPC handlers. */
export const sessionParserPool = new SessionParserPool();
