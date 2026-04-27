import 'dotenv/config';
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
}

main().catch(err => {
  logger.error({ err }, 'Cron runner failed to start');
  process.exit(1);
});
