import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IEconomySnapshotDoc extends Document {
  captured_at: Date;
  league: string;
  patch_version: string;
  currency_rates: Array<{
    currency_id: string;
    chaos_value: number;
    source: 'currency_exchange';
  }>;
  affix_prices: Array<{
    element_id: Types.ObjectId;
    base_item_class: string;
    avg_chaos_value: number;
    sample_size: number;
  }>;
}

const EconomySnapshotSchema = new Schema<IEconomySnapshotDoc>({
  captured_at: { type: Date, default: Date.now },
  league: { type: String, required: true },
  patch_version: { type: String, required: true },
  currency_rates: [
    {
      currency_id: String,
      chaos_value: Number,
      source: { type: String, enum: ['currency_exchange'] },
    },
  ],
  affix_prices: [
    {
      element_id: { type: Schema.Types.ObjectId, ref: 'Element' },
      base_item_class: String,
      avg_chaos_value: Number,
      sample_size: Number,
    },
  ],
});

EconomySnapshotSchema.index({ captured_at: -1 });
EconomySnapshotSchema.index({ league: 1, patch_version: 1 });

export const EconomySnapshot = mongoose.model<IEconomySnapshotDoc>(
  'EconomySnapshot',
  EconomySnapshotSchema,
);
