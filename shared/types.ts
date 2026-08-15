/** Column data type, used for typed comparisons during filter evaluation. */
export type ColumnType = 'number' | 'string';

export type ScanColumns = string[] | '*';

/** A minimal logical plan. Operators wrap their child via `child`. */
export type LogicalPlan =
  | {
      op: 'scan';
      /** Connection id the table lives on, e.g. "csv" or "postgres-prod". */
      connector: string;
      table: string;
      columns: ScanColumns;
      limit?: number;
      columnTypes: Record<string, ColumnType>;
    }
  | {
      op: 'filter';
      child: LogicalPlan;
      column: string;
      operator: '=' | '!=' | '>' | '>=' | '<' | '<=';
      value: string | number;
    }
  | {
      op: 'aggregate';
      child: LogicalPlan;
      fn: 'COUNT' | 'SUM' | 'AVG';
      column?: string;
      alias?: string;
    };

/** A unit of work: one row-range slice of one table, executed by one worker. */
export interface Task {
  taskId: string;
  queryId: string;
  connector: string;
  table: string;
  startRow: number;
  endRow: number; // exclusive
  plan: LogicalPlan;
  /** Config for the worker to build a connector and read this table's rows. */
  connectorConfig: import('./connectors.js').ConnectionConfig;
  createdAt: number;
}

/** Task as observed by the coordinator: base task + scheduling state. */
export interface TaskWithState extends Task {
  status: 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED';
  claimedAt?: number;
  workerId?: string;
  attempts: number;
  error?: string;
}

/** What a worker returns after executing a task. */
export interface PartialResult {
  taskId: string;
  /** For aggregates: { count, sum } accumulators keyed by aggregate node alias. */
  aggregates?: Record<string, { count: number; sum: number }>;
  /** For scans: projected rows (arrays of string|number). */
  rows?: (string | number)[][];
  rowCount: number;
}

export type QueryStatus =
  | 'QUEUED'
  | 'PLANNING'
  | 'RUNNING'
  | 'COMPLETED'
  | 'FAILED';

/** Pagination state for a passthrough DB query (sqlite/postgres/mysql) — CSV isn't paginated this way. */
export interface QueryPageState {
  connectorId: string;
  /** The original SELECT the user typed, without the paging wrapper. */
  sql: string;
  /** Row offset for the next page fetch. */
  offset: number;
  pageSize: number;
  /** True once a fetch returned fewer than `pageSize` rows — no more to load. */
  exhausted: boolean;
}

export interface QueryRecord {
  id: string;
  sql: string;
  status: QueryStatus;
  plan?: LogicalPlan;
  tasks: Task[];
  partials: PartialResult[];
  result?: unknown;
  page?: QueryPageState;
  error?: string;
  createdAt: number;
  finishedAt?: number;
}

export type WorkerStatus = 'ONLINE' | 'BUSY' | 'IDLE' | 'STALE';

export interface WorkerInfo {
  workerId: string;
  status: WorkerStatus;
  lastSeen: number;
  currentTaskId?: string;
  registeredAt: number;
}

export interface ClusterStats {
  workersOnline: number;
  workersTotal: number;
  queueLength: number;
  runningJobs: number;
  completedQueries: number;
  failedQueries: number;
}
