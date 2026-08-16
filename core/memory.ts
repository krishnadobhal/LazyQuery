import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { ConnectionConfig } from '../shared/connectors.js';
import { configDir } from './config.js';

/** A saved connection: the config + when it was last used. */
export interface SavedConnection extends ConnectionConfig {
  lastConnected: number;
}

export interface QueryHistoryEntry {
  sql: string;
  connId: string;
  status: string;
  runAt: number;
  /** Wall-clock time from submit to final status, if known. */
  durationMs?: number;
  /** Rows returned/affected, if known. */
  rowCount?: number;
}

/** Cached table list for a connection, from the last time it was actually connected. */
export interface CachedSchema {
  tables: string[];
  cachedAt: number;
}

interface MemoryFile {
  connections: SavedConnection[];
  history: QueryHistoryEntry[];
  schemas: Record<string, CachedSchema>;
}

/**
 * Claude Code-style global memory. Stores DB connections and query history
 * in the platform config dir (see core/config.ts). Passwords are stored in
 * plain text — fine for a personal dev tool, not for shared machines.
 */
export class MemoryStore {
  private file: string;
  private data: MemoryFile = { connections: [], history: [], schemas: {} };

  constructor(dir = configDir()) {
    this.file = join(dir, 'memory.json');
    this.load();
  }

  private load(): void {
    try {
      const raw = readFileSync(this.file, 'utf8');
      const parsed = JSON.parse(raw) as Partial<MemoryFile>;
      this.data = {
        connections: Array.isArray(parsed.connections) ? parsed.connections : [],
        history: Array.isArray(parsed.history) ? parsed.history : [],
        schemas: parsed.schemas && typeof parsed.schemas === 'object' ? parsed.schemas : {},
      };
    } catch {
      this.data = { connections: [], history: [], schemas: {} };
    }
  }

  private save(): void {
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileSync(this.file, JSON.stringify(this.data, null, 2), 'utf8');
    } catch {
      // Persistence is best-effort; ignore write failures.
    }
  }

  /** All saved connections, most-recently-used first. */
  listConnections(): SavedConnection[] {
    return [...this.data.connections].sort((a, b) => b.lastConnected - a.lastConnected);
  }

  getConnection(id: string): SavedConnection | undefined {
    return this.data.connections.find((c) => c.id === id);
  }

  /** Save a connection (create or update lastConnected) and record it as used. */
  upsertConnection(config: ConnectionConfig): void {
    const existing = this.data.connections.find((c) => c.id === config.id);
    if (existing) {
      Object.assign(existing, config, { lastConnected: Date.now() });
    } else {
      this.data.connections.push({ ...config, lastConnected: Date.now() });
    }
    this.save();
  }

  removeConnection(id: string): void {
    this.data.connections = this.data.connections.filter((c) => c.id !== id);
    this.save();
  }

  /** Recent query history, newest first (capped at 200). */
  listHistory(limit = 50): QueryHistoryEntry[] {
    return [...this.data.history].sort((a, b) => b.runAt - a.runAt).slice(0, limit);
  }

  recordQuery(entry: QueryHistoryEntry): void {
    this.data.history.push(entry);
    if (this.data.history.length > 200) {
      this.data.history = this.data.history.slice(-200);
    }
    this.save();
  }

  /** Cached table list from the last time this connection was actually live. */
  getSchema(connId: string): CachedSchema | undefined {
    return this.data.schemas[connId];
  }

  /** Update the cache — called opportunistically whenever a live connector answers listTables(). */
  setSchema(connId: string, tables: string[]): void {
    this.data.schemas[connId] = { tables, cachedAt: Date.now() };
    this.save();
  }
}
