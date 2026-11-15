-- Search is read-only. A request is sent only after the search result is selected.
create function public.find_friend_by_netid(p_netid text)
returns table (id uuid, netid text)
language sql stable security definer set search_path = ''
as $$
    select account.id, split_part(lower(account.email), '@', 1)
    from auth.users as account
    where auth.uid() is not null
      and account.id <> auth.uid()
      and account.email_confirmed_at is not null
      and lower(account.email) = lower(btrim(p_netid)) || '@wisc.edu'
      and lower(btrim(p_netid)) ~ '^[a-z][a-z0-9._-]{1,31}$'
    limit 1;
$$;

revoke all on function public.find_friend_by_netid(text) from public, anon, authenticated;
grant execute on function public.find_friend_by_netid(text) to authenticated;
