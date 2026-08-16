import { POLL_INTERVAL_MS } from '../shared/constants.js';
import { execute } from '../worker/executor.js';
import { createConnector } from '../shared/connector-factory.js';
import type { ConnectorRegistry } from '../coordinator/connector-registry.js';
import type { Scheduler } from '../coordinator/scheduler.js';
import type { WorkerRegistry } from '../coordinator/worker-registry.js';
import type { Task } from '../shared/types.js';

/**
 * A worker that runs inside the coordinator process. Same execution logic as
 * a remote worker (poll → read range → execute → report) but calls the
 * scheduler and registry directly instead of going over HTTP.
 */
export class EmbeddedWorker {
  private running = false;
  private connectors = new Map<string, Awaited<ReturnType<typeof createConnector>>>();

  constructor(
    readonly workerId: string,
    private scheduler: Scheduler,
    private registry: WorkerRegistry,
    private connectorRegistry: ConnectorRegistry,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.registry.register(this.workerId);
    // Heartbeat + poll loop.
    setInterval(() => this.heartbeat(), 5_000).unref();
    void this.loop();
  }

  stop(): void {
    this.running = false;
  }

  private heartbeat(): void {
    this.registry.heartbeat(this.workerId, this.currentTaskId);
  }

  private currentTaskId: string | undefined;

  private async getConnector(task: Task) {
    const existing = this.connectors.get(task.connector);
    if (existing) return existing;
    const connector = await createConnector(task.connectorConfig);
    await connector.connect();
    this.connectors.set(task.connector, connector);
    return connector;
  }

  private async loop(): Promise<void> {
    while (this.running) {
      const task = this.scheduler.poll(this.workerId);
      if (!task) {
        this.currentTaskId = undefined;
        this.registry.setTask(this.workerId, undefined);
        await sleep(POLL_INTERVAL_MS);
        continue;
      }
      this.currentTaskId = task.taskId;
      this.registry.setTask(this.workerId, task.taskId);
      try {
        const connector = await this.getConnector(task);
        const scan = findScan(task.plan);
        const hasFilter = hasFilterNode(task.plan);
        const rows = await connector.readRange(
          task.table,
          task.startRow,
          task.endRow,
          hasFilter ? undefined : scan.limit,
        );
        const partial = execute({ rows, plan: task.plan });
        this.scheduler.complete(task.taskId, partial);
        this.queryServiceRef?.onTaskComplete(task.queryId, task.taskId, partial);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.queryServiceRef?.onTaskFailed(task.queryId, task.taskId, message);
      } finally {
        this.currentTaskId = undefined;
        this.registry.setTask(this.workerId, undefined);
      }
    }
  }

  /** Set by Cluster after construction to wire task completion into the query service. */
  setQueryService(queryService: import('../coordinator/query-service.js').QueryService): void {
    this.queryServiceRef = queryService;
  }

  private queryServiceRef: import('../coordinator/query-service.js').QueryService | undefined;
}

function findScan(plan: Task['plan']): Extract<Task['plan'], { op: 'scan' }> {
  if (plan.op === 'scan') return plan;
  if ('child' in plan) return findScan(plan.child);
  throw new Error('Plan has no scan node');
}

function hasFilterNode(plan: Task['plan']): boolean {
  if (plan.op === 'filter') return true;
  if ('child' in plan) return hasFilterNode(plan.child);
  return false;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
