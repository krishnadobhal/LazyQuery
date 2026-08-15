import mysql from 'mysql2/promise';
import type { Connector, ConnectionConfig, TableMetadata } from '../connectors.js';
import type { ColumnType } from '../types.js';

function mapType(mysqlType: string): ColumnType {
  const t = mysqlType.toLowerCase();
  if (t.includes('int') || t.includes('float') || t.includes('double') || t.includes('decimal') || t.includes('numeric') || t.includes('real') || t.includes('year') || t.includes('bit')) {
    return 'number';
  }
  return 'string';
}

export class MySqlConnector implements Connector {
  readonly id: string;
  readonly type: 'mysql' = 'mysql';
  readonly config: ConnectionConfig;
  private pool?: mysql.Pool;

  constructor(config: ConnectionConfig) {
    this.id = config.id;
    this.config = config;
  }

  async connect(): Promise<void> {
    this.pool = mysql.createPool({
      host: this.config.host ?? 'localhost',
      port: this.config.port ?? 3306,
      database: this.config.database,
      user: this.config.user,
      password: this.config.password,
      ssl: this.config.ssl ? {} : undefined,
      connectionLimit: 10,
    });
    await this.pool.query('SELECT 1');
  }

  async listTables(): Promise<string[]> {
    const [rows] = await this.pool!.query(
      `SELECT table_name AS name FROM information_schema.tables
       WHERE table_schema = DATABASE() ORDER BY table_name`,
    );
    return (rows as Array<{ name: string }>).map((r) => r.name);
  }

  async getTableMetadata(table: string): Promise<TableMetadata> {
    const [rows] = await this.pool!.query(
      `SELECT column_name AS name, data_type AS type FROM information_schema.columns
       WHERE table_schema = DATABASE() AND table_name = ? ORDER BY ordinal_position`,
      [table],
    );
    const cols = rows as Array<{ name: string; type: string }>;
    if (cols.length === 0) throw new Error(`Unknown table '${table}' on connector '${this.id}'.`);
    const columnTypes: Record<string, ColumnType> = {};
    for (const c of cols) columnTypes[c.name] = mapType(c.type);
    return { table, columns: cols.map((c) => c.name), columnTypes };
  }

  async countRows(table: string): Promise<number> {
    const [rows] = await this.pool!.query(`SELECT COUNT(*) AS n FROM \`${table}\``);
    return Number((rows as Array<{ n: number }>)[0].n);
  }

  /** Run arbitrary SQL directly — no chunking, MySQL does the work. */
  async query(sql: string): Promise<{ columns: string[]; rows: Array<string | number | null>[] }> {
    const [result, fields] = await this.pool!.query(sql);
    if (!Array.isArray(result) || !fields || fields.length === 0) {
      const header = result as mysql.ResultSetHeader;
      return { columns: ['result'], rows: [[`${header.affectedRows ?? 0} row(s) affected`]] };
    }
    const columns = fields.map((f) => f.name);
    const rows = (result as Array<Record<string, unknown>>).map((r) => columns.map((c) => {
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
    const [rows] = await this.pool!.query(`SELECT * FROM \`${table}\` LIMIT ? OFFSET ?`, [size, startRow]);
    return (rows as Array<Record<string, unknown>>).map((r) => {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(r)) {
        out[k] = typeof v === 'number' ? v : v === null ? null : String(v);
      }
      return out;
    });
  }
}
