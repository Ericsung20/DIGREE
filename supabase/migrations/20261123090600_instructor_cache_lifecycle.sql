create or replace function private.sync_bundle_instructors()
returns trigger language plpgsql security definer set search_path='' as $$
begin
    if tg_op='DELETE' then
        update public.section_bundles set instructors='{}' where(term,course_id,bundle_id)=(old.term,old.course_id,old.bundle_id);
        return old;
    end if;
    update public.section_bundles set instructors=new.instructors where(term,course_id,bundle_id)=(new.term,new.course_id,new.bundle_id);
    return new;
end;
$$;
drop trigger instructors_sync_bundle on public.course_instructors;
create trigger instructors_sync_bundle after insert or update or delete on public.course_instructors
    for each row execute function private.sync_bundle_instructors();
