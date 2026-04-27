import mongoose, { Schema, Document, Types } from 'mongoose';
import { EdgeType } from '@precursor/engine';

export interface ISynergyEdgeDoc extends Document {
  element_a: Types.ObjectId;
  element_b: Types.ObjectId;
  edge_type: EdgeType;
  link: {
    shared_keywords?: string[];
    condition?: string;
    stat_a?: string;
    stat_b?: string;
  };
  weight: number;
  patch_version: string;
  computed_at: Date;
}

const SynergyEdgeSchema = new Schema<ISynergyEdgeDoc>({
  element_a: { type: Schema.Types.ObjectId, ref: 'Element', required: true },
  element_b: { type: Schema.Types.ObjectId, ref: 'Element', required: true },
  edge_type: {
    type: String,
    enum: ['keyword_overlap', 'condition_chain', 'stat_multiplication', 'condition_amplification'],
    required: true,
  },
  link: {
    shared_keywords: [String],
    condition: String,
    stat_a: String,
    stat_b: String,
  },
  weight: { type: Number, required: true, min: 0, max: 1 },
  patch_version: { type: String, required: true },
  computed_at: { type: Date, default: Date.now },
});

SynergyEdgeSchema.index({ element_a: 1, edge_type: 1 });
SynergyEdgeSchema.index({ element_b: 1, edge_type: 1 });
SynergyEdgeSchema.index({ weight: -1 });
SynergyEdgeSchema.index({ patch_version: 1 });

export const SynergyEdge = mongoose.model<ISynergyEdgeDoc>('SynergyEdge', SynergyEdgeSchema);
