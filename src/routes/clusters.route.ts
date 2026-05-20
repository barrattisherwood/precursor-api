import { Router, Request, Response } from 'express';
import { SynergyCluster } from '../models/synergy-cluster.model';
import { Element } from '../models/element.model';
import { cache } from '../middleware/cache';

export const clustersRouter = Router();

// GET /api/clusters/tags — distinct tags across all active clusters
clustersRouter.get('/tags', cache(3600), async (_req: Request, res: Response) => {
  try {
    const tags = await SynergyCluster.distinct('tags', { active: true });
    res.json((tags as string[]).filter(Boolean).sort());
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Hardcoded mapping of internal tree IDs → display names. IDs not present here are
// either placeholder slots ([DNT-UNUSED]) or blank transition nodes with no ascendancy.
const ASCENDANCY_NAMES: Record<string, string> = {
  Warrior1: 'Titan', Warrior2: 'Warbringer', Warrior3: 'Smith of Kitava',
  Sorceress1: 'Stormweaver', Sorceress2: 'Chronomancer', Sorceress3: 'Disciple of Varashta',
  Ranger1: 'Deadeye', Ranger3: 'Pathfinder',
  Mercenary1: 'Tactician', Mercenary2: 'Witchhunter', Mercenary3: 'Gemling Legionnaire',
  Monk2: 'Invoker', Monk3: 'Acolyte of Chayula',
  Witch1: 'Infernalist', Witch2: 'Blood Mage', Witch3: 'Lich',
  Huntress1: 'Amazon', Huntress3: 'Ritualist',
  Druid1: 'Oracle', Druid2: 'Shaman',
};

// Display order: original 6 EA classes first, then newer additions
const BASE_CLASS_ORDER = ['Warrior', 'Sorceress', 'Ranger', 'Monk', 'Mercenary', 'Witch', 'Huntress', 'Druid'];

// GET /api/clusters/ascendancies — ascendancy classes grouped by base class (PoE2 only)
clustersRouter.get('/ascendancies', cache(3600), async (_req: Request, res: Response) => {
  try {
    const docs = await Element.find(
      {
        facet: 'ascendancy_node',
        'meta.base_class': { $exists: true, $ne: null },
        name: { $not: /^\[DNT-UNUSED\]/ },
      },
      { 'meta.ascendancy_class': 1, 'meta.base_class': 1, _id: 0 },
    ).lean();

    const groupMap = new Map<string, Set<string>>();
    for (const doc of docs) {
      const baseClass = doc.meta.base_class as string | undefined;
      const ascClass = doc.meta.ascendancy_class as string | undefined;
      if (!baseClass || !ascClass || !ASCENDANCY_NAMES[ascClass]) continue;
      if (!groupMap.has(baseClass)) groupMap.set(baseClass, new Set());
      groupMap.get(baseClass)!.add(ascClass);
    }

    const sortedClasses = [...groupMap.keys()].sort((a, b) => {
      const ai = BASE_CLASS_ORDER.indexOf(a);
      const bi = BASE_CLASS_ORDER.indexOf(b);
      if (ai !== -1 && bi !== -1) return ai - bi;
      if (ai !== -1) return -1;
      if (bi !== -1) return 1;
      return a.localeCompare(b);
    });

    const result = sortedClasses.map(base_class => ({
      base_class,
      ascendancies: [...(groupMap.get(base_class) ?? new Set())]
        .filter(id => ASCENDANCY_NAMES[id])
        .sort()
        .map(id => ({ id, name: ASCENDANCY_NAMES[id] })),
    }));

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/clusters
// Query: sort, facet, patch, spirit_feasible, league_scoped, combo_gated, min_elements, limit, offset
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
      ascendancy_class,
      tags,
      min_elements,
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
    if (ascendancy_class) {
      query.relevant_ascendancies = ascendancy_class;
    }
    if (tags) {
      const tagList = String(tags).split(',').map(t => t.trim()).filter(Boolean);
      if (tagList.length > 0) query.tags = { $all: tagList };
    }
    if (min_elements) {
      // Filter by array length: element_ids.N exists means length > N
      const minN = Math.max(1, Number(min_elements));
      query[`element_ids.${minN - 1}`] = { $exists: true };
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
      // Pass 1: fetch all matching IDs (lightweight — element_ids only) to apply diversity
      // filter across the full result set. Avoids the over-fetch window running dry on
      // deep pages, which caused empty results past page ~5.
      const allCandidates = await SynergyCluster.find(query)
        .sort({ [sortField]: -1 })
        .select('element_ids')
        .lean();

      const elementCount = new Map<string, number>();
      const filteredIds = allCandidates
        .filter(c => {
          const ids = (c.element_ids as { toString(): string }[]).map(id => id.toString());
          const maxCount = Math.max(0, ...ids.map(id => elementCount.get(id) ?? 0));
          if (maxCount >= maxPerElement) return false;
          ids.forEach(id => elementCount.set(id, (elementCount.get(id) ?? 0) + 1));
          return true;
        })
        .map(c => c._id as { toString(): string });

      total = filteredIds.length;
      const pageIds = filteredIds.slice(pageOffset, pageOffset + pageSize);

      // Pass 2: fetch and populate only the current page's clusters.
      const orderMap = new Map(pageIds.map((id, i) => [id.toString(), i]));
      const pageClusters = await SynergyCluster.find({ _id: { $in: pageIds } })
        .populate('element_ids')
        .lean();
      pageClusters.sort(
        (a, b) =>
          (orderMap.get((a._id as { toString(): string }).toString()) ?? 0) -
          (orderMap.get((b._id as { toString(): string }).toString()) ?? 0),
      );
      clusters = pageClusters;
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
