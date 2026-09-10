import { randomUUID } from 'node:crypto';
import pg from 'pg';

const { Pool } = pg;
const iso = (value) => value instanceof Date ? value.toISOString() : value;

function mapSource(row) {
  return row && { id: row.id, funnelId: row.funnel_id, source: row.source, medium: row.medium, campaign: row.campaign, content: row.content, articleSlug: row.article_slug, startParameter: row.start_parameter };
}
function mapUser(row) {
  return row && {
    id: row.id, funnelId: row.funnel_id, sourceId: row.first_source_id,
    firstTouch: row.first_touch, funnelEntryTouch: row.funnel_entry_touch, entryNotice: row.entry_notice,
    promotionalEnabled: row.promotional_enabled, stopRequestedAt: iso(row.stop_requested_at), deletionRequestedAt: iso(row.deletion_requested_at),
    leadStatus: row.lead_status, firstContactAt: iso(row.first_contact_at), lastEventAt: iso(row.last_event_at),
    createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
  };
}
function mapTelegram(row) {
  return row && {
    userId: row.user_id, telegramUserId: String(row.telegram_user_id), telegramChatId: String(row.telegram_chat_id),
    firstName: row.first_name, username: row.username, languageCode: row.language_code,
    firstStartedAt: iso(row.first_started_at), lastStartedAt: iso(row.last_started_at),
    channelStatus: row.channel_status, unsubscribedAt: iso(row.unsubscribed_at),
  };
}
function mapEvent(row) {
  return row && { id: row.id, userId: row.user_id, funnelId: row.funnel_id, eventType: row.event_type, occurredAt: iso(row.occurred_at), metadata: row.metadata, idempotencyKey: row.idempotency_key };
}
function mapApplication(row) {
  return row && { id: row.id, userId: row.user_id, funnelId: row.funnel_id, status: row.status, answers: row.answers, privacyPolicyVersion: row.privacy_policy_version, consent: row.consent, createdAt: iso(row.created_at), updatedAt: iso(row.updated_at) };
}
function mapDeliveryOperation(row) {
  return row && {
    id: row.id, operationKey: row.operation_key, funnelId: row.funnel_id, userId: row.user_id,
    telegramUpdateId: row.telegram_update_id == null ? null : String(row.telegram_update_id),
    telegramChatId: String(row.telegram_chat_id), messageType: row.message_type,
    dependsOnOperationId: row.depends_on_operation_id, descriptor: row.descriptor,
    status: row.status, attemptCount: row.attempt_count, maxAttempts: row.max_attempts,
    nextAttemptAt: iso(row.next_attempt_at), leaseOwner: row.lease_owner,
    leaseStartedAt: iso(row.lease_started_at), leaseExpiresAt: iso(row.lease_expires_at),
    requestStartedAt: iso(row.request_started_at), provider: row.provider,
    providerMessageId: row.provider_message_id, deliveredAt: iso(row.delivered_at),
    lastErrorCode: row.last_error_code, lastErrorCategory: row.last_error_category,
    createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
  };
}

export class PostgresStore {
  constructor({ connectionString, pool = null } = {}) {
    if (!pool && !connectionString) throw new Error('DATABASE_URL is required for FUNNEL_STORE=postgres');
    this.pool = pool ?? new Pool({ connectionString });
  }

  async close() { await this.pool.end(); }

  async transaction(work) {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const result = await work(client);
      await client.query('commit');
      return result;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally { client.release(); }
  }

  async seed({ funnel, sources = [], bonuses = [], messageTemplates = [], automationRules = [], webinar }) {
    await this.transaction(async (db) => {
      await db.query(`insert into funnels (id,name,status,config_version) values ($1,$2,$3,$4)
        on conflict (id) do update set name=excluded.name,status=excluded.status,config_version=excluded.config_version,updated_at=now()`, [funnel.id, funnel.name, funnel.status, funnel.configVersion]);
      for (const item of sources) await db.query(`insert into traffic_sources (id,funnel_id,source,medium,campaign,content,article_slug,start_parameter) values ($1,$2,$3,$4,$5,$6,$7,$8)
        on conflict (id) do update set source=excluded.source,medium=excluded.medium,campaign=excluded.campaign,content=excluded.content,article_slug=excluded.article_slug,start_parameter=excluded.start_parameter`, [item.id,item.funnelId,item.source,item.medium,item.campaign,item.content,item.articleSlug,item.startParameter]);
      for (const item of bonuses) await db.query(`insert into bonuses (id,funnel_id,source_id,type,delivery_mode,title,content_ref,telegram_file_id,use_case,status,version) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        on conflict (id) do update set type=excluded.type,delivery_mode=excluded.delivery_mode,title=excluded.title,content_ref=excluded.content_ref,telegram_file_id=excluded.telegram_file_id,use_case=excluded.use_case,status=excluded.status,version=excluded.version`, [item.id,item.funnelId,item.sourceId,item.type,item.deliveryMode,item.title,item.contentRef,item.telegramFileId,item.useCase,item.status,item.version]);
      for (const item of messageTemplates) await db.query(`insert into message_templates (id,funnel_id,name,role,message_class,text,buttons,status,version) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        on conflict (id) do update set name=excluded.name,role=excluded.role,message_class=excluded.message_class,text=excluded.text,buttons=excluded.buttons,status=excluded.status,version=excluded.version`, [item.id,item.funnelId,item.name,item.role,item.messageClass,item.text,JSON.stringify(item.buttons),item.status,item.version]);
      for (const item of automationRules) await db.query(`insert into automation_rules (id,funnel_id,name,trigger_event,delay_seconds,conditions,action_type,action_config,message_class,status,version) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        on conflict (id) do update set name=excluded.name,trigger_event=excluded.trigger_event,delay_seconds=excluded.delay_seconds,conditions=excluded.conditions,action_type=excluded.action_type,action_config=excluded.action_config,message_class=excluded.message_class,status=excluded.status,version=excluded.version`, [item.id,item.funnelId,item.name,item.triggerEvent,item.delaySeconds,JSON.stringify(item.conditions),item.actionType,JSON.stringify(item.actionConfig),item.messageClass,item.status,item.version]);
      if (webinar) await db.query(`insert into webinars (id,funnel_id,route,video_provider,video_id,video_url,status) values ($1,$2,$3,$4,$5,$6,$7)
        on conflict (id) do update set route=excluded.route,video_provider=excluded.video_provider,video_id=excluded.video_id,video_url=excluded.video_url,status=excluded.status`, [webinar.id,webinar.funnelId,webinar.route,webinar.videoProvider,webinar.videoId,webinar.videoUrl,webinar.status]);
    });
  }

  async findSourceByStartParameter(funnelId, startParameter) { return mapSource((await this.pool.query('select * from traffic_sources where funnel_id=$1 and start_parameter=$2', [funnelId,startParameter])).rows[0]); }
  async findSourceById(sourceId) { return mapSource((await this.pool.query('select * from traffic_sources where id=$1', [sourceId])).rows[0]); }
  async findBonusForFunnel(funnelId, useCase='entry') {
    const row=(await this.pool.query("select * from bonuses where funnel_id=$1 and source_id is null and use_case=$2 and status='active' limit 1",[funnelId,useCase])).rows[0];
    return row && { id:row.id,funnelId:row.funnel_id,sourceId:row.source_id,type:row.type,deliveryMode:row.delivery_mode,title:row.title,contentRef:row.content_ref,telegramFileId:row.telegram_file_id,useCase:row.use_case,status:row.status,version:row.version };
  }
  async findMessageTemplate(funnelId, name) {
    const row=(await this.pool.query("select * from message_templates where funnel_id=$1 and name=$2 and status='active'",[funnelId,name])).rows[0];
    return row && { id:row.id,funnelId:row.funnel_id,name:row.name,role:row.role,messageClass:row.message_class,text:row.text,buttons:row.buttons,status:row.status,version:row.version };
  }
  async findWebinarForFunnel(funnelId) {
    const row=(await this.pool.query('select * from webinars where funnel_id=$1 limit 1',[funnelId])).rows[0];
    return row && { id:row.id,funnelId:row.funnel_id,route:row.route,videoProvider:row.video_provider,videoId:row.video_id,videoUrl:row.video_url,status:row.status };
  }
  async listAutomationRules(funnelId) {
    const rows=(await this.pool.query("select * from automation_rules where funnel_id=$1 and status='active'",[funnelId])).rows;
    return rows.map(row=>({id:row.id,funnelId:row.funnel_id,name:row.name,triggerEvent:row.trigger_event,delaySeconds:row.delay_seconds,conditions:row.conditions,actionType:row.action_type,actionConfig:row.action_config,messageClass:row.message_class,status:row.status,version:row.version}));
  }
  async getUser(userId, db=this.pool) { return mapUser((await db.query('select * from users where id=$1',[userId])).rows[0]); }
  async findUserByTelegramId(telegramUserId, db=this.pool) { return mapUser((await db.query('select u.* from users u join telegram_users t on t.user_id=u.id where t.telegram_user_id=$1',[String(telegramUserId)])).rows[0]); }
  async getTelegramUser(userId, db=this.pool) { return mapTelegram((await db.query('select * from telegram_users where user_id=$1',[userId])).rows[0]); }
  async getApplicationForUser(userId) { return mapApplication((await this.pool.query('select * from applications where user_id=$1 order by created_at desc limit 1',[userId])).rows[0]); }
  async listUserEvents(userId) { return (await this.pool.query('select * from events where user_id=$1 order by occurred_at,id',[userId])).rows.map(mapEvent); }
  async findEventByIdempotencyKey(funnelId,key,db=this.pool) { return mapEvent((await db.query('select * from events where funnel_id=$1 and idempotency_key=$2',[funnelId,key])).rows[0]); }

  async updateUser(userId, patch, db=this.pool) {
    const columns={sourceId:'first_source_id',firstTouch:'first_touch',funnelEntryTouch:'funnel_entry_touch',entryNotice:'entry_notice',promotionalEnabled:'promotional_enabled',stopRequestedAt:'stop_requested_at',deletionRequestedAt:'deletion_requested_at',leadStatus:'lead_status',lastEventAt:'last_event_at'};
    const entries=Object.entries(patch).filter(([key])=>columns[key]);
    if (!entries.length) return this.getUser(userId,db);
    const values=entries.map(([,value])=>typeof value==='object'&&value!==null?JSON.stringify(value):value);
    const sets=entries.map(([key],index)=>`${columns[key]}=$${index+2}`).join(',');
    return mapUser((await db.query(`update users set ${sets},updated_at=now() where id=$1 returning *`,[userId,...values])).rows[0]);
  }

  async addEvent({userId=null,funnelId,eventType,metadata={},idempotencyKey=null}, db=this.pool) {
    const row=(await db.query(`insert into events (id,user_id,funnel_id,event_type,metadata,idempotency_key) values ($1,$2,$3,$4,$5,$6)
      on conflict (funnel_id,idempotency_key) do nothing returning *`,[randomUUID(),userId,funnelId,eventType,JSON.stringify(metadata),idempotencyKey])).rows[0];
    if (!row) return {event:await this.findEventByIdempotencyKey(funnelId,idempotencyKey,db),duplicate:true};
    if (userId) await db.query('update users set last_event_at=$2,updated_at=now() where id=$1',[userId,row.occurred_at]);
    return {event:mapEvent(row),duplicate:false};
  }

  async claimTelegramStart({source,telegramUserId,telegramChatId,firstName,username,languageCode,firstTouch,funnelEntryTouch,eventMetadata,eventKey,updateId,occurredAt}) {
    return this.transaction(async (db)=>{
      if (updateId!=null) {
        const claim=await db.query(`insert into telegram_updates (funnel_id,update_id,source_id,status,received_at,processing_started_at) values ($1,$2,$3,'processing',$4,$4)
          on conflict (funnel_id,update_id) do nothing returning update_id`,[source.funnelId,String(updateId),source.id,occurredAt]);
        if (!claim.rowCount) {
          const saved=(await db.query('select * from telegram_updates where funnel_id=$1 and update_id=$2',[source.funnelId,String(updateId)])).rows[0];
          const event=await this.findEventByIdempotencyKey(source.funnelId,eventKey,db);
          return {user:await this.getUser(saved.user_id,db),event,duplicate:true,updateStatus:saved.status};
        }
      }
      let user=await this.findUserByTelegramId(telegramUserId,db);
      if (!user) {
        user=mapUser((await db.query(`insert into users (id,funnel_id,first_source_id,first_touch,funnel_entry_touch,lead_status,first_contact_at,last_event_at,created_at,updated_at)
          values ($1,$2,$3,$4,$5,'telegram_lead',$6,$6,$6,$6) returning *`,[randomUUID(),source.funnelId,firstTouch.sourceId,JSON.stringify(firstTouch),JSON.stringify(funnelEntryTouch),occurredAt])).rows[0]);
      } else {
        user=await this.updateUser(user.id,{sourceId:user.firstTouch?.sourceId??user.sourceId??firstTouch.sourceId,firstTouch:user.firstTouch??firstTouch,funnelEntryTouch:user.funnelEntryTouch??funnelEntryTouch},db);
      }
      await db.query(`insert into telegram_users (user_id,telegram_user_id,telegram_chat_id,first_name,username,language_code,first_started_at,last_started_at)
        values ($1,$2,$3,$4,$5,$6,$7,$7) on conflict (user_id) do update set first_name=excluded.first_name,username=excluded.username,language_code=excluded.language_code,telegram_chat_id=excluded.telegram_chat_id,last_started_at=excluded.last_started_at`,[user.id,String(telegramUserId),String(telegramChatId??telegramUserId),firstName,username,languageCode,occurredAt]);
      const added=await this.addEvent({userId:user.id,funnelId:source.funnelId,eventType:'telegram_start',metadata:eventMetadata,idempotencyKey:eventKey},db);
      if (updateId!=null) await db.query('update telegram_updates set user_id=$3 where funnel_id=$1 and update_id=$2',[source.funnelId,String(updateId),user.id]);
      return {user:await this.getUser(user.id,db),event:added.event,duplicate:added.duplicate,updateStatus:'processing'};
    });
  }

  async finishTelegramUpdate({funnelId,updateId,status,errorStage=null,errorCode=null}) {
    if (updateId==null) return;
    await this.pool.query(`update telegram_updates set status=$3,completed_at=case when $3='completed' then now() else completed_at end,
      failed_at=case when $3='failed' then now() else failed_at end,error_stage=$4,error_code=$5 where funnel_id=$1 and update_id=$2`,[funnelId,String(updateId),status,errorStage,errorCode]);
  }
  async getTelegramUpdate(funnelId,updateId) {
    const row=(await this.pool.query('select * from telegram_updates where funnel_id=$1 and update_id=$2',[funnelId,String(updateId)])).rows[0];
    return row&&{funnelId:row.funnel_id,updateId:String(row.update_id),userId:row.user_id,sourceId:row.source_id,status:row.status,receivedAt:iso(row.received_at),processingStartedAt:iso(row.processing_started_at),completedAt:iso(row.completed_at),failedAt:iso(row.failed_at),errorStage:row.error_stage,errorCode:row.error_code};
  }

  async createDeliveryOperation({operationKey,funnelId,userId,telegramUpdateId=null,telegramChatId,messageType,dependsOnOperationId=null,descriptor={},maxAttempts=3}) {
    const row=(await this.pool.query(`insert into delivery_operations
      (id,operation_key,funnel_id,user_id,telegram_update_id,telegram_chat_id,message_type,depends_on_operation_id,descriptor,max_attempts)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      on conflict (funnel_id,operation_key) do update set operation_key=excluded.operation_key
      returning *`,[randomUUID(),operationKey,funnelId,userId,telegramUpdateId==null?null:String(telegramUpdateId),String(telegramChatId),messageType,dependsOnOperationId,JSON.stringify(descriptor),maxAttempts])).rows[0];
    return mapDeliveryOperation(row);
  }

  async getDeliveryOperation(operationId) {
    return mapDeliveryOperation((await this.pool.query('select * from delivery_operations where id=$1',[operationId])).rows[0]);
  }

  async listDeliveryOperations({userId=null,status=null}={}) {
    const values=[];
    const where=[];
    if (userId) { values.push(userId); where.push(`user_id=$${values.length}`); }
    if (status) { values.push(status); where.push(`status=$${values.length}`); }
    const rows=(await this.pool.query(`select * from delivery_operations${where.length?` where ${where.join(' and ')}`:''} order by created_at,id`,values)).rows;
    return rows.map(mapDeliveryOperation);
  }

  async claimDeliveryOperation({workerId,leaseMs,operationId=null,now=new Date().toISOString()}) {
    return this.transaction(async(db)=>{
      await db.query(`update delivery_operations set status='delivery_unknown',last_error_code='lease_expired_after_request',last_error_category='unknown',
        lease_owner=null,lease_started_at=null,lease_expires_at=null,updated_at=$1
        where status='processing' and lease_expires_at <= $1 and request_started_at is not null`,[now]);
      const values=[now,operationId];
      const row=(await db.query(`select operation.* from delivery_operations operation
        where ($2::uuid is null or operation.id=$2)
          and (operation.depends_on_operation_id is null or exists (select 1 from delivery_operations dependency where dependency.id=operation.depends_on_operation_id and dependency.status='delivered'))
          and ((status in ('pending','retryable_failed') and next_attempt_at <= $1)
            or (status='processing' and lease_expires_at <= $1 and request_started_at is null))
        order by operation.next_attempt_at,operation.created_at,operation.id for update of operation skip locked limit 1`,values)).rows[0];
      if (!row) return null;
      const leaseExpiresAt=new Date(new Date(now).getTime()+leaseMs).toISOString();
      return mapDeliveryOperation((await db.query(`update delivery_operations set status='processing',lease_owner=$2,
        lease_started_at=$3,lease_expires_at=$4,request_started_at=null,updated_at=$3 where id=$1 returning *`,
      [row.id,workerId,now,leaseExpiresAt])).rows[0]);
    });
  }

  async markDeliveryAttemptStarted({operationId,workerId}) {
    const row=(await this.pool.query(`update delivery_operations set attempt_count=attempt_count+1,request_started_at=now(),updated_at=now()
      where id=$1 and status='processing' and lease_owner=$2 and request_started_at is null returning *`,[operationId,workerId])).rows[0];
    return mapDeliveryOperation(row);
  }

  async finishDeliveryOperation({operationId,workerId,status,provider=null,providerMessageId=null,errorCode=null,errorCategory=null,nextAttemptAt=null,outcome=null}) {
    return this.transaction(async(db)=>{
      const row=(await db.query(`update delivery_operations set status=$3,provider=$4,provider_message_id=$5,
        delivered_at=case when $3='delivered' then now() else null end,last_error_code=$6,last_error_category=$7,
        next_attempt_at=coalesce($8,next_attempt_at),lease_owner=null,lease_started_at=null,lease_expires_at=null,
        request_started_at=case when $3='retryable_failed' then null else request_started_at end,updated_at=now()
        where id=$1 and status='processing' and lease_owner=$2 returning *`,
      [operationId,workerId,status,provider,providerMessageId,errorCode,errorCategory,nextAttemptAt])).rows[0];
      if (!row) return mapDeliveryOperation((await db.query('select * from delivery_operations where id=$1',[operationId])).rows[0]);
      if (status==='suppressed') await db.query(`update delivery_operations set status='suppressed',last_error_code=$3,last_error_category='permanent',
        next_attempt_at=now(),lease_owner=null,lease_started_at=null,lease_expires_at=null,updated_at=now()
        where funnel_id=$1 and user_id=$2 and status in ('pending','retryable_failed')`,[row.funnel_id,row.user_id,errorCode]);
      if (outcome?.userPatch) await this.updateUser(row.user_id,outcome.userPatch,db);
      if (outcome?.event) await this.addEvent(outcome.event,db);
      return mapDeliveryOperation(row);
    });
  }

  async setPromotionalEnabled(userId,enabled,stoppedAt=null) { return this.updateUser(userId,{promotionalEnabled:Boolean(enabled),stopRequestedAt:enabled?null:stoppedAt}); }
  async requestDataDeletion({userId,funnelId}) {
    return this.transaction(async(db)=>{
      let row=(await db.query(`insert into deletion_requests (id,user_id,funnel_id,status,requested_at) values ($1,$2,$3,'requested',now())
        on conflict (funnel_id,user_id) do nothing returning *`,[randomUUID(),userId,funnelId])).rows[0];
      if (!row) row=(await db.query('select * from deletion_requests where funnel_id=$1 and user_id=$2',[funnelId,userId])).rows[0];
      await this.updateUser(userId,{deletionRequestedAt:row.requested_at},db);
      return {id:row.id,userId:row.user_id,funnelId:row.funnel_id,status:row.status,requestedAt:iso(row.requested_at),processedAt:iso(row.processed_at)};
    });
  }
  async getDataDeletionRequest({userId,funnelId}) {
    const row=(await this.pool.query('select * from deletion_requests where funnel_id=$1 and user_id=$2',[funnelId,userId])).rows[0];
    return row&&{id:row.id,userId:row.user_id,funnelId:row.funnel_id,status:row.status,requestedAt:iso(row.requested_at),processedAt:iso(row.processed_at)};
  }

  async createApplicationWithEvent({userId,funnelId,answers,consent,idempotencyKey}) {
    return this.transaction(async(db)=>{
      let row=(await db.query(`insert into applications (id,user_id,funnel_id,status,answers,consent,privacy_policy_version,idempotency_key) values ($1,$2,$3,'submitted',$4,$5,$6,$7)
        on conflict (funnel_id,idempotency_key) do nothing returning *`,[randomUUID(),userId,funnelId,JSON.stringify(answers),JSON.stringify(consent),consent.policyVersion,idempotencyKey])).rows[0];
      if (!row) {
        row=(await db.query('select * from applications where funnel_id=$1 and idempotency_key=$2',[funnelId,idempotencyKey])).rows[0];
        return {application:mapApplication(row),duplicate:true};
      }
      await this.addEvent({userId,funnelId,eventType:'application_submitted',metadata:{purpose:'application'},idempotencyKey:`application-event:${row.id}`},db);
      await this.updateUser(userId,{leadStatus:'application_submitted'},db);
      return {application:mapApplication(row),duplicate:false};
    });
  }

  async dashboard(funnelId) {
    const events=(await this.pool.query('select event_type,user_id from events where funnel_id=$1',[funnelId])).rows;
    const count=(type)=>new Set(events.filter(e=>e.event_type===type).map(e=>e.user_id)).size;
    return {funnelId,visitors:count('article_view'),telegramStarts:count('telegram_start'),bonusDeliveryAttempts:count('bonus_delivery_attempted'),bonusSent:count('bonus_sent'),bonusDeliveryFailed:count('bonus_delivery_failed'),webinarStarted:count('webinar_started'),watched25:count('watched_25'),watched50:count('watched_50'),watched75:count('watched_75'),ctaClicks:count('cta_clicked'),applications:events.filter(e=>e.event_type==='application_submitted').length,users:Number((await this.pool.query('select count(*) from users where funnel_id=$1',[funnelId])).rows[0].count)};
  }
}
