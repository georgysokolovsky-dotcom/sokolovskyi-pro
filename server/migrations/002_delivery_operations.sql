-- Persistent, fail-closed Telegram delivery recovery.

create table if not exists delivery_operations (
  id uuid primary key,
  operation_key text not null,
  funnel_id text not null references funnels(id),
  user_id uuid not null references users(id) on delete cascade,
  telegram_update_id bigint,
  telegram_chat_id bigint not null,
  message_type text not null check (message_type in ('entry_notice', 'bonus', 'webinar_invite')),
  descriptor jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in (
    'pending', 'processing', 'delivered', 'retryable_failed',
    'delivery_unknown', 'dead_letter', 'suppressed'
  )),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 3 check (max_attempts > 0),
  next_attempt_at timestamptz not null default now(),
  lease_owner text,
  lease_started_at timestamptz,
  lease_expires_at timestamptz,
  request_started_at timestamptz,
  provider text,
  provider_message_id text,
  delivered_at timestamptz,
  last_error_code text,
  last_error_category text check (last_error_category in ('retryable', 'permanent', 'unknown') or last_error_category is null),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (funnel_id, operation_key),
  foreign key (funnel_id, telegram_update_id) references telegram_updates(funnel_id, update_id),
  check ((status = 'delivered') = (provider_message_id is not null and delivered_at is not null)),
  check (status = 'processing' or (lease_owner is null and lease_started_at is null and lease_expires_at is null))
);

create index if not exists delivery_operations_recovery_idx
  on delivery_operations (next_attempt_at, created_at)
  where status in ('pending', 'retryable_failed', 'processing');

create index if not exists delivery_operations_user_idx
  on delivery_operations (user_id, created_at);
