import type { Connector, ConnectionConfig } from '../../shared/connectors.js';
import { CsvConnector } from '../../shared/connectors/csv.js';
import { SqliteConnector } from '../../shared/connectors/sqlite.js';
import { PostgresConnector } from '../../shared/connectors/postgres.js';
import { MySqlConnector } from '../../shared/connectors/mysql.js';

export function createConnector(config: ConnectionConfig): Connector {
  switch (config.type) {
    case 'csv':
      return new CsvConnector(config);
    case 'sqlite':
      return new SqliteConnector(config);
    case 'postgres':
      return new PostgresConnector(config);
    case 'mysql':
      return new MySqlConnector(config);
    default:
      throw new Error(`Unsupported connector type '${(config as { type: string }).type}'.`);
  }
}
