import type { WorkerInfo, WorkerStatus } from '../shared/types.js';
import { WORKER_STALE_MS } from '../shared/constants.js';

/**
 * Registry of known workers. Workers register once at boot, then send
 * heartbeats. A worker whose lastSeen is older than WORKER_STALE_MS is
 * reported as STALE (offline) by the stats/API but kept in the registry.
 */
export class WorkerRegistry {
  private workers = new Map<string, WorkerInfo>();

  register(workerId: string): WorkerInfo {
    const now = Date.now();
    const existing = this.workers.get(workerId);
    if (existing) {
      existing.lastSeen = now;
      return existing;
    }
    const info: WorkerInfo = {
      workerId,
      status: 'IDLE',
      lastSeen: now,
      registeredAt: now,
    };
    this.workers.set(workerId, info);
    return info;
  }

  heartbeat(workerId: string, currentTaskId?: string): void {
    const w = this.workers.get(workerId);
    if (!w) return;
    w.lastSeen = Date.now();
    w.status = currentTaskId ? 'BUSY' : 'IDLE';
    w.currentTaskId = currentTaskId;
  }

  setTask(workerId: string, taskId?: string): void {
    const w = this.workers.get(workerId);
    if (!w) return;
    w.currentTaskId = taskId;
    w.status = taskId ? 'BUSY' : 'IDLE';
  }

  list(): WorkerInfo[] {
    const now = Date.now();
    return [...this.workers.values()].map((w) => {
      if (w.status !== 'STALE' && now - w.lastSeen > WORKER_STALE_MS) {
        w.status = 'STALE';
      }
      return { ...w };
    });
  }

  onlineCount(): number {
    let n = 0;
    for (const w of this.workers.values()) {
      if (Date.now() - w.lastSeen <= WORKER_STALE_MS) n++;
    }
    return n;
  }
}
