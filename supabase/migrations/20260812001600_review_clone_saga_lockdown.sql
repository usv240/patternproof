-- Final hardening for the fenced review-clone saga.
-- Run immediately after 013_review_clone_saga.sql and before 014.

alter table public.review_revision_clone
  add constraint review_revision_clone_distinct_revision_check
  check (target_revision_id <> source_revision_id);

-- The legacy one-step RPC can strand the brief between withdrawal and clone.
-- All service callers must use the fenced reserve + copy + commit saga.
revoke execute on function public.withdraw_customer_review(uuid, text)
  from service_role;

-- Cleanup for an expired clone may coexist with one new live reservation. Their
-- target revision UUID paths are distinct, so uniqueness applies only to live
-- reserved work; including cleaning rows can deadlock the retry worker.
drop index if exists public.review_revision_clone_one_active_brief_idx;
create unique index review_revision_clone_one_active_brief_idx
  on public.review_revision_clone (brief_id)
  where state = 'reserved';
