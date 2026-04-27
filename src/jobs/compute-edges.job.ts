import {
  computeAllKeywordEdges,
  computeConditionEdges,
  computeStatMultiplicationEdges,
} from '@precursor/engine';
import { Element, IElementDoc } from '../models/element.model';
import { SynergyEdge } from '../models/synergy-edge.model';
import { IElement } from '@precursor/engine';
import { Types } from 'mongoose';
import { logger } from '../logger';

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

export async function computeEdges(patchVersion: string): Promise<void> {
  logger.info({ patchVersion }, 'Starting edge computation');

  const docs = await Element.find({ patch_version: patchVersion }).lean();
  const elements = docs.map(docToElement);
  logger.info({ count: elements.length }, 'Elements loaded for edge computation');

  const keywordEdges = computeAllKeywordEdges(elements);
  const conditionEdges = computeConditionEdges(elements);
  const statEdges = computeStatMultiplicationEdges(elements);

  const allEdges = [...keywordEdges, ...conditionEdges, ...statEdges];
  logger.info({ count: allEdges.length }, 'Edges computed');

  // Delete stale edges for this patch before reinserting
  await SynergyEdge.deleteMany({ patch_version: patchVersion });

  const ops = allEdges.map(edge => ({
    insertOne: {
      document: {
        element_a: new Types.ObjectId(edge.element_a.toString()),
        element_b: new Types.ObjectId(edge.element_b.toString()),
        edge_type: edge.edge_type,
        link: edge.link,
        weight: edge.weight,
        patch_version: edge.patch_version,
        computed_at: edge.computed_at,
      },
    },
  }));

  const result = await SynergyEdge.bulkWrite(ops);
  logger.info({ inserted: result.insertedCount }, 'Edge computation complete');
}
