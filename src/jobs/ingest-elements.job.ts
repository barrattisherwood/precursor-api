import { normalizeGems, normalizeMods, normalizePassiveNodes } from '@precursor/engine';
import { fetchGems, fetchMods } from '../adapters/repoe.adapter';
import { fetchSkillTree } from '../adapters/skilltree.adapter';
import { Element } from '../models/element.model';
import { logger } from '../logger';

export async function ingestElements(patchVersion: string): Promise<void> {
  logger.info({ patchVersion }, 'Starting element ingestion');

  const [gemsJson, modsJson, treeData] = await Promise.all([
    fetchGems(),
    fetchMods(),
    fetchSkillTree(),
  ]);

  const gems = normalizeGems(gemsJson, patchVersion);
  const mods = normalizeMods(modsJson, patchVersion);
  const passives = normalizePassiveNodes(treeData, patchVersion);

  const all = [...gems, ...mods, ...passives];
  logger.info({ count: all.length }, 'Elements normalised');

  const ops = all.map(el => ({
    updateOne: {
      filter: { source_id: el.source_id, patch_version: el.patch_version },
      update: { $set: el },
      upsert: true,
    },
  }));

  const result = await Element.bulkWrite(ops);
  logger.info(
    { upserted: result.upsertedCount, modified: result.modifiedCount },
    'Element ingestion complete',
  );
}
