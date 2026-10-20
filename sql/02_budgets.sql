-- ============================================================================
--  Migration 02 — Budgets (per season, per category, with burn-down)
--  Run after 01_foundation.sql. Re-runnable.
-- ============================================================================

create table if not exists public.budgets (
  id          uuid primary key default gen_random_uuid(),
  season_id   uuid not null references public.seasons(id) on delete cascade,
  category_id uuid references public.categories(id) on delete cascade,  -- null = overall
  amount      numeric(12,2) not null check (amount >= 0),
  notes       text,
  created_at  timestamptz not null default now(),
  unique (season_id, category_id)
);

-- One "overall" (uncategorised) budget per season.
create unique index if not exists budgets_overall_uniq
  on public.budgets (season_id) where category_id is null;

create index if not exists ix_budgets_season on public.budgets(season_id);

alter table public.budgets enable row level security;
alter table public.budgets force  row level security;

-- Read: any member. Write: mentors (budgets are planning/authority).
drop policy if exists budgets_read  on public.budgets;
drop policy if exists budgets_write on public.budgets;
create policy budgets_read on public.budgets
  for select using (public.member_role() is not null);
create policy budgets_write on public.budgets
  for all using (public.member_role() = 'mentor')
          with check (public.member_role() = 'mentor');
