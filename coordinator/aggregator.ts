import type { LogicalPlan, PartialResult } from '../shared/types.js';

/**
 * Merge partial results from all workers into a single final result.
 * - aggregate: merge accumulators per aggregate node (identified by alias)
 * - scan: concatenate projected rows, apply LIMIT
 */
export function aggregate(plan: LogicalPlan, partials: PartialResult[]): unknown {
  if (plan.op === 'aggregate') {
    // Find the aggregate node (root) and any nested aggregates (e.g. under a filter).
    const aggs = collectAggregates(plan);
    const out: Record<string, unknown> = {};
    for (const agg of aggs) {
      const key = agg.alias ?? `${agg.fn.toLowerCase()}_result`;
      let count = 0;
      let sum = 0;
      for (const p of partials) {
        const acc = p.aggregates?.[key];
        if (!acc) continue;
        count += acc.count;
        sum += acc.sum;
      }
      if (agg.fn === 'COUNT') out[key] = count;
      else if (agg.fn === 'SUM') out[key] = sum;
      else if (agg.fn === 'AVG') out[key] = count === 0 ? 0 : sum / count;
    }
    return out;
  }

  if (plan.op === 'scan') {
    const rows: (string | number)[][] = [];
    for (const p of partials) {
      for (const row of p.rows ?? []) rows.push(row);
    }
    const limit = plan.limit;
    return limit !== undefined ? rows.slice(0, limit) : rows;
  }

  // Filter is transparent for aggregation (its child is the real scan/aggregate).
  return aggregate(plan.child, partials);
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
