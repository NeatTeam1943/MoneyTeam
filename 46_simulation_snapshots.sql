-- ============================================================================
--  Migration 46 — a saved simulation is a SNAPSHOT, not a set of pointers.
--
--  Migration 45 stored only the typed rows, because the shopping-list picks
--  reference items that move. That was the right instinct and the wrong fix:
--  it threw away half the scenario to avoid a problem that storing ids causes.
--
--  Storing ids and reporting the missing ones does not go far enough. It
--  catches the items that were DELETED and says nothing about the ones that
--  CHANGED — a price filled in, a quantity edited. Those reopen silently at a
--  different total than the one on screen when it was saved, which is the exact
--  failure the id approach was meant to avoid.
--
--  So the whole picked set is frozen: name, price, quantity, category, program,
--  as they were. A saved simulation always reopens showing what it showed.
--
--  `item_id` travels alongside the frozen values, used for ONE thing: matching
--  a snapshot row back to a live item when someone asks to re-apply it. It is
--  never what the snapshot displays.
--
--  Re-runnable.
-- ============================================================================

alter table public.saved_simulations
  -- [{ item_id, name, est_price, quantity, category_id, team_scope, fund_account_id }]
  add column if not exists picked jsonb not null default '[]'::jsonb,
  -- Balances as they stood. Without them a reopened simulation projects today's
  -- accounts against a months-old plan and the "after" figures are fiction.
  add column if not exists balances jsonb not null default '[]'::jsonb,
  add column if not exists snapshot_at timestamptz;

alter table public.saved_simulations
  drop constraint if exists picked_is_array,
  add constraint picked_is_array check (jsonb_typeof(picked) = 'array');

alter table public.saved_simulations
  drop constraint if exists balances_is_array,
  add constraint balances_is_array check (jsonb_typeof(balances) = 'array');

comment on column public.saved_simulations.picked is
  'The chosen shopping-list rows, frozen with their values at save time. item_id
   is kept only for re-applying against live data — never for display, because
   the live row may have changed.';

comment on column public.saved_simulations.balances is
  'Account balances at save time, so the projection a reopened simulation shows
   is the one that was saved rather than today''s accounts against an old plan.';
