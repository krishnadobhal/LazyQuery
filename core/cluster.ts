import { QueryStore } from '../coordinator/query-store.js';
import { Scheduler } from '../coordinator/scheduler.js';
import { QueryService } from '../coordinator/query-service.js';
import { WorkerRegistry } from '../coordinator/worker-registry.js';
import { ConnectorRegistry } from '../coordinator/connector-registry.js';
import { CsvConnector } from '../shared/connectors/csv.js';
import { EmbeddedWorker } from './embedded-worker.js';
import { WORKER_STALE_MS } from '../shared/constants.js';

/**
 * The whole coordinator in one object — used by the HTTP server (distributed
 * mode) and by the single-process TUI app (in-process mode).
 */
export class Cluster {
  readonly store = new QueryStore();
  readonly connectors = new ConnectorRegistry(new CsvConnector());
  readonly scheduler: Scheduler;
  readonly queryService: QueryService;
  readonly registry = new WorkerRegistry();

  /** Embedded in-process workers (single-process mode). */
  readonly embeddedWorkers: EmbeddedWorker[] = [];

  constructor(private workerCount = 2) {
    this.scheduler = new Scheduler(this.connectors);
    this.queryService = new QueryService(this.store, this.scheduler, this.connectors);
  }

  /** Start `workerCount` in-process workers that poll the scheduler directly. */
  startEmbeddedWorkers(): void {
    for (let i = 1; i <= this.workerCount; i++) {
      const worker = new EmbeddedWorker(
        `worker-${i}`,
        this.scheduler,
        this.registry,
        this.connectors,
      );
      worker.setQueryService(this.queryService);
      worker.start();
      this.embeddedWorkers.push(worker);
    }
  }

  getStats() {
    const counts = this.store.counts();
    return {
      workersOnline: this.registry.onlineCount(),
      workersTotal: this.registry.list().length,
      queueLength: this.scheduler.queueLength(),
      runningJobs: this.scheduler.runningCount(),
      completedQueries: counts.completed,
      failedQueries: counts.failed,
    };
  }
}

export { WORKER_STALE_MS };
