-- Initial PostgreSQL schema for the isolated men funnel runtime.

create table if not exists funnels (
  id text primary key,
  name text not null,
  status text not null check (status in ('active', 'paused', 'archived')),
  config_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists traffic_sources (
  id uuid primary key,
  funnel_id text not null references funnels(id),
  source text not null,
  medium text not null,
  campaign text not null,
  content text not null,
  article_slug text,
  start_parameter text not null,
  created_at timestamptz not null default now(),
  unique (funnel_id, start_parameter)
);

create table if not exists lead_statuses (
  id text primary key,
  label text not null,
  sort_order integer not null default 0,
  active boolean not null default true
);

insert into lead_statuses (id, label, sort_order) values
  ('anonymous', 'Anonymous', 10), ('telegram_lead', 'Telegram lead', 20),
  ('warming', 'Warming', 30), ('webinar_started', 'Webinar started', 40),
  ('webinar_engaged', 'Webinar engaged', 50), ('application_started', 'Application started', 60),
  ('application_submitted', 'Application submitted', 70), ('contacted', 'Contacted', 80),
  ('consultation_booked', 'Consultation booked', 90), ('consultation_completed', 'Consultation completed', 100),
  ('sold', 'Sold', 110), ('lost', 'Lost', 120), ('unsubscribed', 'Unsubscribed', 130)
on conflict (id) do nothing;

create table if not exists users (
  id uuid primary key,
  funnel_id text not null references funnels(id),
  first_source_id uuid references traffic_sources(id),
  first_touch jsonb,
  funnel_entry_touch jsonb,
  entry_notice jsonb,
  promotional_enabled boolean not null default true,
  stop_requested_at timestamptz,
  deletion_requested_at timestamptz,
  lead_status text not null references lead_statuses(id),
  first_contact_at timestamptz not null default now(),
  last_event_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists telegram_users (
  user_id uuid primary key references users(id) on delete cascade,
  telegram_user_id bigint not null unique,
  telegram_chat_id bigint not null,
  first_name text,
  username text,
  language_code text,
  first_started_at timestamptz not null default now(),
  last_started_at timestamptz not null default now(),
  channel_status text not null default 'unknown' check (channel_status in ('unknown', 'subscribed', 'not_subscribed', 'unavailable')),
  unsubscribed_at timestamptz
);

create table if not exists telegram_updates (
  funnel_id text not null references funnels(id),
  update_id bigint not null,
  user_id uuid references users(id),
  source_id uuid references traffic_sources(id),
  status text not null check (status in ('processing', 'completed', 'failed')),
  received_at timestamptz not null,
  processing_started_at timestamptz not null,
  completed_at timestamptz,
  failed_at timestamptz,
  error_stage text,
  error_code text,
  primary key (funnel_id, update_id)
);

create table if not exists bonuses (
  id uuid primary key,
  funnel_id text not null references funnels(id),
  source_id uuid references traffic_sources(id),
  type text not null check (type in ('pdf', 'text', 'video', 'audio', 'page', 'sequence')),
  delivery_mode text not null check (delivery_mode in ('link', 'telegram_audio')),
  title text not null,
  content_ref text not null,
  telegram_file_id text,
  use_case text not null check (use_case in ('entry', 'follow_up', 'sequence')),
  status text not null check (status in ('draft', 'active', 'archived')),
  version integer not null
);

create table if not exists webinars (
  id uuid primary key,
  funnel_id text not null references funnels(id),
  route text,
  video_provider text,
  video_id text,
  video_url text,
  status text not null check (status in ('draft', 'active', 'archived'))
);

create table if not exists message_templates (
  id uuid primary key,
  funnel_id text not null references funnels(id),
  name text not null,
  role text not null,
  message_class text not null check (message_class in ('funnel_service', 'promotional')),
  text text not null,
  buttons jsonb not null default '[]'::jsonb,
  status text not null check (status in ('draft', 'active', 'archived')),
  version integer not null,
  unique (funnel_id, name)
);

create table if not exists automation_rules (
  id uuid primary key,
  funnel_id text not null references funnels(id),
  name text not null,
  trigger_event text not null,
  delay_seconds integer not null default 0,
  conditions jsonb not null default '{}'::jsonb,
  action_type text not null,
  action_config jsonb not null default '{}'::jsonb,
  message_class text not null check (message_class in ('funnel_service', 'promotional')),
  status text not null check (status in ('draft', 'active', 'paused', 'archived')),
  version integer not null,
  unique (funnel_id, name)
);

create table if not exists events (
  id uuid primary key,
  user_id uuid references users(id) on delete cascade,
  funnel_id text not null references funnels(id),
  event_type text not null,
  occurred_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  idempotency_key text,
  unique (funnel_id, idempotency_key)
);

create index if not exists events_user_time_idx on events (user_id, occurred_at, id);
create index if not exists events_article_idx on events (funnel_id, (metadata ->> 'source_article_slug'), event_type);

create table if not exists applications (
  id uuid primary key,
  user_id uuid not null references users(id) on delete cascade,
  funnel_id text not null references funnels(id),
  status text not null check (status in ('submitted', 'contacted', 'consultation_booked', 'consultation_completed', 'sold', 'lost')),
  answers jsonb not null,
  consent jsonb not null,
  privacy_policy_version text not null,
  idempotency_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (funnel_id, idempotency_key)
);

create table if not exists deletion_requests (
  id uuid primary key,
  user_id uuid not null references users(id) on delete cascade,
  funnel_id text not null references funnels(id),
  status text not null check (status in ('requested', 'processing', 'completed', 'rejected')),
  requested_at timestamptz not null,
  processed_at timestamptz,
  unique (funnel_id, user_id)
);
