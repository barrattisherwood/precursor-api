import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IBuildInstanceDoc extends Document {
  snapshot_id: Types.ObjectId;
  character_class: string;
  ascendancy: string;
  level: number;
  ladder_rank: number;
  active_elements: Types.ObjectId[];
  skill_gems: Types.ObjectId[];
  support_gems: Types.ObjectId[];
  passive_nodes: Types.ObjectId[];
  ascendancy_nodes: Types.ObjectId[];
  item_affixes: Types.ObjectId[];
  total_spirit_cost: number;
  matched_clusters: Types.ObjectId[];
  snapshot_date: Date;
}

const BuildInstanceSchema = new Schema<IBuildInstanceDoc>({
  snapshot_id: { type: Schema.Types.ObjectId, ref: 'LadderSnapshot', required: true },
  character_class: { type: String, required: true },
  ascendancy: { type: String, required: true },
  level: { type: Number, required: true },
  ladder_rank: { type: Number, required: true },
  active_elements: [{ type: Schema.Types.ObjectId, ref: 'Element' }],
  skill_gems: [{ type: Schema.Types.ObjectId, ref: 'Element' }],
  support_gems: [{ type: Schema.Types.ObjectId, ref: 'Element' }],
  passive_nodes: [{ type: Schema.Types.ObjectId, ref: 'Element' }],
  ascendancy_nodes: [{ type: Schema.Types.ObjectId, ref: 'Element' }],
  item_affixes: [{ type: Schema.Types.ObjectId, ref: 'Element' }],
  total_spirit_cost: { type: Number, default: 0 },
  matched_clusters: [{ type: Schema.Types.ObjectId, ref: 'SynergyCluster' }],
  snapshot_date: { type: Date, required: true },
});

BuildInstanceSchema.index({ snapshot_id: 1 });
BuildInstanceSchema.index({ active_elements: 1 }); // multikey — critical
BuildInstanceSchema.index({ matched_clusters: 1 });
BuildInstanceSchema.index({ ascendancy: 1 });

export const BuildInstance = mongoose.model<IBuildInstanceDoc>(
  'BuildInstance',
  BuildInstanceSchema,
);
