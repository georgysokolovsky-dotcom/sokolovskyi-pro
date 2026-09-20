-- Add normalized phone storage for the simplified MEN application contract.
-- Existing applications keep their legacy answers JSON, including situation.

alter table applications add column phone text;

alter table applications add constraint applications_phone_normalized_check
  check (phone is null or phone ~ '^\+?[0-9]{7,15}$');
