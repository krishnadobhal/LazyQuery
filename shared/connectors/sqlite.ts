import Database from 'better-sqlite3';
import type { Connector, ConnectionConfig, TableMetadata } from '../connectors.js';
import type { ColumnType } from '../types.js';

/** Map SQLite declared types to our ColumnType. */
function mapType(sqliteType: string): ColumnType {
  const t = sqliteType.toUpperCase();
  if (t.includes('INT') || t.includes('REAL') || t.includes('FLOA') || t.includes('DOUB') || t.includes('NUM') || t.includes('DEC')) {
    return 'number';
  }
  return 'string';
}

export class SqliteConnector implements Connector {
  readonly id: string;
  readonly type: 'sqlite' = 'sqlite';
  readonly config: ConnectionConfig;
  private db?: Database.Database;

  constructor(config: ConnectionConfig) {
    this.id = config.id;
    this.config = config;
  }

  async connect(): Promise<void> {
    const file = this.config.file ?? this.config.host;
    if (!file) throw new Error(`SQLite connector '${this.id}' requires a 'file' path.`);
    this.db = new Database(file, { readonly: true });
  }

  async listTables(): Promise<string[]> {
    const rows = this.db!.prepare(
      "SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name",
    ).all() as { name: string }[];
    return rows.map((r) => r.name);
  }

  async getTableMetadata(table: string): Promise<TableMetadata> {
    const cols = this.db!.prepare(`PRAGMA table_info("${table}")`).all() as {
      name: string;
      type: string;
    }[];
    if (cols.length === 0) throw new Error(`Unknown table '${table}' on connector '${this.id}'.`);
    const columnTypes: Record<string, ColumnType> = {};
    for (const c of cols) columnTypes[c.name] = mapType(c.type);
    return { table, columns: cols.map((c) => c.name), columnTypes };
  }

  async countRows(table: string): Promise<number> {
    const row = this.db!.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get() as { n: number };
    return row.n;
  }

  /** Run arbitrary SQL directly — no chunking, SQLite does the work. */
  async query(sql: string): Promise<{ columns: string[]; rows: Array<string | number | null>[] }> {
    const stmt = this.db!.prepare(sql);
    if (!stmt.reader) {
      const info = stmt.run();
      return { columns: ['result'], rows: [[`${info.changes} row(s) affected`]] };
    }
    const columns = stmt.columns().map((c) => c.name);
    const rows = (stmt.all() as Array<Record<string, unknown>>).map((r) => columns.map((c) => {
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
    const rows = this.db!
      .prepare(`SELECT * FROM "${table}" LIMIT ? OFFSET ?`)
      .all(size, startRow) as Array<Record<string, unknown>>;
    // Normalize all values to number|string|null.
    return rows.map((r) => {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(r)) {
        out[k] = typeof v === 'number' ? v : v === null ? null : String(v);
      }
      return out;
    });
  }
}
