import mongoose from 'mongoose';
import request from 'supertest';
import app from '../../src/app';
import { Element } from '../../src/models/element.model';
import { SynergyEdge } from '../../src/models/synergy-edge.model';
import { nodeCache } from '../../src/middleware/cache';

beforeAll(async () => {
  await mongoose.connect(process.env.MONGODB_URI!);
});

afterAll(async () => {
  await mongoose.disconnect();
});

beforeEach(async () => {
  nodeCache.flushAll();
  await Element.deleteMany({});
  await SynergyEdge.deleteMany({});
});

let counter = 0;

const seedElement = async (name: string, facet = 'skill_gem') => {
  counter++;
  return Element.create({
    source_id: `${name.toLowerCase().replace(/\s+/g, '_')}_${counter}`,
    name,
    facet,
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

describe('GET /api/elements/:id', () => {
  it('returns 404 for unknown id', async () => {
    const res = await request(app).get('/api/elements/000000000000000000000099');
    expect(res.status).toBe(404);
  });

  it('returns the element and its edges', async () => {
    const el = await seedElement('Fireball');
    const res = await request(app).get(`/api/elements/${el._id}`);
    expect(res.status).toBe(200);
    expect(res.body.element.name).toBe('Fireball');
    expect(Array.isArray(res.body.edges)).toBe(true);
  });
});

describe('GET /api/elements/search', () => {
  it('returns 400 when q is missing', async () => {
    const res = await request(app).get('/api/elements/search');
    expect(res.status).toBe(400);
  });

  it('finds elements by name substring', async () => {
    await seedElement('Fireball');
    await seedElement('Fireblast');
    await seedElement('Glacial Cascade');
    const res = await request(app).get('/api/elements/search?q=fire');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    res.body.forEach((el: { name: string }) => {
      expect(el.name.toLowerCase()).toContain('fire');
    });
  });

  it('filters search results by facet', async () => {
    await seedElement('Fireball', 'skill_gem');
    await seedElement('Fire Support', 'support_gem');
    const res = await request(app).get('/api/elements/search?q=fire&facet=skill_gem');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].facet).toBe('skill_gem');
  });

  it('is case-insensitive', async () => {
    await seedElement('Fireball');
    const res = await request(app).get('/api/elements/search?q=FIREBALL');
    expect(res.body).toHaveLength(1);
  });
});
