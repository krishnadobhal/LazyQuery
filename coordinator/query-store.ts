import { randomUUID } from 'node:crypto';
import type { PartialResult, QueryRecord, QueryStatus, Task } from '../shared/types.js';

/**
 * In-memory store of submitted queries and their lifecycle state.
 * All queries start QUEUED; status transitions are centralized here
 * so the API and TUI read a consistent view.
 */
export class QueryStore {
  private queries = new Map<string, QueryRecord>();

  create(sql: string): QueryRecord {
    const record: QueryRecord = {
      id: randomUUID().slice(0, 8),
      sql,
      status: 'QUEUED',
      tasks: [],
      partials: [],
      createdAt: Date.now(),
    };
    this.queries.set(record.id, record);
    return record;
  }

  get(id: string): QueryRecord | undefined {
    return this.queries.get(id);
  }

  setPlan(id: string, plan: QueryRecord['plan']): void {
    const q = this.queries.get(id);
    if (q) q.plan = plan;
  }

  setTasks(id: string, tasks: Task[]): void {
    const q = this.queries.get(id);
    if (q) q.tasks = tasks;
  }

  setStatus(id: string, status: QueryStatus, error?: string): void {
    const q = this.queries.get(id);
    if (!q) return;
    q.status = status;
    if (error) q.error = error;
    if (status === 'COMPLETED' || status === 'FAILED') {
      q.finishedAt = Date.now();
    }
  }

  addPartial(id: string, partial: PartialResult): void {
    const q = this.queries.get(id);
    if (q && !q.partials.some((p) => p.taskId === partial.taskId)) {
      q.partials.push(partial);
    }
  }

  setResult(id: string, result: unknown): void {
    const q = this.queries.get(id);
    if (q) q.result = result;
  }

  setPage(id: string, page: QueryRecord['page']): void {
    const q = this.queries.get(id);
    if (q) q.page = page;
  }

  /** Append another page of columnar rows onto an existing {columns, rows} result. */
  appendRows(id: string, more: { columns: string[]; rows: unknown[][] }): void {
    const q = this.queries.get(id);
    if (!q) return;
    const current = q.result as { columns: string[]; rows: unknown[][] } | undefined;
    if (current && Array.isArray(current.rows)) {
      current.rows.push(...more.rows);
    } else {
      q.result = more;
    }
  }

  list(): QueryRecord[] {
    return [...this.queries.values()].sort((a, b) => b.createdAt - a.createdAt);
  }

  counts(): { completed: number; failed: number } {
    let completed = 0;
    let failed = 0;
    for (const q of this.queries.values()) {
      if (q.status === 'COMPLETED') completed++;
      else if (q.status === 'FAILED') failed++;
    }
    return { completed, failed };
  }
}
