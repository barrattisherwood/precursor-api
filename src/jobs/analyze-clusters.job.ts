import {
  findChainClusters,
  findKeywordClusters,
  computeStatMultiplicationEdges,
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

  // Discover clusters from condition chains
  const partialClusters = findChainClusters(conditionEdges, elementMap, 3);

  // Load pre-computed keyword edges from DB (written by compute-edges job).
  // This avoids O(n²) recomputation here and uses the full edge set including
  // lower-weight edges (0.075–0.1) that the hub algorithm needs.
  const keywordEdgeDocs = await SynergyEdge.find({
    patch_version: PATCH_VERSION,
    edge_type: 'keyword_overlap',
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

  const statEdges = computeStatMultiplicationEdges(elements).filter(e => e.weight >= 0.1);

  // maxSpokesPerHub capped at 5: clusters of 9 elements (hub + 8 spokes) aren't equippable builds
  const keywordClusters = findKeywordClusters(keywordEdges, elementMap, 0.5, 5);
  const statClusters = findKeywordClusters(statEdges, elementMap, 0.4, 5);

  logger.info({ keywordEdgesLoaded: keywordEdges.length, conditionEdgesLoaded: conditionEdgeDocs.length, statEdgesComputed: statEdges.length }, 'Edges loaded');

  logger.info({ keywordClusters: keywordClusters.length, statClusters: statClusters.length, conditionClusters: partialClusters.length }, 'Cluster counts by type');

  const allPartial = [...partialClusters, ...keywordClusters, ...statClusters];
  logger.info({ count: allPartial.length }, 'Partial clusters discovered');

  const MAX_ITEM_AFFIXES = 2;
  const MAX_UNIQUE_ITEMS = 3;

  function isQualityCluster(partial: typeof allPartial[0]): boolean {
    const clusterEls = partial.element_ids
      .map((id: { toString(): string }) => elementMap.get(id.toString()))
      .filter(Boolean) as IElement[];

    // Item affixes are mutually exclusive per slot — more than 2 is noise
    if (clusterEls.filter(e => e.facet === 'item_affix').length > MAX_ITEM_AFFIXES) return false;

    // More than 3 unique items sharing a keyword is alternatives, not synergy
    if (clusterEls.filter(e => e.facet === 'unique_item').length > MAX_UNIQUE_ITEMS) return false;

    // Clusters of 3+ must span at least 2 facet types to represent a real build combo
    if (clusterEls.length >= 3) {
      const facets = new Set(clusterEls.map(e => e.facet));
      if (facets.size < 2) return false;
    }

    // Support gems must be link-compatible with at least one skill gem in the cluster
    const skillGems = clusterEls.filter(e => e.facet === 'skill_gem');
    for (const support of clusterEls.filter(e => e.facet === 'support_gem')) {
      const restricted = support.meta.support_restricted_to;
      if (!restricted || restricted.length === 0) continue;
      const canLink = skillGems.some(skill =>
        restricted.some(tag => skill.meta.gem_tags?.includes(tag)),
      );
      if (!canLink) return false;
    }

    return true;
  }

  const filtered = allPartial.filter(isQualityCluster);
  logger.info({ before: allPartial.length, after: filtered.length, dropped: allPartial.length - filtered.length }, 'Clusters after quality filter');

  // Score and persist
  const ops = [];

  for (const partial of filtered) {
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
  }

  if (ops.length > 0) {
    const result = await SynergyCluster.bulkWrite(ops);
    logger.info(
      { upserted: result.upsertedCount, modified: result.modifiedCount },
      'Cluster upsert complete',
    );
  } else {
    logger.warn('No clusters found to persist');
  }

  // Deactivate clusters that failed quality filters. Using $in on the rejected keys
  // (small set) rather than $nin on all valid keys avoids a massive query.
  const rejectedKeys = allPartial
    .filter(partial => !isQualityCluster(partial))
    .map(partial =>
      [...partial.element_ids.map((id: { toString(): string }) => id.toString())].sort().join(':'),
    );

  if (rejectedKeys.length > 0) {
    const deactivated = await SynergyCluster.updateMany(
      { patch_version: PATCH_VERSION, active: true, cluster_key: { $in: rejectedKeys } },
      { $set: { active: false } },
    );
    logger.info({ deactivated: deactivated.modifiedCount }, 'Low-quality clusters deactivated');
  }
}
