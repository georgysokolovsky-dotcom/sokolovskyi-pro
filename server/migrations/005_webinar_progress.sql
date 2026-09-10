-- First-party webinar sessions and watched ranges for reliable progress milestones.

alter table webinars
  add column if not exists duration_seconds numeric(10,3);

create table if not exists webinar_view_sessions (
  id uuid primary key,
  client_session_id uuid not null,
  user_id uuid not null references users(id) on delete cascade,
  funnel_id text not null references funnels(id),
  webinar_id uuid not null references webinars(id),
  duration_seconds numeric(10,3) not null check (duration_seconds > 0),
  last_position_seconds numeric(10,3) not null default 0 check (last_position_seconds >= 0),
  last_observed_at timestamptz not null,
  playing boolean not null default false,
  started_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, webinar_id, client_session_id)
);

create table if not exists webinar_telemetry_requests (
  request_id uuid primary key,
  session_id uuid not null references webinar_view_sessions(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  funnel_id text not null references funnels(id),
  webinar_id uuid not null references webinars(id),
  action text not null check (action in ('play', 'heartbeat', 'pause', 'seek', 'ended')),
  position_seconds numeric(10,3) not null check (position_seconds >= 0),
  segment_start_seconds numeric(10,3),
  segment_end_seconds numeric(10,3),
  received_at timestamptz not null,
  created_at timestamptz not null default now(),
  check (
    (segment_start_seconds is null and segment_end_seconds is null)
    or (segment_start_seconds >= 0 and segment_end_seconds > segment_start_seconds)
  )
);

create index if not exists webinar_telemetry_progress_idx
  on webinar_telemetry_requests (user_id, webinar_id, segment_start_seconds, segment_end_seconds)
  where segment_start_seconds is not null;
