-- Preserve imported IDs; do not guess historical credit values.
insert into public.course_aliases(course_id,code,source,observed_at)
select id,upper(btrim(code)),source,coalesce(fetched_at,now()) from public.courses
on conflict(course_id,code) do nothing;
insert into public.course_aliases(course_id,code,source,observed_at)
select course_id,upper(btrim(a)),max(source_url),max(fetched_at)
from public.course_requisites cross join lateral unnest(coalesce(course_aliases,'{}')) a
where length(btrim(a)) between 3 and 100 group by course_id,upper(btrim(a))
on conflict(course_id,code) do nothing;
insert into public.course_offerings(term,course_id,title,credit_options,breadth,repeatable,source,fetched_at,snapshot_kind)
select distinct x.term,c.id,c.title,c.credit_options,c.breadth,c.repeatable,c.source,c.fetched_at,'legacy_backfill'
from(select term,course_id from public.section_bundles union select term,course_id from public.course_requisites
    union select term,course_id from public.course_designations) x join public.courses c on c.id=x.course_id
on conflict(term,course_id) do nothing;
