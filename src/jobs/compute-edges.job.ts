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

const BATCH_SIZE = 500;

async function flushEdges(edges: ReturnType<typeof computeAllKeywordEdges>): Promise<number> {
  let inserted = 0;
  for (let i = 0; i < edges.length; i += BATCH_SIZE) {
    const batch = edges.slice(i, i + BATCH_SIZE);
    const ops = batch.map(edge => ({
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
    inserted += result.insertedCount;
  }
  return inserted;
}

export async function computeEdges(patchVersion: string): Promise<void> {
  logger.info({ patchVersion }, 'Starting edge computation');

  const docs = await Element.find({ patch_version: patchVersion }).lean();
  const elements = docs.map(docToElement);
  logger.info({ count: elements.length }, 'Elements loaded for edge computation');

  // Delete stale edges before reinserting
  await SynergyEdge.deleteMany({ patch_version: patchVersion });
  logger.info('Stale edges deleted');

  // Compute and flush each type separately to avoid holding all edges in memory
  const keywordEdges = computeAllKeywordEdges(elements);
  logger.info({ count: keywordEdges.length }, 'Keyword edges computed');
  const kwInserted = await flushEdges(keywordEdges);
  logger.info({ inserted: kwInserted }, 'Keyword edges written');

  const conditionEdges = computeConditionEdges(elements);
  logger.info({ count: conditionEdges.length }, 'Condition edges computed');
  const condInserted = await flushEdges(conditionEdges);
  logger.info({ inserted: condInserted }, 'Condition edges written');

  const statEdges = computeStatMultiplicationEdges(elements);
  logger.info({ count: statEdges.length }, 'Stat edges computed');
  const statInserted = await flushEdges(statEdges);

  logger.info({ kwInserted, condInserted, statInserted }, 'Edge computation complete');
}
