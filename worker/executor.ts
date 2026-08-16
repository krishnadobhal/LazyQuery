import type { ColumnType, LogicalPlan, PartialResult } from '../shared/types.js';

export interface ExecuteInput {
  /** Object rows from a connector (values: number|string|null). */
  rows: Array<Record<string, unknown>>;
  plan: LogicalPlan;
}

/**
 * Execute a logical plan over in-memory rows produced by a connector.
 * Applies scan → filter → aggregate (or projection), producing a PartialResult.
 * Row values may be number | string | null.
 */
export function execute(input: ExecuteInput): PartialResult {
  const scan = findScan(input.plan);
  const aggregates = collectAggregates(input.plan);
  if (aggregates.length > 0) {
    return executeAggregate(input.rows, input.plan, aggregates);
  }
  return executeScan(input.rows, input.plan);
}

/** Resolve a column's runtime value from a row. */
function cellValue(row: Record<string, unknown>, column: string): string | number {
  const raw = row[column];
  if (raw === undefined) throw new Error(`Column '${column}' not found in row.`);
  if (raw === null) return 0;
  return typeof raw === 'number' ? raw : String(raw);
}

function matchesFilter(
  row: Record<string, unknown>,
  plan: LogicalPlan,
  scanTypes: Record<string, ColumnType>,
): boolean {
  if (plan.op === 'filter') {
    const value = cellValue(row, plan.column);
    const expected = plan.value;
    let ok: boolean;
    switch (plan.operator) {
      case '=': ok = value === expected; break;
      case '!=': ok = value !== expected; break;
      case '>': ok = (value as number) > (expected as number); break;
      case '>=': ok = (value as number) >= (expected as number); break;
      case '<': ok = (value as number) < (expected as number); break;
      case '<=': ok = (value as number) <= (expected as number); break;
      default: ok = true;
    }
    if (!ok) return false;
    return matchesFilter(row, plan.child, scanTypes);
  }
  if ('child' in plan) {
    return matchesFilter(row, plan.child, scanTypes);
  }
  return true; // scan node
}

function executeAggregate(
  rows: Array<Record<string, unknown>>,
  plan: LogicalPlan,
  aggregates: Extract<LogicalPlan, { op: 'aggregate' }>[],
): PartialResult {
  const aggOut: PartialResult['aggregates'] = {};

  for (const agg of aggregates) {
    const key = agg.alias ?? `${agg.fn.toLowerCase()}_result`;
    aggOut[key] = { count: 0, sum: 0 };
  }

  for (const row of rows) {
    if (!matchesFilter(row, plan, findScan(plan).columnTypes)) continue;
    for (const agg of aggregates) {
      const key = agg.alias ?? `${agg.fn.toLowerCase()}_result`;
      const acc = aggOut[key]!;
      if (agg.fn === 'COUNT') {
        acc.count++;
        continue;
      }
      const value = cellValue(row, agg.column!);
      acc.count++;
      acc.sum += value as number;
    }
  }

  return { taskId: '', aggregates: aggOut, rowCount: rows.length };
}

function executeScan(
  rows: Array<Record<string, unknown>>,
  plan: LogicalPlan,
): PartialResult {
  const scan = findScan(plan);
  const columns = scan.columns === '*' ? Object.keys(scan.columnTypes) : scan.columns;
  const output: (string | number)[][] = [];

  for (const row of rows) {
    if (!matchesFilter(row, plan, scan.columnTypes)) continue;
    const projected = columns.map((c) => cellValue(row, c));
    output.push(projected);
    if (scan.limit !== undefined && output.length >= scan.limit) break;
  }

  return { taskId: '', rows: output, rowCount: rows.length };
}

function findScan(plan: LogicalPlan): Extract<LogicalPlan, { op: 'scan' }> {
  if (plan.op === 'scan') return plan;
  if ('child' in plan) return findScan(plan.child);
  throw new Error('Plan has no scan node');
}

function collectAggregates(plan: LogicalPlan): Extract<LogicalPlan, { op: 'aggregate' }>[] {
  const out: Extract<LogicalPlan, { op: 'aggregate' }>[] = [];
  const walk = (p: LogicalPlan): void => {
    if (p.op === 'aggregate') {
      out.push(p);
      return;
    }
    if ('child' in p) walk(p.child);
  };
  walk(plan);
  return out;
}
