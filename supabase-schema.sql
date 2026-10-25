-- Routine Analytics: isolated cloud table for the no-SMS rebuild.
-- Run this entire script in Supabase Dashboard > SQL Editor.
-- It creates a NEW table. It does not drop, rename, or modify public.tasks.

create table if not exists public.routine_analytics_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(trim(title)) between 1 and 120),
  notes text not null default '',
  category text not null default 'Study'
    check (category in ('Study','Work','Personal','Health','Coding','Other')),
  priority text not null default 'Medium'
    check (priority in ('High','Medium','Low')),
  due_date date,
  due_time time,
  status text not null default 'pending'
    check (status in ('pending','completed')),
  created_at timestamptz not null default now()
);

alter table public.routine_analytics_tasks enable row level security;

drop policy if exists "ra_tasks_select_own" on public.routine_analytics_tasks;
create policy "ra_tasks_select_own"
on public.routine_analytics_tasks for select to authenticated
using ((select auth.uid()) = user_id);

drop policy if exists "ra_tasks_insert_own" on public.routine_analytics_tasks;
create policy "ra_tasks_insert_own"
on public.routine_analytics_tasks for insert to authenticated
with check ((select auth.uid()) = user_id);

drop policy if exists "ra_tasks_update_own" on public.routine_analytics_tasks;
create policy "ra_tasks_update_own"
on public.routine_analytics_tasks for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

drop policy if exists "ra_tasks_delete_own" on public.routine_analytics_tasks;
create policy "ra_tasks_delete_own"
on public.routine_analytics_tasks for delete to authenticated
using ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.routine_analytics_tasks to authenticated;
notify pgrst, 'reload schema';
