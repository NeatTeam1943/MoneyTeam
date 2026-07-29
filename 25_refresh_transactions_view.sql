-- ============================================================================
--  Migration 25 — rebuild transactions_view after migration 22.
--
--  transactions_view was created with `t.*`, which Postgres expands and
--  freezes at creation time. Migration 22 added approval, proposed_by,
--  decided_by, decided_at and decision_note to transactions — none of which
--  the view picked up, because a view does not track its source table's shape.
--
--  The consequence was quiet rather than loud: the ledger page reads this
--  view, so every row came back with approval undefined, the pending filter
--  matched nothing, and the mentor approval queue simply never appeared.
--  Nothing errored.
--
--  Migration 13 documented this exact hazard when it rebuilt the same view.
--  Migration 22 changed the underlying table and did not.
--
--  CREATE OR REPLACE cannot insert columns before existing ones, so this drops
--  and recreates. security_invoker keeps RLS evaluated as the calling user.
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
  pu.raw_user_meta_data ->> 'full_name' as proposer_name
from public.transactions t
left join auth.users pu on pu.id = t.proposed_by;

grant select on public.transactions_view to authenticated;
