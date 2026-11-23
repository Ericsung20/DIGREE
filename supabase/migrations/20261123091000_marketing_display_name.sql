-- Display-only correction. MARKETNG is UW's official code, not an identity typo.
-- Reversible by a forward migration restoring the previous view/RPC definitions.
-- No course IDs, aliases, student records or requirement definitions are changed.
create or replace view public.catalog_courses with(security_invoker=true) as
select c.*, coalesce(a.aliases,array[c.code]) as aliases,
    regexp_replace(case when cardinality(a.aliases)>1 and not exists(
        select from unnest(a.aliases) x where substring(x from '[0-9]+[A-Z]?$') is distinct from substring(c.code from '[0-9]+[A-Z]?$')
    ) then (select string_agg(replace(regexp_replace(x,' [0-9]+[A-Z]?$',''),'COMP SCI','CS'),'/' order by (x=c.code) desc,x)
        from unnest(a.aliases) x) || ' ' || substring(c.code from '[0-9]+[A-Z]?$')
    else replace(c.code,'COMP SCI ','CS ') end,'\mMARKETNG\M','Marketing','g') as display_code
from public.courses c
left join lateral(select array_agg(code order by (code=c.code) desc,code) aliases from public.course_aliases where course_id=c.id) a on true;

create or replace function public.search_catalog_courses(p_query text,p_limit integer default 20)
returns setof public.catalog_courses language sql stable security invoker set search_path = '' as $$
    with q as(select regexp_replace(regexp_replace(regexp_replace(upper(btrim(p_query)),'\mMARKETING\M','MARKETNG','g'),'^CS[[:space:]]*([0-9]|$)','COMP SCI \1'),'[[:space:]]+',' ','g') needle)
    select c.* from public.catalog_courses c cross join q
    where length(q.needle)>=2 and (c.code ilike '%'||replace(replace(q.needle,'%','\%'),'_','\_')||'%'
        or exists(select from unnest(c.aliases) a where a ilike '%'||replace(replace(q.needle,'%','\%'),'_','\_')||'%'))
    order by (q.needle=any(c.aliases)) desc,c.code,c.id limit least(greatest(p_limit,1),100);
$$;
