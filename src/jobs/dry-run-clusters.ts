import {
  findChainClusters,
  findKeywordClusters,
  findStatClusters,
  computeStatMultiplicationEdges,
  IElement,
  ISynergyEdge,
} from '@precursor/engine';
import { Element } from '../models/element.model';
import { SynergyEdge } from '../models/synergy-edge.model';
import { Types } from 'mongoose';

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
  stat_edges: {
    computed: number;
    above_threshold: number;
    weight_min: number;
    weight_max: number;
    weight_avg: number;
  } | null;
}

function buildQualityFilter(params: Required<DryRunParams>) {
  return function isQualityCluster(
    partial: { element_ids: { toString(): string }[]; edges: unknown[] },
    elementMap: Map<string, IElement>,
  ): string | null {
    const clusterEls = partial.element_ids
      .map(id => elementMap.get(id.toString()))
      .filter(Boolean) as IElement[];

    if (clusterEls.filter(e => e.facet === 'item_affix').length > params.maxItemAffixes) return 'item_affixes';
    if (clusterEls.filter(e => e.facet === 'unique_item').length > params.maxUniqueItems) return 'unique_items';
    if (clusterEls.filter(e => e.facet === 'skill_gem').length > params.maxSkillGems) return 'skill_gems';

    const skillGems = clusterEls.filter(e => e.facet === 'skill_gem');
    if (skillGems.length > 0) {
      for (const support of clusterEls.filter(e => e.facet === 'support_gem')) {
        const restricted = support.meta.support_restricted_to;
        if (!restricted || restricted.length === 0) continue;
        const canLink = skillGems.some(skill =>
          restricted.some(tag => skill.meta.gem_tags?.includes(tag)),
        );
        if (!canLink) return 'support_linkability';
      }
    }

    return null;
  };
}

export async function dryRunClusters(overrides: DryRunParams = {}): Promise<DryRunResult> {
  const params: Required<DryRunParams> = {
    maxItemAffixes: overrides.maxItemAffixes ?? 2,
    maxUniqueItems: overrides.maxUniqueItems ?? 3,
    maxSkillGems: overrides.maxSkillGems ?? 3,
    kwHubThreshold: overrides.kwHubThreshold ?? 0.5,
    statHubThreshold: overrides.statHubThreshold ?? 0.4,
    maxSpokesPerHub: overrides.maxSpokesPerHub ?? 5,
    chainMinLength: overrides.chainMinLength ?? 3,
    kwEdgeWeightMin: overrides.kwEdgeWeightMin ?? 0,
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
  }).lean();

  const keywordEdges = keywordEdgeDocs
    .filter(e => e.weight >= params.kwEdgeWeightMin)
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

  // Stat edge weight distribution
  const stat_edges = allStatEdges.length > 0 ? {
    computed: allStatEdges.length,
    above_threshold: statEdges.length,
    weight_min: Math.min(...allStatEdges.map(e => e.weight)),
    weight_max: Math.max(...allStatEdges.map(e => e.weight)),
    weight_avg: allStatEdges.reduce((s, e) => s + e.weight, 0) / allStatEdges.length,
  } : null;

  const partialClusters = findChainClusters(conditionEdges, elementMap, params.chainMinLength);
  const keywordClusters = findKeywordClusters(keywordEdges, elementMap, params.kwHubThreshold, params.maxSpokesPerHub);
  const statClusters = findStatClusters(statEdges, elementMap, params.statHubThreshold, params.maxSpokesPerHub);

  const allPartial = [...partialClusters, ...keywordClusters, ...statClusters];

  const isQuality = buildQualityFilter(params);
  const rejectionStats: Record<string, number> = {};

  const filtered = allPartial.filter(partial => {
    const reason = isQuality(partial, elementMap);
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

  return {
    params,
    total_discovered: allPartial.length,
    total_after_filter: filtered.length,
    dropped: allPartial.length - filtered.length,
    rejections: rejectionStats,
    by_type: {
      condition_chains: partialClusters.length,
      keyword_hubs: keywordClusters.length,
      stat_hubs: statClusters.length,
    },
    by_size,
    facet_coverage,
    top_tags,
    element_field_coverage,
    stat_edges,
  };
}
