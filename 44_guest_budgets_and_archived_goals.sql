-- ============================================================================
--  Migration 44 — budgets for guests, and archived goals stop counting.
--
--  TWO UNRELATED THINGS, both small, both in the database.
--
--  ── 1. Guests can see budgets ──────────────────────────────────────────────
--
--  Guests already see transactions and balances. Budgets are the context that
--  makes those numbers mean anything: a parent looking at "spent 26,000" has no
--  way to know whether that was the plan.
--
--  A separate view rather than relaxing RLS on `budgets`, following the pattern
--  set in migration 16 — the mentor-facing table keeps its policies untouched,
--  and what a guest may read is stated in one place instead of hidden in a
--  policy expression.
--
--  Budgets carry no personal data — a category, an amount, a program — so
--  unlike transactions there is nothing to strip.
--
--  ── 2. An archived goal no longer holds money ──────────────────────────────
--
--  Archiving a goal means it is done with: the purchase happened, or the goal
--  was dropped. Either way its reservation is not a live claim on the balance,
--  and continuing to subtract it makes "available" understate what the team
--  actually has — quietly, and in three separate places.
--
--  Fixed at the SOURCE rather than at each reader: a view that already excludes
--  archived goals cannot be forgotten by a future caller, which a convention
--  ("remember to filter") certainly would be.
--
--  Re-runnable.
-- ============================================================================

-- ------------------------------------------------------------- budgets ------
drop view if exists public.budgets_guest;

create view public.budgets_guest as
select
  b.id, b.season_id, b.category_id, b.amount, b.team_scope, b.calc
from public.budgets b
where public.can_view_public();

grant select on public.budgets_guest to authenticated;

-- The spend behind each budget, so a guest sees utilisation and not just the
-- ceiling. Amounts and the budget they hit; no description, no vendor, no
-- author — the same reticence transactions_guest already applies.
drop view if exists public.ledger_lines_guest;

create view public.ledger_lines_guest as
select
  l.id, l.transaction_id, l.budget_id, l.category_id,
  l.amount, l.team_scope, t.season_id, t.date,
  t.team_scope as tx_team_scope
from public.transaction_lines l
join public.transactions t on t.id = l.transaction_id
where t.approval = 'approved'
  and public.can_view_public();

grant select on public.ledger_lines_guest to authenticated;

-- ------------------------------------------------- goals that still count ---
-- Every screen asking "how much is reserved" should read THIS, not the table.
drop view if exists public.active_goals;

create view public.active_goals as
select *
from public.savings_goals
where archived_at is null;

grant select on public.active_goals to authenticated;

-- The alert job reads budget_alert_candidates, which does not touch goals, so
-- it needs no change. The app's three readers switch to active_goals.
comment on view public.active_goals is
  'Goals that still hold money. Archived goals are excluded: archiving means
   the purchase happened or the goal was dropped, so its reservation is no
   longer a claim on the balance.';
