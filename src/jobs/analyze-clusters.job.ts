import {
  findChainClusters,
  findKeywordClusters,
  computeAllKeywordEdges,
  computeStatMultiplicationEdges,
  computeHiddenScore,
  computeSpiritFeasibility,
  generateClusterDescription,
  IElement,
} from '@precursor/engine';
import { Element } from '../models/element.model';
import { SynergyEdge } from '../models/synergy-edge.model';
import { SynergyCluster } from '../models/synergy-cluster.model';
import { BuildInstance } from '../models/build-instance.model';
import { LadderSnapshot } from '../models/ladder-snapshot.model';
import { Types } from 'mongoose';
import { logger } from '../logger';

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
  logger.info({ patchVersion: PATCH_VERSION }, 'Starting cluster analysis');

  const elementDocs = await Element.find({ patch_version: PATCH_VERSION }).lean();
  const elements = elementDocs.map(docToElement);
  const elementMap = new Map(elements.map(e => [e._id.toString(), e]));

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

  // Discover clusters from condition chains
  const partialClusters = findChainClusters(conditionEdges, elementMap, 3);

  // Find keyword and stat clusters — triangles preferred over isolated pairs.
  // Pass edges at a lower threshold so weaker edges can complete triangles;
  // pairThreshold ensures standalone pairs are still held to a higher bar.
  const keywordEdges = computeAllKeywordEdges(elements).filter(e => e.weight >= 0.25);
  const statEdges = computeStatMultiplicationEdges(elements).filter(e => e.weight >= 0.25);

  const kwMax = keywordEdges.reduce((m, e) => Math.max(m, e.weight), 0);
  const stMax = statEdges.reduce((m, e) => Math.max(m, e.weight), 0);
  logger.info({ keywordEdgeCount: keywordEdges.length, kwMaxWeight: kwMax.toFixed(3), statEdgeCount: statEdges.length, stMaxWeight: stMax.toFixed(3) }, 'Edges computed');

  const keywordClusters = findKeywordClusters(keywordEdges, elementMap, 0.5);
  const statClusters = findKeywordClusters(statEdges, elementMap, 0.4);

  const kwSample = keywordClusters.slice(0, 5).map(c => ({ size: c.element_ids.length, score: c.theoretical_score.toFixed(3) }));
  logger.info({ keywordClusters: keywordClusters.length, statClusters: statClusters.length, conditionClusters: partialClusters.length, kwSample }, 'Cluster counts by type');

  const allPartial = [...partialClusters, ...keywordClusters, ...statClusters];
  logger.info({ count: allPartial.length }, 'Partial clusters discovered');

  // Score and persist
  const ops = [];

  for (const partial of allPartial) {
    const elementIds = [...partial.element_ids.map((id: { toString(): string }) => id.toString())].sort();
    const clusterKey = elementIds.join(':');

    // Count how many ladder builds contain ALL elements in this cluster
    const usageCount = await BuildInstance.countDocuments({
      active_elements: { $all: elementIds.map((id: string) => new Types.ObjectId(id)) },
    });

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
  }

  if (ops.length > 0) {
    const result = await SynergyCluster.bulkWrite(ops);
    logger.info(
      { upserted: result.upsertedCount, modified: result.modifiedCount },
      'Cluster analysis complete',
    );
  } else {
    logger.warn('No clusters found to persist');
  }
}
