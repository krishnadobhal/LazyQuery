import nodeSqlParser from 'node-sql-parser';
import type { LogicalPlan } from '../shared/types.js';
import type { ConnectorRegistry } from './connector-registry.js';

const { Parser } = nodeSqlParser;
const parser = new Parser();

export class QueryValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QueryValidationError';
  }
}

/** Resolve a column reference (possibly table-qualified like `users.age`) to its plain name. */
function columnName(expr: unknown): string {
  if (expr && typeof expr === 'object' && 'column' in expr) {
    return String((expr as { column: unknown }).column);
  }
  throw new QueryValidationError('Expected a column reference.');
}

function isColumnRef(expr: unknown): boolean {
  return Boolean(
    expr && typeof expr === 'object' && (expr as { type?: string }).type === 'column_ref'
  );
}

type FilterNode = {
  op: 'filter';
  child: LogicalPlan;
  column: string;
  operator: '=' | '!=' | '>' | '>=' | '<' | '<=';
  value: string | number;
};

/** Convert an AST `where` clause into a chain of filter operators. */
function buildFilters(node: unknown, columnTypes: Record<string, 'number' | 'string'>): FilterNode[] {
  if (!node) return [];
  if (Array.isArray(node)) {
    return node.flatMap((n) => buildFilters(n, columnTypes));
  }

  const expr = node as Record<string, unknown>;

  if (expr.type === 'binary_expr') {
    const operator = String(expr.operator).toUpperCase();
    if (operator === 'AND') {
      return [...buildFilters(expr.left, columnTypes), ...buildFilters(expr.right, columnTypes)];
    }
    if (operator === 'OR') {
      throw new QueryValidationError('OR conditions are not supported in V1. Use AND only.');
    }
    if (['=', '!=', '>', '>=', '<', '<='].includes(operator)) {
      if (!isColumnRef(expr.left)) {
        throw new QueryValidationError('Filter left side must be a column.');
      }
      const column = columnName(expr.left);
      const value = expr.right as { type: string; value: unknown };
      if (value?.type === 'column_ref') {
        throw new QueryValidationError('Column-to-column comparisons are not supported in V1.');
      }
      let parsed: string | number;
      if (value?.type === 'number') parsed = Number(value.value);
      else if (value?.type === 'single_quote_string') parsed = String(value.value);
      else if (typeof value?.value === 'string' || typeof value?.value === 'number') parsed = value.value as string | number;
      else throw new QueryValidationError('Filter value must be a literal (number or string).');

      if (columnTypes[column] === 'number' && typeof parsed === 'string') {
        const n = Number(parsed);
        if (Number.isNaN(n)) {
          throw new QueryValidationError(`Cannot compare string to numeric column '${column}'.`);
        }
        parsed = n;
      }
      return [{
        op: 'filter',
        column,
        operator: operator as '=' | '!=' | '>' | '>=' | '<' | '<=',
        value: parsed,
      } as FilterNode];
    }
    throw new QueryValidationError(`Unsupported WHERE operator '${expr.operator}'.`);
  }
  throw new QueryValidationError('Unsupported WHERE clause.');
}

/**
 * Parse SQL into a LogicalPlan tree:
 * aggregate → filter(s) → scan.
 *
 * Table resolution is delegated to the connector registry:
 *   `FROM users`        → table on the default connector ('csv')
 *   `FROM sqlite_demo.users` → table on connector 'sqlite_demo'
 */
export async function plan(
  sql: string,
  registry: ConnectorRegistry,
  defaultConnector?: string,
): Promise<LogicalPlan> {
  let ast: unknown;
  try {
    ast = parser.astify(sql);
  } catch {
    throw new QueryValidationError(`Failed to parse SQL: "${sql}"`);
  }

  if (Array.isArray(ast)) ast = ast[0];
  const root = ast as Record<string, unknown>;

  if (root.type !== 'select') {
    throw new QueryValidationError(`Only SELECT queries are supported (got ${String(root.type)}).`);
  }
  if (root.distinct) {
    throw new QueryValidationError('SELECT DISTINCT is not supported in V1.');
  }
  if (root.groupby || root.orderby || root.having) {
    throw new QueryValidationError('GROUP BY / ORDER BY / HAVING are not supported in V1.');
  }

  const from = (root.from as { db?: unknown; table: unknown }[] | null) ?? [];
  if (from.length !== 1) {
    throw new QueryValidationError('Only single-table queries are supported in V1.');
  }

  // Resolve connector + table: `FROM users` → <default>.users; `FROM sqlite_demo.users` → sqlite_demo.users
  const qualifier = from[0].db ? String(from[0].db) : undefined;
  const connectorId = qualifier ?? defaultConnector ?? 'csv';
  const requestedTable = String(from[0].table);

  const connector = registry.get(connectorId);
  if (!connector) {
    throw new QueryValidationError(
      `Unknown connector '${connectorId}'. Registered: ${registry.list().map((c) => c.id).join(', ') || 'none'}.`
    );
  }

  // Match case-insensitively against the connector's real table names — SQL
  // identifiers are conventionally case-insensitive, but some databases
  // (e.g. Postgres tables created with quoted/mixed-case names, common with
  // ORMs like Prisma) are case-sensitive underneath. Resolve to the real
  // casing rather than assuming lower/as-typed.
  const availableTables = await connector.listTables().catch(() => [] as string[]);
  const table = availableTables.find((t) => t === requestedTable)
    ?? availableTables.find((t) => t.toLowerCase() === requestedTable.toLowerCase());
  if (!table) {
    throw new QueryValidationError(
      `Unknown table '${requestedTable}' on connector '${connectorId}'. Tables: ${availableTables.join(', ') || 'none'}.`
    );
  }

  let metadata;
  try {
    metadata = await connector.getTableMetadata(table);
  } catch (err) {
    throw new QueryValidationError(
      `Could not read metadata for table '${table}' on connector '${connectorId}': ${err instanceof Error ? err.message : String(err)}`
    );
  }

  const columnTypes = metadata.columnTypes;

  // Limit (int) — from node-sql-parser { value: [ {value: n} ] }.
  const rawLimit = root.limit as { value?: { value: unknown }[] } | null;
  let limit: number | undefined;
  if (rawLimit?.value?.[0]) {
    limit = Number(rawLimit.value[0].value);
  }

  const filters = buildFilters(root.where, columnTypes);
  let child: LogicalPlan = {
    op: 'scan',
    connector: connectorId,
    table,
    columns: '*',
    columnTypes,
    limit,
  };

  // Wrap in filters (innermost first).
  for (const f of filters) {
    child = { ...f, child } as LogicalPlan;
  }

  // Aggregation on top.
  const cols = (root.columns as { expr: { type?: string; name?: string }; as?: unknown }[]) ?? [];
  if (cols.length !== 1 || cols[0].expr.type !== 'aggr_func') {
    // Plain projection: SELECT name, age FROM users
    if (cols.length === 1 && (cols[0].expr as { type?: string }).type === 'column_ref' &&
        (cols[0].expr as { column?: unknown }).column === '*') {
      child = { ...child, columns: '*' } as LogicalPlan;
      return child;
    }
    const projected = cols.map((c) => {
      if (!isColumnRef(c.expr)) {
        throw new QueryValidationError('Only column projections are supported (no expressions in SELECT).');
      }
      const name = columnName(c.expr);
      if (!metadata.columns.includes(name)) {
        throw new QueryValidationError(`Unknown column '${name}' in table '${table}'.`);
      }
      return name;
    });
    if (projected.length === 0) projected.push('*');
    child = { ...child, columns: projected } as LogicalPlan;
    return child;
  }

  const agg = cols[0].expr as { type: string; name: string; args: { expr: unknown } };
  const fn = String(agg.name).toUpperCase() as 'COUNT' | 'SUM' | 'AVG';
  if (!['COUNT', 'SUM', 'AVG'].includes(fn)) {
    throw new QueryValidationError(`Unsupported aggregate '${fn}'.`);
  }
  if (fn !== 'COUNT') {
    const inner = agg.args?.expr as { type?: string; column?: string };
    if (inner?.type !== 'column_ref') {
      throw new QueryValidationError(`${fn} requires a column argument, e.g. ${fn}(age).`);
    }
    const col = String(inner.column);
    if (columnTypes[col] !== 'number') {
      throw new QueryValidationError(`${fn} requires a numeric column (got '${col}').`);
    }
  }
  const alias = cols[0].as ? String(cols[0].as) : `${fn.toLowerCase()}_result`;

  return {
    op: 'aggregate',
    child,
    fn,
    column: fn === 'COUNT' ? undefined : String((agg.args.expr as { column?: string }).column),
    alias,
  };
}
