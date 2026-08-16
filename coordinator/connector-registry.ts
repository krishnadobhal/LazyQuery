import type { Connector, ConnectionConfig, TableMetadata } from '../shared/connectors.js';

/**
 * Registry of all connectors. The CSV connector is always present;
 * additional DB connectors are added at runtime via the API.
 */
export class ConnectorRegistry {
  private connectors = new Map<string, Connector>();

  constructor(csvConnector: Connector) {
    this.connectors.set(csvConnector.id, csvConnector);
  }

  register(connector: Connector): void {
    this.connectors.set(connector.id, connector);
  }

  get(id: string): Connector | undefined {
    return this.connectors.get(id);
  }

  /** Config for a connector, for embedding into worker tasks. */
  getConfig(id: string): ConnectionConfig | undefined {
    return this.connectors.get(id)?.config;
  }

  has(id: string): boolean {
    return this.connectors.has(id);
  }

  list(): Connector[] {
    return [...this.connectors.values()];
  }

  listConfigs(): ConnectionConfig[] {
    return this.list().map((c) => ({ id: c.id, type: c.type }));
  }

  async getTableMetadata(connectorId: string, table: string): Promise<TableMetadata | undefined> {
    const c = this.connectors.get(connectorId);
    if (!c) return undefined;
    return c.getTableMetadata(table);
  }

  async countRows(connectorId: string, table: string): Promise<number> {
    const c = this.connectors.get(connectorId);
    if (!c) throw new Error(`Unknown connector '${connectorId}'.`);
    return c.countRows(table);
  }
}
