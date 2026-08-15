import { createReadStream } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'csv-parse';
import type { Connector, ConnectionConfig, TableMetadata } from '../connectors.js';
import type { ColumnType } from '../types.js';
import { DATASETS_DIR } from '../constants.js';

interface CsvTable {
  file: string;
  columns: string[];
  columnTypes: Record<string, ColumnType>;
}

/** Built-in CSV tables. */
const CSV_TABLES: Record<string, CsvTable> = {
  users: {
    file: 'users.csv',
    columns: ['id', 'name', 'age', 'salary', 'city'],
    columnTypes: { id: 'number', name: 'string', age: 'number', salary: 'number', city: 'string' },
  },
  orders: {
    file: 'orders.csv',
    columns: ['id', 'user_id', 'product_id', 'quantity', 'amount'],
    columnTypes: { id: 'number', user_id: 'number', product_id: 'number', quantity: 'number', amount: 'number' },
  },
  products: {
    file: 'products.csv',
    columns: ['id', 'name', 'price', 'stock'],
    columnTypes: { id: 'number', name: 'string', price: 'number', stock: 'number' },
  },
};

export class CsvConnector implements Connector {
  readonly id: string;
  readonly type: 'csv' = 'csv';
  readonly config: ConnectionConfig;

  constructor(config?: ConnectionConfig) {
    this.id = config?.id ?? 'csv';
    this.config = { id: this.id, type: 'csv' };
  }

  async connect(): Promise<void> {
    // Static tables; nothing to connect.
  }

  async listTables(): Promise<string[]> {
    return Object.keys(CSV_TABLES);
  }

  async getTableMetadata(table: string): Promise<TableMetadata> {
    const t = CSV_TABLES[table];
    if (!t) throw new Error(`Unknown table '${table}' on connector '${this.id}'.`);
    return { table, columns: t.columns, columnTypes: t.columnTypes };
  }

  async countRows(table: string): Promise<number> {
    const t = CSV_TABLES[table];
    if (!t) throw new Error(`Unknown table '${table}' on connector '${this.id}'.`);
    return countCsvRows(join(DATASETS_DIR, t.file));
  }

  async readRange(
    table: string,
    startRow: number,
    endRow: number,
    limit?: number,
  ): Promise<Array<Record<string, unknown>>> {
    const t = CSV_TABLES[table];
    if (!t) throw new Error(`Unknown table '${table}' on connector '${this.id}'.`);
    const { headers, rows } = await readCsvSlice(
      join(DATASETS_DIR, t.file),
      startRow,
      endRow,
      limit,
    );
    return rows.map((row) => {
      const obj: Record<string, unknown> = {};
      headers.forEach((h, i) => {
        const type = t.columnTypes[h] ?? 'string';
        obj[h] = type === 'number' ? Number(row[i]) : row[i];
      });
      return obj;
    });
  }
}

async function countCsvRows(file: string): Promise<number> {
  let rows = 0;
  await new Promise<void>((resolve, reject) => {
    createReadStream(file)
      .pipe(parse({ skip_records_with_error: true }))
      .on('data', () => {
        rows++;
      })
      .on('end', () => resolve())
      .on('error', reject);
  });
  return Math.max(0, rows - 1); // minus header
}

interface CsvSlice {
  headers: string[];
  rows: string[][];
}

async function readCsvSlice(
  file: string,
  startRow: number,
  endRow: number,
  limit?: number,
): Promise<CsvSlice> {
  const rows: string[][] = [];
  let headers: string[] = [];
  let rowIndex = -1; // header counts as -1, first data row is 0
  let captured = 0;
  let done = false;

  const finish = (resolve: () => void) => {
    if (!done) {
      done = true;
      resolve();
    }
  };

  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(file);
    const parser = stream.pipe(parse({ skip_records_with_error: true }));
    parser.on('data', (record: string[]) => {
      rowIndex++;
      if (rowIndex === 0) {
        headers = record;
        return;
      }
      const dataIndex = rowIndex - 1;
      if (dataIndex < startRow) return;
      if (dataIndex >= endRow) return;
      rows.push(record);
      captured++;
      if (limit !== undefined && captured >= limit) {
        parser.destroy();
        finish(resolve);
      }
    });
    parser.on('end', () => finish(resolve));
    parser.on('error', (err) => {
      if (done) return; // destroy() after early stop
      reject(err);
    });
  });

  return { headers, rows };
}
