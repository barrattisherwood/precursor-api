import {
  findChainClusters,
  findKeywordClusters,
  computeStatMultiplicationEdges,
  IElement,
  ISynergyEdge,
} from '@precursor/engine';
import { Element } from '../models/element.model';
import { SynergyEdge } from '../models/synergy-edge.model';
import { Types } from 'mongoose';
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

export interface DryRunParams {
  maxItemAffixes?: number;
  maxUniqueItems?: number;
  maxSkillGems?: number;
  kwHubThreshold?: number;
  // Overrides findKeywordClusters' minHubWeight directly, decoupling it from
  // kwHubThreshold (which the engine otherwise derives as kwHubThreshold * 0.5).
  // Lets a dry run compare hub-ratio changes in isolation without also moving
  // the standalone-pair threshold.
  kwHubWeightMin?: number;
  // When set, additionally runs keyword-hub clustering with this threshold as
  // a baseline for comparison (same kwHubThreshold/maxSpokesPerHub, only the
  // hub cutoff differs), and buckets the primary run's clusters into
  // "recovered" (touch >=1 element the baseline never covers) vs "existing"
  // (fully covered by the baseline already) — with theoretical_score stats
  // for each bucket. Lets a threshold change be judged by whether the
  // clusters it recovers are actually as good as the ones already there,
  // not just how many there are.
  compareKwHubWeightMin?: number;
  statHubThreshold?: number;
  maxSpokesPerHub?: number;
  chainMinLength?: number;
  kwEdgeWeightMin?: number;
  statEdgeWeightMin?: number;
}

export interface FacetBreakdown {
  facet: string;
  count: number;
}

export interface SizeBreakdown {
  size: number;
  count: number;
}

export interface DryRunResult {
  params: Required<DryRunParams>;
  total_discovered: number;
  total_after_filter: number;
  dropped: number;
  rejections: Record<string, number>;
  by_type: {
    condition_chains: number;
    keyword_hubs: number;
    stat_hubs: number;
  };
  by_size: SizeBreakdown[];
  facet_coverage: FacetBreakdown[];
  top_tags: { tag: string; count: number }[];
  element_field_coverage: {
    total: number;
    with_produces: number;
    with_scales_conditions: number;
    with_scales_keywords: number;
    with_stats: number;
  };
  elements_covered: number;
  stat_edges: {
    computed: number;
    above_threshold: number;
    modifier_type_counts: Record<string, number>;
    more_stat_ids_sample: string[];
    shared_stat_ids_count: number;
    shared_stat_ids_sample: string[];
    weight_min: number | null;
    weight_max: number | null;
    weight_avg: number | null;
  };
  comparison?: {
    baseline_kw_hub_weight_min: number;
    baseline_elements_covered: number;
    recovered: ClusterScoreBucket;
    existing: ClusterScoreBucket;
  };
}

export interface ClusterScoreBucket {
  count: number;
  theoretical_score_mean: number | null;
  theoretical_score_median: number | null;
}

function scoreBucket(scores: number[]): ClusterScoreBucket {
  if (scores.length === 0) {
    return { count: 0, theoretical_score_mean: null, theoretical_score_median: null };
  }
  const sorted = [...scores].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  return {
    count: scores.length,
    theoretical_score_mean: scores.reduce((s, v) => s + v, 0) / scores.length,
    theoretical_score_median: median,
  };
}


export async function dryRunClusters(overrides: DryRunParams = {}): Promise<DryRunResult> {
  const kwHubThreshold = overrides.kwHubThreshold ?? 0.5;
  const params: Required<DryRunParams> = {
    maxItemAffixes: overrides.maxItemAffixes ?? 2,
    maxUniqueItems: overrides.maxUniqueItems ?? 3,
    maxSkillGems: overrides.maxSkillGems ?? 3,
    kwHubThreshold,
    kwHubWeightMin: overrides.kwHubWeightMin ?? kwHubThreshold * 0.5,
    // -1 is a sentinel: no baseline comparison requested. A real threshold is
    // always >= 0, so this can't collide with a genuine caller-supplied value.
    compareKwHubWeightMin: overrides.compareKwHubWeightMin ?? -1,
    statHubThreshold: overrides.statHubThreshold ?? 0.4,
    maxSpokesPerHub: overrides.maxSpokesPerHub ?? 5,
    chainMinLength: overrides.chainMinLength ?? 3,
    kwEdgeWeightMin: overrides.kwEdgeWeightMin ?? 0.1,
    statEdgeWeightMin: overrides.statEdgeWeightMin ?? 0.1,
  };

  const elementDocs = await Element.find({ patch_version: PATCH_VERSION }).lean();
  const elements = elementDocs.map(docToElement);
  const elementMap = new Map(elements.map(e => [e._id.toString(), e]));

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

  const keywordEdgeDocs = await SynergyEdge.find({
    patch_version: PATCH_VERSION,
    edge_type: 'keyword_overlap',
    weight: { $gte: params.kwEdgeWeightMin },
  }).lean();

  const keywordEdges = keywordEdgeDocs
    .map(e => ({
      _id: e._id as unknown as import('mongodb').ObjectId,
      element_a: e.element_a as unknown as import('mongodb').ObjectId,
      element_b: e.element_b as unknown as import('mongodb').ObjectId,
      edge_type: e.edge_type as import('@precursor/engine').EdgeType,
      link: e.link,
      weight: e.weight,
      patch_version: e.patch_version,
      computed_at: e.computed_at,
    })) as ISynergyEdge[];

  // Stat modifier diagnostic — runs before computeStatMultiplicationEdges to expose raw data
  const modifierTypeCounts: Record<string, number> = {};
  const moreStatIds = new Set<string>();
  const increasedStatIds = new Set<string>();
  for (const el of elements) {
    for (const stat of el.stats) {
      modifierTypeCounts[stat.modifier_type] = (modifierTypeCounts[stat.modifier_type] ?? 0) + 1;
      if (stat.modifier_type === 'more') moreStatIds.add(stat.stat_id);
      if (stat.modifier_type === 'increased') increasedStatIds.add(stat.stat_id);
    }
  }
  const sharedStatIds = [...moreStatIds].filter(id => increasedStatIds.has(id));

  const allStatEdges = computeStatMultiplicationEdges(elements);
  const statEdges = allStatEdges.filter(e => e.weight >= params.statEdgeWeightMin);

  // Element field coverage — diagnose why condition chains / stat edges may be empty
  const element_field_coverage = {
    total: elements.length,
    with_produces: elements.filter(e => e.produces.length > 0).length,
    with_scales_conditions: elements.filter(e => e.scales_conditions.length > 0).length,
    with_scales_keywords: elements.filter(e => e.scales_keywords.length > 0).length,
    with_stats: elements.filter(e => e.stats.length > 0).length,
  };

  const stat_edges = {
    computed: allStatEdges.length,
    above_threshold: statEdges.length,
    modifier_type_counts: modifierTypeCounts,
    more_stat_ids_sample: [...moreStatIds].slice(0, 15),
    shared_stat_ids_count: sharedStatIds.length,
    shared_stat_ids_sample: sharedStatIds.slice(0, 10),
    weight_min: allStatEdges.length > 0 ? Math.min(...allStatEdges.map(e => e.weight)) : null,
    weight_max: allStatEdges.length > 0 ? Math.max(...allStatEdges.map(e => e.weight)) : null,
    weight_avg: allStatEdges.length > 0 ? allStatEdges.reduce((s, e) => s + e.weight, 0) / allStatEdges.length : null,
  };

  const partialClusters = findChainClusters(conditionEdges, elementMap, params.chainMinLength);
  const keywordClusters = findKeywordClusters(
    keywordEdges,
    elementMap,
    params.kwHubThreshold,
    params.maxSpokesPerHub,
    params.kwHubWeightMin,
  );

  const allPartial = [...partialClusters, ...keywordClusters];

  const rejectionStats: Record<string, number> = {};
  const filtered = allPartial.filter(partial => {
    const reason = isQualityCluster(partial, elementMap);
    if (reason) rejectionStats[reason] = (rejectionStats[reason] ?? 0) + 1;
    return reason === null;
  });

  // by_size distribution
  const sizeMap = new Map<number, number>();
  for (const c of filtered) {
    const n = c.element_ids.length;
    sizeMap.set(n, (sizeMap.get(n) ?? 0) + 1);
  }
  const by_size = [...sizeMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([size, count]) => ({ size, count }));

  // facet coverage — how many clusters include at least one element of each facet
  const facetMap = new Map<string, number>();
  for (const c of filtered) {
    const facets = new Set(
      c.element_ids
        .map((id: { toString(): string }) => elementMap.get(id.toString())?.facet)
        .filter(Boolean) as string[],
    );
    for (const f of facets) facetMap.set(f, (facetMap.get(f) ?? 0) + 1);
  }
  const facet_coverage = [...facetMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([facet, count]) => ({ facet, count }));

  // top tags
  const tagMap = new Map<string, number>();
  for (const c of filtered) {
    const seen = new Set<string>();
    for (const id of c.element_ids) {
      const el = elementMap.get((id as { toString(): string }).toString());
      for (const kw of [...(el?.keywords ?? []), ...(el?.scales_keywords ?? [])]) {
        if (!seen.has(kw)) { seen.add(kw); tagMap.set(kw, (tagMap.get(kw) ?? 0) + 1); }
      }
    }
  }
  const top_tags = [...tagMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([tag, count]) => ({ tag, count }));

  const coveredElementIds = new Set<string>();
  for (const c of filtered) {
    for (const id of c.element_ids) {
      coveredElementIds.add((id as { toString(): string }).toString());
    }
  }

  let comparison: DryRunResult['comparison'];
  if (params.compareKwHubWeightMin >= 0) {
    // Same edges/elements/maxSpokesPerHub/kwHubThreshold — only the hub cutoff
    // differs, so any difference in output is attributable to that alone.
    const baselineKeywordClusters = findKeywordClusters(
      keywordEdges,
      elementMap,
      params.kwHubThreshold,
      params.maxSpokesPerHub,
      params.compareKwHubWeightMin,
    );
    const baselineFiltered = [...partialClusters, ...baselineKeywordClusters].filter(
      partial => isQualityCluster(partial, elementMap) === null,
    );
    const baselineElementIds = new Set<string>();
    for (const c of baselineFiltered) {
      for (const id of c.element_ids) {
        baselineElementIds.add((id as { toString(): string }).toString());
      }
    }

    const recoveredScores: number[] = [];
    const existingScores: number[] = [];
    for (const c of filtered) {
      const ids = c.element_ids.map((id: { toString(): string }) => id.toString());
      const isRecovered = ids.some(id => !baselineElementIds.has(id));
      (isRecovered ? recoveredScores : existingScores).push(c.theoretical_score);
    }

    comparison = {
      baseline_kw_hub_weight_min: params.compareKwHubWeightMin,
      baseline_elements_covered: baselineElementIds.size,
      recovered: scoreBucket(recoveredScores),
      existing: scoreBucket(existingScores),
    };
  }

  return {
    params,
    total_discovered: allPartial.length,
    total_after_filter: filtered.length,
    dropped: allPartial.length - filtered.length,
    rejections: rejectionStats,
    by_type: {
      condition_chains: partialClusters.length,
      keyword_hubs: keywordClusters.length,
      stat_hubs: 0,
    },
    by_size,
    facet_coverage,
    top_tags,
    element_field_coverage,
    stat_edges,
    elements_covered: coveredElementIds.size,
    comparison,
  };
}
