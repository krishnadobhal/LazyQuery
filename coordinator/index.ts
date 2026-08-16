import 'dotenv/config';
import express from 'express';
import { queryRouter } from '../api/routes/query.js';
import { workerRouter } from '../api/routes/worker.js';
import { statsRouter } from '../api/routes/stats.js';
import { connectionsRouter } from '../api/routes/connections.js';
import { startMonitoring } from '../config/logger.js';
import { Cluster } from '../core/cluster.js';

const PORT = Number(process.env.PORT ?? 3000);

const cluster = new Cluster();
const { store, connectors, scheduler, queryService, registry } = cluster;

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(startMonitoring);

app.use(workerRouter(registry, queryService, scheduler));
app.use(queryRouter(queryService, scheduler));
app.use(connectionsRouter(connectors));
app.use(statsRouter(registry, scheduler, store));

app.get('/health', (_req, res) => res.json({ status: 'ok', ts: Date.now() }));

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  res.status(400).json({ error: err.message });
});

app.listen(PORT, () => {
  console.log(`• LazyQuery coordinator listening on http://localhost:${PORT}`);
});
