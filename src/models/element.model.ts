import mongoose, { Schema, Document } from 'mongoose';
import { IElement } from '@precursor/engine';

export interface IElementDoc extends Omit<IElement, '_id'>, Document {}

const ElementSchema = new Schema<IElementDoc>(
  {
    source_id: { type: String, required: true },
    name: { type: String, required: true },
    facet: {
      type: String,
      enum: ['skill_gem', 'support_gem', 'passive_node', 'ascendancy_node', 'item_affix', 'unique_item'],
      required: true,
    },
    meta: {
      gem_tags: [String],
      max_level: Number,
      support_restricted_to: [String],
      spirit_cost: Number,
      node_type: { type: String, enum: ['small', 'notable', 'keystone', 'mastery'] },
      position: { x: Number, y: Number },
      class_start: String,
      ascendancy: String,
      ascendancy_class: String,
      base_class: String,
      incomplete: Boolean,
      affix_type: { type: String, enum: ['prefix', 'suffix', 'implicit', 'unique'] },
      item_classes: [String],
      spawn_weight_tags: [String],
      tier: Number,
      league_mechanic: {
        type: String,
        enum: ['Breach', 'Sanctum', 'Ritual', 'Expedition', null],
      },
      // unique_item
      unique_item_class: String,
      base_item_name: String,
      flavour_text: String,
      // shared
      stat_lines: [String],
      description: String,
    },
    keywords: [String],
    produces: [
      {
        condition: String,
        requirement: {
          type: String,
          enum: ['always', 'on_hit', 'on_kill', 'on_crit', 'on_flask'],
        },
        chance: Number,
      },
    ],
    stats: [
      {
        stat_id: String,
        value_min: Number,
        value_max: Number,
        modifier_type: {
          type: String,
          enum: ['increased', 'more', 'added', 'base'],
        },
        condition: String,
      },
    ],
    scales_keywords: [String],
    scales_conditions: [String],
    scales_stats: [String],
    excluded_keywords: [String],
    combo_required: { type: Boolean, default: false },
    combo_produces: { type: Boolean, default: false },
    patch_version: { type: String, required: true },
    source: {
      type: String,
      enum: ['repoe_fork', 'poe2db', 'poe2wiki', 'skilltree_export', 'manual'],
      required: true,
    },
    last_updated: { type: Date, default: Date.now },
  },
  { timestamps: false },
);

ElementSchema.index({ facet: 1, patch_version: 1 });
ElementSchema.index({ keywords: 1 });
ElementSchema.index({ scales_keywords: 1 });
ElementSchema.index({ 'produces.condition': 1 });
ElementSchema.index({ 'meta.league_mechanic': 1 });
ElementSchema.index({ 'meta.ascendancy_class': 1 });
ElementSchema.index({ source_id: 1, patch_version: 1 }, { unique: true });

export const Element = mongoose.model<IElementDoc>('Element', ElementSchema);
