import type { ColumnType } from './types.js';

/** Where a table lives: which connector (connection id) hosts it. */
export interface TableRef {
  /** Connection id, e.g. "csv", "sqlite-dev", "postgres-prod". */
  connector: string;
  /** Table name within that connector. */
  table: string;
}

/** A table discovered on a connector: its columns and column types. */
export interface TableMetadata {
  table: string;
  columns: string[];
  columnTypes: Record<string, ColumnType>;
}

/** A registered connection (config as provided by the user). */
export interface ConnectionConfig {
  id: string;
  type: 'csv' | 'sqlite' | 'postgres' | 'mysql';
  /** sqlite: file path; postgres/mysql: host */
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  password?: string;
  /** sqlite file path */
  file?: string;
  /** Enable SSL (postgres/mysql). Set by the URL parser when the URL asks for it. */
  ssl?: boolean;
}

/**
 * A source of table data. Implementations are registered in the
 * ConnectorRegistry and answer row-count, metadata, and row-range reads.
 */
export interface Connector {
  readonly id: string;
  readonly type: ConnectionConfig['type'];
  /** The config this connector was built from (workers use it to reconnect). */
  readonly config: ConnectionConfig;

  connect(): Promise<void>;

  listTables(): Promise<string[]>;

  /** Columns + types for a table (used by the planner for validation). */
  getTableMetadata(table: string): Promise<TableMetadata>;

  /** Total data rows in a table (used to size task chunks). */
  countRows(table: string): Promise<number>;

  /**
   * Stream rows [startRow, endRow) of a table. Rows are objects keyed by
   * column name with raw values (numbers as JS numbers, strings as strings).
   */
  readRange(
    table: string,
    startRow: number,
    endRow: number,
    limit?: number,
  ): Promise<Array<Record<string, unknown>>>;

  /**
   * Run arbitrary SQL directly against the underlying database (real SQL
   * engines only — sqlite/postgres/mysql). Bypasses the coordinator's
   * parse/plan/chunk pipeline entirely; the database does its own work.
   * CSV has no engine to delegate to, so it doesn't implement this.
   */
  query?(sql: string): Promise<{ columns: string[]; rows: Array<string | number | null>[] }>;
}
