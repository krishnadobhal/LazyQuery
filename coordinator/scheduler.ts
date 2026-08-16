import type { LogicalPlan, PartialResult, Task, TaskWithState } from '../shared/types.js';
import { DEFAULT_CHUNK_ROWS, MAX_TASK_RETRIES, TASK_TIMEOUT_MS } from '../shared/constants.js';
import type { ConnectorRegistry } from './connector-registry.js';

type TaskState = TaskWithState & { claimedAt?: number };

/**
 * In-memory task scheduler. Tasks are pulled by workers via `poll`.
 * A RUNNING task whose `claimedAt` is older than TASK_TIMEOUT_MS is re-queued
 * by `sweepTimeouts` (called on a timer) — this gives us retry-on-failure
 * without a push-based dispatch.
 */
export class Scheduler {
  private tasks = new Map<string, TaskState>();
  private pendingQueue: string[] = [];
  private retryQueue: string[] = [];

  constructor(private registry: ConnectorRegistry) {
    setInterval(() => this.sweepTimeouts(), 5_000).unref();
  }

  /** Split a table into row-range tasks and enqueue them. */
  async submit(queryId: string, plan: LogicalPlan): Promise<Task[]> {
    // Count the table rows via its connector (used to size the chunks).
    const scan = findScan(plan);
    const totalRows = await this.registry.countRows(scan.connector, scan.table);
    const connectorConfig = this.registry.getConfig(scan.connector);
    if (!connectorConfig) {
      throw new Error(`Connector '${scan.connector}' has no config.`);
    }
    const chunkRows = Math.min(DEFAULT_CHUNK_ROWS, Math.max(1, totalRows));

    const tasks: Task[] = [];
    for (let start = 0; start < totalRows; start += chunkRows) {
      const end = Math.min(start + chunkRows, totalRows);
      const task: Task = {
        taskId: `${queryId}-${tasks.length + 1}`,
        queryId,
        connector: scan.connector,
        table: scan.table,
        startRow: start,
        endRow: end,
        plan,
        connectorConfig,
        createdAt: Date.now(),
      };
      tasks.push(task);
      this.tasks.set(task.taskId, { ...task, status: 'PENDING', attempts: 0 });
      this.pendingQueue.push(task.taskId);
    }
    return tasks;
  }

  /** Claim the next PENDING task for a worker. Returns null if the queue is empty. */
  poll(workerId: string): Task | null {
    const id = this.pendingQueue.shift() ?? this.retryQueue.shift();
    if (!id) return null;
    const task = this.tasks.get(id);
    if (!task) return null;
    task.status = 'RUNNING';
    task.claimedAt = Date.now();
    task.workerId = workerId;
    task.attempts++;
    return task;
  }

  complete(taskId: string, partial: PartialResult): void {
    const task = this.tasks.get(taskId);
    if (!task || task.status === 'DONE') return;
    task.status = 'DONE';
    partial.taskId = taskId;
  }

  fail(taskId: string, error: string): void {
    const task = this.tasks.get(taskId);
    if (!task || task.status === 'DONE') return;
    if (task.attempts >= MAX_TASK_RETRIES) {
      task.status = 'FAILED';
      task.error = error;
      return;
    }
    // Re-queue for another worker.
    task.status = 'PENDING';
    task.claimedAt = undefined;
    task.workerId = undefined;
    this.retryQueue.push(taskId);
  }

  getTasks(queryId: string): TaskWithState[] {
    return [...this.tasks.values()]
      .filter((t) => t.queryId === queryId)
      .map(({ status, claimedAt, workerId, attempts, error, ...task }) => ({
        ...task,
        status,
        claimedAt,
        workerId,
        attempts,
        error,
      }));
  }

  queueLength(): number {
    return this.pendingQueue.length + this.retryQueue.length;
  }

  runningCount(): number {
    let n = 0;
    for (const t of this.tasks.values()) if (t.status === 'RUNNING') n++;
    return n;
  }

  /** Re-queue RUNNING tasks whose claim expired. */
  private sweepTimeouts(): void {
    const now = Date.now();
    for (const task of this.tasks.values()) {
      if (task.status !== 'RUNNING' || task.claimedAt === undefined) continue;
      if (now - task.claimedAt > TASK_TIMEOUT_MS) {
        this.fail(task.taskId, 'Task timed out');
      }
    }
  }

  /**
   * Cancel all tasks of a query: queued tasks are dropped, running tasks are
   * marked FAILED (their results, if they arrive, are ignored). Returns the
   * number of tasks that were still pending/running.
   */
  cancel(queryId: string): number {
    let n = 0;
    this.pendingQueue = this.pendingQueue.filter((id) => {
      const t = this.tasks.get(id);
      if (t?.queryId === queryId) {
        n++;
        return false;
      }
      return true;
    });
    this.retryQueue = this.retryQueue.filter((id) => {
      const t = this.tasks.get(id);
      if (t?.queryId === queryId) {
        n++;
        return false;
      }
      return true;
    });
    for (const task of this.tasks.values()) {
      if (task.queryId === queryId && task.status === 'RUNNING') {
        task.status = 'FAILED';
        task.error = 'Cancelled';
        n++;
      }
    }
    return n;
  }
}

function findScan(plan: LogicalPlan): Extract<LogicalPlan, { op: 'scan' }> {
  if (plan.op === 'scan') return plan;
  if ('child' in plan) return findScan(plan.child);
  throw new Error('Plan has no scan node');
}
