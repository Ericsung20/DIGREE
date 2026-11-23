-- Expand-only: existing source metadata remains intact. A recognized UW
-- equivalent is sufficient; source details are optional for mapped awards.
-- Rollback requires a forward migration after reconciling source-less awards.
alter table public.transfer_credits
    alter column institution drop not null,
    alter column source_course drop not null;
alter table public.transfer_credits add constraint transfer_identifiable_credit
    check(equivalent_course_id is not null or nullif(btrim(source_course),'') is not null);
-- Existing length checks accept NULL but continue to reject blank values.
-- The source and equivalent uniqueness indexes and owner RLS remain in force.
