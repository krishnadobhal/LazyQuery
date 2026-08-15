import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Rows per task chunk. A 50k-row CSV → 2 chunks of 25k. */
export const DEFAULT_CHUNK_ROWS = 25_000;

/** A RUNNING task older than this (no result, no fail) is considered lost and re-queued. */
export const TASK_TIMEOUT_MS = 30_000;

/** Max attempts before a task is marked failed for good. */
export const MAX_TASK_RETRIES = 3;

/** Worker heartbeat cadence. */
export const HEARTBEAT_INTERVAL_MS = 5_000;

/** A worker with no heartbeat in this window is offline/STALE. */
export const WORKER_STALE_MS = 15_000;

/** Worker poll interval when the queue is empty. */
export const POLL_INTERVAL_MS = 1_000;

/**
 * Directory the coordinator reads CSVs from. For a globally-installed
 * package, the user's cwd has no datasets/ — fall back to the bundled
 * sample datasets shipped inside the package.
 */
const PKG_DIR = dirname(fileURLToPath(import.meta.url));
const PACKAGE_DATASETS = join(PKG_DIR, '..', 'sample-datasets');

export const DATASETS_DIR = existsSync(join(process.cwd(), 'datasets'))
  ? join(process.cwd(), 'datasets')
  : PACKAGE_DATASETS;

/** Tables the coordinator knows about, mapped to their CSV file. */
export const TABLES: Record<string, string> = {
  users: 'users.csv',
  orders: 'orders.csv',
  products: 'products.csv',
};
