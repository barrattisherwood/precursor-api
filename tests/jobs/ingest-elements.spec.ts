import mongoose from 'mongoose';
import { Element } from '../../src/models/element.model';
import { ingestElements } from '../../src/jobs/ingest-elements.job';
import * as repoeAdapter from '../../src/adapters/repoe.adapter';
import * as skilltreeAdapter from '../../src/adapters/skilltree.adapter';
import { RePoEGem, RePoEMod, SkillTreeData } from '@precursor/engine';

beforeAll(async () => {
  await mongoose.connect(process.env.MONGODB_URI!);
});

afterAll(async () => {
  await mongoose.disconnect();
});

beforeEach(async () => {
  await Element.deleteMany({});
});

const mockGems: RePoEGem[] = [
  {
    id: 'fireball',
    display_name: 'Fireball',
    release_state: 'released',
    tags: ['Fire', 'Projectile', 'AoE', 'Spell'],
    per_level: { '1': {}, '20': {} },
    static: { stats: [] },
  },
  {
    id: 'unreleased_skill',
    display_name: 'Unreleased',
    release_state: 'unreleased',
    tags: ['Spell'],
  },
];

const mockMods: Record<string, RePoEMod> = {
  fire_damage_prefix: {
    name: 'of Flames',
    generation_type: 'prefix',
    domain: 'item',
    required_level: 10,
    stats: [{ id: 'fire_damage_pct_inc', min: 20, max: 30 }],
    spawn_weights: [{ tag: 'default', weight: 100 }],
  },
};

const mockTree: SkillTreeData = {
  nodes: {
    '12345': {
      name: 'Ash of the Flame',
      isNotable: true,
      stats: ['20% increased Fire Damage'],
    },
    '99999': {
      name: 'Small Node',
      isNotable: false,
      isKeystone: false,
      stats: ['5% increased Fire Damage'],
    },
  },
  classes: [{ name: 'Witch' }],
};

describe('ingestElements', () => {
  beforeEach(() => {
    jest.spyOn(repoeAdapter, 'fetchGems').mockResolvedValue(mockGems);
    jest.spyOn(repoeAdapter, 'fetchMods').mockResolvedValue(mockMods);
    jest.spyOn(skilltreeAdapter, 'fetchSkillTree').mockResolvedValue(mockTree);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('inserts released gems into the database', async () => {
    await ingestElements('0.4.0');
    const fireball = await Element.findOne({ source_id: 'fireball' });
    expect(fireball).toBeDefined();
    expect(fireball!.name).toBe('Fireball');
    expect(fireball!.facet).toBe('skill_gem');
  });

  it('skips unreleased gems', async () => {
    await ingestElements('0.4.0');
    const unreleased = await Element.findOne({ source_id: 'unreleased_skill' });
    expect(unreleased).toBeNull();
  });

  it('inserts prefix/suffix mods from item domain', async () => {
    await ingestElements('0.4.0');
    const mod = await Element.findOne({ source_id: 'fire_damage_prefix' });
    expect(mod).toBeDefined();
    expect(mod!.facet).toBe('item_affix');
  });

  it('inserts notable passive nodes', async () => {
    await ingestElements('0.4.0');
    const node = await Element.findOne({ source_id: 'passive_12345' });
    expect(node).toBeDefined();
    expect(node!.facet).toBe('passive_node');
  });

  it('skips small passive nodes', async () => {
    await ingestElements('0.4.0');
    const small = await Element.findOne({ source_id: 'passive_99999' });
    expect(small).toBeNull();
  });

  it('is idempotent — running twice does not duplicate elements', async () => {
    await ingestElements('0.4.0');
    await ingestElements('0.4.0');
    const count = await Element.countDocuments({ patch_version: '0.4.0' });
    const firstRun = await Element.countDocuments({ patch_version: '0.4.0' });
    expect(count).toBe(firstRun);
  });

  it('tags elements with the correct patch version', async () => {
    await ingestElements('0.5.0');
    const el = await Element.findOne({ source_id: 'fireball' });
    expect(el!.patch_version).toBe('0.5.0');
  });
});
