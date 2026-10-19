-- ============================================================================
--  Migration 54 — marking one income's amount as "do not display".
--
--  Run after 53. Safe to re-run.
--
--  WHAT THIS IS, AND WHAT IT DELIBERATELY IS NOT.
--
--  This hides the amount from the SCREEN. It does not put it out of reach:
--  the column stays readable, so every total, chart and balance a student
--  sees is exactly right, and someone who opens the network tab can still
--  find the number.
--
--  That is the chosen trade, not an oversight. The point is that a parent's
--  payment should not be sitting in the middle of a shared screen in large
--  type — not that it should be secret from a determined teammate. An
--  earlier draft of this migration did take the column away (revoking it from
--  `authenticated`, serving a masked copy through a view that runs as its
--  owner). It worked, and it cost: the view had to re-state the row-level
--  policies it no longer inherited, the lines had to be hidden too, and the
--  totals had to be rebuilt from a separate aggregate because the rows could
--  no longer be added up. All of that to protect a number that can be
--  recovered by subtracting the visible rows from a visible total anyway.
--
--  If that ever becomes the requirement, the way to do it is: revoke the
--  TABLE-level select first and then grant every other column back. A bare
--  `revoke select (amount)` does nothing while a table-wide grant is in
--  place — which is exactly how the earlier draft managed to look sealed in
--  testing while a student could still read the number off the table.
-- ============================================================================

alter table public.transactions
  add column if not exists amounts_private boolean not null default false;

comment on column public.transactions.amounts_private is
  'Do not display this transaction''s amount to anyone who is not a mentor.
   A display rule, not an access rule: totals and balances still include it,
   and the column itself stays readable.';

-- Rebuilt because it is `select t.*`, and such a view freezes its column list
-- at creation — without this, amounts_private simply would not exist as far
-- as the client is concerned. See migrations 13, 25 and 33, where exactly
-- that was missed twice.
drop view if exists public.transactions_view cascade;
create view public.transactions_view
  with (security_invoker = true) as
select
  t.*,
  -- The payer mask, unchanged since migration 09.
  case
    when public.member_role() = 'mentor' then t.payer_name
    when t.payer_name is not null then '***'
    else null
  end as payer_display,
  -- The amount, for display. Null tells the screen to print '***' rather
  -- than a figure; `amount` beside it is untouched, which is what keeps the
  -- totals honest.
  case
    when t.amounts_private and coalesce(public.member_role()::text, '') <> 'mentor'
      then null
    else t.amount
  end as amount_display,
  m.full_name as proposer_name
from public.transactions t
left join public.members m on m.id = t.proposed_by;

grant select on public.transactions_view to authenticated;

-- Dropped by the cascade above; same definition as migration 23.
drop view if exists public.ledger_transactions cascade;
create view public.ledger_transactions
  with (security_invoker = true) as
select t.* from public.transactions t where t.approval = 'approved';
grant select on public.ledger_transactions to authenticated;

-- Verify:
--   select id, amount, amount_display, amounts_private
--     from public.transactions_view where amounts_private;
