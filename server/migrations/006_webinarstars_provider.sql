-- Persistent, PII-free WebinarStars correlation and post-session report ingestion.

create table if not exists provider_correlations (
  correlation_hmac text primary key,
  provider text not null,
  funnel_entry_id uuid not null references users(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  funnel_id text not null references funnels(id),
  contract_version text not null,
  created_at timestamptz not null default now(),
  unique (provider, funnel_entry_id, contract_version)
);

create table if not exists provider_sync_sessions (
  id uuid primary key,
  provider text not null,
  funnel_id text not null references funnels(id),
  webinar_id text not null,
  scheduled_start timestamptz not null,
  scheduled_end timestamptz not null,
  funnel_version text not null,
  report_id text,
  status text not null check (status in ('pending','processing','completed','finalization_pending','permanent_failure','configuration_failure')),
  attempt_index integer not null default 0,
  next_poll_at timestamptz not null,
  lease_owner text,
  lease_started_at timestamptz,
  lease_expires_at timestamptz,
  last_error_code text,
  last_error_category text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, webinar_id, scheduled_start, scheduled_end, funnel_version)
);

create index if not exists provider_sync_due_idx on provider_sync_sessions (next_poll_at, created_at)
  where status in ('pending','processing');

create table if not exists provider_visitors (
  provider text not null,
  report_id text not null,
  visitor_id text not null,
  session_id uuid not null references provider_sync_sessions(id) on delete cascade,
  user_id uuid references users(id) on delete set null,
  funnel_id text not null references funnels(id),
  correlation_status text not null check (correlation_status in ('matched','unmatched')),
  signals jsonb not null,
  ingested_at timestamptz not null default now(),
  primary key (provider, report_id, visitor_id)
);
