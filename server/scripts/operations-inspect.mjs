import { FUNNEL_ID } from '../src/constants.mjs';
import { PostgresStore } from '../src/store/postgres-store.mjs';
import { databasePoolOptions } from '../src/store/pool-options.mjs';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const store = new PostgresStore({ connectionString: process.env.DATABASE_URL, poolOptions: databasePoolOptions(process.env) });
try {
  const operations = await store.listExceptionalDeliveryOperations({ funnelId: FUNNEL_ID });
  const providerSessions = (await store.pool.query(`select id,status,report_id,last_error_code,updated_at from provider_sync_sessions
    where status in ('finalization_pending','permanent_failure','configuration_failure') order by updated_at,id`)).rows;
  const providerFollowUps = (await store.pool.query(`select id,status,cancellation_reason,updated_at from provider_follow_ups
    where status in ('delivery_unknown','failed','blocked_template') order by updated_at,id`)).rows;
  console.log(JSON.stringify({
    count: operations.length + providerSessions.length + providerFollowUps.length,
    operations: operations.map((item) => ({
      operationId: item.id,
      messageType: item.messageType,
      state: item.status,
      attempts: item.attemptCount,
      lastError: item.lastErrorCode,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    })),
    providerSessions: providerSessions.map((item) => ({ sessionId: item.id, state: item.status,
      reportPresent: item.report_id != null, lastError: item.last_error_code, updatedAt: item.updated_at })),
    providerFollowUps: providerFollowUps.map((item) => ({ operationId: item.id, state: item.status,
      reason: item.cancellation_reason, updatedAt: item.updated_at })),
  }));
} finally {
  await store.close();
}
