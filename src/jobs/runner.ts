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
import { dryRunClusters, DryRunParams } from './dry-run-clusters';
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
          // size distribution: how many clusters have 2, 3, 4, 5, 6+ elements
          SynergyCluster.aggregate([
            { $match: { patch_version: pv, active: true } },
            { $project: { size: { $size: '$element_ids' } } },
            { $bucket: { groupBy: '$size', boundaries: [2, 3, 4, 5, 6, 100], default: '6+', output: { count: { $sum: 1 } } } },
          ]),
          // top 10 tags by cluster count
          SynergyCluster.aggregate([
            { $match: { patch_version: pv, active: true } },
            { $unwind: '$tags' },
            { $group: { _id: '$tags', count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 10 },
          ]),
          // avg scores
          SynergyCluster.aggregate([
            { $match: { patch_version: pv, active: true } },
            { $group: { _id: null, avg_hidden: { $avg: '$hidden_score' }, avg_theoretical: { $avg: '$theoretical_score' }, avg_usage_pct: { $avg: '$usage_pct' } } },
          ]),
        ]).then(([elements, kwEdges, condEdges, clusters, taggedClusters, bySize, topTags, scores]) => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            patch_version: pv,
            elements,
            kwEdges,
            condEdges,
            clusters,
            taggedClusters,
            by_size: (bySize as { _id: number | string; count: number }[]).map(b => ({ size: b._id, count: b.count })),
            top_tags: (topTags as { _id: string; count: number }[]).map(t => ({ tag: t._id, count: t.count })),
            avg_scores: (scores as { avg_hidden: number; avg_theoretical: number; avg_usage_pct: number }[])[0] ?? null,
          }));
        }).catch(err => {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: String(err) }));
        });
        return;
      }

      if (req.url === '/trigger/analyze-clusters/dry-run' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
          let params: DryRunParams = {};
          try {
            if (body) params = JSON.parse(body) as DryRunParams;
          } catch {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid JSON body' }));
            return;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          // Stream a status line first so the caller knows the run started,
          // then write the full result when done (newline-delimited JSON).
          res.write(JSON.stringify({ status: 'running', params }) + '\n');
          dryRunClusters(params)
            .then(result => {
              res.end(JSON.stringify({ status: 'done', result }) + '\n');
            })
            .catch(err => {
              logger.error({ err }, 'Dry-run failed');
              res.end(JSON.stringify({ status: 'error', error: String(err) }) + '\n');
            });
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
