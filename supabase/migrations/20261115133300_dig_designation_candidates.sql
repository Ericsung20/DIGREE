-- Suggest only courses that carry a requested Gen Ed designation and have
-- a non-full section in the selected term. The browser never receives this list.
create function public.dig_designation_candidates(p_term text, p_codes text[], p_limit integer default 80)
returns table (course_id text)
language sql stable security invoker set search_path = ''
as $$
    select designation.course_id
    from public.course_designations as designation
    join public.courses as course on course.id = designation.course_id
    where designation.term = p_term
      and exists (
          select from public.section_bundles as bundle
          where bundle.term = p_term and bundle.course_id = designation.course_id
            and bundle.seat_status <> 'full'
      )
      and (
          ('COMM_A' = any(p_codes) and upper(designation.general_ed_code) = 'A')
          or ('COMM_B' = any(p_codes) and upper(designation.general_ed_code) = 'B')
          or ('QR_A' = any(p_codes) and upper(designation.general_ed_code) = 'Q')
          or ('QR_B' = any(p_codes) and upper(designation.general_ed_code) = 'R')
          or ('ETHNIC' = any(p_codes) and designation.ethnic_studies_code is not null)
      )
    order by designation.course_id
    limit least(greatest(p_limit, 1), 200);
$$;

revoke all on function public.dig_designation_candidates(text, text[], integer) from public, anon, authenticated;
grant execute on function public.dig_designation_candidates(text, text[], integer) to authenticated;
