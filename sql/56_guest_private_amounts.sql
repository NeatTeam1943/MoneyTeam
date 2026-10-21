-- ============================================================================
--  Migration 56 — the "hide amounts" flag reaches the guest view too.
--
--  Run after 55. Safe to re-run.
--
--  THE BUG. An income marked "hide amounts from non-mentors" still showed its
--  full figure in parent/guest mode — in the table, in the detail panel, and
--  on every breakdown line. The flag was saved correctly and the screen was
--  masking correctly; the row simply never carried the flag.
--
--  transactions_view is `select t.*`, so migration 54's new column appeared
--  there the moment the view was rebuilt. transactions_guest is NOT: it lists
--  its columns one by one, on purpose, because that list is what keeps a
--  parent from seeing payer names, receipts and notes. A column list that
--  exists to withhold things also withholds the things you meant to add, and
--  it does it silently — the client asked for `select *`, got every column the
--  view had, and `amounts_private` came back undefined. `undefined && …` is
--  falsy, so the mask was simply never applied and nothing anywhere reported
--  a problem.
--
--  This is the fourth time a view's column list has gone stale behind a new
--  column (see 13, 25, 33 and 54). The difference here is that the other three
--  were `t.*` views that needed rebuilding, and this one is a deliberate list
--  that needs EXTENDING — so a rebuild of the `t.*` views, which is what those
--  migrations taught, would not have caught it. scripts/check-stale-copy.mjs
--  now fails the build when a column the UI masks on is missing from any view
--  the UI reads transactions from.
--
--  WHAT THE GUEST GETS. The flag, and the real amount beside it — exactly as a
--  signed-in student does. The masking is a display rule by design: the point
--  is that a parent's payment should not be sitting in large type on a shared
--  screen, not that it should be cryptographically secret from someone reading
--  the network tab. Keeping `amount` intact is what keeps every total, balance
--  and chart on the guest dashboard correct; blanking it here would leave a
--  parent looking at a season total that does not match its own rows.
-- ============================================================================

drop view if exists public.transactions_guest;

create view public.transactions_guest as
select
  t.id, t.season_id, t.date, t.type, t.amount, t.currency,
  t.account_id, t.to_account_id, t.income_source_id, t.category_id,
  t.budget_id, t.vendor, t.description,
  t.receipt_no, t.receipt_number, t.team_scope,
  t.fx_currency, t.fx_amount, t.fx_rate,
  -- New here. Deliberately the only addition: everything withheld from a
  -- guest above stays withheld.
  t.amounts_private
from public.transactions t
where public.can_view_public()
  and t.approval = 'approved';

-- Both roles, as before: a signed-out parent reads as anon, and a signed-in
-- one who is not a member still falls through to the guest view.
grant select on public.transactions_guest to authenticated, anon;

-- The REST API serves from a cached copy of the schema, so a view rebuilt
-- while it is running keeps its old column list until the cache turns over.
notify pgrst, 'reload schema';

-- Verify — as a guest would see it:
--   select id, amount, amounts_private from public.transactions_guest
--    where amounts_private;
--   -- amounts_private must come back true, not null and not missing.
