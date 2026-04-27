import { gggApi, GGGCharacter } from '../adapters/ggg-api.adapter';
import { LadderSnapshot } from '../models/ladder-snapshot.model';
import { BuildInstance } from '../models/build-instance.model';
import { Element } from '../models/element.model';
import { logger } from '../logger';

const PATCH_VERSION = process.env.PATCH_VERSION ?? '0.1.0';

export async function snapshotLadder(league: string): Promise<void> {
  const sampleSize = Number(process.env.GGG_LADDER_SAMPLE_SIZE ?? 1000);
  logger.info({ league, sampleSize }, 'Starting ladder snapshot');

  const characters = await gggApi.fetchLadder(league, sampleSize);

  const snapshot = await LadderSnapshot.create({
    captured_at: new Date(),
    patch_version: PATCH_VERSION,
    league,
    sample_size: characters.length,
    rank_ceiling: characters.length,
  });

  logger.info({ snapshotId: snapshot._id, characters: characters.length }, 'Snapshot created');

  await buildInstances(snapshot._id.toString(), characters, snapshot.captured_at);

  logger.info({ snapshotId: snapshot._id }, 'Ladder snapshot complete');
}

async function buildInstances(
  snapshotId: string,
  characters: GGGCharacter[],
  snapshotDate: Date,
): Promise<void> {
  const ops = [];

  for (let rank = 0; rank < characters.length; rank++) {
    const char = characters[rank];

    // Resolve gem element IDs from skill/support gem names
    const skillIds = await resolveElementIds(
      (char.skills ?? []).map(s => s.id),
      ['skill_gem', 'support_gem'],
    );

    // Resolve notable/keystone passive node IDs from hash list
    const passiveIds = await resolvePassiveIds(char.passives?.hashes ?? []);

    // Resolve item affix element IDs from explicit/implicit mod strings
    const affixStrings = (char.items ?? []).flatMap(item => [
      ...(item.explicitMods ?? []),
      ...(item.implicitMods ?? []),
      ...(item.craftedMods ?? []),
    ]);
    const affixIds = await resolveElementIds(affixStrings, ['item_affix']);

    const activeElements = [...new Set([...skillIds, ...passiveIds, ...affixIds])];
    const spiritCost = await computeSpiritCost(skillIds);

    ops.push({
      insertOne: {
        document: {
          snapshot_id: snapshotId,
          character_class: char.class,
          ascendancy: char.ascendancyClass ?? char.class,
          level: char.level,
          ladder_rank: rank + 1,
          active_elements: activeElements,
          skill_gems: skillIds.filter(id => id), // populated below
          support_gems: [],
          passive_nodes: passiveIds,
          ascendancy_nodes: [],
          item_affixes: affixIds,
          total_spirit_cost: spiritCost,
          matched_clusters: [],
          snapshot_date: snapshotDate,
        },
      },
    });
  }

  if (ops.length > 0) {
    await BuildInstance.bulkWrite(ops);
  }
}

async function resolveElementIds(
  names: string[],
  facets: string[],
): Promise<string[]> {
  if (names.length === 0) return [];
  const elements = await Element.find({
    $or: [{ source_id: { $in: names } }, { name: { $in: names } }],
    facet: { $in: facets },
  }).select('_id');
  return elements.map(e => e._id.toString());
}

async function resolvePassiveIds(hashes: number[]): Promise<string[]> {
  if (hashes.length === 0) return [];
  const sourceIds = hashes.map(h => `passive_${h}`);
  const elements = await Element.find({
    source_id: { $in: sourceIds },
    facet: { $in: ['passive_node', 'ascendancy_node'] },
    'meta.node_type': { $in: ['notable', 'keystone'] },
  }).select('_id');
  return elements.map(e => e._id.toString());
}

async function computeSpiritCost(elementIds: string[]): Promise<number> {
  if (elementIds.length === 0) return 0;
  const elements = await Element.find({
    _id: { $in: elementIds },
    'meta.spirit_cost': { $exists: true, $ne: null },
  }).select('meta.spirit_cost');
  return elements.reduce((sum, e) => sum + (e.meta.spirit_cost ?? 0), 0);
}
