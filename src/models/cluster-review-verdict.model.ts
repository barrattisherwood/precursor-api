import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IClusterReviewVerdictDoc extends Document {
  cluster_id: Types.ObjectId;
  mechanically_accurate: 'yes' | 'no' | 'unsure' | null;
  non_obvious: 'yes' | 'no' | null;
  buildable: 'yes' | 'no' | null;
  score_feels_right: 'too high' | 'about right' | 'too low' | null;
  note: string | null;
  reviewed_by: string;
  reviewed_at: Date;
  patch_version: string;
}

const ClusterReviewVerdictSchema = new Schema<IClusterReviewVerdictDoc>({
  cluster_id: { type: Schema.Types.ObjectId, ref: 'SynergyCluster', required: true },
  mechanically_accurate: { type: String, enum: ['yes', 'no', 'unsure', null], default: null },
  non_obvious: { type: String, enum: ['yes', 'no', null], default: null },
  buildable: { type: String, enum: ['yes', 'no', null], default: null },
  score_feels_right: { type: String, enum: ['too high', 'about right', 'too low', null], default: null },
  note: { type: String, default: null },
  reviewed_by: { type: String, required: true },
  reviewed_at: { type: Date, default: Date.now },
  // Copied from the cluster at time of review, so historical verdicts stay
  // meaningful even after the cluster itself changes/gets recomputed.
  patch_version: { type: String, required: true },
});

ClusterReviewVerdictSchema.index({ cluster_id: 1 }, { unique: true });
ClusterReviewVerdictSchema.index({ reviewed_at: -1 });
ClusterReviewVerdictSchema.index({ mechanically_accurate: 1 });

export const ClusterReviewVerdict = mongoose.model<IClusterReviewVerdictDoc>(
  'ClusterReviewVerdict',
  ClusterReviewVerdictSchema,
);
