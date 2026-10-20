-- ============================================================================
--  Migration 23 — make the mistake impossible instead of detectable.
--
--  Migration 22 left every page responsible for remembering
--  .eq('approval','approved'). That is a rule enforced by discipline, and
--  scripts/check-approval-filter.mjs existed to catch the day discipline
--  failed — which it already had, once, before the script was written.
--
--  A filter you can forget is a filter that will eventually be forgotten. The
--  fix is not a better reminder; it is to hand the application a source that
--  has no unapproved rows in it at all. Exactly the pattern migration 16 used
--  for the parent view, applied where it should have been from the start.
--
--     ledger_transactions   approved transactions, nothing else
--     ledger_lines          their lines, nothing else
--
--  Aggregations read these. The raw tables stay available for the two places
--  that genuinely need pending rows — the approval queue and editing a
--  proposal — and those are now the exception rather than the default.
--
--  security_invoker keeps RLS evaluated as the calling user, so this widens
--  nothing: a view cannot show a row its reader could not already see.
--
--  Run after 22. Re-runnable.
-- ============================================================================

drop view if exists public.ledger_transactions;

create view public.ledger_transactions
  with (security_invoker = true) as
select t.*
from public.transactions t
where t.approval = 'approved';

grant select on public.ledger_transactions to authenticated;

drop view if exists public.ledger_lines;

create view public.ledger_lines
  with (security_invoker = true) as
select l.*
from public.transaction_lines l
join public.transactions t on t.id = l.transaction_id
where t.approval = 'approved';

grant select on public.ledger_lines to authenticated;

-- A line's season and date live on its parent, and the aggregations need both
-- for filtering. Exposing them here means a caller never has to join back to
-- transactions — and therefore never has a reason to reach for the raw table.
drop view if exists public.ledger_lines_full;

create view public.ledger_lines_full
  with (security_invoker = true) as
select
  l.id, l.transaction_id, l.budget_id, l.amount, l.description,
  l.shopping_item_id, l.fx_currency, l.fx_amount, l.fx_rate,
  l.team_scope, l.category_id,
  t.season_id, t.date, t.team_scope as tx_team_scope, t.type as tx_type
from public.transaction_lines l
join public.transactions t on t.id = l.transaction_id
where t.approval = 'approved';

grant select on public.ledger_lines_full to authenticated;
