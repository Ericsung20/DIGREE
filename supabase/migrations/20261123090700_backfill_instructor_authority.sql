insert into public.course_instructors(term,course_id,bundle_id,instructors,source_url,fetched_at)
select b.term,b.course_id,b.bundle_id,b.instructors,'legacy_bundle_cache',coalesce(c.fetched_at,now())
from public.section_bundles b join public.courses c on c.id=b.course_id where cardinality(b.instructors)>0
on conflict(term,course_id,bundle_id) do nothing;
