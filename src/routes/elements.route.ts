import { Router, Request, Response } from 'express';
import { Element } from '../models/element.model';
import { SynergyEdge } from '../models/synergy-edge.model';
import { SynergyCluster } from '../models/synergy-cluster.model';
import { cache } from '../middleware/cache';

export const elementsRouter = Router();

// GET /api/elements/search?q=fireball&facet=skill_gem
// Must be declared before /:id to avoid route collision
elementsRouter.get('/search', cache(60), async (req: Request, res: Response) => {
  try {
    const { q, facet } = req.query;
    if (!q) {
      res.status(400).json({ error: 'q parameter is required' });
      return;
    }
    const query: Record<string, unknown> = {
      name: { $regex: String(q), $options: 'i' },
    };
    if (facet) query.facet = facet;
    const results = await Element.find(query).limit(20).lean();
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/elements/:id/clusters — top clusters containing this element, sorted by hidden_score
elementsRouter.get('/:id/clusters', cache(300), async (req: Request, res: Response) => {
  try {
    const limit = Math.min(Number(req.query.limit ?? 12), 20);
    const clusters = await SynergyCluster.find({
      element_ids: req.params.id,
      active: true,
    })
      .sort({ hidden_score: -1 })
      .limit(limit)
      .populate('element_ids')
      .lean();
    res.json({ clusters });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/elements/:id — includes full edge neighbourhood
elementsRouter.get('/:id', cache(300), async (req: Request, res: Response) => {
  try {
    const element = await Element.findById(req.params.id).lean();
    if (!element) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    const edges = await SynergyEdge.find({
      $or: [{ element_a: element._id }, { element_b: element._id }],
    })
      .populate('element_a element_b')
      .lean();

    res.json({ element, edges });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});
