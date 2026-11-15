-- One academic profile holds the primary major. Permit two additional major rows.
alter table public.academic_profile_programs add column major_slot smallint;

with existing_majors as (
    select id, row_number() over (partition by user_id order by id) as slot
    from public.academic_profile_programs
    where kind = 'major'
)
update public.academic_profile_programs as program
set major_slot = existing_majors.slot
from existing_majors
where program.id = existing_majors.id;

alter table public.academic_profile_programs
    add constraint academic_profile_major_slot_shape check (
        (kind = 'major' and major_slot is not null and major_slot between 1 and 2)
        or (kind <> 'major' and major_slot is null)
    ),
    add constraint academic_profile_major_slot_unique unique (user_id, major_slot);

create function public.assign_academic_profile_major_slot()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    if new.kind <> 'major' then
        return new;
    end if;

    -- Serialize additions for the same owner. The unique slot also protects
    -- against concurrent writes from transactions with an older snapshot.
    perform user_id from public.academic_profiles where user_id = new.user_id for no key update;
    select slots.slot into new.major_slot
    from (values (1), (2)) as slots(slot)
    where not exists (
        select from public.academic_profile_programs
        where user_id = new.user_id and major_slot = slots.slot
    )
    order by slots.slot
    limit 1;

    if new.major_slot is null then
        raise exception 'You can save up to 3 majors, including your primary major.'
            using errcode = '23514';
    end if;
    return new;
end;
$$;

revoke execute on function public.assign_academic_profile_major_slot() from public, anon, authenticated;
create trigger academic_profile_assign_major_slot
    before insert on public.academic_profile_programs
    for each row execute function public.assign_academic_profile_major_slot();
