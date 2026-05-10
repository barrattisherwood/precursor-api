import 'dotenv/config';
import http from 'http';
import cron from 'node-cron';
import * as Sentry from '@sentry/node';
import { runJob } from './job-runner';
import { ingestElements } from './ingest-elements.job';
import { computeEdges } from './compute-edges.job';
import { snapshotLadder } from './snapshot-ladder.job';
import { analyzeClusters } from './analyze-clusters.job';
import { snapshotEconomy } from './snapshot-economy.job';
import { matchClusters } from './match-clusters.job';
import { gggApi } from '../adapters/ggg-api.adapter';
import { connectDb } from '../app';
import { Element } from '../models/element.model';
import { SynergyEdge } from '../models/synergy-edge.model';
import { SynergyCluster } from '../models/synergy-cluster.model';
import { logger } from '../logger';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
});

process.on('unhandledRejection', reason => {
  Sentry.captureException(reason);
  logger.error({ reason }, 'Unhandled rejection in cron runner');
});

async function main(): Promise<void> {
  await connectDb();
  logger.info('Cron runner connected to MongoDB');

  await gggApi.init();

  const patchVersion = process.env.PATCH_VERSION!;
  const elementCount = await Element.countDocuments({ patch_version: patchVersion });
  if (elementCount === 0) {
    logger.info({ patchVersion }, 'No elements found — running initial seed');
    await runJob('ingest-elements', () => ingestElements(patchVersion));
    await runJob('compute-edges', () => computeEdges(patchVersion));
  } else {
    logger.info({ patchVersion, elementCount }, 'Elements present — skipping seed');
  }

  const league = process.env.LEAGUE_NAME!;

  cron.schedule(process.env.CRON_LADDER_SCHEDULE!, () =>
    runJob('snapshot-ladder', () => snapshotLadder(league)),
  );

  cron.schedule(process.env.CRON_CLUSTERS_SCHEDULE!, () =>
    runJob('analyze-clusters', () => analyzeClusters()),
  );

  cron.schedule(process.env.CRON_ECONOMY_SCHEDULE!, () =>
    runJob('snapshot-economy', () => snapshotEconomy(league)),
  );

  cron.schedule(process.env.CRON_MATCH_SCHEDULE!, () =>
    runJob('match-clusters', () => matchClusters()),
  );

  logger.info('Cron runner started — all jobs scheduled');

  const JOBS: Record<string, () => Promise<void>> = {
    'ingest-elements':  () => ingestElements(patchVersion),
    'compute-edges':    () => computeEdges(patchVersion),
    'analyze-clusters': () => analyzeClusters(),
    'snapshot-ladder':  () => snapshotLadder(league),
    'snapshot-economy': () => snapshotEconomy(league),
    'match-clusters':   () => matchClusters(),
  };

  const port = process.env.PORT ?? 3000;
  http
    .createServer((req, res) => {
      if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok', build: '20260511' }));
        return;
      }

      if (req.url === '/diagnostics' && req.method === 'GET') {
        const pv = process.env.PATCH_VERSION ?? '0.1.0';
        Promise.all([
          Element.countDocuments({ patch_version: pv }),
          SynergyEdge.countDocuments({ patch_version: pv, edge_type: 'keyword_overlap' }),
          SynergyEdge.countDocuments({ patch_version: pv, edge_type: 'condition_chain' }),
          SynergyCluster.countDocuments({ patch_version: pv, active: true }),
          SynergyCluster.countDocuments({ patch_version: pv, active: true, tags: { $exists: true, $not: { $size: 0 } } }),
        ]).then(([elements, kwEdges, condEdges, clusters, taggedClusters]) => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ patch_version: pv, elements, kwEdges, condEdges, clusters, taggedClusters }));
        }).catch(err => {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: String(err) }));
        });
        return;
      }

      const triggerMatch = req.url?.match(/^\/trigger\/([a-z-]+)$/);
      if (triggerMatch && req.method === 'POST') {
        const jobName = triggerMatch[1];
        const jobFn = JOBS[jobName];
        if (!jobFn) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Unknown job: ${jobName}`, available: Object.keys(JOBS) }));
          return;
        }
        res.writeHead(202, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'accepted', job: jobName }));
        runJob(jobName, jobFn).catch(err =>
          logger.error({ err, jobName }, 'Manual trigger failed'),
        );
        return;
      }

      res.writeHead(404);
      res.end();
    })
    .listen(port, () => logger.info({ port }, 'Cron health server listening'));
}

main().catch(err => {
  logger.error({ err }, 'Cron runner failed to start');
  process.exit(1);
});
