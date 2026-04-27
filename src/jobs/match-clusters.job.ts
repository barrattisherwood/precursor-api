import { BuildInstance } from '../models/build-instance.model';
import { SynergyCluster } from '../models/synergy-cluster.model';
import { LadderSnapshot } from '../models/ladder-snapshot.model';
import { Types } from 'mongoose';
import { logger } from '../logger';

export async function matchClusters(): Promise<void> {
  logger.info('Starting cluster matching');

  const latestSnapshot = await LadderSnapshot.findOne().sort({ captured_at: -1 });
  if (!latestSnapshot) {
    logger.warn('No ladder snapshot found — skipping cluster matching');
    return;
  }

  const clusters = await SynergyCluster.find({ active: true }).select('_id element_ids');
  logger.info({ clusters: clusters.length }, 'Active clusters loaded');

  let matched = 0;

  for (const cluster of clusters) {
    const elementIds = cluster.element_ids.map(id => new Types.ObjectId(id.toString()));

    // Find all builds in the latest snapshot that contain all cluster elements
    const buildIds = await BuildInstance.find({
      snapshot_id: latestSnapshot._id,
      active_elements: { $all: elementIds },
    }).distinct('_id');

    if (buildIds.length > 0) {
      await BuildInstance.updateMany(
        { _id: { $in: buildIds } },
        { $addToSet: { matched_clusters: cluster._id } },
      );
      matched++;
    }
  }

  logger.info({ matched }, 'Cluster matching complete');
}
