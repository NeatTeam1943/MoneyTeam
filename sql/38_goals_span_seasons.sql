-- ============================================================================
--  Migration 38 — goals are not season-specific.
--
--  Migration 37 hung goals off a season. That was wrong: "save for a CNC" does
--  not end when the season does, and the money does not reset either — the
--  balance carries across, which is exactly what migration 35's opening-balance
--  figure exists to show.
--
--  Three consequences of the old shape, in rising order of seriousness:
--
--    * a goal created in 2026 vanished from the screen the moment the season
--      picker moved to 2027, while the money it reserved was still held;
--    * the same goal had to be re-created per season to stay visible, and two
--      copies then reserved the same shekel twice;
--    * `on delete cascade` meant deleting a season deleted its goals outright.
--
--  season_id becomes optional and is kept only as "which season was this
--  created in" — useful context, never a filter. Existing rows keep their
--  value; nothing is lost.
--
--  Re-runnable.
-- ============================================================================

-- Deleting a season must not take goals with it. The column stays for
-- provenance, so it is nulled rather than dropped.
alter table public.savings_goals
  drop constraint if exists savings_goals_season_id_fkey;

alter table public.savings_goals
  add constraint savings_goals_season_id_fkey
  foreign key (season_id) references public.seasons(id) on delete set null;

alter table public.savings_goals
  alter column season_id drop not null;

comment on column public.savings_goals.season_id is
  'Which season the goal was created in. Provenance only — goals span seasons and must never be filtered by this.';

-- The season index is pointless once nothing filters by season, and a goals
-- list is short enough not to need one at all.
drop index if exists ix_goals_season;

-- An achieved goal should be able to leave the list without being deleted, now
-- that goals persist instead of ageing out with their season.
alter table public.savings_goals
  add column if not exists archived_at timestamptz;

create index if not exists ix_goals_open
  on public.savings_goals (created_at)
  where archived_at is null;
