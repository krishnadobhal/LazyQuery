import type { Connector, ConnectionConfig } from './connectors.js';

/**
 * Build a connector from config. Heavy DB drivers (mysql2, pg) are loaded
 * lazily on first use so importing this module stays cheap — important for
 * the single-process TUI, which must boot without waiting on DB drivers.
 */
export async function createConnector(config: ConnectionConfig): Promise<Connector> {
  switch (config.type) {
    case 'csv': {
      const { CsvConnector } = await import('./connectors/csv.js');
      return new CsvConnector(config);
    }
    case 'sqlite': {
      const { SqliteConnector } = await import('./connectors/sqlite.js');
      return new SqliteConnector(config);
    }
    case 'postgres': {
      const { PostgresConnector } = await import('./connectors/postgres.js');
      return new PostgresConnector(config);
    }
    case 'mysql': {
      const { MySqlConnector } = await import('./connectors/mysql.js');
      return new MySqlConnector(config);
    }
    default:
      throw new Error(`Unsupported connector type '${(config as { type: string }).type}'.`);
  }
}
