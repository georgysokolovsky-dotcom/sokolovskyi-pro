export const FUNNEL_ID = 'men_webinar_v1';
export const DIRECT_START_PARAMETER = 'direct_men_webinar';

export const LEAD_STATUSES = Object.freeze([
  'anonymous',
  'telegram_lead',
  'warming',
  'webinar_started',
  'webinar_engaged',
  'application_started',
  'application_submitted',
  'contacted',
  'consultation_booked',
  'consultation_completed',
  'sold',
  'lost',
  'unsubscribed',
]);

export const FUNNEL_EVENTS = Object.freeze([
  'telegram_start',
  'funnel_entry_notice_presented',
  'bonus_delivery_attempted',
  'bonus_sent',
  'bonus_delivery_failed',
  'webinar_invite_delivery_attempted',
  'webinar_invite_sent',
  'webinar_invite_delivery_failed',
  'warming_delivery_attempted',
  'warming_sent',
  'warming_delivery_failed',
  'webinar_page_view',
  'webinar_started',
  'watched_25',
  'watched_50',
  'watched_75',
  'watched_90',
  'watched_100',
  'webinar_completed',
  'cta_clicked',
  'application_started',
  'application_submitted',
  'telegram_stop',
  'data_deletion_requested',
  'webinarstars_report_finalized',
  'webinarstars_attended',
  'webinarstars_presence_started',
  'webinarstars_presence_ended',
  'webinarstars_presence_seconds',
  'webinarstars_cta_seen',
  'webinarstars_cta_clicked',
  'webinarstars_comment_present',
]);

export const APPLICATION_FIELDS = Object.freeze([
  'name',
  'situation',
]);

export const PUBLIC_EVENT_METADATA_KEYS = Object.freeze([
  'video_id',
  'placement',
  'source_article_slug',
  'source_id',
  'source',
  'medium',
  'campaign',
  'content',
  'start_parameter',
  'threshold',
  'bonus_id',
  'bonus_version',
  'attempt_number',
  'provider',
  'provider_message_id',
  'purpose',
  'consent_or_request_version',
  'template_id',
  'template_version',
  'warming_rule_id',
  'warming_rule_name',
  'message_class',
  'result_category',
  'cancellation_reason',
  'watched_seconds',
  'progress_percent',
  'report_id',
  'visitor_id',
  'provider_timestamp',
  'presence_seconds',
  'presence_ratio',
  'comment_count',
]);

export const BONUS_DELIVERY_MODES = Object.freeze(['link', 'telegram_audio']);

export const WEBINAR_EVENTS = Object.freeze([
  'webinar_page_view',
  'webinar_started',
  'watched_25',
  'watched_50',
  'watched_75',
  'watched_90',
  'watched_100',
  'webinar_completed',
  'cta_clicked',
]);

export const TOKEN_PURPOSES = Object.freeze(['webinar', 'application']);
