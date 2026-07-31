import { Router, Request, Response } from 'express';
import { SynergyCluster } from '../models/synergy-cluster.model';
import { ClusterReviewVerdict } from '../models/cluster-review-verdict.model';

export const reviewRouter = Router();

// Internal single-user tool, not linked in public nav — but still gate it
// with the same secret-header check admin.route.ts already uses, rather
// than relying on the path being unlisted.
const ADMIN_SECRET = process.env.ADMIN_SECRET;

reviewRouter.use((req: Request, res: Response, next) => {
  if (!ADMIN_SECRET || req.headers['x-admin-secret'] !== ADMIN_SECRET) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
});

const VALID_SORT_FIELDS = ['hidden_score', 'theoretical_score', 'usage_pct'];
const VERDICT_FIELDS = ['mechanically_accurate', 'non_obvious', 'buildable', 'score_feels_right', 'note'] as const;

// GET /api/review/queue?sort=hidden_score&limit=20&offset=0&reviewed=false&min_score=&max_score=
// Returns clusters merged with any existing verdict (null fields if unreviewed).
// min_score/max_score always filter on hidden_score, independent of `sort`.
reviewRouter.get('/queue', async (req: Request, res: Response) => {
  try {
    const {
      sort = 'hidden_score',
      limit = '20',
      offset = '0',
      reviewed,
      min_score,
      max_score,
    } = req.query;

    const sortField = VALID_SORT_FIELDS.includes(sort as string) ? (sort as string) : 'hidden_score';
    const pageSize = Math.min(Number(limit) || 20, 100);
    const pageOffset = Number(offset) || 0;

    const query: Record<string, unknown> = { active: true };
    if (min_score !== undefined || max_score !== undefined) {
      const range: Record<string, number> = {};
      if (min_score !== undefined) range.$gte = Number(min_score);
      if (max_score !== undefined) range.$lte = Number(max_score);
      query.hidden_score = range;
    }

    const clusters = await SynergyCluster.find(query)
      .sort({ [sortField]: -1 })
      .skip(pageOffset)
      .limit(pageSize)
      .populate('element_ids')
      .lean();

    const clusterIds = clusters.map(c => c._id);
    const verdicts = await ClusterReviewVerdict.find({ cluster_id: { $in: clusterIds } }).lean();
    const verdictMap = new Map(verdicts.map(v => [v.cluster_id.toString(), v]));

    let merged = clusters.map(c => ({
      ...c,
      verdict: verdictMap.get((c._id as { toString(): string }).toString()) ?? null,
    }));

    if (reviewed === 'false') {
      merged = merged.filter(c => !c.verdict);
    } else if (reviewed === 'true') {
      merged = merged.filter(c => !!c.verdict);
    }

    res.json({ clusters: merged, total: merged.length });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/review/verdict
// Body: { cluster_id, mechanically_accurate?, non_obvious?, buildable?, score_feels_right?, note? }
// Upserts — merges with existing verdict rather than overwriting fields not sent.
// Only the known verdict fields are accepted; anything else in the body is
// ignored rather than spread into $set unchecked.
reviewRouter.post('/verdict', async (req: Request, res: Response) => {
  try {
    const { cluster_id, ...rest } = req.body ?? {};
    if (!cluster_id) {
      res.status(400).json({ error: 'cluster_id is required' });
      return;
    }

    const cluster = await SynergyCluster.findById(cluster_id).lean();
    if (!cluster) {
      res.status(404).json({ error: 'Cluster not found' });
      return;
    }

    const fields: Record<string, unknown> = {};
    for (const key of VERDICT_FIELDS) {
      if (key in rest) fields[key] = rest[key];
    }

    const updated = await ClusterReviewVerdict.findOneAndUpdate(
      { cluster_id },
      {
        $set: {
          ...fields,
          reviewed_by: 'barratt',
          reviewed_at: new Date(),
          patch_version: cluster.patch_version,
        },
      },
      { upsert: true, new: true },
    );

    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/review/summary — aggregate stats across all verdicts
reviewRouter.get('/summary', async (_req: Request, res: Response) => {
  try {
    const all = await ClusterReviewVerdict.find({}).lean();
    const stats = {
      total: all.length,
      mechanical_issues: all.filter(v => v.mechanically_accurate === 'no').length,
      too_obvious: all.filter(v => v.non_obvious === 'no').length,
      unbuildable: all.filter(v => v.buildable === 'no').length,
      score_mismatches: all.filter(v => v.score_feels_right && v.score_feels_right !== 'about right').length,
    };
    res.json({ stats, verdicts: all });
  } catch (err) {
    res.status(500).json({ error: 'Internal server error' });
  }
});
