create extension if not exists pgcrypto;

create table if not exists public.shorts_queue (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  drive_file_id text not null,
  file_name text not null,
  file_size bigint,
  mime_type text,
  title text not null default '',
  description text not null default '',
  tags text[] not null default '{}',
  status text not null default 'pending'
    check (status in ('pending','approved','rejected','scheduled','published','error')),
  youtube_video_id text,
  youtube_url text,
  publish_at timestamptz,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_user_id, drive_file_id)
);

create index if not exists shorts_queue_owner_status_created
  on public.shorts_queue (owner_user_id, status, created_at);

alter table public.shorts_queue enable row level security;

drop policy if exists "Owners can view their own Shorts" on public.shorts_queue;
create policy "Owners can view their own Shorts"
  on public.shorts_queue for select to authenticated
  using (auth.uid() = owner_user_id);

drop policy if exists "Owners can update their own Shorts" on public.shorts_queue;
create policy "Owners can update their own Shorts"
  on public.shorts_queue for update to authenticated
  using (auth.uid() = owner_user_id)
  with check (auth.uid() = owner_user_id);

-- GitHub Actions inserts rows using the service-role key.
-- Do not add an anonymous/public insert policy.
grant select, update on public.shorts_queue to authenticated;
