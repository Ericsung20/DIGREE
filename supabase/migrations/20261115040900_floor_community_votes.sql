-- Keep individual up/down votes, but never expose a negative aggregate score.
create or replace function public.community_vote_totals(p_ids uuid[])
returns table (post_id uuid, score integer, my_vote smallint)
language sql stable security definer set search_path = ''
as $$
    select p.id, greatest(coalesce(sum(v.value), 0), 0)::integer,
        coalesce(max(v.value) filter (where v.voter_id = auth.uid()), 0)::smallint
    from public.posts p
    left join public.post_votes v on v.post_id = p.id
    where auth.uid() is not null and p.id = any(p_ids)
        and private.community_author_visible(p.author_id)
    group by p.id;
$$;
