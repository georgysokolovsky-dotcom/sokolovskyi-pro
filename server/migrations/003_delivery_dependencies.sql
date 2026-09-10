-- Preserve entry_notice -> bonus -> webinar_invite ordering across restarts.

alter table delivery_operations
  add column if not exists depends_on_operation_id uuid references delivery_operations(id);

create index if not exists delivery_operations_dependency_idx
  on delivery_operations (depends_on_operation_id);
