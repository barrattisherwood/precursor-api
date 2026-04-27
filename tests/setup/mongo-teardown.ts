import { MongoMemoryServer } from 'mongodb-memory-server';

export default async function teardown(): Promise<void> {
  const mongod = (global as unknown as Record<string, unknown>).__MONGOD__ as MongoMemoryServer | undefined;
  await mongod?.stop();
}
