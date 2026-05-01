import { Router, Request, Response } from 'express';
import { analyzeClusters } from '../jobs/analyze-clusters.job';
import { ingestElements } from '../jobs/ingest-elements.job';
import { computeEdges } from '../jobs/compute-edges.job';
import { runJob } from '../jobs/job-runner';
import { logger } from '../logger';

export const adminRouter = Router();

const ADMIN_SECRET = process.env.ADMIN_SECRET;

adminRouter.use((req: Request, res: Response, next) => {
  if (!ADMIN_SECRET || req.headers['x-admin-secret'] !== ADMIN_SECRET) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
});

adminRouter.post('/trigger/:job', async (req: Request, res: Response) => {
  const { job } = req.params;
  const patchVersion = process.env.PATCH_VERSION!;

  logger.info({ job }, 'Admin trigger received');

  res.json({ queued: job });

  switch (job) {
    case 'analyze-clusters':
      runJob('analyze-clusters', () => analyzeClusters()).catch(() => {});
      break;
    case 'ingest-elements':
      runJob('ingest-elements', () => ingestElements(patchVersion)).catch(() => {});
      break;
    case 'compute-edges':
      runJob('compute-edges', () => computeEdges(patchVersion)).catch(() => {});
      break;
    default:
      logger.warn({ job }, 'Unknown job name in admin trigger');
  }
});
