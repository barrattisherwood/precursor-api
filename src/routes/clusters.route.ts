import { Router, Request, Response } from 'express';
import { SynergyCluster } from '../models/synergy-cluster.model';
import { cache } from '../middleware/cache';

export const clustersRouter = Router();

// GET /api/clusters
// Query: sort, facet, patch, spirit_feasible, league_scoped, combo_gated, limit, offset
clustersRouter.get('/', cache(300), async (req: Request, res: Response) => {
  try {
    const {
      sort = 'hidden_score',
      facet,
      patch,
      spirit_feasible,
      league_scoped = 'false',
      combo_gated,
      limit = '20',
      offset = '0',
    } = req.query;

    const query: Record<string, unknown> = { active: true };
    if (facet) query.facets_represented = facet;
    if (patch) query.patch_version = patch;
    if (spirit_feasible === 'true') query.spirit_feasible = true;
    if (league_scoped === 'false') query.league_scoped = false;
    if (combo_gated === 'true') query.combo_gated = true;

    const validSortFields = ['hidden_score', 'theoretical_score', 'usage_pct'];
    const sortField = validSortFields.includes(sort as string) ? (sort as string) : 'hidden_score';

    const [clusters, total] = await Promise.all([
      SynergyCluster.find(query)
        .sort({ [sortField]: -1 })
        .skip(Number(offset))
        .limit(Math.min(Number(limit), 100))
        .populate('element_ids')
        .lean(),
      SynergyCluster.countDocuments(query),
    ]);

    res.json({ clusters, total });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/clusters/:id
clustersRouter.get('/:id', cache(300), async (req: Request, res: Response) => {
  try {
    const cluster = await SynergyCluster.findById(req.params.id).populate('element_ids').lean();
    if (!cluster) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    res.json(cluster);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});
