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
      edge_type,
      element_id,
      tags,
      limit = '20',
      offset = '0',
    } = req.query;

    const query: Record<string, unknown> = { active: true };
    if (facet) query.facets_represented = facet;
    if (patch) query.patch_version = patch;
    if (spirit_feasible === 'true') query.spirit_feasible = true;
    if (league_scoped === 'false') query.league_scoped = false;
    if (combo_gated === 'true') query.combo_gated = true;
    if (edge_type) query['edges.edge_type'] = edge_type;
    if (element_id) query.element_ids = element_id;
    if (tags) {
      const tagList = String(tags).split(',').map(t => t.trim()).filter(Boolean);
      if (tagList.length > 0) query.tags = { $all: tagList };
    }

    const validSortFields = ['hidden_score', 'theoretical_score', 'usage_pct'];
    const sortField = validSortFields.includes(sort as string) ? (sort as string) : 'hidden_score';

    const maxPerElement = req.query.max_per_element !== undefined
      ? Number(req.query.max_per_element)
      : 5;

    const pageSize = Math.min(Number(limit), 100);
    const pageOffset = Number(offset);

    let clusters;
    let total;

    if (maxPerElement > 0) {
      // Fetch enough candidates to fill the page after diversity filtering.
      // Over-fetch by a factor so filtering doesn't leave the page thin.
      const OVER_FETCH = 20;
      const candidates = await SynergyCluster.find(query)
        .sort({ [sortField]: -1 })
        .limit((pageOffset + pageSize) * OVER_FETCH)
        .populate('element_ids')
        .lean();

      const elementCount = new Map<string, number>();
      const filtered = candidates.filter(c => {
        const ids = (c.element_ids as unknown[]).map((e: unknown) =>
          (e as { _id?: { toString(): string }; toString?(): string })._id?.toString() ??
          (e as { toString(): string }).toString(),
        );
        const maxCount = Math.max(...ids.map(id => elementCount.get(id) ?? 0));
        if (maxCount >= maxPerElement) return false;
        ids.forEach(id => elementCount.set(id, (elementCount.get(id) ?? 0) + 1));
        return true;
      });

      total = filtered.length;
      clusters = filtered.slice(pageOffset, pageOffset + pageSize);
    } else {
      [clusters, total] = await Promise.all([
        SynergyCluster.find(query)
          .sort({ [sortField]: -1 })
          .skip(pageOffset)
          .limit(pageSize)
          .populate('element_ids')
          .lean(),
        SynergyCluster.countDocuments(query),
      ]);
    }

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
