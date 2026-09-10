import { FUNNEL_ID } from '../src/constants.mjs';
import { PostgresStore } from '../src/store/postgres-store.mjs';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const store = new PostgresStore({ connectionString: process.env.DATABASE_URL });
try {
  const operations = await store.listExceptionalDeliveryOperations({ funnelId: FUNNEL_ID });
  console.log(JSON.stringify({
    count: operations.length,
    operations: operations.map((item) => ({
      operationId: item.id,
      userId: item.userId,
      messageType: item.messageType,
      state: item.status,
      attempts: item.attemptCount,
      lastError: item.lastErrorCode,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    })),
  }));
} finally {
  await store.close();
}
