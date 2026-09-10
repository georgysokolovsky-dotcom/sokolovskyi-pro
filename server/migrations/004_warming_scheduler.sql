-- Persistent per-user warming scheduler built on delivery_operations.

alter table delivery_operations drop constraint if exists delivery_operations_status_check;
alter table delivery_operations add constraint delivery_operations_status_check check (status in (
  'scheduled', 'scheduler_processing', 'pending', 'processing', 'delivered',
  'retryable_failed', 'delivery_unknown', 'dead_letter', 'suppressed', 'cancelled'
));

alter table delivery_operations drop constraint if exists delivery_operations_message_type_check;
alter table delivery_operations add constraint delivery_operations_message_type_check
  check (message_type in ('entry_notice', 'bonus', 'webinar_invite', 'warming'));

alter table delivery_operations
  add column if not exists warming_rule_id uuid references automation_rules(id),
  add column if not exists message_class text check (message_class in ('funnel_service', 'promotional')),
  add column if not exists funnel_entry_key text,
  add column if not exists scheduled_for timestamptz,
  add column if not exists earliest_execution_at timestamptz,
  add column if not exists cancellation_reason text,
  add column if not exists executed_at timestamptz,
  add column if not exists scheduler_lease_owner text,
  add column if not exists scheduler_lease_started_at timestamptz,
  add column if not exists scheduler_lease_expires_at timestamptz;

create index if not exists delivery_operations_scheduler_idx
  on delivery_operations (earliest_execution_at, created_at)
  where status in ('scheduled', 'scheduler_processing');

create unique index if not exists delivery_operations_warming_rule_entry_idx
  on delivery_operations (funnel_id, user_id, funnel_entry_key, warming_rule_id)
  where warming_rule_id is not null;
