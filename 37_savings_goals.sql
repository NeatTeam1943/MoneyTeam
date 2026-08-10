-- ============================================================================
--  Migration 37 — savings goals.
--
--  A goal is "we want ₪12,000 for a new CNC by March". It is not a budget: a
--  budget is a ceiling on spending that already has a category, while a goal is
--  a target to reach and may have no category at all.
--
--  Kept as its own table rather than a flag on budgets, because the two answer
--  opposite questions — "how much may we spend on this" versus "how much have
--  we put aside for this" — and overloading one row with both would make every
--  budget query decide which kind it is looking at.
--
--  Progress is NOT stored. It is derived from the accounts, the same way every
--  other figure in this app is, so it cannot drift.
--
--  Re-runnable.
-- ============================================================================

create table if not exists public.savings_goals (
  id           uuid primary key default gen_random_uuid(),
  season_id    uuid references public.seasons(id) on delete cascade,
  name         text not null,
  target       numeric(12,2) not null check (target > 0),
  target_date  date,
  category_id  uuid references public.categories(id) on delete set null,
  team_scope   team_scope not null default 'both',
  notes        text,
  -- Money already earmarked toward this goal. Set by a mentor when a decision
  -- is made to reserve funds; it is a stated commitment, not a derived figure,
  -- so unlike everything else here it IS stored.
  reserved     numeric(12,2) not null default 0 check (reserved >= 0),
  created_at   timestamptz not null default now(),
  created_by   uuid references public.members(id) on delete set null
);

create index if not exists ix_goals_season on public.savings_goals (season_id);

alter table public.savings_goals enable row level security;
alter table public.savings_goals force row level security;

drop policy if exists goals_read on public.savings_goals;
create policy goals_read on public.savings_goals for select
  using (public.member_role() is not null);

-- Anyone who may propose can suggest a goal; only mentors may change or remove
-- one. A goal is a plan, and plans are worth collecting widely — but a goal
-- other people are working toward should not vanish on one person's decision.
drop policy if exists goals_insert on public.savings_goals;
create policy goals_insert on public.savings_goals for insert
  with check (public.can_propose());

drop policy if exists goals_update on public.savings_goals;
create policy goals_update on public.savings_goals for update
  using (public.member_role() = 'mentor') with check (public.member_role() = 'mentor');

drop policy if exists goals_delete on public.savings_goals;
create policy goals_delete on public.savings_goals for delete
  using (public.member_role() = 'mentor');

grant select, insert on public.savings_goals to authenticated;
grant update, delete on public.savings_goals to authenticated;
