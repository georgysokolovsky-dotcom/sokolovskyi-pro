import assert from 'node:assert/strict';
import pg from 'pg';
import { loadRuntimeConfig } from '../src/config/runtime-config.mjs';

const { Pool } = pg;
const replay = process.argv.includes('--replay');
const config = loadRuntimeConfig();
if (config.mode !== 'staging') throw new Error('FUNNEL_MODE=staging is required');
const updateId = process.env.STAGING_TEST_UPDATE_ID?.trim();
if (!updateId || !/^\d+$/.test(updateId)) throw new Error('STAGING_TEST_UPDATE_ID must be a numeric Telegram update_id');

const pool = new Pool({ connectionString: config.databaseUrl, max: 1 });
try {
  const loadEvidence = async () => {
    const update = (await pool.query(`select tu.status,tu.error_stage,tu.error_code,u.id as user_id,u.first_touch,u.funnel_entry_touch,
      tg.telegram_user_id,ts.start_parameter
      from telegram_updates tu
      join users u on u.id=tu.user_id
      join telegram_users tg on tg.user_id=u.id
      join traffic_sources ts on ts.id=tu.source_id
      where tu.funnel_id=$1 and tu.update_id=$2`, ['men_webinar_v1', updateId])).rows[0];
    assert.ok(update, 'Telegram update was not found in staging PostgreSQL');
    const events = (await pool.query(`select e.event_type,e.metadata
      from events e join telegram_updates tu on tu.user_id=e.user_id
      where tu.funnel_id=$1 and tu.update_id=$2 order by e.occurred_at,e.id`, ['men_webinar_v1', updateId])).rows;
    const userCount = Number((await pool.query('select count(*) from users where funnel_id=$1', ['men_webinar_v1'])).rows[0].count);
    return { update, events, userCount };
  };

  const before = await loadEvidence();
  assert.equal(before.update.status, 'completed', `Update is ${before.update.status} at ${before.update.error_stage ?? 'unknown'} (${before.update.error_code ?? 'no_code'})`);
  assert.ok(before.update.first_touch?.source);
  assert.ok(before.update.first_touch?.medium);
  assert.ok(before.update.first_touch?.campaign);
  assert.equal(before.update.first_touch?.sourceId, before.update.funnel_entry_touch?.sourceId);
  const eventTypes = before.events.map((event) => event.event_type);
  const requiredOrder = [
    'telegram_start',
    'funnel_entry_notice_presented',
    'bonus_delivery_attempted',
    'bonus_sent',
    'webinar_invite_delivery_attempted',
    'webinar_invite_sent',
  ];
  let cursor = -1;
  for (const eventType of requiredOrder) {
    cursor = eventTypes.indexOf(eventType, cursor + 1);
    assert.notEqual(cursor, -1, `Missing or out-of-order event: ${eventType}`);
    assert.equal(eventTypes.filter((item) => item === eventType).length, 1, `Expected one event: ${eventType}`);
  }
  for (const eventType of ['funnel_entry_notice_presented', 'bonus_sent', 'webinar_invite_sent']) {
    const event = before.events.find((item) => item.event_type === eventType);
    assert.equal(event.metadata?.provider, 'telegram-bot-api');
    assert.ok(event.metadata?.provider_message_id);
  }

  if (replay) {
    const response = await fetch(config.webhookUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-telegram-bot-api-secret-token': config.webhookSecret,
      },
      body: JSON.stringify({
        update_id: Number(updateId),
        message: {
          text: `/start ${before.update.start_parameter}`,
          from: { id: Number(before.update.telegram_user_id), first_name: 'Staging replay' },
        },
      }),
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.duplicate, true);
    const after = await loadEvidence();
    assert.deepEqual(after.events, before.events, 'Duplicate replay created or changed funnel events');
    assert.equal(after.userCount, before.userCount, 'Duplicate replay created another user');
    assert.equal(after.update.user_id, before.update.user_id, 'Duplicate replay changed the update owner');
  }

  console.log(JSON.stringify({
    ok: true,
    updateStatus: before.update.status,
    requiredEventsVerified: requiredOrder.length,
    providerReceiptsVerified: 3,
    duplicateReplayVerified: replay,
  }));
} finally {
  await pool.end();
}
