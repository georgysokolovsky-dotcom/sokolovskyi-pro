import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import pg from 'pg';
import { PostgresStore } from '../src/store/postgres-store.mjs';
import { localFixture } from '../src/data/local-fixture.mjs';
import { createCorrelationToken } from '../src/webinarstars/correlation.mjs';
import { createWebinarStarsExperienceProvider } from '../src/webinarstars/experience-provider.mjs';
import { createWebinarStarsSyncScheduler } from '../src/webinarstars/sync-scheduler.mjs';
import { createWebinarStarsFollowUpScheduler, createWebinarStarsLifecycle } from '../src/webinarstars/lifecycle.mjs';
import { WEBINARSTARS_FOLLOW_UP_TEMPLATES } from '../src/webinarstars/lifecycle-policy.mjs';

const { Pool } = pg;
const connectionString = process.env.FUNNEL_TEST_DATABASE_URL;
const integrationTest = connectionString ? test : test.skip;

integrationTest('PostgreSQL persists WebinarStars correlation, claims concurrently and ingests visitors once', async (t) => {
  const schema = `men_webinarstars_${randomUUID().replaceAll('-', '')}`;
  const admin = new Pool({ connectionString, max: 2 });
  await admin.query(`create schema ${schema}`);
  const pools = [];
  const makeStore = () => {
    const pool = new Pool({ connectionString, max: 4, options: `-c search_path=${schema}` });
    pools.push(pool);
    return new PostgresStore({ pool });
  };
  t.after(async () => {
    await Promise.allSettled(pools.map((pool) => pool.end()));
    await admin.query(`drop schema if exists ${schema} cascade`);
    await admin.end();
  });
  const storeA = makeStore();
  const migrationsUrl = new URL('../migrations/', import.meta.url);
  for (const name of (await readdir(migrationsUrl)).filter((item) => /^\d+.*\.sql$/.test(item)).sort()) {
    await storeA.pool.query(await readFile(new URL(name, migrationsUrl), 'utf8'));
  }
  await storeA.seed(localFixture);
  const source = await storeA.findSourceByStartParameter(localFixture.funnel.id, 'article_wife_cheating');
  const touch = { sourceId: source.id, source: source.source, medium: source.medium, campaign: source.campaign, content: source.content, articleSlug: source.articleSlug, startParameter: source.startParameter, occurredAt: '2026-09-15T19:00:00Z' };
  const claimed = await storeA.claimTelegramStart({ source, telegramUserId: 81001, telegramChatId: 81001, firstName: null, username: null, languageCode: null, firstTouch: touch, funnelEntryTouch: touch, eventMetadata: {}, eventKey: 'pg-webinarstars-entry', updateId: 81001, occurredAt: touch.occurredAt });

  const config = { correlationSecret: 'postgres-webinarstars-secret', webinarId: '32439', registrationUrl: 'https://provider.invalid/register', applicationUrl:'https://provider.invalid/application', scheduledStart: '2026-09-15T20:00:00Z', scheduledEnd: '2026-09-15T21:00:00Z', pollOffsetsMinutes: [0,1,3,5,10,15], targetCtaShowNumbers: ['1','2'], offerBoundarySeconds: 3300 };
  const experience = createWebinarStarsExperienceProvider({ store: storeA, config });
  const firstUrl = await experience.createExperienceUrl({ user: claimed.user });
  await storeA.close();

  const storeB = makeStore();
  const storeC = makeStore();
  const repeatedUrl = await createWebinarStarsExperienceProvider({ store: storeB, config }).createExperienceUrl({ user: claimed.user });
  assert.equal(firstUrl.url, repeatedUrl.url);
  const token = createCorrelationToken(claimed.user.id, config.correlationSecret);
  const client = {
    getReports: async () => ({ reports: [{ report_id: 397771, webinar_id: 32439, date_start: config.scheduledStart, date_end: config.scheduledEnd }] }),
    getReport: async () => ({ report_id: 397771, webinar_id: 32439, visitors: [{ visitor_id: 5001, utm: `utm_content=${token}`, date_start: '2026-09-15T20:02:00Z', date_end: '2026-09-15T20:32:00Z', buttons_info: [{ type: 'button', show_number: 2, status: 'clicked' }], comments: [{ text: 'discard me' }] }] }),
  };
  const now = () => new Date(config.scheduledEnd);
  const [a, b] = await Promise.all([
    createWebinarStarsSyncScheduler({ store: storeB, client, config, lifecycle:createWebinarStarsLifecycle({store:storeB,config}), now, workerId: 'pg-a' }).run(),
    createWebinarStarsSyncScheduler({ store: storeC, client, config, lifecycle:createWebinarStarsLifecycle({store:storeC,config}), now, workerId: 'pg-b' }).run(),
  ]);
  assert.equal(a.completed + b.completed, 1);
  const visitors = await storeB.listProviderVisitors();
  assert.equal(visitors.length, 1);
  assert.equal(visitors[0].correlationStatus, 'matched');
  assert.equal(JSON.stringify(visitors).includes(token), false);
  assert.equal(JSON.stringify(visitors).includes('discard me'), false);
  const events = await storeB.listUserEvents(claimed.user.id);
  assert.equal(events.filter((event) => event.eventType === 'webinarstars_cta_clicked').length, 1);
  assert.equal(events.some((event) => /^watched_/.test(event.eventType)), false);
  assert.equal((await storeC.listProviderSegmentDecisions()).length,1);
  assert.equal((await storeC.listProviderFollowUps()).length,1);
  const templates=Object.fromEntries(Object.entries(WEBINARSTARS_FOLLOW_UP_TEMPLATES).map(([key,value])=>[key,{...value,approved:true,text:'staging synthetic',ctaLabel:'test'}]));
  const sent=[]; const deliveryNow=()=>new Date('2026-09-15T21:21:00Z');
  const scheduler=(store,workerId)=>createWebinarStarsFollowUpScheduler({store,config,experienceProvider:createWebinarStarsExperienceProvider({store,config}),
    templates,workerId,now:deliveryNow,transport:{async sendMessage(payload){sent.push(payload);return {provider:'fake',messageId:`pg-${sent.length}`};}}});
  const [deliveryA,deliveryB]=await Promise.all([scheduler(storeB,'delivery-a').run(),scheduler(storeC,'delivery-b').run()]);
  assert.equal(deliveryA.delivered+deliveryB.delivered,1);
  assert.equal(sent.length,1);
  assert.equal((await storeB.listProviderFollowUps())[0].status,'delivered');

  const users={}; const initialUrls={};
  for (const [index,name] of ['A','B','C','D','E','F','G','STOP','DELETE'].entries()) {
    const updateId=82000+index;
    const entry=await storeB.claimTelegramStart({source,telegramUserId:updateId,telegramChatId:updateId,firstName:null,username:null,languageCode:null,
      firstTouch:touch,funnelEntryTouch:touch,eventMetadata:{},eventKey:`pg-lifecycle-${name}`,updateId,occurredAt:touch.occurredAt});
    users[name]=entry.user;
    initialUrls[name]=(await createWebinarStarsExperienceProvider({store:storeB,config}).createExperienceUrl({user:entry.user})).url;
  }
  const providerSignal=(presenceSeconds,targetCtaSeen=false,targetCtaClicked=false)=>({presenceSeconds,
    presenceRatio:Math.min(1,presenceSeconds/3600),targetCtaSeen,targetCtaClicked,buttons:[]});
  for (const [name,signals] of Object.entries({B:providerSignal(3299),C:providerSignal(3300),D:providerSignal(3400,true),E:providerSignal(3400,true,true),
    F:providerSignal(3400,true,true),G:providerSignal(3400,true,true),STOP:providerSignal(3400,true,true),DELETE:providerSignal(3400,true,true)})) {
    await storeB.ingestProviderVisitor({provider:'webinarstars',sessionId:visitors[0].sessionId,reportId:'397771',visitorId:`synthetic-${name}`,
      userId:users[name].id,funnelId:users[name].funnelId,correlationStatus:'matched',signals});
  }
  await storeB.createApplicationWithEvent({userId:users.F.id,funnelId:users.F.funnelId,answers:{},consent:{policyVersion:'test'},idempotencyKey:'pg-app-f'});
  await storeB.updateUser(users.G.id,{leadStatus:'sold'});
  await storeB.setPromotionalEnabled(users.STOP.id,false,'2026-09-15T21:25:00Z');
  await storeB.requestDataDeletion({userId:users.DELETE.id,funnelId:users.DELETE.funnelId});
  const stagedAt='2026-09-15T21:30:00Z';
  const lifecycle= createWebinarStarsLifecycle({store:storeB,config});
  const staged=await lifecycle.finalizeReport({session:await storeB.getProviderSyncSession(visitors[0].sessionId),reportId:'397771',finalizedAt:stagedAt});
  assert.deepEqual(staged,{decisions:9,scheduled:5,duplicates:1});
  const decisions=await storeC.listProviderSegmentDecisions();
  const count=(segment)=>decisions.filter((item)=>item.segment===segment).length;
  assert.deepEqual({A:count('NO_SHOW'),B:count('LEFT_BEFORE_OFFER'),C:count('REACHED_OFFER_CTA_UNSEEN'),D:count('CTA_SEEN_NOT_CLICKED'),
    E:count('CTA_CLICKED_NO_APPLICATION'),F:count('APPLICATION_SUBMITTED'),G:count('SUPPRESSED')},{A:1,B:1,C:1,D:1,E:2,F:1,G:3});
  await storeC.createApplicationWithEvent({userId:users.E.id,funnelId:users.E.funnelId,answers:{},consent:{policyVersion:'test'},idempotencyKey:'pg-late-app-e'});
  const lateSent=[]; const lateNow=()=>new Date('2026-09-15T22:31:00Z');
  const lateScheduler=(store,workerId)=>createWebinarStarsFollowUpScheduler({store,config,experienceProvider:createWebinarStarsExperienceProvider({store,config}),
    templates,workerId,now:lateNow,transport:{async sendMessage(payload){lateSent.push(payload);return {provider:'fake',messageId:`late-${lateSent.length}`};}}});
  const [lateA,lateB]=await Promise.all([lateScheduler(storeB,'late-a').run(),lateScheduler(storeC,'late-b').run()]);
  assert.equal(lateA.delivered+lateB.delivered,4);
  assert.equal(lateA.cancelled+lateB.cancelled,1);
  assert.equal(lateSent.length,4);
  for (const name of ['A','B']) {
    const payload=lateSent.find((item)=>item.userId===users[name].id);
    assert.equal(payload.message.variables.next_webinar_url,initialUrls[name]);
  }
});
