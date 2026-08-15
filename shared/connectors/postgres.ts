import pg from 'pg';
import type { Connector, ConnectionConfig, TableMetadata } from '../connectors.js';
import type { ColumnType } from '../types.js';

const { Pool } = pg;

function mapType(pgType: string): ColumnType {
  const t = pgType.toLowerCase();
  if (t.includes('int') || t.includes('serial') || t.includes('float') || t.includes('double') || t.includes('numeric') || t.includes('decimal') || t.includes('real') || t.includes('money') || t.includes('bigint')) {
    return 'number';
  }
  return 'string';
}

export class PostgresConnector implements Connector {
  readonly id: string;
  readonly type: 'postgres' = 'postgres';
  readonly config: ConnectionConfig;
  private pool?: pg.Pool;

  constructor(config: ConnectionConfig) {
    this.id = config.id;
    this.config = config;
  }

  async connect(): Promise<void> {
    this.pool = new Pool({
      host: this.config.host ?? 'localhost',
      port: this.config.port ?? 5432,
      database: this.config.database,
      user: this.config.user,
      password: this.config.password,
      ssl: this.config.ssl ? { rejectUnauthorized: false } : undefined,
      max: 10,
    });
    await this.pool.query('SELECT 1');
  }

  async listTables(): Promise<string[]> {
    const res = await this.pool!.query(
      `SELECT table_name AS name FROM information_schema.tables
       WHERE table_schema = 'public' ORDER BY table_name`,
    );
    return res.rows.map((r) => r.name as string);
  }

  async getTableMetadata(table: string): Promise<TableMetadata> {
    const res = await this.pool!.query(
      `SELECT column_name AS name, data_type AS type FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`,
      [table],
    );
    if (res.rows.length === 0) throw new Error(`Unknown table '${table}' on connector '${this.id}'.`);
    const columnTypes: Record<string, ColumnType> = {};
    for (const r of res.rows) columnTypes[r.name as string] = mapType(r.type as string);
    return { table, columns: res.rows.map((r) => r.name as string), columnTypes };
  }

  async countRows(table: string): Promise<number> {
    const res = await this.pool!.query(`SELECT COUNT(*)::int AS n FROM "${table}"`);
    return Number(res.rows[0].n);
  }

  /** Run arbitrary SQL directly — no chunking, Postgres does the work. */
  async query(sql: string): Promise<{ columns: string[]; rows: Array<string | number | null>[] }> {
    const res = await this.pool!.query(sql);
    if (res.fields.length === 0) {
      return { columns: ['result'], rows: [[`${res.command} ${res.rowCount ?? 0} row(s)`]] };
    }
    const columns = res.fields.map((f) => f.name);
    const rows = res.rows.map((r) => columns.map((c) => {
      const v = r[c];
      return typeof v === 'number' ? v : v === null || v === undefined ? null : String(v);
    }));
    return { columns, rows };
  }

  async readRange(
    table: string,
    startRow: number,
    endRow: number,
    limit?: number,
  ): Promise<Array<Record<string, unknown>>> {
    const size = limit !== undefined ? Math.min(limit, endRow - startRow) : endRow - startRow;
    if (size <= 0) return [];
    const res = await this.pool!.query(`SELECT * FROM "${table}" LIMIT $1 OFFSET $2`, [size, startRow]);
    return res.rows.map((r) => {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(r)) {
        out[k] = typeof v === 'number' ? v : v === null ? null : String(v);
      }
      return out;
    });
  }
}
