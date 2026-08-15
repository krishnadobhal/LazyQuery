# LazyQuery

A distributed SQL query engine with a real-time terminal UI — inspired by Trino, DataGrip, and lazydocker.

> **Deep-dive:** for the full system design (query lifecycle, planner, scheduler, connectors, fault tolerance, TUI architecture, memory, packaging), see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

Queries are parsed, split into row-range tasks, dispatched to workers over HTTP, executed on partitioned datasets (CSV, SQLite, PostgreSQL, MySQL), and aggregated back into a single result.

```
┌─────────┐    ┌──────────────────────────────────────────┐
│  User   │───▶│                Coordinator               │
└─────────┘    │  planner → scheduler → aggregator        │
               └───────┬──────────────┬───────────────────┘
                       │              │
                       ▼              ▼
               ┌──────────┐    ┌──────────┐
               │ Worker 1 │    │ Worker 2 │      (add as many as you like)
               └────┬─────┘    └────┬─────┘
                    ▼               ▼
          CSV chunks / DB row ranges (LIMIT/OFFSET)
                              │
                              ▼
                     ┌──────────────┐
                     │  TUI (Ink)   │
                     └──────────────┘
```

## Features

- **Distributed execution** — tables are chunked into row-range tasks; any number of workers pull tasks and execute them in parallel
- **Multi-database** — query CSV files, SQLite, PostgreSQL, and MySQL through one interface; register any number of connections at runtime
- **SQL support** — `SELECT`, projections, `WHERE` (with `AND`), `LIMIT`, and `COUNT` / `SUM` / `AVG` aggregations
- **Fault tolerance** — workers heartbeat every 5s; a task not finished within 30s is re-queued to another worker
- **Terminal dashboard** — live cluster stats, worker status, query progress, and a SQL editor

## Prerequisites

- **Node.js >= 22** (Ink 7 requires it)
- npm

## Quick start

### Global install (npm)

```bash
npm install -g lazyquery

# Then run it anywhere:
lazyquery        # or: lazyq
```

### From source

```bash
# 1. Install dependencies
npm install

# 2. Generate the CSV datasets (users ~50k, orders ~30k, products ~1k rows)
npm run datasets:generate

# 3. Create the demo SQLite database (optional)
npm run db:demo

# 4. Run LazyQuery — single command, everything in one process
npm run lazy
```

That's it — the coordinator, 2 embedded workers, and the TUI all start together in a single process. No HTTP server, no ports, no extra terminals. Press `q` to quit everything. (A global install ships small sample CSV datasets, so it works in any directory — run `npm run datasets:generate` in a project dir to get the full 50k-row datasets.)

### Build & run compiled (no tsx)

`npm run lazy` runs the TypeScript source directly via `tsx` — no build step. If you want a plain-JS build:

```bash
npm run build      # compiles TypeScript → dist/ (tsc -p tsconfig.build.json)
npm start          # runs node dist/index.js
```

The npm bin (`lazyquery` / `lazyq`) automatically uses `dist/index.js` when the build exists, and falls back to tsx otherwise.

## Global memory (Claude Code-style)

LazyQuery persists your state in the platform config directory, like Claude Code:

| Platform | Location |
| --- | --- |
| Windows | `%APPDATA%\lazyquery\memory.json` |
| macOS | `~/Library/Application Support/lazyquery/memory.json` |
| Linux | `$XDG_CONFIG_HOME/lazyquery/memory.json` (or `~/.config/lazyquery`) |

`memory.json` stores:

- **Connections** — every database you've connected to, with `lastConnected` timestamps. The picker offers them sorted by recency (Claude Code memory style) and reconnects them automatically at boot. Disconnected-but-saved DBs appear with a *(reconnect)* tag.
- **Query history** — the last 200 queries (SQL, connection, status), shown under "Recent queries" in the editor.

Override the location with `LAZYQUERY_CONFIG=/path/to/dir`. Note: passwords are stored in plain text — fine for a personal tool, not shared machines.

## TUI flow

The terminal app is a DataGrip-style database client:

1. **Database picker** — on launch you see the databases you've connected to before (from global memory), plus a **Connect New Database** option at the bottom.
2. **Connect wizard** — pick a type (SQLite / PostgreSQL / MySQL), then fill in the connection fields. The connection is saved to global memory for next time.
3. **Workspace** — a left sidebar lists your databases and their tables; a shortcut-driven menu opens stats, DDL, schema info, samples, and row counts; a query editor runs SQL against the selected connection and records history.

### Shortcuts

| Key | Action |
| --- | --- |
| `↑` / `↓` | Navigate connections / tables |
| `←` / `→` | Switch database (workspace) |
| `Enter` | Select (picker / wizard) / run SQL (editor) |
| `Tab` | Enter the SQL editor |
| `Ctrl+Enter` | Run the query |
| `v` | Table view — list tables |
| `s` | Stats — row count + columns |
| `c` | Table DDL |
| `i` | Schema info — column types |
| `p` | Sample — preview 20 rows |
| `n` | Row count |
| `Esc` | Back (wizard → picker, workspace → picker, editor → menu) |
| `q` | Quit |

`npm run lazy` auto-registers `datasets/demo.sqlite` as `sqlite_demo` when it exists, and reconnects every saved connection from global memory.

## Slash commands

In the SQL editor, type a command starting with `/` and press Enter (Claude Code-style):

| Command | Action |
| --- | --- |
| `/help` | List all commands |
| `/clear` | Clear the terminal screen |
| `/history [n]` | Show the last `n` queries from global memory (default 15) |
| `/kill <queryId>` | Cancel a running/queued query |
| `/kill` | List running queries to choose from |
| `/connect` | List saved connections |
| `/connect <connId>` | Reconnect a saved connection |
| `/connect <id> <type> [host] [port] [db] [user] [password]` | Connect to a new database |

Example — cancel a stuck query:

```
/kill             → shows running queries:  a1b2c3d4  RUNNING  SELECT COUNT(*) FROM users
/kill a1b2c3d4    → Cancelled query a1b2c3d4
```

## Two ways to run

### Single-process mode (recommended)

```bash
npm run lazy
```

Everything in one process, direct in-memory wiring — no HTTP, no ports. The TUI is the app. Adjust the embedded worker count with `LAZY_WORKERS`:

```bash
LAZY_WORKERS=4 npm run lazy
```

### Distributed mode (separate processes)

For horizontal scaling across machines or terminals, run the pieces separately:

```bash
# Terminal 1 — coordinator (API on http://localhost:3000)
npm run dev:coordinator

# Terminal 2 — worker (add more on other machines with COORDINATOR_URL)
npm run dev:worker

# Terminal 3 — TUI, connects to the remote coordinator over HTTP
npm run dev:tui
```

Or start the coordinator plus two workers in one terminal:

```bash
npm run cluster
```

Workers auto-generate an ID like `worker-12345`, or pick one explicitly:

```bash
npx tsx worker/index.ts --worker-id worker-1
```

Scale horizontally by starting more workers — each polls the coordinator and picks up queued tasks.

## Running the TUI

The TUI is the app itself — `npm run lazy` boots it with everything wired in-process. To attach a TUI to a remote coordinator instead:

```bash
npm run dev:tui
```

The workspace screen shows your databases and tables in a left sidebar, a shortcut menu for table actions (stats / DDL / schema / sample / count), and a SQL editor. See the [TUI flow](#tui-flow) section for the full navigation.

## Multi-database support

LazyQuery can query any number of registered databases through a single interface. The built-in `csv` connector is always available. Connections are registered via the HTTP API (distributed mode) or programmatically in `index.ts` (single-process mode — the demo SQLite DB is auto-registered).

### Register a connection

```bash
# SQLite (local file)
curl -X POST http://localhost:3000/connections \
  -H 'content-type: application/json' \
  -d '{"id":"sqlite_demo","type":"sqlite","file":"datasets/demo.sqlite"}'

# PostgreSQL
curl -X POST http://localhost:3000/connections \
  -H 'content-type: application/json' \
  -d '{"id":"postgres_prod","type":"postgres","host":"localhost","port":5432,"database":"ecommerce","user":"postgres","password":"secret"}'

# MySQL
curl -X POST http://localhost:3000/connections \
  -H 'content-type: application/json' \
  -d '{"id":"mysql_dev","type":"mysql","host":"localhost","port":3306,"database":"inventory","user":"root","password":"secret"}'
```

### Query any registered database

Use the connection id as a table qualifier: `FROM <connection_id>.<table>`.

```sql
-- CSV (default connector — no qualifier needed)
SELECT COUNT(*) FROM users;

-- SQLite
SELECT COUNT(*) FROM sqlite_demo.users;
SELECT SUM(salary) AS total FROM sqlite_demo.users WHERE age > 20;

-- PostgreSQL / MySQL
SELECT COUNT(*) FROM postgres_prod.orders;
SELECT AVG(amount) FROM mysql_dev.orders WHERE quantity > 2;
```

> **Connection id rules:** use letters, digits and underscores (e.g. `sqlite_demo`).
> A dash is not a valid SQL identifier — it needs backtick quoting: `` FROM `sqlite-demo`.users ``.

### Explore connections

```bash
# List registered connections
curl http://localhost:3000/connections

# Tables on a connection
curl http://localhost:3000/connections/sqlite_demo/tables

# Column metadata for a table
curl http://localhost:3000/connections/sqlite_demo/tables/users
```

## API reference

| Method | Endpoint | Description |
| --- | --- | --- |
| `POST` | `/query` | Submit SQL `{"sql": "..."}` → `{"queryId": "..."}` |
| `GET` | `/query/:id` | Query status, plan, and task states |
| `GET` | `/query/:id/result` | Final result (when COMPLETED) |
| `GET` | `/queries` | List all queries (for the TUI) |
| `POST` | `/connections` | Register a database connection |
| `GET` | `/connections` | List registered connections |
| `GET` | `/connections/:id/tables` | Tables on a connection |
| `GET` | `/connections/:id/tables/:table` | Column metadata |
| `GET` | `/connections/:id/tables/:table/count` | Row count |
| `GET` | `/connections/:id/tables/:table/sample?limit=N` | Sample rows |
| `POST` | `/workers/register` | Worker registration |
| `POST` | `/workers/heartbeat` | Worker heartbeat |
| `GET` | `/workers` | Registered workers + status |
| `GET` | `/tasks/poll` | Worker claims next task |
| `POST` | `/tasks/:taskId/result` | Worker reports task result |
| `GET` | `/stats` | Cluster health (`workersOnline`, `queueLength`, `runningJobs`, …) |
| `GET` | `/health` | Liveness probe |

### Query lifecycle

```
QUEUED → PLANNING → RUNNING → COMPLETED | FAILED
```

```bash
# Submit
curl -X POST http://localhost:3000/query \
  -H 'content-type: application/json' \
  -d '{"sql":"SELECT COUNT(*) FROM users"}'
# → {"queryId":"a1b2c3d4"}

# Poll status
curl http://localhost:3000/query/a1b2c3d4

# Fetch result once COMPLETED
curl http://localhost:3000/query/a1b2c3d4/result
```

## Supported SQL

```sql
SELECT * FROM users;
SELECT name, age FROM users;
SELECT * FROM users WHERE age > 20;
SELECT * FROM users WHERE age > 20 AND city = 'Mumbai';
SELECT * FROM users LIMIT 100;

SELECT COUNT(*) FROM users;
SELECT COUNT(*) FROM users WHERE age > 20;
SELECT SUM(salary) FROM users;
SELECT AVG(age) FROM users;
SELECT SUM(salary) AS total FROM users WHERE city = 'Mumbai';
```

Built-in CSV tables: `users`, `orders`, `products` (generated into `datasets/`). Registered databases expose their own tables.

**Not supported in V1** (each returns a clear error): JOINs, `GROUP BY` / `ORDER BY` / `HAVING`, `DISTINCT`, column-to-column comparisons, `OR` conditions.

## How it works

1. **Plan** — `POST /query` parses the SQL into a logical plan (`aggregate → filter → scan`) and resolves the table via its connector (default `csv`, or `connection_id.table`)
2. **Schedule** — the scheduler counts the table's rows through the connector and splits them into chunks (`DEFAULT_CHUNK_ROWS = 25_000`); each chunk becomes a task
3. **Execute** — workers poll `GET /tasks/poll`, claim a task, read only their assigned row range (`LIMIT/OFFSET` for databases, streaming for CSV), apply filter/projection/aggregation, and POST the partial result back
4. **Aggregate** — the aggregator merges partials (sum of counts/sums; `AVG = Σsum / Σcount`) into the final result
5. **Recover** — workers heartbeat every 5s; a RUNNING task older than 30s (dead worker) is re-queued for another worker, up to 3 attempts

## Connector architecture

Every data source implements the same interface (`shared/connectors.ts`), so adding a new database type is a self-contained change:

```ts
interface Connector {
  id: string;
  type: 'csv' | 'sqlite' | 'postgres' | 'mysql';
  connect(): Promise<void>;
  listTables(): Promise<string[]>;
  getTableMetadata(table: string): Promise<TableMetadata>; // columns + types
  countRows(table: string): Promise<number>;               // chunk sizing
  readRange(table, startRow, endRow, limit?): Promise<Row[]>; // scan slice
}
```

To add a new database type (e.g. MongoDB, ClickHouse, DuckDB):

1. Implement `Connector` in `shared/connectors/<type>.ts`
2. Register it in `shared/connector-factory.ts`
3. Add the new type to the `ConnectionConfig['type']` union in `shared/connectors.ts`
4. Done — the planner, scheduler, workers, aggregator, and TUI all pick it up automatically

### Walkthrough: adding a DuckDB connector

**Step 1 — install the driver**

```bash
npm install @duckdb/node-api
```

**Step 2 — implement the interface** in `shared/connectors/duckdb.ts`:

```ts
import type { Connector, ConnectionConfig, TableMetadata } from '../connectors.js';
import type { ColumnType } from '../types.js';

function mapType(t: string): ColumnType {
  return /INT|REAL|DOUBLE|NUMERIC|DECIMAL|FLOAT/.test(t.toUpperCase()) ? 'number' : 'string';
}

export class DuckDbConnector implements Connector {
  readonly id: string;
  readonly type = 'duckdb' as const;
  readonly config: ConnectionConfig;
  private db: any; // your driver instance

  constructor(config: ConnectionConfig) {
    this.id = config.id;
    this.config = config;
  }

  async connect(): Promise<void> {
    // open the database from config.file / config.host
  }

  async listTables(): Promise<string[]> {
    // query information_schema.tables → names[]
  }

  async getTableMetadata(table: string): Promise<TableMetadata> {
    // query information_schema.columns → { columns, columnTypes }
  }

  async countRows(table: string): Promise<number> {
    // SELECT COUNT(*) FROM "table"
  }

  async readRange(table, startRow, endRow, limit?): Promise<Array<Record<string, unknown>>> {
    // SELECT * FROM "table" LIMIT size OFFSET startRow
    // normalize values: number stays number, null stays null, everything else String(v)
  }
}
```

**Step 3 — register the factory case** in `shared/connector-factory.ts`:

```ts
import { DuckDbConnector } from './connectors/duckdb.js';
// ...
case 'duckdb':
  return new DuckDbConnector(config);
```

**Step 4 — extend the type union** in `shared/connectors.ts`:

```ts
export interface ConnectionConfig {
  id: string;
  type: 'csv' | 'sqlite' | 'postgres' | 'mysql' | 'duckdb';
  // ...
}
```

**Step 5 — register and query it:**

```bash
curl -X POST http://localhost:3000/connections \
  -H 'content-type: application/json' \
  -d '{"id":"duckdb_analytics","type":"duckdb","file":"data/analytics.duckdb"}'

curl -X POST http://localhost:3000/query \
  -H 'content-type: application/json' \
  -d '{"sql":"SELECT COUNT(*) FROM duckdb_analytics.events"}'
```

That's the whole integration — chunking, distributed execution, aggregation, error handling, and the TUI all work automatically once the interface is implemented.

## Configuration

Environment variables (see `.env.example`):

| Variable | Default | Description |
| --- | --- | --- |
| `LAZY_WORKERS` | `2` | Embedded worker count in single-process mode |
| `LAZYQUERY_CONFIG` | platform dir | Override the global memory directory |
| `PORT` | `3000` | Coordinator HTTP port (distributed mode) |
| `COORDINATOR_URL` | `http://localhost:3000` | Workers/TUI: coordinator address |
| `WORKER_ID` | `worker-<pid>` | Worker identity |

## Project layout

```
bin/                 npm bin entry (lazyquery / lazyq)
index.ts             Single-process entry (npm run lazy): cluster + TUI
commands/            Slash commands (/help, /history, /kill, /connect)
core/                Cluster wiring, embedded workers, global memory (connections + history)
api/routes/          Express HTTP routes (query, worker, stats, connections)
coordinator/         Planner, scheduler, aggregator, query store, worker registry
worker/              HTTP worker poll loop, plan executor
shared/              Types, constants, connector interface + implementations
tui/                 Ink TUI (picker / connect wizard / workspace); Backend interface with
                     DirectBackend (in-process) + HttpBackend (remote)
scripts/             Dataset + demo DB generators
sample-datasets/     Bundled sample CSVs (shipped with the npm package)
datasets/            Generated CSV files + demo.sqlite (gitignored)
```
