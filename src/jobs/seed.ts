import 'dotenv/config';
import * as Sentry from '@sentry/node';
import { connectDb } from '../app';
import { runJob } from './job-runner';
import { ingestElements } from './ingest-elements.job';
import { computeEdges } from './compute-edges.job';
import { logger } from '../logger';

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
});

async function main(): Promise<void> {
  const patchVersion = process.env.PATCH_VERSION;
  if (!patchVersion) {
    logger.error('PATCH_VERSION env var is required');
    process.exit(1);
  }

  await connectDb();
  logger.info({ patchVersion }, 'Seed runner connected');

  await runJob('ingest-elements', () => ingestElements(patchVersion));
  await runJob('compute-edges', () => computeEdges(patchVersion));

  logger.info('Seed complete');
  process.exit(0);
}

main().catch(err => {
  logger.error({ err }, 'Seed runner failed');
  process.exit(1);
});
