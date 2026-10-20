-- ============================================================================
--  Migration 45 — saved simulations.
--
--  A scenario can already be kept in the browser (localStorage, one per
--  season). That covers "I stepped away and came back". It does not cover
--  "keep this one and show it to the team", which needs a name, a home that
--  survives a cleared cache, and a link someone else can open.
--
--  ── What is saved, and what deliberately is not ─────────────────────────────
--
--  Only the MANUALLY ENTERED parts:
--
--      extras      ad-hoc rows somebody typed
--      incomes     expected income somebody typed
--      fund_from   the default account
--
--  NOT the shopping-list picks, the per-item funding, or the estimated prices.
--  Those reference rows in shopping_items, which move: an item gets bought, its
--  price is filled in, someone deletes it. A saved scenario pointing at them
--  would degrade silently — reopened in a month it would show a different total
--  with no indication that anything had changed, which is worse than not
--  offering to save it.
--
--  So a reopened simulation restores the typed figures and starts fresh on the
--  list. The list is live data; the typed rows are the thinking.
--
--  ── Sharing ────────────────────────────────────────────────────────────────
--
--  A saved simulation is readable by anyone in the team who has its id. It is a
--  plan, not a record — nothing here changes a balance — and a link that only
--  works for its author is not a share.
--
--  Re-runnable.
-- ============================================================================

create table if not exists public.saved_simulations (
  id          uuid primary key default gen_random_uuid(),
  season_id   uuid references public.seasons(id) on delete cascade,
  name        text not null check (btrim(name) <> ''),
  note        text,

  -- The typed parts, as given. jsonb rather than columns because the shape is
  -- the simulation's business and will change with it; a saved scenario that
  -- fails to open because a column was added later would be a poor trade for
  -- schema tidiness.
  extras      jsonb not null default '[]'::jsonb,
  incomes     jsonb not null default '[]'::jsonb,
  fund_from   uuid references public.accounts(id) on delete set null,

  created_by  uuid references public.members(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint extras_is_array  check (jsonb_typeof(extras) = 'array'),
  constraint incomes_is_array check (jsonb_typeof(incomes) = 'array')
);

create index if not exists ix_sim_season on public.saved_simulations (season_id, created_at desc);

alter table public.saved_simulations enable row level security;
alter table public.saved_simulations force row level security;

-- Anyone in the team can read any saved simulation. Sharing a link is the
-- point, and a plan carries nothing private.
drop policy if exists sims_read on public.saved_simulations;
create policy sims_read on public.saved_simulations for select
  using (public.member_role() is not null);

drop policy if exists sims_insert on public.saved_simulations;
create policy sims_insert on public.saved_simulations for insert
  with check (public.can_propose());

-- Edit and delete your own; mentors can manage any. A student who saved a
-- scenario should be able to rename or drop it without asking, and a mentor
-- needs to be able to clear out a list that has filled with experiments.
drop policy if exists sims_update on public.saved_simulations;
create policy sims_update on public.saved_simulations for update
  using (created_by = auth.uid() or public.member_role() = 'mentor')
  with check (created_by = auth.uid() or public.member_role() = 'mentor');

drop policy if exists sims_delete on public.saved_simulations;
create policy sims_delete on public.saved_simulations for delete
  using (created_by = auth.uid() or public.member_role() = 'mentor');

grant select, insert, update, delete on public.saved_simulations to authenticated;

-- Stamp the author and the edit time, rather than trusting the client to send
-- them — created_by is what the delete policy rests on.
create or replace function public.stamp_saved_simulation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_stamp_saved_simulation on public.saved_simulations;
create trigger trg_stamp_saved_simulation
  before insert or update on public.saved_simulations
  for each row execute function public.stamp_saved_simulation();
