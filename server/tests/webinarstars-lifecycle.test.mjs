import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from '../src/store/memory-store.mjs';
import { localFixture } from '../src/data/local-fixture.mjs';
import { createWebinarStarsExperienceProvider } from '../src/webinarstars/experience-provider.mjs';
import { createWebinarStarsFollowUpScheduler, createWebinarStarsLifecycle } from '../src/webinarstars/lifecycle.mjs';
import { decideWebinarStarsSegment, WEBINARSTARS_FOLLOW_UP_TEMPLATES } from '../src/webinarstars/lifecycle-policy.mjs';

const finalizedAt = '2026-09-15T18:35:00.000Z';
const config = Object.freeze({ correlationSecret:'test-lifecycle-secret',webinarId:'31195',
  registrationUrl:'https://efir.webinar-stars.com/webinar/5071c97bc4cfde5',applicationUrl:'https://example.invalid/application',
  scheduledStart:'2026-09-15T17:00:00.000Z',scheduledEnd:'2026-09-15T18:31:00.000Z',pollOffsetsMinutes:[0,1,3,5,10,15],
  targetCtaShowNumbers:['1','2'],offerBoundarySeconds:3300 });

const signal = (presenceSeconds, statuses=[]) => ({ presenceSeconds,presenceRatio:Math.min(1,presenceSeconds/5460),
  targetCtaSeen:statuses.some((value)=>['seen','clicked'].includes(value)),targetCtaClicked:statuses.includes('clicked'),buttons:[] });

test('segment precedence, 55-minute boundary and both configured CTA signals', () => {
  assert.equal(decideWebinarStarsSegment({}), 'NO_SHOW');
  assert.equal(decideWebinarStarsSegment({visitorSignals:signal(3299)}), 'LEFT_BEFORE_OFFER');
  assert.equal(decideWebinarStarsSegment({visitorSignals:signal(3300)}), 'REACHED_OFFER_CTA_UNSEEN');
  assert.equal(decideWebinarStarsSegment({visitorSignals:signal(3300,['seen'])}), 'CTA_SEEN_NOT_CLICKED');
  assert.equal(decideWebinarStarsSegment({visitorSignals:signal(100,['clicked','seen'])}), 'CTA_CLICKED_NO_APPLICATION');
  assert.equal(decideWebinarStarsSegment({visitorSignals:signal(100,['clicked']),applicationSubmitted:true}), 'APPLICATION_SUBMITTED');
  for (const reason of ['sold','telegram_stop','data_deletion_requested','deleted','anonymized']) {
    assert.equal(decideWebinarStarsSegment({visitorSignals:signal(3300,['clicked']),applicationSubmitted:true,suppressionReason:reason}), 'SUPPRESSED');
  }
});

test('provider classification targets CTA 1 and CTA 2, clicked overrides seen and caps ratio', async () => {
  const { classifyVisitor } = await import('../src/webinarstars/normalize.mjs');
  const session={scheduledStart:config.scheduledStart,scheduledEnd:config.scheduledEnd};
  const visitor={presenceStarted:config.scheduledStart,presenceEnded:'2026-09-15T20:00:00Z',presenceSeconds:10800,commentCount:0,
    buttons:[{showNumber:'1',status:'seen'},{showNumber:'2',status:'clicked'},{showNumber:'3',status:'clicked'}]};
  const classified=classifyVisitor(visitor,session,config);
  assert.equal(classified.presenceRatio,1);
  assert.equal(classified.targetCtaSeen,true);
  assert.equal(classified.targetCtaClicked,true);
  assert.equal('watchedSeconds' in classified,false);
  for (const showNumber of ['1','2']) {
    for (const status of ['seen','clicked']) {
      const one=classifyVisitor({...visitor,presenceSeconds:100,buttons:[{showNumber,status}]},session,config);
      assert.equal(one.targetCtaSeen,true);
      assert.equal(one.targetCtaClicked,status==='clicked');
    }
  }
});

test('A-G staging lifecycle is idempotent, cancels late application and reuses stable URL', async () => {
  const clock={value:new Date(finalizedAt)};
  const store=new MemoryStore({now:()=>clock.value});
  store.seed(localFixture);
  const experience=createWebinarStarsExperienceProvider({store,config});
  const users={}; const originalUrls={};
  for (const name of ['A','B','C','D','E','F','G','STOP','DELETE']) {
    const user=store.createUser({funnelId:localFixture.funnel.id});
    store.upsertTelegramUser({userId:user.id,telegramUserId:`9${Object.keys(users).length+1}`});
    users[name]=user;
    originalUrls[name]=(await experience.createExperienceUrl({user})).url;
  }
  const session=[...store.providerSyncSessions.values()][0];
  const put=(name,signals)=>store.ingestProviderVisitor({provider:'webinarstars',sessionId:session.id,reportId:'report-1',visitorId:`visitor-${name}`,
    userId:users[name].id,funnelId:users[name].funnelId,correlationStatus:'matched',signals});
  put('B',signal(3299)); put('C',signal(3300)); put('D',signal(3400,['seen'])); put('E',signal(3400,['clicked']));
  put('F',signal(3400,['clicked'])); put('G',signal(3400,['clicked'])); put('STOP',signal(3400,['clicked'])); put('DELETE',signal(3400,['clicked']));
  store.createApplicationWithEvent({userId:users.F.id,funnelId:users.F.funnelId,answers:{},consent:{policyVersion:'test'},idempotencyKey:'app-f'});
  store.updateUser(users.G.id,{leadStatus:'sold'});
  store.setPromotionalEnabled(users.STOP.id,false,finalizedAt);
  store.requestDataDeletion({userId:users.DELETE.id,funnelId:users.DELETE.funnelId});
  const lifecycle=createWebinarStarsLifecycle({store,config,now:()=>clock.value});
  const first=await lifecycle.finalizeReport({session,reportId:'report-1',finalizedAt});
  assert.deepEqual(first,{decisions:9,scheduled:5,duplicates:0});
  const segments=store.listProviderSegmentDecisions().map((item)=>item.segment);
  assert.deepEqual(Object.fromEntries(segments.map((item)=>[item,segments.filter((value)=>value===item).length])),{
    NO_SHOW:1,LEFT_BEFORE_OFFER:1,REACHED_OFFER_CTA_UNSEEN:1,CTA_SEEN_NOT_CLICKED:1,CTA_CLICKED_NO_APPLICATION:1,APPLICATION_SUBMITTED:1,SUPPRESSED:3 });
  assert.deepEqual(await lifecycle.finalizeReport({session,reportId:'report-1',finalizedAt}),{decisions:0,scheduled:0,duplicates:9});

  store.createApplicationWithEvent({userId:users.E.id,funnelId:users.E.funnelId,answers:{},consent:{policyVersion:'test'},idempotencyKey:'late-app-e'});
  const templates=Object.fromEntries(Object.entries(WEBINARSTARS_FOLLOW_UP_TEMPLATES).map(([key,value])=>[key,{...value,approved:true,text:`test-${key}`,ctaLabel:'test'}]));
  const sent=[];
  clock.value=new Date('2026-09-15T19:36:00.000Z');
  const makeScheduler=(workerId)=>createWebinarStarsFollowUpScheduler({store,config,experienceProvider:experience,templates,workerId,now:()=>clock.value,
    transport:{async sendMessage(payload){sent.push(payload);return {provider:'fake',messageId:`fake-${sent.length}`};}}});
  const [one,two]=await Promise.all([makeScheduler('one').run(),makeScheduler('two').run()]);
  assert.equal(one.delivered+two.delivered,4);
  assert.equal(one.cancelled+two.cancelled,1);
  assert.equal(sent.length,4);
  for (const name of ['A','B']) {
    const payload=sent.find((item)=>item.userId===users[name].id);
    assert.equal(payload.message.variables.next_webinar_url,originalUrls[name]);
  }
  assert.equal(store.listProviderFollowUps().filter((item)=>item.status==='delivered').length,4);
});

test('unapproved placeholders fail closed without a transport call', async () => {
  const clock={value:new Date(finalizedAt)}; const store=new MemoryStore({now:()=>clock.value}); store.seed(localFixture);
  const user=store.createUser({funnelId:localFixture.funnel.id}); store.upsertTelegramUser({userId:user.id,telegramUserId:'999'});
  const experience=createWebinarStarsExperienceProvider({store,config}); await experience.createExperienceUrl({user});
  const session=[...store.providerSyncSessions.values()][0];
  await createWebinarStarsLifecycle({store,config}).finalizeReport({session,reportId:'blocked',finalizedAt});
  clock.value=new Date('2026-09-15T20:00:00Z'); let calls=0;
  const result=await createWebinarStarsFollowUpScheduler({store,config,experienceProvider:experience,now:()=>clock.value,transport:{async sendMessage(){calls+=1;}}}).run();
  assert.equal(result.blockedTemplate,1); assert.equal(calls,0);
});

test('restart after an outbound request is delivery-unknown and never sends twice', async () => {
  const clock={value:new Date(finalizedAt)}; const store=new MemoryStore({now:()=>clock.value}); store.seed(localFixture);
  const user=store.createUser({funnelId:localFixture.funnel.id}); store.upsertTelegramUser({userId:user.id,telegramUserId:'998'});
  const experience=createWebinarStarsExperienceProvider({store,config}); await experience.createExperienceUrl({user});
  const session=[...store.providerSyncSessions.values()][0];
  await createWebinarStarsLifecycle({store,config}).finalizeReport({session,reportId:'crash',finalizedAt});
  clock.value=new Date('2026-09-15T20:00:00Z');
  const claimed=store.claimProviderFollowUp({workerId:'crashed',leaseMs:1000,now:clock.value.toISOString()});
  store.markProviderFollowUpRequestStarted({id:claimed.id,workerId:'crashed'});
  clock.value=new Date('2026-09-15T20:00:02Z'); let calls=0;
  const result=await createWebinarStarsFollowUpScheduler({store,config,experienceProvider:experience,now:()=>clock.value,
    transport:{async sendMessage(){calls+=1;}},workerId:'restarted'}).run();
  assert.equal(result.claimed,0); assert.equal(calls,0);
  assert.equal(store.listProviderFollowUps()[0].status,'delivery_unknown');
});
