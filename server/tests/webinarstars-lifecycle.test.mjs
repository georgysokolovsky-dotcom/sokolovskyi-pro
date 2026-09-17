import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from '../src/store/memory-store.mjs';
import { localFixture } from '../src/data/local-fixture.mjs';
import { createMenApplicationUrlProvider } from '../src/application/access-url.mjs';
import { WEBINARSTARS_STAGING_FOLLOW_UP_TEMPLATES } from '../src/config/webinarstars-follow-up-templates.mjs';
import { verifyFunnelToken } from '../src/security/signed-tokens.mjs';
import { createWebinarStarsExperienceProvider } from '../src/webinarstars/experience-provider.mjs';
import { createWebinarStarsFollowUpScheduler, createWebinarStarsLifecycle } from '../src/webinarstars/lifecycle.mjs';
import { decideWebinarStarsSegment, WEBINARSTARS_FOLLOW_UP_TEMPLATE_CONTRACTS } from '../src/webinarstars/lifecycle-policy.mjs';

const finalizedAt = '2026-09-15T18:35:00.000Z';
const config = Object.freeze({ correlationSecret:'test-lifecycle-secret',webinarId:'31195',
  registrationUrl:'https://efir.webinar-stars.com/webinar/5071c97bc4cfde5',
  scheduledStart:'2026-09-15T17:00:00.000Z',scheduledEnd:'2026-09-15T18:31:00.000Z',pollOffsetsMinutes:[0,1,3,5,10,15],
  targetCtaShowNumbers:['1','2'],offerBoundarySeconds:3300 });
const signingSecret='webinarstars-application-signing-test';

const signal = (presenceSeconds, statuses=[]) => ({ presenceSeconds,presenceRatio:Math.min(1,presenceSeconds/5460),
  effectivePresenceSeconds:presenceSeconds,effectivePresenceRatio:Math.min(1,presenceSeconds/5460),
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

test('approved staging templates match every segment contract and expose one allowed CTA', () => {
  const expected={
    NO_SHOW:['ws_no_show_v1','Записаться на следующий вебинар'],LEFT_BEFORE_OFFER:['ws_left_before_offer_v1','Посмотреть следующий вебинар'],
    REACHED_OFFER_CTA_UNSEEN:['ws_offer_unseen_v1','Записаться на разбор'],CTA_SEEN_NOT_CLICKED:['ws_cta_seen_v1','Перейти к разбору'],
    CTA_CLICKED_NO_APPLICATION:['ws_cta_clicked_v1','Завершить заявку'],
  };
  assert.deepEqual(Object.keys(WEBINARSTARS_STAGING_FOLLOW_UP_TEMPLATES),Object.keys(WEBINARSTARS_FOLLOW_UP_TEMPLATE_CONTRACTS));
  for (const [segment,contract] of Object.entries(WEBINARSTARS_FOLLOW_UP_TEMPLATE_CONTRACTS)) {
    const template=WEBINARSTARS_STAGING_FOLLOW_UP_TEMPLATES[segment];
    assert.equal(template.approved,true);
    assert.equal(template.templateId,contract.templateId);
    assert.equal(template.purpose,contract.purpose);
    assert.equal(template.cta,contract.cta);
    assert.deepEqual(template.variables,contract.variables);
    assert.equal(template.variables.length,1);
    assert.ok(template.text.length>0);
    assert.ok(template.ctaLabel.length>0);
    assert.deepEqual([template.templateId,template.ctaLabel],expected[segment]);
  }
});

test('provider classification targets CTA 1 and CTA 2, clicked overrides seen and caps ratio', async () => {
  const { classifyVisitor } = await import('../src/webinarstars/normalize.mjs');
  const session={scheduledStart:config.scheduledStart,scheduledEnd:config.scheduledEnd};
  const visitor={presenceStarted:config.scheduledStart,presenceEnded:'2026-09-15T20:00:00Z',presenceSeconds:10800,commentCount:0,
    buttons:[{showNumber:'1',status:'seen'},{showNumber:'2',status:'clicked'},{showNumber:'3',status:'clicked'}]};
  const classified=classifyVisitor(visitor,session,config);
  assert.equal(classified.presenceRatio,1);
  assert.equal(classified.effectivePresenceSeconds,5460);
  assert.equal(classified.effectivePresenceRatio,1);
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

test('waiting-room time never advances the 3300-second offer boundary', async () => {
  const { classifyVisitor } = await import('../src/webinarstars/normalize.mjs');
  const session={scheduledStart:config.scheduledStart,scheduledEnd:config.scheduledEnd};
  const at=(minutes)=>new Date(new Date(config.scheduledStart).getTime()+minutes*60_000).toISOString();
  const classify=(startMinutes,endMinutes)=>{
    const start=at(startMinutes),end=at(endMinutes);
    const raw=Math.floor((new Date(end)-new Date(start))/1000);
    return classifyVisitor({presenceStarted:start,presenceEnded:end,presenceSeconds:raw,buttons:[],commentCount:0},session,config);
  };
  const cases=[
    [-40,5,2700,300,'LEFT_BEFORE_OFFER'],
    [-40,20,3600,1200,'LEFT_BEFORE_OFFER'],
    [0,55,3300,3300,'REACHED_OFFER_CTA_UNSEEN'],
    [10,20,600,600,'LEFT_BEFORE_OFFER'],
    [-40,56,5760,3360,'REACHED_OFFER_CTA_UNSEEN'],
    [80,110,1800,660,'LEFT_BEFORE_OFFER'],
    [-70,-10,3600,0,'LEFT_BEFORE_OFFER'],
  ];
  for (const [start,end,raw,effective,segment] of cases) {
    const result=classify(start,end);
    assert.equal(result.presenceSeconds,raw);
    assert.equal(result.effectivePresenceSeconds,effective);
    assert.equal(result.effectivePresenceRatio,Math.min(1,effective/5460));
    assert.equal(decideWebinarStarsSegment({visitorSignals:result}),segment);
  }
  const reversed=classifyVisitor({presenceStarted:at(10),presenceEnded:at(5),presenceSeconds:null,buttons:[]},session,config);
  assert.equal(reversed.effectivePresenceSeconds,null);
  assert.equal(reversed.timingValid,false);
  assert.throws(()=>decideWebinarStarsSegment({visitorSignals:reversed}),/effective_presence_unavailable/);
  const invalid=classifyVisitor({presenceStarted:null,presenceEnded:at(5),presenceSeconds:null,buttons:[]},session,config);
  assert.equal(invalid.timingValid,false);
  assert.throws(()=>decideWebinarStarsSegment({visitorSignals:invalid}),/effective_presence_unavailable/);
});

test('A-G staging lifecycle delivers every approved template once with bound URLs', async () => {
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

  const sent=[];
  clock.value=new Date('2026-09-15T19:36:00.000Z');
  const applicationUrlProvider=createMenApplicationUrlProvider({signingSecret,applicationReference:'https://example.invalid/application',now:()=>clock.value});
  const makeScheduler=(workerId)=>createWebinarStarsFollowUpScheduler({store,config,experienceProvider:experience,workerId,now:()=>clock.value,
    applicationUrlProvider,templates:WEBINARSTARS_STAGING_FOLLOW_UP_TEMPLATES,
    transport:{async sendMessage(payload){sent.push(payload);return {provider:'fake',messageId:`fake-${sent.length}`};}}});
  const [one,two]=await Promise.all([makeScheduler('one').run(),makeScheduler('two').run()]);
  assert.equal(one.delivered+two.delivered,5);
  assert.equal(sent.length,5);
  assert.equal(new Set(sent.map((item)=>item.message.templateId)).size,5);
  assert.equal(sent.every((item)=>item.message.buttons.length===1),true);
  for (const name of ['A','B']) {
    const payload=sent.find((item)=>item.userId===users[name].id);
    assert.equal(payload.message.variables.next_webinar_url,originalUrls[name]);
  }
  for (const name of ['C','D','E']) {
    const payload=sent.find((item)=>item.userId===users[name].id);
    const url=new URL(payload.message.variables.application_url);
    const verified=verifyFunnelToken(url.searchParams.get('t'),{purpose:'application',secret:signingSecret,now:()=>clock.value.getTime()});
    assert.equal(verified.ok,true);
    assert.equal(verified.payload.user_ref,users[name].id);
    assert.equal(verified.payload.funnel_id,users[name].funnelId);
  }
  assert.equal(store.listProviderFollowUps().filter((item)=>item.status==='delivered').length,5);
  assert.equal((await makeScheduler('repeat').run()).claimed,0);
});

test('late application, sold, stop and deletion cancel scheduled follow-ups before URL creation', async () => {
  const clock={value:new Date(finalizedAt)}; const store=new MemoryStore({now:()=>clock.value}); store.seed(localFixture);
  const experience=createWebinarStarsExperienceProvider({store,config}); const users={};
  for (const name of ['APPLICATION','SOLD','STOP','DELETE']) {
    const user=store.createUser({funnelId:localFixture.funnel.id}); users[name]=user;
    store.upsertTelegramUser({userId:user.id,telegramUserId:`7${Object.keys(users).length}`});
    await experience.createExperienceUrl({user});
  }
  const session=[...store.providerSyncSessions.values()][0];
  for (const [name,user] of Object.entries(users)) store.ingestProviderVisitor({provider:'webinarstars',sessionId:session.id,reportId:'suppression',
    visitorId:`suppression-${name}`,userId:user.id,funnelId:user.funnelId,correlationStatus:'matched',signals:signal(3400,['clicked'])});
  await createWebinarStarsLifecycle({store,config}).finalizeReport({session,reportId:'suppression',finalizedAt});
  store.createApplicationWithEvent({userId:users.APPLICATION.id,funnelId:users.APPLICATION.funnelId,answers:{},consent:{policyVersion:'test'},idempotencyKey:'late-application'});
  store.updateUser(users.SOLD.id,{leadStatus:'sold'});
  store.setPromotionalEnabled(users.STOP.id,false,finalizedAt);
  store.requestDataDeletion({userId:users.DELETE.id,funnelId:users.DELETE.funnelId});
  clock.value=new Date('2026-09-15T19:00:00Z'); let urls=0; let sends=0;
  const result=await createWebinarStarsFollowUpScheduler({store,config,experienceProvider:experience,
    applicationUrlProvider:{createApplicationUrl(){urls+=1;throw new Error('must_not_create_url');}},templates:WEBINARSTARS_STAGING_FOLLOW_UP_TEMPLATES,
    now:()=>clock.value,transport:{async sendMessage(){sends+=1;}},workerId:'suppression'}).run();
  assert.equal(result.cancelled,1); assert.equal(result.suppressed,3); assert.equal(urls,0); assert.equal(sends,0);
});

test('production-default empty template configuration fails closed without a transport call', async () => {
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
