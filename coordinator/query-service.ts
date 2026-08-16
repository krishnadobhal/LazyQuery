import type { PartialResult } from '../shared/types.js';
import type { LogicalPlan } from '../shared/types.js';
import { QueryStore } from './query-store.js';
import { Scheduler } from './scheduler.js';
import { QueryValidationError, plan } from './planner.js';
import { aggregate } from './aggregator.js';
import type { ConnectorRegistry } from './connector-registry.js';

/** First/subsequent page size for passthrough SELECTs — see `submit()`. */
const PAGE_SIZE = 200;

function stripTrailingSemicolon(sql: string): string {
  return sql.trim().replace(/;+\s*$/, '');
}

/** Wrap arbitrary SELECT-shaped SQL as a paged subquery. Safe across sqlite/postgres/mysql. */
function wrapForPage(sql: string, offset: number, pageSize: number): string {
  return `SELECT * FROM (${stripTrailingSemicolon(sql)}) AS __lazyquery_page LIMIT ${pageSize} OFFSET ${offset}`;
}

/**
 * Orchestrates a query from submission to completion:
 * submit → plan → schedule → (workers execute) → complete.
 */
export class QueryService {
  constructor(
    private store: QueryStore,
    private scheduler: Scheduler,
    private registry: ConnectorRegistry,
  ) {}

  getStore(): QueryStore {
    return this.store;
  }

  /** Submit a query. Planning is async (connector metadata lookups). */
  async submit(sql: string, defaultConnector?: string): Promise<{ queryId: string }> {
    const record = this.store.create(sql);
    const connector = this.registry.get(defaultConnector ?? 'csv');

    // Real databases (sqlite/postgres/mysql) run the SQL directly — no
    // parse/chunk/distribute needed, the database does its own work. Only
    // CSV (no SQL engine of its own) goes through the plan+schedule pipeline.
    if (connector?.query) {
      const trimmed = sql.trim();
      // SELECT-shaped queries are paginated (fetch PAGE_SIZE at a time,
      // more loaded on demand as the TUI scrolls near the end) instead of
      // pulling an entire result set into memory in one shot. Mutating
      // statements (INSERT/UPDATE/DDL/...) run as-is, once, unpaginated.
      const isSelect = /^\s*(select|with)\b/i.test(trimmed);
      const sqlToRun = isSelect ? wrapForPage(trimmed, 0, PAGE_SIZE) : trimmed;

      this.store.setStatus(record.id, 'RUNNING');
      connector.query(sqlToRun)
        .then((result) => {
          this.store.setResult(record.id, result);
          if (isSelect) {
            this.store.setPage(record.id, {
              connectorId: connector.id,
              sql: trimmed,
              offset: PAGE_SIZE,
              pageSize: PAGE_SIZE,
              exhausted: result.rows.length < PAGE_SIZE,
            });
          }
          this.store.setStatus(record.id, 'COMPLETED');
        })
        .catch((err) => {
          this.store.setStatus(record.id, 'FAILED', err instanceof Error ? err.message : String(err));
        });
      return { queryId: record.id };
    }

    try {
      const logicalPlan = await plan(sql, this.registry, defaultConnector);
      this.store.setPlan(record.id, logicalPlan);
      this.store.setStatus(record.id, 'PLANNING');
      void this.schedule(record.id, logicalPlan);
    } catch (err) {
      const message = err instanceof QueryValidationError ? err.message : `Unexpected error: ${String(err)}`;
      this.store.setStatus(record.id, 'FAILED', message);
    }
    return { queryId: record.id };
  }

  private async schedule(queryId: string, logicalPlan: LogicalPlan): Promise<void> {
    try {
      // If the query was cancelled while planning, don't start it.
      if (this.store.get(queryId)?.status === 'FAILED') return;
      const tasks = await this.scheduler.submit(queryId, logicalPlan);
      if (this.store.get(queryId)?.status === 'FAILED') {
        // Cancelled during chunking — drop the tasks we just created.
        this.scheduler.cancel(queryId);
        return;
      }
      this.store.setTasks(queryId, tasks);
      this.store.setStatus(queryId, 'RUNNING');
    } catch (err) {
      this.store.setStatus(queryId, 'FAILED', `Failed to schedule: ${String(err)}`);
    }
  }

  /** Called when a task completes on a worker. */
  onTaskComplete(queryId: string, taskId: string, partial: PartialResult): void {
    this.scheduler.complete(taskId, partial);
    this.store.addPartial(queryId, partial);

    const record = this.store.get(queryId);
    if (!record || record.status !== 'RUNNING') return;

    const tasks = this.scheduler.getTasks(queryId);
    const done = tasks.every((t) => t.status === 'DONE');
    if (done) {
      try {
        const result = aggregate(record.plan!, record.partials);
        this.store.setResult(queryId, result);
        this.store.setStatus(queryId, 'COMPLETED');
      } catch (err) {
        this.store.setStatus(queryId, 'FAILED', `Aggregation failed: ${String(err)}`);
      }
    }
  }

  onTaskFailed(queryId: string, taskId: string, error: string): void {
    this.scheduler.fail(taskId, error);
    const record = this.store.get(queryId);
    if (!record || record.status !== 'RUNNING') return;
    const tasks = this.scheduler.getTasks(queryId);
    if (tasks.some((t) => t.status === 'FAILED')) {
      this.store.setStatus(queryId, 'FAILED', `Task ${taskId} failed: ${error}`);
    }
  }

  /** Fetch the next page of a paginated passthrough query's results, appending in place. */
  async fetchMore(queryId: string): Promise<{ done: boolean }> {
    const record = this.store.get(queryId);
    if (!record?.page || record.page.exhausted) return { done: true };
    const connector = this.registry.get(record.page.connectorId);
    if (!connector?.query) return { done: true };

    const more = await connector.query(wrapForPage(record.page.sql, record.page.offset, record.page.pageSize));
    this.store.appendRows(queryId, more);
    const exhausted = more.rows.length < record.page.pageSize;
    this.store.setPage(queryId, { ...record.page, offset: record.page.offset + record.page.pageSize, exhausted });
    return { done: exhausted };
  }

  /** Cancel a query: drop queued tasks, abandon running ones, mark FAILED. */
  kill(queryId: string): boolean {
    const record = this.store.get(queryId);
    if (!record) return false;
    if (record.status === 'COMPLETED' || record.status === 'FAILED') return false;
    this.scheduler.cancel(queryId);
    this.store.setStatus(queryId, 'FAILED', 'Cancelled by user');
    return true;
  }
}
