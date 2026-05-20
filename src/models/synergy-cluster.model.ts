import mongoose, { Schema, Document, Types } from 'mongoose';

export interface ISynergyClusterDoc extends Document {
  cluster_key: string;
  element_ids: Types.ObjectId[];
  facets_represented: string[];
  tags: string[];
  edges: Array<{
    from: Types.ObjectId;
    to: Types.ObjectId;
    edge_type: string;
    weight: number;
  }>;
  theoretical_score: number;
  usage_count: number;
  usage_pct: number;
  hidden_score: number;
  spirit_feasible: boolean;
  combo_gated: boolean;
  league_scoped: boolean;
  relevant_ascendancies: string[];
  description: string;
  patch_version: string;
  computed_at: Date;
  invalidated_by_patch: string | null;
  active: boolean;
}

const SynergyClusterSchema = new Schema<ISynergyClusterDoc>({
  cluster_key: { type: String, required: true },
  element_ids: [{ type: Schema.Types.ObjectId, ref: 'Element' }],
  facets_represented: [String],
  tags: { type: [String], default: [] },
  relevant_ascendancies: { type: [String], default: [] },
  edges: [
    {
      from: { type: Schema.Types.ObjectId, ref: 'Element' },
      to: { type: Schema.Types.ObjectId, ref: 'Element' },
      edge_type: String,
      weight: Number,
    },
  ],
  theoretical_score: { type: Number, required: true },
  usage_count: { type: Number, default: 0 },
  usage_pct: { type: Number, default: 0 },
  hidden_score: { type: Number, required: true },
  spirit_feasible: { type: Boolean, default: true },
  combo_gated: { type: Boolean, default: false },
  league_scoped: { type: Boolean, default: false },
  description: { type: String, default: '' },
  patch_version: { type: String, required: true },
  computed_at: { type: Date, default: Date.now },
  invalidated_by_patch: { type: String, default: null },
  active: { type: Boolean, default: true },
});

SynergyClusterSchema.index({ cluster_key: 1, patch_version: 1 }, { unique: true });
SynergyClusterSchema.index({ hidden_score: -1 });
SynergyClusterSchema.index({ element_ids: 1 });
SynergyClusterSchema.index({ patch_version: 1, hidden_score: -1 });
SynergyClusterSchema.index({ facets_represented: 1 });
SynergyClusterSchema.index({ tags: 1 });
SynergyClusterSchema.index({ relevant_ascendancies: 1 });
SynergyClusterSchema.index({ league_scoped: 1, active: 1 });
SynergyClusterSchema.index({ spirit_feasible: 1 });

export const SynergyCluster = mongoose.model<ISynergyClusterDoc>(
  'SynergyCluster',
  SynergyClusterSchema,
);
