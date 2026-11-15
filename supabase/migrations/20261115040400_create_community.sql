create schema if not exists private;

create table public.posts (
    id uuid primary key default gen_random_uuid(),
    author_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
    public_alias text not null default ('Student-' || replace(gen_random_uuid()::text, '-', '')),
    course_id text references public.courses (id),
    category text not null check (length(btrim(category)) > 0),
    body text not null check (length(btrim(body)) > 0),
    created_at timestamptz not null default now()
);

create index posts_course_created_at_idx on public.posts (course_id, created_at desc);

create table public.comments (
    id uuid primary key default gen_random_uuid(),
    post_id uuid not null references public.posts (id) on delete cascade,
    author_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
    public_alias text not null default ('Student-' || replace(gen_random_uuid()::text, '-', '')),
    body text not null check (length(btrim(body)) > 0),
    created_at timestamptz not null default now()
);

create index comments_post_created_at_idx on public.comments (post_id, created_at);

create table public.post_reports (
    id uuid primary key default gen_random_uuid(),
    post_id uuid not null references public.posts (id) on delete cascade,
    reporter_id uuid default auth.uid() references auth.users (id) on delete set null,
    reason text not null check (length(btrim(reason)) > 0),
    created_at timestamptz not null default now()
);

create table public.user_blocks (
    blocker_id uuid default auth.uid() references auth.users (id) on delete cascade,
    blocked_id uuid references auth.users (id) on delete cascade,
    primary key (blocker_id, blocked_id),
    check (blocker_id <> blocked_id)
);

alter table public.posts enable row level security;
alter table public.comments enable row level security;
alter table public.post_reports enable row level security;
alter table public.user_blocks enable row level security;

revoke all on public.posts, public.comments, public.post_reports, public.user_blocks
    from public, anon, authenticated;
grant select (id, public_alias, course_id, category, body, created_at),
    insert (course_id, category, body), update (course_id, category, body), delete
    on public.posts to authenticated;
grant select (id, post_id, public_alias, body, created_at),
    insert (post_id, body), update (body), delete on public.comments to authenticated;
grant insert (post_id, reason) on public.post_reports to anon, authenticated;
grant select on public.post_reports to service_role;
grant select, insert, delete on public.user_blocks to authenticated;

create function private.community_author_visible(author uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
    select not exists (
        select from public.user_blocks as block
        where (block.blocker_id = auth.uid() and block.blocked_id = author)
           or (block.blocked_id = auth.uid() and block.blocker_id = author)
    );
$$;

revoke all on function private.community_author_visible(uuid) from public, anon, authenticated;
grant usage on schema private to authenticated;
grant execute on function private.community_author_visible(uuid) to authenticated;

create policy posts_read on public.posts for select to authenticated
    using (private.community_author_visible(author_id));
create policy posts_create on public.posts for insert to authenticated
    with check (author_id = (select auth.uid()));
create policy posts_edit on public.posts for update to authenticated
    using (author_id = (select auth.uid())) with check (author_id = (select auth.uid()));
create policy posts_delete on public.posts for delete to authenticated
    using (author_id = (select auth.uid()));

create policy comments_read on public.comments for select to authenticated
    using (
        private.community_author_visible(author_id)
        and exists (select from public.posts as post where post.id = comments.post_id)
    );
create policy comments_create on public.comments for insert to authenticated
    with check (
        author_id = (select auth.uid())
        and exists (select from public.posts as post where post.id = comments.post_id)
    );
create policy comments_edit on public.comments for update to authenticated
    using (author_id = (select auth.uid())) with check (author_id = (select auth.uid()));
create policy comments_delete on public.comments for delete to authenticated
    using (author_id = (select auth.uid()));

create policy post_reports_create on public.post_reports for insert to anon, authenticated
    with check (reporter_id is not distinct from (select auth.uid()));
create policy user_blocks_read on public.user_blocks for select to authenticated
    using (blocker_id = (select auth.uid()));
create policy user_blocks_create on public.user_blocks for insert to authenticated
    with check (blocker_id = (select auth.uid()));
create policy user_blocks_delete on public.user_blocks for delete to authenticated
    using (blocker_id = (select auth.uid()));

create view public.community_posts with (security_invoker = true) as
    select id, public_alias, course_id, category, body, created_at from public.posts;

create view public.community_comments with (security_invoker = true) as
    select id, post_id, public_alias, body, created_at from public.comments;

revoke all on public.community_posts, public.community_comments from public, anon, authenticated;
grant select, delete, insert (course_id, category, body), update (course_id, category, body)
    on public.community_posts to authenticated;
grant select, delete, insert (post_id, body), update (body)
    on public.community_comments to authenticated;
