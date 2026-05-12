import {
  findChainClusters,
  findKeywordClusters,
  computeHiddenScore,
  computeSpiritFeasibility,
  generateClusterDescription,
  IElement,
  ISynergyEdge,
} from '@precursor/engine';
import { Element } from '../models/element.model';
import { SynergyEdge } from '../models/synergy-edge.model';
import { SynergyCluster } from '../models/synergy-cluster.model';
import { BuildInstance } from '../models/build-instance.model';
import { LadderSnapshot } from '../models/ladder-snapshot.model';
import { Types } from 'mongoose';
import { logger } from '../logger';
import { isQualityCluster } from './cluster-quality';

const PATCH_VERSION = process.env.PATCH_VERSION ?? '0.1.0';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function docToElement(doc: any): IElement {
  return {
    _id: doc._id as unknown as import('mongodb').ObjectId,
    source_id: doc.source_id,
    name: doc.name,
    facet: doc.facet,
    meta: doc.meta,
    keywords: doc.keywords,
    produces: doc.produces,
    stats: doc.stats,
    scales_keywords: doc.scales_keywords,
    scales_conditions: doc.scales_conditions,
    scales_stats: doc.scales_stats,
    excluded_keywords: doc.excluded_keywords,
    combo_required: doc.combo_required,
    combo_produces: doc.combo_produces,
    patch_version: doc.patch_version,
    source: doc.source,
    last_updated: doc.last_updated,
  };
}

export async function analyzeClusters(): Promise<void> {
  const jobStartTime = new Date();
  logger.info({ patchVersion: PATCH_VERSION }, 'Starting cluster analysis');

  const elementDocs = await Element.find({ patch_version: PATCH_VERSION }).lean();
  const elements = elementDocs.map(docToElement);
  const elementMap = new Map(elements.map(e => [e._id.toString(), e]));
  logger.info({ elementCount: elements.length }, 'Elements loaded');

  // Load condition edges from DB (already computed) for chain discovery
  const conditionEdgeDocs = await SynergyEdge.find({
    patch_version: PATCH_VERSION,
    edge_type: { $in: ['condition_chain', 'condition_amplification'] },
  }).lean();

  const conditionEdges = conditionEdgeDocs.map(e => ({
    _id: e._id as unknown as import('mongodb').ObjectId,
    element_a: e.element_a as unknown as import('mongodb').ObjectId,
    element_b: e.element_b as unknown as import('mongodb').ObjectId,
    edge_type: e.edge_type as import('@precursor/engine').EdgeType,
    link: e.link,
    weight: e.weight,
    patch_version: e.patch_version,
    computed_at: e.computed_at,
  }));

  // Get latest ladder snapshot for usage counting
  const latestSnapshot = await LadderSnapshot.findOne().sort({ captured_at: -1 });
  const ladderSample = latestSnapshot?.sample_size ?? 1;

  // Load all build instances once — avoids one countDocuments query per cluster (was O(n) DB hits)
  const buildInstanceDocs = await BuildInstance.find({}, { active_elements: 1 }).lean();
  const instanceElementSets = buildInstanceDocs.map(
    bi => new Set((bi.active_elements as Types.ObjectId[]).map(id => id.toString())),
  );
  logger.info({ buildInstances: instanceElementSets.length }, 'Build instances loaded for usage counting');

  function countUsage(elementIds: string[]): number {
    return instanceElementSets.filter(set => elementIds.every(id => set.has(id))).length;
  }

  // Discover clusters from condition chains
  const partialClusters = findChainClusters(conditionEdges, elementMap, 3);

  // Load pre-computed keyword edges from DB (written by compute-edges job).
  // This avoids O(n²) recomputation here and uses the full edge set including
  // Only load edges that can contribute to clusters: minHubWeight=0.25, minEdgeWeight=0.5.
  // Edges below 0.1 can never form a hub spoke or standalone pair with current thresholds.
  const keywordEdgeDocs = await SynergyEdge.find({
    patch_version: PATCH_VERSION,
    edge_type: 'keyword_overlap',
    weight: { $gte: 0.1 },
  }).lean();

  const keywordEdges = keywordEdgeDocs.map(e => ({
    _id: e._id as unknown as import('mongodb').ObjectId,
    element_a: e.element_a as unknown as import('mongodb').ObjectId,
    element_b: e.element_b as unknown as import('mongodb').ObjectId,
    edge_type: e.edge_type as import('@precursor/engine').EdgeType,
    link: e.link,
    weight: e.weight,
    patch_version: e.patch_version,
    computed_at: e.computed_at,
  })) as ISynergyEdge[];

  // maxSpokesPerHub capped at 5: clusters of 9 elements (hub + 8 spokes) aren't equippable builds
  const keywordClusters = findKeywordClusters(keywordEdges, elementMap, 0.5, 5);

  // Free large edge arrays — no longer needed after cluster discovery
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (keywordEdgeDocs as any[]).length = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (keywordEdges as any[]).length = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (conditionEdgeDocs as any[]).length = 0;

  // Stat multiplication clusters (findStatClusters) are omitted: PoE2 RePoE data does not
  // expose "more" multiplier stat IDs in a form the algorithm can match, so it produces 0 edges.

  logger.info({ keywordClustersFound: keywordClusters.length, conditionClustersFound: partialClusters.length }, 'Edges loaded and freed');

  logger.info({ keywordClusters: keywordClusters.length, conditionClusters: partialClusters.length }, 'Cluster counts by type');
  logger.info({
    elementsWithProduces: elements.filter(e => e.produces.length > 0).length,
    elementsWithScalesConditions: elements.filter(e => e.scales_conditions.length > 0).length,
    elementsWithScalesKeywords: elements.filter(e => e.scales_keywords.length > 0).length,
    elementsWithStats: elements.filter(e => e.stats.length > 0).length,
  }, 'Element field coverage');

  const allPartial = [...partialClusters, ...keywordClusters];
  logger.info({ count: allPartial.length }, 'Partial clusters discovered');

  const rejectionStats: Record<string, number> = {};
  const filtered = allPartial.filter(partial => {
    const reason = isQualityCluster(partial, elementMap);
    if (reason) rejectionStats[reason] = (rejectionStats[reason] ?? 0) + 1;
    return reason === null;
  });
  logger.info(
    { before: allPartial.length, after: filtered.length, dropped: allPartial.length - filtered.length, rejections: rejectionStats },
    'Clusters after quality filter',
  );

  // Score and persist in batches to avoid accumulating 150k+ ops in memory at once
  const WRITE_BATCH = 2000;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let ops: any[] = [];
  let totalUpserted = 0;
  let totalModified = 0;

  async function flushOps(): Promise<void> {
    if (ops.length === 0) return;
    const result = await SynergyCluster.bulkWrite(ops);
    totalUpserted += result.upsertedCount;
    totalModified += result.modifiedCount;
    ops = [];
  }

  for (const partial of filtered) {
    const elementIds = [...partial.element_ids.map((id: { toString(): string }) => id.toString())].sort();
    const clusterKey = elementIds.join(':');

    const usageCount = countUsage(elementIds);

    const hiddenScore = computeHiddenScore(
      partial.theoretical_score,
      usageCount,
      ladderSample,
      partial.facets_represented,
      partial.edges,
    );

    const spiritFeasible = computeSpiritFeasibility(elementIds, elementMap);
    const comboGated = partial.element_ids.some((id: { toString(): string }) => elementMap.get(id.toString())?.combo_required);
    const leagueScoped = partial.element_ids.some(
      (id: { toString(): string }) => elementMap.get(id.toString())?.meta.league_mechanic != null,
    );

    const clusterElements = elementIds
      .map((id: string) => elementMap.get(id))
      .filter(Boolean) as IElement[];

    const description = generateClusterDescription(clusterElements, partial.edges.map((e: { from: { toString(): string }; to: { toString(): string }; edge_type: string; link?: Record<string, unknown> }) => ({
      from: e.from,
      to: e.to,
      edge_type: e.edge_type,
      link: e.link ?? {},
    })));

    const tags = [
      ...new Set(
        clusterElements.flatMap(e => [...(e.keywords ?? []), ...(e.scales_keywords ?? [])]),
      ),
    ];

    ops.push({
      updateOne: {
        filter: { cluster_key: clusterKey, patch_version: PATCH_VERSION },
        update: {
          $setOnInsert: {
            cluster_key: clusterKey,
            element_ids: elementIds.map((id: string) => new Types.ObjectId(id)),
          },
          $set: {
            facets_represented: partial.facets_represented,
            tags,
            edges: partial.edges.map((e: { from: { toString(): string }; to: { toString(): string }; edge_type: string; weight: number }) => ({
              from: new Types.ObjectId(e.from.toString()),
              to: new Types.ObjectId(e.to.toString()),
              edge_type: e.edge_type,
              weight: e.weight,
            })),
            theoretical_score: partial.theoretical_score,
            usage_count: usageCount,
            usage_pct: usageCount / ladderSample,
            hidden_score: hiddenScore,
            spirit_feasible: spiritFeasible,
            combo_gated: comboGated,
            league_scoped: leagueScoped,
            description,
            patch_version: PATCH_VERSION,
            computed_at: new Date(),
            invalidated_by_patch: null,
            active: true,
          },
        },
        upsert: true,
      },
    });

    if (ops.length >= WRITE_BATCH) await flushOps();
  }

  await flushOps();

  if (totalUpserted + totalModified > 0) {
    logger.info({ upserted: totalUpserted, modified: totalModified }, 'Cluster upsert complete');
  } else {
    logger.warn('No clusters found to persist');
  }

  // Deactivate any cluster not touched by this run — covers stale clusters from previous
  // algorithm configs (e.g. old maxSpokesPerHub=8 clusters) and filtered-out ones.
  // computed_at < jobStartTime means the upsert loop didn't reach it this run.
  const deactivated = await SynergyCluster.updateMany(
    { patch_version: PATCH_VERSION, active: true, computed_at: { $lt: jobStartTime } },
    { $set: { active: false } },
  );
  logger.info({ deactivated: deactivated.modifiedCount }, 'Stale/filtered clusters deactivated');
}
