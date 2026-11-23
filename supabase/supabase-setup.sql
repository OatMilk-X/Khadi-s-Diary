-- Khadi's Diary: lock the cloud table down so each signed-in user can only touch their own row.
-- Run once in Supabase → SQL Editor.
--
-- Also in Supabase → Authentication → URL Configuration:
--   * add the address where you host the app to "Redirect URLs"
--   * (optional) edit the "Magic Link" email template to include {{ .Token }} so the 6-8 digit code appears in the email
--     (needed on iPhone when the app is installed to the Home Screen).

create table if not exists public.user_data (
  email      text primary key,
  payload    jsonb       not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.user_data enable row level security;

-- drop every old policy (including any "allow everyone" ones)
do $$
declare p record;
begin
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'user_data' loop
    execute format('drop policy %I on public.user_data', p.policyname);
  end loop;
end $$;

revoke all on public.user_data from anon;
grant select, insert, update, delete on public.user_data to authenticated;

create policy "own row: select" on public.user_data for select to authenticated
  using (lower(auth.jwt() ->> 'email') = lower(email));
create policy "own row: insert" on public.user_data for insert to authenticated
  with check (lower(auth.jwt() ->> 'email') = lower(email));
create policy "own row: update" on public.user_data for update to authenticated
  using (lower(auth.jwt() ->> 'email') = lower(email))
  with check (lower(auth.jwt() ->> 'email') = lower(email));
create policy "own row: delete" on public.user_data for delete to authenticated
  using (lower(auth.jwt() ->> 'email') = lower(email));

-- ---------------------------------------------------------------------------
-- Shared AI (Edge Function "pet-chat"): per-user daily message counter.
-- Only the Edge Function (service role) can touch it.
-- ---------------------------------------------------------------------------
create table if not exists public.ai_usage (
  email text not null,
  day   date not null,
  count int  not null default 0,
  primary key (email, day)
);
alter table public.ai_usage enable row level security;   -- no policies = no access for app users
revoke all on public.ai_usage from anon, authenticated;

create or replace function public.bump_ai_usage(p_email text, p_limit int)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare n int;
begin
  insert into ai_usage (email, day, count)
  values (lower(p_email), (now() at time zone 'Europe/Prague')::date, 1)
  on conflict (email, day) do update
    set count = ai_usage.count + 1
    where ai_usage.count < p_limit
  returning count into n;
  return coalesce(n, -1);   -- -1 = limit reached
end $$;

revoke all on function public.bump_ai_usage(text, int) from public, anon, authenticated;
grant execute on function public.bump_ai_usage(text, int) to service_role;
