import mongoose from 'mongoose';
import request from 'supertest';
import app from '../../src/app';
import { SynergyCluster } from '../../src/models/synergy-cluster.model';
import { Element } from '../../src/models/element.model';
import { nodeCache } from '../../src/middleware/cache';

beforeAll(async () => {
  await mongoose.connect(process.env.MONGODB_URI!);
});

afterAll(async () => {
  await mongoose.disconnect();
});

beforeEach(async () => {
  nodeCache.flushAll();
  await SynergyCluster.deleteMany({});
  await Element.deleteMany({});
});

let elementCounter = 0;

const seedElement = async () => {
  elementCounter++;
  return Element.create({
    source_id: `test_element_${elementCounter}`,
    name: `Element ${elementCounter}`,
    facet: 'skill_gem',
    meta: {},
    keywords: ['Fire'],
    produces: [],
    stats: [],
    scales_keywords: [],
    scales_conditions: [],
    scales_stats: [],
    excluded_keywords: [],
    combo_required: false,
    combo_produces: false,
    patch_version: '0.4.0',
    source: 'repoe_fork',
    last_updated: new Date(),
  });
};

const seedCluster = async (overrides: Record<string, unknown> = {}) => {
  const el = await seedElement();
  return SynergyCluster.create({
    element_ids: [el._id],
    facets_represented: ['skill_gem'],
    edges: [],
    theoretical_score: 0.8,
    usage_count: 5,
    usage_pct: 0.005,
    hidden_score: 0.75,
    spirit_feasible: true,
    combo_gated: false,
    league_scoped: false,
    description: 'Test cluster',
    patch_version: '0.4.0',
    computed_at: new Date(),
    invalidated_by_patch: null,
    active: true,
    ...overrides,
  });
};

describe('GET /api/clusters', () => {
  it('returns an empty list when no clusters exist', async () => {
    const res = await request(app).get('/api/clusters');
    expect(res.status).toBe(200);
    expect(res.body.clusters).toHaveLength(0);
    expect(res.body.total).toBe(0);
  });

  it('returns active clusters', async () => {
    await seedCluster();
    const res = await request(app).get('/api/clusters');
    expect(res.status).toBe(200);
    expect(res.body.clusters).toHaveLength(1);
    expect(res.body.total).toBe(1);
  });

  it('excludes inactive clusters', async () => {
    await seedCluster({ active: false });
    const res = await request(app).get('/api/clusters');
    expect(res.body.clusters).toHaveLength(0);
  });

  it('filters by spirit_feasible=true', async () => {
    await seedCluster({ spirit_feasible: true });
    await seedCluster({ spirit_feasible: false });
    const res = await request(app).get('/api/clusters?spirit_feasible=true');
    expect(res.body.clusters).toHaveLength(1);
    expect(res.body.clusters[0].spirit_feasible).toBe(true);
  });

  it('excludes league_scoped clusters by default', async () => {
    await seedCluster({ league_scoped: false });
    await seedCluster({ league_scoped: true });
    const res = await request(app).get('/api/clusters');
    expect(res.body.clusters).toHaveLength(1);
    expect(res.body.clusters[0].league_scoped).toBe(false);
  });

  it('returns clusters sorted by hidden_score descending', async () => {
    await seedCluster({ hidden_score: 0.3 });
    await seedCluster({ hidden_score: 0.9 });
    await seedCluster({ hidden_score: 0.6 });
    const res = await request(app).get('/api/clusters');
    const scores = res.body.clusters.map((c: { hidden_score: number }) => c.hidden_score);
    expect(scores[0]).toBeGreaterThan(scores[1]);
    expect(scores[1]).toBeGreaterThan(scores[2]);
  });

  it('sets X-Attribution header', async () => {
    const res = await request(app).get('/api/clusters');
    expect(res.headers['x-attribution']).toBeDefined();
  });
});

describe('GET /api/clusters/:id', () => {
  it('returns 404 for unknown id', async () => {
    const res = await request(app).get('/api/clusters/000000000000000000000099');
    expect(res.status).toBe(404);
  });

  it('returns the cluster for a valid id', async () => {
    const cluster = await seedCluster();
    const res = await request(app).get(`/api/clusters/${cluster._id}`);
    expect(res.status).toBe(200);
    expect(res.body._id).toBe(cluster._id.toString());
    expect(res.body.description).toBe('Test cluster');
  });
});
