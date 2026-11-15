alter table public.posts add column title text
    check (title is null or length(btrim(title)) between 1 and 160);
alter table public.comments add column parent_id uuid;
alter table public.comments add constraint comments_id_post_key unique (id, post_id);
alter table public.comments add constraint comments_parent_in_post
    foreign key (parent_id, post_id) references public.comments (id, post_id)
    on delete set null (parent_id);

create or replace view public.community_posts with (security_invoker = true) as
    select id, public_alias, course_id, category, body, created_at, title from public.posts;
create or replace view public.community_comments with (security_invoker = true) as
    select id, post_id, public_alias, body, created_at, parent_id from public.comments;
grant select (title), insert (title), update (title) on public.posts to authenticated;
grant select (parent_id), insert (parent_id) on public.comments to authenticated;
grant insert (title), update (title) on public.community_posts to authenticated;
grant insert (parent_id) on public.community_comments to authenticated;

create table public.post_votes (
    post_id uuid not null references public.posts (id) on delete cascade,
    voter_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
    value smallint not null check (value in (-1, 1)),
    primary key (post_id, voter_id)
);
alter table public.post_votes enable row level security;
revoke all on public.post_votes from public, anon, authenticated;

create function public.community_vote_totals(p_ids uuid[])
returns table (post_id uuid, score integer, my_vote smallint)
language sql stable security definer set search_path = ''
as $$
    select p.id, coalesce(sum(v.value), 0)::integer,
        coalesce(max(v.value) filter (where v.voter_id = auth.uid()), 0)::smallint
    from public.posts p
    left join public.post_votes v on v.post_id = p.id
    where auth.uid() is not null and p.id = any(p_ids)
        and private.community_author_visible(p.author_id)
    group by p.id;
$$;

create function public.set_community_vote(p_post uuid, p_value smallint)
returns table (post_id uuid, score integer, my_vote smallint)
language plpgsql security definer set search_path = ''
as $$
begin
    if auth.uid() is null or not exists (
        select from public.posts p where p.id = p_post and private.community_author_visible(p.author_id)
    ) then
        raise exception 'Post unavailable' using errcode = '42501';
    end if;
    if p_value is null or p_value not in (-1, 0, 1) then
        raise exception 'Invalid vote' using errcode = '22023';
    end if;
    if p_value = 0 then
        delete from public.post_votes v where v.post_id = p_post and v.voter_id = auth.uid();
    else
        insert into public.post_votes values (p_post, auth.uid(), p_value)
        on conflict on constraint post_votes_pkey do update set value = excluded.value;
    end if;
    return query select * from public.community_vote_totals(array[p_post]);
end;
$$;
revoke all on function public.community_vote_totals(uuid[]), public.set_community_vote(uuid, smallint)
    from public, anon, authenticated;
grant execute on function public.community_vote_totals(uuid[]), public.set_community_vote(uuid, smallint)
    to authenticated;
