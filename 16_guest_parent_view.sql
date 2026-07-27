-- ============================================================================
--  Migration 16 — "parent" access: a signed-out, read-only guest view.
--
--  Parents get exactly two screens: לוח בקרה and תנועות, with the payer name
--  hidden the same way students see it. They never sign in with Google; the
--  app calls supabase.auth.signInAnonymously(), which issues a real JWT
--  carrying is_anonymous = true. That is what identifies a guest here.
--
--  IMPORTANT — one dashboard toggle is required before this works:
--     Supabase → Authentication → Sign In / Providers → Anonymous sign-ins.
--  Leave it off and the parent button simply errors; nothing else breaks.
--
--  Security shape, deliberately:
--  Guests are NOT given a policy on public.transactions. If they were, they
--  could query the table directly and read payer_name, notes and receipt
--  paths — RLS filters rows, never columns. Instead they read purpose-built
--  SECURITY DEFINER views that physically omit those columns. The views carry
--  their own membership test in the WHERE clause, so bypassing the base
--  table's RLS does not also bypass the pending-approval gate: a provisioned
--  Google user with no members row still sees nothing.
--
--  Run after 15. Re-runnable.
-- ============================================================================

create or replace function public.is_guest()
returns boolean
language sql
stable
as $$
  select coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false);
$$;

revoke all on function public.is_guest() from public;
grant execute on function public.is_guest() to authenticated;

-- Who is allowed to read the guest views at all.
create or replace function public.can_view_public()
returns boolean
language sql
stable
as $$
  select public.member_role() is not null or public.is_guest();
$$;

revoke all on function public.can_view_public() from public;
grant execute on function public.can_view_public() to authenticated;

-- ---------------------------------------------------------------- ledger ----
-- Column-censored transactions. Absent by design: payer_name, notes,
-- receipt_url, created_by. Receipt NUMBERS stay (they identify a document
-- without handing over the file itself).
drop view if exists public.transactions_guest;

create view public.transactions_guest as
select
  t.id, t.season_id, t.date, t.type, t.amount, t.currency,
  t.account_id, t.to_account_id, t.income_source_id, t.category_id,
  t.budget_id, t.vendor, t.description,
  t.receipt_no, t.receipt_number, t.team_scope,
  t.fx_currency, t.fx_amount, t.fx_rate
from public.transactions t
where public.can_view_public();

grant select on public.transactions_guest to authenticated;

-- -------------------------------------------------------------- balances ----
-- Same arithmetic as account_balances, but readable by a guest. Kept as a
-- separate object rather than relaxing the original, so the mentor-facing
-- view kept its security_invoker semantics untouched.
drop view if exists public.account_balances_guest;

create view public.account_balances_guest as
select
  a.id, a.name, a.type, a.currency,
  a.opening_balance
    + coalesce(sum(t.amount) filter (where t.type = 'income'   and t.account_id    = a.id), 0)
    - coalesce(sum(t.amount) filter (where t.type = 'expense'  and t.account_id    = a.id), 0)
    - coalesce(sum(t.amount) filter (where t.type = 'transfer' and t.account_id    = a.id), 0)
    + coalesce(sum(t.amount) filter (where t.type = 'transfer' and t.to_account_id = a.id), 0)
    as balance
from public.accounts a
left join public.transactions t on t.account_id = a.id or t.to_account_id = a.id
where public.can_view_public()
group by a.id, a.name, a.type, a.currency, a.opening_balance;

grant select on public.account_balances_guest to authenticated;

-- ------------------------------------------------------------- reference ----
-- Names needed to render those two screens. All are labels the team already
-- prints on public material; none carry personal data.
do $$
declare r record;
begin
  for r in select unnest(array['seasons','accounts','categories','income_sources']) as tbl loop
    execute format('drop policy if exists %1$I_guest_read on public.%1$I', r.tbl);
    execute format(
      'create policy %1$I_guest_read on public.%1$I for select using (public.is_guest())',
      r.tbl);
  end loop;
end $$;

-- Everything not named above stays closed to guests: shopping_items, budgets,
-- transaction_lines, members, vendors, priority_levels, shopping_templates and
-- the receipts storage bucket. The dashboard hides the panels that would have
-- needed them rather than querying and silently rendering an empty chart.
