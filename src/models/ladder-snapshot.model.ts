import mongoose, { Schema, Document } from 'mongoose';

export interface ILadderSnapshotDoc extends Document {
  captured_at: Date;
  patch_version: string;
  league: string;
  sample_size: number;
  rank_ceiling: number;
}

const LadderSnapshotSchema = new Schema<ILadderSnapshotDoc>({
  captured_at: { type: Date, default: Date.now },
  patch_version: { type: String, required: true },
  league: { type: String, required: true },
  sample_size: { type: Number, required: true },
  rank_ceiling: { type: Number, required: true },
});

LadderSnapshotSchema.index({ captured_at: -1 });
LadderSnapshotSchema.index({ patch_version: 1 });

export const LadderSnapshot = mongoose.model<ILadderSnapshotDoc>(
  'LadderSnapshot',
  LadderSnapshotSchema,
);
