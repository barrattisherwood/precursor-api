import { MongoMemoryServer } from 'mongodb-memory-server';

export default async function setup(): Promise<void> {
  const mongod = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongod.getUri();
  (global as unknown as Record<string, unknown>).__MONGOD__ = mongod;
}
