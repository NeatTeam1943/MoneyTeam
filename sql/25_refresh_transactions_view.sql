-- ============================================================================
--  Migration 25 — rebuild transactions_view after migration 22.
--
--  transactions_view was created with `t.*`, which Postgres expands and
--  freezes at creation time. Migration 22 added approval, proposed_by,
--  decided_by, decided_at and decision_note to transactions; the view never
--  picked them up, because a view does not track its source table's shape.
--
--  The failure was quiet: the ledger page reads this view, so every row came
--  back with approval undefined, the pending filter matched nothing, and the
--  mentor approval queue could never appear. Nothing errored.
--
--  Migration 13 documented this exact hazard when it rebuilt the same view.
--  Migration 22 changed the underlying table and did not.
--
--  PROPOSER NAME — read this before "improving" it.
--  A first version of this migration joined auth.users to show who proposed a
--  transaction. That made the view unreadable: it is security_invoker, so the
--  join runs with the caller's rights, and `authenticated` has no SELECT on
--  auth.users. Every query against the view failed with "permission denied for
--  table users", which the app surfaced as an empty ledger — the page loaded
--  and simply showed nothing.
--
--  public.members holds full_name and IS readable under the existing policies,
--  so the name comes from there. Do not reach into auth.* from a
--  security_invoker view.
--
--  Run after 22. Re-runnable.
-- ============================================================================

drop view if exists public.transactions_view;

create view public.transactions_view
  with (security_invoker = true) as
select
  t.*,
  case
    when public.member_role() = 'mentor' then t.payer_name
    when t.payer_name is not null then '***'
    else null
  end as payer_display,
  m.full_name as proposer_name
from public.transactions t
left join public.members m on m.id = t.proposed_by;

grant select on public.transactions_view to authenticated;