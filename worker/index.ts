import { HEARTBEAT_INTERVAL_MS, POLL_INTERVAL_MS } from '../shared/constants.js';
import { execute } from './executor.js';
import { createConnector } from '../shared/connector-factory.js';
import type { PartialResult, Task } from '../shared/types.js';

const COORDINATOR_URL = process.env.COORDINATOR_URL ?? 'http://localhost:3000';
const WORKER_ID =
  (process.env.WORKER_ID ?? '') ||
  (() => {
    const arg = process.argv.find((a) => a.startsWith('--worker-id='));
    return arg ? arg.split('=')[1] : `worker-${process.pid}`;
  })();

let currentTaskId: string | undefined;

/** Cache of built connectors keyed by connector id. */
const connectors = new Map<string, Awaited<ReturnType<typeof createConnector>>>();

async function getConnector(task: Task) {
  const existing = connectors.get(task.connector);
  if (existing) return existing;
  const connector = await createConnector(task.connectorConfig);
  await connector.connect();
  connectors.set(task.connector, connector);
  return connector;
}

async function request<T = unknown>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(`${COORDINATOR_URL}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  });
  if (res.status === 204) return undefined as T;
  const json = (await res.json().catch(() => ({}))) as T;
  if (!res.ok) {
    throw new Error(`Coordinator ${res.status} ${path}: ${JSON.stringify(json)}`);
  }
  return json;
}

async function register(): Promise<void> {
  await request('/workers/register', {
    method: 'POST',
    body: JSON.stringify({ workerId: WORKER_ID }),
  });
  console.log(`• ${WORKER_ID} registered with ${COORDINATOR_URL}`);
}

async function heartbeat(): Promise<void> {
  await request('/workers/heartbeat', {
    method: 'POST',
    body: JSON.stringify({ workerId: WORKER_ID, currentTaskId }),
  });
}

/** Claim and execute tasks until the queue is empty, then return. */
async function workOnce(): Promise<void> {
  const task = await request<Task | null>(`/tasks/poll?workerId=${WORKER_ID}`);
  if (!task) return;

  currentTaskId = task.taskId;
  console.log(
    `  ${WORKER_ID} executing ${task.taskId} (${task.connector}.${task.table}) rows [${task.startRow}, ${task.endRow})`
  );
  try {
    const connector = await getConnector(task);
    const hasFilter = hasFilterNode(task.plan);
    const scan = findScan(task.plan);
    const rows = await connector.readRange(
      task.table,
      task.startRow,
      task.endRow,
      hasFilter ? undefined : scan.limit,
    );
    const partial: PartialResult = execute({ rows, plan: task.plan });
    await request(`/tasks/${task.taskId}/result`, {
      method: 'POST',
      body: JSON.stringify({
        queryId: task.queryId,
        partial,
        workerId: WORKER_ID,
      }),
    });
    console.log(`  ${WORKER_ID} completed ${task.taskId}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`  ${WORKER_ID} FAILED ${task.taskId}: ${message}`);
    try {
      await request(`/tasks/${task.taskId}/result`, {
        method: 'POST',
        body: JSON.stringify({ queryId: task.queryId, error: message }),
      });
    } catch {
      /* coordinator may be down; task will time out and be re-queued */
    }
  } finally {
    currentTaskId = undefined;
  }
}

function findScan(plan: Task['plan']): Extract<Task['plan'], { op: 'scan' }> {
  if (plan.op === 'scan') return plan;
  if ('child' in plan) return findScan(plan.child);
  throw new Error('Plan has no scan node');
}

function hasFilterNode(plan: Task['plan']): boolean {
  if (plan.op === 'filter') return true;
  if ('child' in plan) return hasFilterNode(plan.child);
  return false;
}

async function main(): Promise<void> {
  await register();
  setInterval(() => {
    void heartbeat().catch(() => {
      /* coordinator temporarily down */
    });
  }, HEARTBEAT_INTERVAL_MS);

  console.log(`• ${WORKER_ID} polling ${COORDINATOR_URL}`);
  for (;;) {
    try {
      await workOnce();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`  ${WORKER_ID} poll error: ${message}`);
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

main();
