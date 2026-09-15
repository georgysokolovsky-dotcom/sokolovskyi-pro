create table if not exists provider_session_entries (
  session_id uuid not null references provider_sync_sessions(id) on delete cascade,
  funnel_entry_id uuid not null references users(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  funnel_id text not null references funnels(id),
  correlation_hmac text not null,
  created_at timestamptz not null default now(),
  primary key (session_id, funnel_entry_id)
);

create table if not exists provider_segment_decisions (
  id uuid primary key,
  provider text not null,
  session_id uuid not null references provider_sync_sessions(id) on delete cascade,
  report_id text not null,
  funnel_entry_id uuid not null references users(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  funnel_id text not null references funnels(id),
  segment text not null check (segment in ('NO_SHOW','LEFT_BEFORE_OFFER','REACHED_OFFER_CTA_UNSEEN','CTA_SEEN_NOT_CLICKED','CTA_CLICKED_NO_APPLICATION','APPLICATION_SUBMITTED','SUPPRESSED')),
  signals jsonb not null default '{}'::jsonb,
  decided_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (provider, funnel_entry_id, report_id)
);

create table if not exists provider_follow_ups (
  id uuid primary key,
  decision_id uuid not null unique references provider_segment_decisions(id) on delete cascade,
  funnel_entry_id uuid not null references users(id) on delete cascade,
  report_id text not null,
  funnel_id text not null references funnels(id),
  user_id uuid not null references users(id) on delete cascade,
  segment text not null,
  follow_up_rule text not null,
  template_id text not null,
  scheduled_for timestamptz not null,
  status text not null default 'scheduled' check (status in ('scheduled','processing','delivered','cancelled','suppressed','blocked_template','delivery_unknown','failed')),
  cancellation_reason text,
  lease_owner text,
  lease_started_at timestamptz,
  lease_expires_at timestamptz,
  request_started_at timestamptz,
  provider text,
  provider_message_id text,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (funnel_entry_id, report_id, segment, follow_up_rule),
  check ((status = 'delivered') = (provider_message_id is not null and delivered_at is not null))
);

create index if not exists provider_follow_ups_due_idx
  on provider_follow_ups (scheduled_for, created_at)
  where status in ('scheduled','processing');
